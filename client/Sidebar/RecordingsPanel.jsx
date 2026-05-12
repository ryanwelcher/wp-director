import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog } from '../Dialog.jsx';
import { useAppState } from '../context/AppStateContext.jsx';
import { useRunState } from '../context/RunContext.jsx';
import { errorMessage } from '../utils/actions.js';
import { formatFileSize, formatTimestamp } from '../utils/formatters.js';
import { useDeleteRecordingMutation } from '../utils/apiHooks.js';
import { SectionBadge } from './SectionBadge.jsx';
import { TrashIcon } from './TrashIcon.jsx';

function DownloadIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}

function DownloadMenu({ recording, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleDocClick(event) {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    }
    function handleKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const size = recording.sourceSize;
  const sizeLabel = size ? `${size.width}×${size.height}` : 'source';
  const base = `/api/recordings/${encodeURIComponent(recording.dirname)}/download`;

  return (
    <div className="download-menu" ref={ref} role="menu">
      <div className="download-menu-section-label">WebM</div>
      <a className="download-menu-item" role="menuitem" href={`${base}?format=webm`} onClick={onClose}>{sizeLabel}</a>
      <div className="download-menu-section-label">MP4</div>
      <a className="download-menu-item" role="menuitem" href={`${base}?format=mp4`} onClick={onClose}>{sizeLabel}</a>
    </div>
  );
}

export function RecordingsPanel() {
  const { recordings } = useAppState();
  const { running, showPreviewVideo } = useRunState();
  const deleteRecordingMutation = useDeleteRecordingMutation();
  const [pendingDeleteRecording, setPendingDeleteRecording] = useState(null);
  const [downloadMenuFor, setDownloadMenuFor] = useState(null);
  const deletingRecording = deleteRecordingMutation.isPending;

  function closeDeleteDialog() {
    if (!deletingRecording) setPendingDeleteRecording(null);
  }

  async function confirmDeleteRecording() {
    if (!pendingDeleteRecording) return;

    try {
      await deleteRecordingMutation.mutateAsync(pendingDeleteRecording.dirname);
      toast.success(`Deleted recording "${pendingDeleteRecording.name}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    } finally {
      setPendingDeleteRecording(null);
    }
  }

  return (
    <>
      <details id="recordings-section">
        <summary>
          <span>Recordings</span>
          <SectionBadge hidden={recordings.length === 0}>{recordings.length}</SectionBadge>
        </summary>
        <div className="recordings-body">
          <div id="recordings-list">
            {!recordings.length && <p className="hint">No recordings yet - run a script to generate a video.</p>}

            {recordings.map((recording) => {
              const fileSize = formatFileSize(recording.size);
              const timestamp = formatTimestamp(recording.createdAt);
              const videoUrl = `/api/recordings/${recording.dirname}/video`;
              const downloadOpen = downloadMenuFor === recording.dirname;

              return (
                <div className="recording-item" key={recording.dirname}>
                  <span className="recording-item-name">{recording.name}</span>
                  <span className="recording-item-meta">
                    {timestamp && <span>{timestamp}</span>}
                    {fileSize && <span>{fileSize}</span>}
                  </span>
                  <span className="recording-item-actions">
                    <button
                      className="recording-preview-btn recording-action-btn secondary"
                      type="button"
                      aria-label={`Preview ${recording.name}`}
                      title="Preview"
                      disabled={running}
                      onClick={() => showPreviewVideo(videoUrl, {
                        recordedAt: recording.createdAt,
                        title: recording.name,
                      })}
                    >
                      <PreviewIcon />
                    </button>
                    <span className="recording-download-wrap">
                      <button
                        className="recording-download-btn recording-action-btn secondary"
                        type="button"
                        aria-label={`Download ${recording.name}`}
                        aria-haspopup="menu"
                        aria-expanded={downloadOpen}
                        title="Download"
                        onClick={() => setDownloadMenuFor(downloadOpen ? null : recording.dirname)}
                      >
                        <DownloadIcon />
                      </button>
                      {downloadOpen && (
                        <DownloadMenu
                          recording={recording}
                          onClose={() => setDownloadMenuFor(null)}
                        />
                      )}
                    </span>
                    <button
                      className="recording-delete-btn sidebar-delete-icon-btn recording-action-btn danger"
                      type="button"
                      aria-label={`Delete ${recording.name}`}
                      title="Delete"
                      disabled={deletingRecording && deleteRecordingMutation.variables === recording.dirname}
                      onClick={() => setPendingDeleteRecording(recording)}
                    >
                      <TrashIcon />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </details>

      {pendingDeleteRecording && (
        <Dialog
          title="Delete recording?"
          description={`Delete "${pendingDeleteRecording.name}"? This cannot be undone.`}
          closeDisabled={deletingRecording}
          onClose={closeDeleteDialog}
        >
          <div className="app-dialog-actions">
            <button
              className="app-dialog-btn app-dialog-btn--secondary"
              type="button"
              disabled={deletingRecording}
              onClick={closeDeleteDialog}
            >
              Cancel
            </button>
            <button
              className="app-dialog-btn app-dialog-btn--danger"
              type="button"
              disabled={deletingRecording}
              onClick={confirmDeleteRecording}
            >
              {deletingRecording ? 'Deleting...' : 'Delete recording'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
