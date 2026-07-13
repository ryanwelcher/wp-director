import { useState } from 'react';
import { toast } from 'react-toastify';
import { api } from './utils/api.js';
import { errorMessage } from './utils/actions.js';
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
    try {
      if (!(await ensureAuthed())) return;

      let destination = folder;
      if (!destination) {
        destination = await chooseFolder();
        if (!destination) return; // user cancelled the picker
      }

      const webViewLink = await api.uploadToDrive(recording.dirname, destination.id, format);
      if (!webViewLink) throw new Error('No link returned');
      setLink(webViewLink);
      toast.success(`Uploaded "${recording.name}" (${format.toUpperCase()}) to "${destination.name}".`);
    } catch (err) {
      toast.error(errorMessage(err, 'Upload to Drive failed'));
    } finally {
      setBusy(false);
    }
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
