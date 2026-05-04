import { useAppState } from '../context/AppStateContext.jsx';
import { useRunState } from '../context/RunContext.jsx';
import { SectionBadge } from './SectionBadge.jsx';

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
            const sizeMb = (recording.size / (1024 * 1024)).toFixed(1);
            const videoUrl = `/api/recordings/${recording.dirname}/video`;
            return (
              <div className="recording-item" key={recording.dirname}>
                <span className="recording-item-name">{recording.name}</span>
                <span className="recording-item-meta">{sizeMb} MB</span>
                <button
                  className="recording-preview-btn secondary"
                  type="button"
                  disabled={running}
                  onClick={() => showPreviewVideo(videoUrl)}
                >
                  Preview
                </button>
                <a
                  className="recording-download-btn secondary"
                  href={videoUrl}
                  download={`${recording.slug ?? recording.dirname}.${recording.ext ?? 'mp4'}`}
                >
                  Download
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
