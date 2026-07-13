import { useState } from 'react';
import { toast } from 'react-toastify';
import { api } from './utils/api.js';
import { errorMessage } from './utils/actions.js';

function DriveIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.7 3.5 1.2 15l3.2 5.5 6.5-11.3zM22.8 15 16.3 3.5H9.9l6.5 11.5zM5.6 16 2.4 21.5h13l3.2-5.5z" />
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
 * Phase 1 tracer: one-click upload of a recording to Google Drive.
 *
 * On first click, if the server reports no cached token, opens the OAuth flow in
 * a new tab and asks the user to sign in and click again. Once authed, uploads
 * to the hardcoded default folder, makes the file public, and surfaces the
 * shareable link with a Copy button.
 */
export function UploadToDriveButton({ recording, disabled }) {
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState(null);

  async function handleUpload() {
    setUploading(true);
    try {
      const authed = await api.getDriveStatus();
      if (!authed) {
        window.open('/api/drive/oauth/start', '_blank', 'noopener');
        toast.info('Sign in to Google Drive in the new tab, then click Upload again.');
        return;
      }
      const webViewLink = await api.uploadToDrive(recording.dirname);
      if (!webViewLink) throw new Error('No link returned');
      setLink(webViewLink);
      toast.success(`Uploaded "${recording.name}" to Google Drive.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Upload to Drive failed'));
    } finally {
      setUploading(false);
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

  return (
    <button
      className="recording-drive-btn recording-action-btn secondary"
      type="button"
      aria-label={`Upload ${recording.name} to Google Drive`}
      title="Upload to Google Drive"
      disabled={disabled || uploading}
      onClick={handleUpload}
    >
      <DriveIcon />
    </button>
  );
}
