import { useAppState } from '../context/AppStateContext.jsx';
import { useRunState } from '../context/RunContext.jsx';
import { formatFileSize, formatTimestamp } from '../utils/formatters.js';
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

export function RecordingsPanel() {
  const { recordings } = useAppState();
  const { running, showPreviewVideo } = useRunState();

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
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
