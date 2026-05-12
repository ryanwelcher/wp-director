import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { Dialog } from '../Dialog.jsx';
import { useAppState } from '../context/AppStateContext.jsx';
import { DEFAULT_RUN_SETTINGS } from '../state/useRunSettingsState.js';
import { VIDEO_SIZE_VALUES } from '../utils/actions.js';

const VIDEO_LABELS = {
  '1280x720': '720p',
  '1920x1080': '1080p',
  '3840x2160': '4K',
};

export function RecordingSettingsPanel() {
  const {
    endPause,
    resetRecordingSettings,
    setEndPause,
    setStepPause,
    setTypingDelay,
    setVideoSize,
    stepPause,
    typingDelay,
    videoSize,
  } = useAppState();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const isAtDefault = useMemo(
    () => (
      endPause === DEFAULT_RUN_SETTINGS.endPause
      && stepPause === DEFAULT_RUN_SETTINGS.stepPause
      && typingDelay === DEFAULT_RUN_SETTINGS.typingDelay
      && videoSize === DEFAULT_RUN_SETTINGS.videoSize
    ),
    [endPause, stepPause, typingDelay, videoSize],
  );

  return (
    <>
    <div className="tab-panel-body">
      <div className="setting-field">
        <div className="setting-field-header">
          <label htmlFor="typing-delay-input">Typing speed</label>
          <span className="setting-field-value">{typingDelay} ms/char</span>
        </div>
        <input
          id="typing-delay-input"
          type="range"
          min="0"
          max="250"
          step="10"
          value={typingDelay}
          onChange={(event) => setTypingDelay(event.target.value)}
        />
      </div>

      <div className="setting-field">
        <div className="setting-field-header">
          <label htmlFor="step-pause-input">Between-step pause</label>
          <span className="setting-field-value">{stepPause}s</span>
        </div>
        <input
          id="step-pause-input"
          type="range"
          min="0"
          max="3"
          step="0.1"
          value={stepPause}
          onChange={(event) => setStepPause(event.target.value)}
        />
      </div>

      <div className="setting-field">
        <div className="setting-field-header">
          <span className="setting-field-label">Video size</span>
          <span className="setting-field-value">{videoSize}</span>
        </div>
        <div className="settings-size-toggle" role="radiogroup" aria-label="Video size">
          {VIDEO_SIZE_VALUES.map((size) => (
            <button
              key={size}
              type="button"
              className={clsx('settings-size-opt', videoSize === size && 'active')}
              role="radio"
              aria-checked={videoSize === size}
              title={`${VIDEO_LABELS[size]} (${size})`}
              onClick={() => setVideoSize(size)}
            >
              {VIDEO_LABELS[size]}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-field">
        <div className="setting-field-header">
          <label htmlFor="end-pause-input">Outro length</label>
          <span className="setting-field-value">{endPause}s</span>
        </div>
        <input
          id="end-pause-input"
          type="range"
          min="0"
          max="10"
          step="0.5"
          value={endPause}
          onChange={(event) => setEndPause(event.target.value)}
        />
      </div>
    </div>

    <div className="tab-panel-footer">
      <button
        type="button"
        className="bp-action-btn bp-action-btn--ghost"
        onClick={() => setResetDialogOpen(true)}
        disabled={isAtDefault}
      >
        Reset
      </button>
    </div>

    {resetDialogOpen && (
        <Dialog
          title="Reset recording settings?"
          description="Reset typing speed, between-step pause, video size, and outro length to defaults?"
          onClose={() => setResetDialogOpen(false)}
        >
          <div className="app-dialog-actions">
            <button
              className="app-dialog-btn app-dialog-btn--secondary"
              type="button"
              onClick={() => setResetDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              className="app-dialog-btn app-dialog-btn--danger"
              type="button"
              onClick={() => {
                resetRecordingSettings();
                setResetDialogOpen(false);
              }}
            >
              Reset
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
