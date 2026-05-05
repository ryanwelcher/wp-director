import { toast } from 'react-toastify';
import { useAppState } from '../context/AppStateContext.jsx';
import { useRunState } from '../context/RunContext.jsx';
import { errorMessage } from '../utils/actions.js';
import { formatFileSize, formatTimestamp } from '../utils/formatters.js';
import { useDeleteRecordingMutation } from '../utils/apiHooks.js';
import { SectionBadge } from './SectionBadge.jsx';

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

function DeleteIcon() {
  return (
    <svg className="recording-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 11v6m4-6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 7l1 14h10l1-14M9 7V4h6v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RecordingsPanel() {
  const { recordings } = useAppState();
  const { running, showPreviewVideo } = useRunState();
  const deleteRecordingMutation = useDeleteRecordingMutation();

  async function deleteRecording(recording) {
    try {
      await deleteRecordingMutation.mutateAsync(recording.dirname);
      toast.success(`Deleted recording "${recording.name}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    }
  }

  return (
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
            const downloadName = `${recording.filenameBase ?? recording.slug ?? recording.dirname}.${recording.ext ?? 'mp4'}`;

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
                  <a
                    className="recording-download-btn recording-action-btn secondary"
                    href={videoUrl}
                    aria-label={`Download ${recording.name}`}
                    title="Download"
                    download={downloadName}
                  >
                    <DownloadIcon />
                  </a>
                  <button
                    className="recording-delete-btn recording-action-btn danger"
                    type="button"
                    aria-label={`Delete ${recording.name}`}
                    title="Delete"
                    disabled={deleteRecordingMutation.isPending && deleteRecordingMutation.variables === recording.dirname}
                    onClick={() => deleteRecording(recording)}
                  >
                    <DeleteIcon />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
