import clsx from 'clsx';
import { useRunState } from './context/RunContext.jsx';
import { formatTimestamp } from './utils/formatters.js';

export function PreviewPanel() {
  const { preview } = useRunState();
  const isPolling = preview.mode === 'connecting' || (preview.mode === 'image' && preview.isLive);
  const heading = preview.mode === 'video' && preview.title ? `Recording: ${preview.title}` : 'Live Preview';
  const connectingLabel = preview.playgroundPort
    ? `Connecting to browser on port ${preview.playgroundPort}...`
    : 'Connecting to browser...';
  const recordingTimestamp = preview.mode === 'video' && preview.title
    ? formatTimestamp(preview.recordedAt)
    : null;

  return (
    <div className={clsx('panel', isPolling && 'polling')} id="preview-panel">
      <div className="preview-heading">
        <h2>{heading}</h2>
        {recordingTimestamp && <span className="preview-heading-timestamp">{recordingTimestamp}</span>}
      </div>
      <div id="preview-container">
        {(preview.mode === 'idle' || preview.mode === 'connecting') && (
          <div id="preview-placeholder">
            {preview.mode === 'connecting' ? connectingLabel : 'No preview yet - start a recording to see the browser live.'}
          </div>
        )}

        {preview.mode === 'image' && (
          <img id="preview-img" alt="Browser preview" src={preview.imageSrc} />
        )}

        {preview.mode === 'video' && (
          <video
            id="preview-video"
            controls
            playsInline
            poster={preview.poster || undefined}
            src={preview.videoSrc}
          />
        )}
      </div>
    </div>
  );
}
