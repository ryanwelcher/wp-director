import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { api, queryKeys, responseErrorMessage } from './utils/api.js';
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

// The Google Drive logo — used only as the small brand marker on the Drive row
// label, so it no longer collides with the upload/open actions below.
function DriveIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.7 3.5 1.2 15l3.2 5.5 6.5-11.3zM22.8 15 16.3 3.5H9.9l6.5 11.5zM5.6 16 2.4 21.5h13l3.2-5.5z" />
    </svg>
  );
}

// Cloud + up-arrow: the "send this to Drive" action, visually distinct from both
// the row's Drive logo and the download button's plain down-arrow.
function UploadCloudIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M6.5 19a4.5 4.5 0 0 1-.42-8.98 6 6 0 0 1 11.64-1.28A4.5 4.5 0 0 1 17.5 19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 21v-8m0 0-2.5 2.5M12 13l2.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Box + out-arrow: opens the already-uploaded file's share link in a new tab.
function ExternalLinkIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M14 4h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4 10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

// The Drive row shares one header (label + Drive glyph) across both its states —
// the existing-link view and the upload-controls view. Render it once here so
// the label, icon, and class can't drift between the two branches.
function DriveRow({ children }) {
  return (
    <div className="recording-item-drive">
      <span className="recording-action-group-label"><DriveIcon />Drive</span>
      {children}
    </div>
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
 * These controls only render when signed in to Google Drive — sign-in lives in a
 * single place (the header), so the row stays clean when Drive isn't connected.
 * The first upload opens the Google Picker to choose a destination folder; that
 * choice is remembered (localStorage) so later uploads go straight there. A
 * secondary folder button re-opens the picker to change the destination. After
 * upload the file is made public and its shareable link is shown with a Copy
 * button.
 */
export function UploadToDriveButton({ recording, disabled }) {
  const queryClient = useQueryClient();
  const { data: driveStatus } = useQuery({
    queryKey: queryKeys.drive.status,
    queryFn: ({ signal }) => api.getDriveStatus({ signal }),
  });
  // Recordings already uploaded in the signed-in account's Drive → their links.
  // Lets us surface an existing link (and hide the upload button) across restarts
  // without any local bookkeeping — the source of truth is Drive itself.
  const { data: uploads } = useQuery({
    queryKey: queryKeys.drive.uploads,
    queryFn: ({ signal }) => api.getDriveUploads({ signal }),
    enabled: Boolean(driveStatus?.authed),
    // The map only changes when we upload (handled by an explicit invalidate),
    // so serve cached data across row remounts rather than refiring a full Drive
    // files.list each time.
    staleTime: 5 * 60 * 1000,
  });
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

  // Prefer a just-uploaded link (immediate), otherwise fall back to one Drive
  // already has for this recording. Either one flips the row to the link view.
  const effectiveLink = driveStatus?.authed
    ? (link || uploads?.[recording.dirname] || null)
    : null;

  function toggleFormat() {
    const next = format === 'mp4' ? 'webm' : 'mp4';
    setFormat(next);
    writeRememberedFormat(next);
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
      let destination = folder;
      if (!destination) destination = await chooseFolder();

      const controller = new AbortController();
      uploadAbortRef.current = controller;
      setUploading(true);
      const webViewLink = await streamDriveUpload(
        { dirname: recording.dirname, folderId: destination?.id, format },
        {
          signal: controller.signal,
          onProgress: setProgress,
          onPhase: setPhase,
        },
      );
      setLink(webViewLink);
      // Keep the cross-session "already uploaded" map in sync with what we just
      // created, so a later refetch still shows this recording as uploaded.
      queryClient.invalidateQueries({ queryKey: queryKeys.drive.uploads });
      toast.success(
        destination
          ? `Uploaded "${recording.name}" (${format.toUpperCase()}) to "${destination.name}".`
          : `Uploaded "${recording.name}" (${format.toUpperCase()}) to Google Drive.`,
      );
    } catch (err) {
      if (isAbortError(err)) {
        toast.info('Upload cancelled.');
      } else {
        toast.error(errorMessage(err, 'Upload to Drive failed'));
        // Re-check auth: if the token expired or was revoked externally, this
        // flips the header to signed-out and hides these controls. If we're
        // still authed, the refetch is a harmless no-op.
        queryClient.invalidateQueries({ queryKey: queryKeys.drive.status });
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
      await navigator.clipboard.writeText(effectiveLink);
      toast.success('Link copied to clipboard.');
    } catch {
      toast.error('Could not copy link.');
    }
  }

  // Hide all Drive controls unless signed in. Sign-in lives solely in the header
  // — there's no per-row prompt anymore.
  if (!effectiveLink && !driveStatus?.authed) return null;

  if (effectiveLink) {
    return (
      <DriveRow>
        <a
          className="recording-drive-link-btn recording-action-btn secondary"
          href={effectiveLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open Google Drive link for ${recording.name}`}
          title="Open in Google Drive"
        >
          <ExternalLinkIcon />
        </a>
        <button
          className="recording-drive-btn recording-action-btn secondary"
          type="button"
          aria-label={`Copy Google Drive link for ${recording.name}`}
          title="Copy link"
          onClick={copyLink}
        >
          <CopyIcon />
        </button>
      </DriveRow>
    );
  }

  const isMp4 = format === 'mp4';
  const formatLabel = format.toUpperCase(); // 'MP4' | 'WEBM'
  const otherLabel = isMp4 ? 'WebM' : 'MP4';

  const uploadTitle = folder
    ? `Upload to Google Drive → ${folder.name} (as ${formatLabel})`
    : `Upload to Google Drive (as ${formatLabel})`;

  // While an upload is in flight the labeled Upload button is swapped, in place,
  // for a compact progress control that doubles as Cancel — the format pill and
  // folder button to its right stay put.
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
    <DriveRow>
      {uploading ? (
        <button
          className={`recording-drive-progress-btn recording-action-btn secondary${indeterminate ? ' indeterminate' : ''}`}
          type="button"
          aria-label={`Cancel uploading ${recording.name} to Google Drive`}
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
          <UploadCloudIcon />
        </button>
      )}
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
    </DriveRow>
  );
}
