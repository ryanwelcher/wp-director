import { useState } from 'react';
import { useAppState } from '../context/AppStateContext.jsx';
import { SectionBadge } from './SectionBadge.jsx';

export function RecordingsPanel() {
  const { recordings } = useAppState();
  const [openRecording, setOpenRecording] = useState(null);

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
            const isOpen = openRecording === recording.dirname;
            const sizeMb = (recording.size / (1024 * 1024)).toFixed(1);
            const videoUrl = `/api/recordings/${recording.dirname}/video`;
            return (
              <div className="recording-item" key={recording.dirname}>
                <span className="recording-item-name">{recording.name}</span>
                <span className="recording-item-meta">{sizeMb} MB</span>
                <button
                  className="recording-preview-btn secondary"
                  type="button"
                  onClick={() => setOpenRecording(isOpen ? null : recording.dirname)}
                >
                  {isOpen ? 'Hide' : 'Preview'}
                </button>
                <a
                  className="recording-download-btn secondary"
                  href={videoUrl}
                  download={`${recording.slug ?? recording.dirname}.${recording.ext ?? 'mp4'}`}
                >
                  Download
                </a>
                {isOpen && (
                  <div className="recording-video-wrapper">
                    <video controls src={videoUrl} preload="metadata" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
