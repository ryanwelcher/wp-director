import clsx from 'clsx';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { useRunState } from './context/RunContext.jsx';
import { errorMessage } from './utils/actions.js';
import { useSaveLatestPreviewMutation } from './utils/apiHooks.js';
import { formatTimestamp } from './utils/formatters.js';

export function PreviewPanel() {
  const { loadRecordings, name } = useAppState();
  const { preview, running, showPreviewVideo } = useRunState();
  const savePreviewMutation = useSaveLatestPreviewMutation();
  const [savingPreview, setSavingPreview] = useState(false);
  const isPolling = preview.mode === 'connecting' || (preview.mode === 'image' && preview.isLive);
  const heading = preview.mode === 'video' && preview.title
    ? `${preview.saveable ? 'Playback' : 'Recording'}: ${preview.title}`
    : 'Live Preview';
  const connectingLabel = preview.playgroundPort
    ? `Connecting to browser on port ${preview.playgroundPort}...`
    : 'Connecting to browser...';
  const recordingTimestamp = preview.mode === 'video' && preview.title
    ? formatTimestamp(preview.recordedAt)
    : null;
  const canSavePreview = preview.mode === 'video' && preview.saveable && !running;

  async function savePreviewVideo() {
    const fallbackName = preview.title || `recording-${Date.now()}`;
    const saveName = name.trim() || fallbackName;

    setSavingPreview(true);
    try {
      const saved = await savePreviewMutation.mutateAsync({
        name: saveName,
      });
      loadRecordings();
      showPreviewVideo(saved.videoUrl, {
        recordedAt: saved.createdAt,
        title: saved.name,
        saveable: false,
      });
      toast.success(`Saved video "${saved.name}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save video'));
    } finally {
      setSavingPreview(false);
    }
  }

  return (
    <div className={clsx('panel', isPolling && 'polling')} id="preview-panel">
      <div className="preview-heading">
        <h2>{heading}</h2>
        {canSavePreview ? (
          <button
            className="preview-save-btn"
            type="button"
            disabled={savingPreview}
            onClick={savePreviewVideo}
          >
            {savingPreview ? 'Saving...' : 'Save Recording'}
          </button>
        ) : (
          recordingTimestamp && <span className="preview-heading-timestamp">{recordingTimestamp}</span>
        )}
      </div>
      <div id="preview-container">
        {(preview.mode === 'idle' || preview.mode === 'connecting') && (
          <div id="preview-placeholder">
            {preview.mode === 'connecting' ? connectingLabel : 'No video yet - press Play to see the browser live.'}
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
