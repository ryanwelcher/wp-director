import { useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { api, responseErrorMessage } from './utils/api.js';
import { errorMessage, isAbortError } from './utils/actions.js';
import { readSSE } from './utils/sse.js';
import { pickDriveFolder } from './utils/googlePicker.js';

// Last-used Drive folder, remembered globally (id + name) so repeat uploads
// skip the picker. Kept in localStorage per the Phase 2 plan.
const FOLDER_KEY = 'wpdirector.driveFolder';

// Last-used upload format ('webm' | 'mp4'), remembered globally (Phase 3).
// WebM uploads the raw capture instantly; MP4 transcodes first but shares more
// widely. Default to WebM (fast).
const FORMAT_KEY = 'wpdirector.driveFormat';

function readRememberedFormat() {
  try {
    return localStorage.getItem(FORMAT_KEY) === 'mp4' ? 'mp4' : 'webm';
  } catch {
    return 'webm';
  }
}

function writeRememberedFormat(format) {
  try {
    localStorage.setItem(FORMAT_KEY, format);
  } catch {
    /* storage unavailable — non-fatal, we just won't remember */
  }
}

function readRememberedFolder() {
  try {
    const raw = localStorage.getItem(FOLDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id && parsed.name ? parsed : null;
  } catch {
    return null;
  }
}

function writeRememberedFolder(folder) {
  try {
    localStorage.setItem(FOLDER_KEY, JSON.stringify(folder));
  } catch {
    /* storage unavailable — non-fatal, we just won't remember */
  }
}

function DriveIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.7 3.5 1.2 15l3.2 5.5 6.5-11.3zM22.8 15 16.3 3.5H9.9l6.5 11.5zM5.6 16 2.4 21.5h13l3.2-5.5z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Drive the SSE upload stream (Phase 4). Reports byte progress and phase changes
 * through the callbacks; resolves with the shareable link. Throws an AbortError
 * if cancelled (via `signal`) or the server reports cancellation, and a regular
 * Error on failure.
 */
async function streamDriveUpload({ dirname, folderId, format }, { signal, onProgress, onPhase }) {
  const res = await api.startDriveUpload(dirname, folderId, format, signal);
  if (!res.ok) throw new Error(await responseErrorMessage(res));

  let link = null;
  let failure = null;
  let cancelled = false;

  await readSSE(res, (msg) => {
    switch (msg.type) {
      case 'transcoding':
        onPhase('transcoding');
        break;
      case 'retrying':
        onPhase('retrying');
        break;
      case 'progress':
        onPhase('uploading');
        onProgress(msg.totalBytes ? msg.bytesUploaded / msg.totalBytes : null);
        break;
      case 'done':
        link = msg.webViewLink;
        break;
      case 'error':
        failure = msg.error || 'Upload failed.';
        cancelled = Boolean(msg.cancelled);
        break;
      default:
        break;
    }
  });

  if (cancelled) {
    const err = new Error(failure || 'Upload cancelled.');
    err.name = 'AbortError';
    throw err;
  }
  if (failure) throw new Error(failure);
  if (!link) throw new Error('No link returned');
  return link;
}

/**
 * Phase 2: upload a recording to a user-chosen Google Drive folder.
 *
 * On first click, if the server has no cached token, opens the OAuth flow and
 * asks the user to sign in and click again. Once authed, the first upload opens
 * the Google Picker to choose a destination folder; that choice is remembered
 * (localStorage) so later uploads go straight there. A secondary folder button
 * re-opens the picker to change the destination. After upload the file is made
 * public and its shareable link is shown with a Copy button.
 */
export function UploadToDriveButton({ recording, disabled }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const [folder, setFolder] = useState(() => readRememberedFolder());
  const [format, setFormat] = useState(() => readRememberedFormat());
  // Upload progress (0..1, or null while indeterminate) and phase, plus an
  // AbortController so the Cancel button can abort the in-flight upload.
  const [progress, setProgress] = useState(null);
  const [phase, setPhase] = useState('uploading');
  const [uploading, setUploading] = useState(false);
  const uploadAbortRef = useRef(null);

  function toggleFormat() {
    const next = format === 'mp4' ? 'webm' : 'mp4';
    setFormat(next);
    writeRememberedFormat(next);
  }

  // Ensure we're signed in; if not, kick off OAuth and tell the user to retry.
  async function ensureAuthed() {
    const authed = await api.getDriveStatus();
    if (!authed) {
      window.open('/api/drive/oauth/start', '_blank', 'noopener');
      toast.info('Sign in to Google Drive in the new tab, then click again.');
      return false;
    }
    return true;
  }

  // Open the Picker and, if a folder is chosen, remember it. Returns the folder
  // or null (cancelled).
  async function chooseFolder() {
    const { accessToken, apiKey, appId } = await api.getDriveToken();
    const picked = await pickDriveFolder({ accessToken, apiKey, appId });
    if (picked) {
      setFolder(picked);
      writeRememberedFolder(picked);
    }
    return picked;
  }

  async function handleUpload() {
    setBusy(true);
    setProgress(null);
    setPhase('uploading');
    try {
      if (!(await ensureAuthed())) return;

      let destination = folder;
      if (!destination) {
        destination = await chooseFolder();
        if (!destination) return; // user cancelled the picker
      }

      const controller = new AbortController();
      uploadAbortRef.current = controller;
      setUploading(true);
      const webViewLink = await streamDriveUpload(
        { dirname: recording.dirname, folderId: destination.id, format },
        {
          signal: controller.signal,
          onProgress: setProgress,
          onPhase: setPhase,
        },
      );
      setLink(webViewLink);
      toast.success(`Uploaded "${recording.name}" (${format.toUpperCase()}) to "${destination.name}".`);
    } catch (err) {
      if (isAbortError(err)) {
        toast.info('Upload cancelled.');
      } else {
        toast.error(errorMessage(err, 'Upload to Drive failed'));
      }
    } finally {
      uploadAbortRef.current = null;
      setUploading(false);
      setProgress(null);
      setBusy(false);
    }
  }

  function cancelUpload() {
    uploadAbortRef.current?.abort();
  }

  async function handleChangeFolder() {
    setBusy(true);
    try {
      if (!(await ensureAuthed())) return;
      const picked = await chooseFolder();
      if (picked) toast.success(`Drive destination set to "${picked.name}".`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not open the folder picker'));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied to clipboard.');
    } catch {
      toast.error('Could not copy link.');
    }
  }

  if (link) {
    return (
      <span className="recording-drive-link">
        <a href={link} target="_blank" rel="noopener noreferrer" title="Open in Google Drive">
          Drive link
        </a>
        <button
          className="recording-action-btn secondary"
          type="button"
          aria-label={`Copy Google Drive link for ${recording.name}`}
          title="Copy link"
          onClick={copyLink}
        >
          <CopyIcon />
        </button>
      </span>
    );
  }

  const isMp4 = format === 'mp4';
  const formatLabel = format.toUpperCase(); // 'MP4' | 'WEBM'
  const otherLabel = isMp4 ? 'WebM' : 'MP4';

  const uploadTitle = folder
    ? `Upload to Google Drive → ${folder.name} (as ${formatLabel})`
    : `Upload to Google Drive (as ${formatLabel})`;

  // While an upload is in flight the Drive button is swapped, in place and at a
  // fixed width, for a compact progress control that doubles as Cancel — so the
  // rest of the row (format pill, folder, delete) never gets shoved aside.
  const pct = progress == null ? null : Math.round(progress * 100);
  // Transcoding and retry waits have no byte progress — show them as busy, not
  // as a stalled percentage.
  const indeterminate = pct == null || phase === 'transcoding' || phase === 'retrying';
  const progressLabel = indeterminate ? '···' : `${pct}%`;
  const progressTitle = phase === 'transcoding'
    ? 'Transcoding… — click to cancel'
    : phase === 'retrying'
      ? 'Retrying… — click to cancel'
      : (pct == null ? 'Uploading… — click to cancel' : `Uploading ${pct}% — click to cancel`);

  return (
    <>
      <button
        className="recording-drive-format-btn recording-action-btn secondary"
        type="button"
        aria-label={`Upload format: ${formatLabel} (click to switch to ${otherLabel})`}
        title={isMp4
          ? 'Format: MP4 (compatible) — click for WebM (fast)'
          : 'Format: WebM (fast) — click for MP4 (compatible)'}
        disabled={disabled || busy}
        onClick={toggleFormat}
      >
        {formatLabel}
      </button>
      {uploading ? (
        <button
          className={`recording-drive-progress-btn recording-action-btn secondary${indeterminate ? ' indeterminate' : ''}`}
          type="button"
          role="progressbar"
          aria-label={`Cancel uploading ${recording.name} to Google Drive`}
          aria-valuenow={indeterminate ? undefined : pct}
          aria-valuemin={indeterminate ? undefined : 0}
          aria-valuemax={indeterminate ? undefined : 100}
          title={progressTitle}
          onClick={cancelUpload}
          style={indeterminate ? undefined : { '--drive-pct': `${pct}%` }}
        >
          <span className="drive-progress-pct" aria-hidden="true">{progressLabel}</span>
          <span className="drive-progress-x" aria-hidden="true"><CancelIcon /></span>
        </button>
      ) : (
        <button
          className="recording-drive-btn recording-action-btn secondary"
          type="button"
          aria-label={`Upload ${recording.name} to Google Drive${folder ? ` (${folder.name})` : ''}`}
          title={uploadTitle}
          disabled={disabled || busy}
          onClick={handleUpload}
        >
          <DriveIcon />
        </button>
      )}
      {folder && (
        <button
          className="recording-drive-folder-btn recording-action-btn secondary"
          type="button"
          aria-label={`Change Google Drive destination folder (currently ${folder.name})`}
          title={`Change destination folder (currently ${folder.name})`}
          disabled={disabled || busy}
          onClick={handleChangeFolder}
        >
          <FolderIcon />
        </button>
      )}
    </>
  );
}
