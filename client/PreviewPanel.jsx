import { useRunState } from './context/RunContext.jsx';

export function PreviewPanel() {
  const { preview } = useRunState();
  const isPolling = preview.mode === 'connecting' || preview.mode === 'image';

  return (
    <div className={`panel${isPolling ? ' polling' : ''}`} id="preview-panel">
      <h2>Live Preview</h2>
      <div id="preview-container">
        {(preview.mode === 'idle' || preview.mode === 'connecting') && (
          <div id="preview-placeholder">
            {preview.mode === 'connecting' ? 'Connecting to browser...' : 'No preview yet - start a recording to see the browser live.'}
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
