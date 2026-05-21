import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../Dialog.jsx';
import { useAppState } from '../context/AppStateContext.jsx';
import { DEFAULT_RUN_SETTINGS } from '../state/useRunSettingsState.js';
import { BROWSER_SIZE_PRESETS, isValidVideoSizeValue } from '../utils/actions.js';

function splitSizeValue(value) {
  const match = String(value).match(/^(\d+)x(\d+)$/i);
  return match ? [match[1], match[2]] : ['', ''];
}

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
  const [[customWidth, customHeight], setCustomSizeParts] = useState(() => splitSizeValue(videoSize));
  const activePreset = BROWSER_SIZE_PRESETS.find((preset) => preset.value === videoSize);
  const customSizeValue = `${customWidth}x${customHeight}`;
  const customSizeValid = isValidVideoSizeValue(customSizeValue);
  const normalizedCustomSizeValue = customSizeValid
    ? `${Number(customWidth)}x${Number(customHeight)}`
    : customSizeValue;

  const isAtDefault = useMemo(
    () => (
      endPause === DEFAULT_RUN_SETTINGS.endPause
      && stepPause === DEFAULT_RUN_SETTINGS.stepPause
      && typingDelay === DEFAULT_RUN_SETTINGS.typingDelay
      && videoSize === DEFAULT_RUN_SETTINGS.videoSize
    ),
    [endPause, stepPause, typingDelay, videoSize],
  );

  useEffect(() => {
    setCustomSizeParts(splitSizeValue(videoSize));
  }, [videoSize]);

  function applyCustomSize(event) {
    event.preventDefault();
    if (!customSizeValid) return;
    setVideoSize(normalizedCustomSizeValue);
  }

  return (
    <>
    <div className="tab-panel-body">
      <div className="setting-field">
        <div className="setting-field-header">
          <label htmlFor="typing-delay-input">Typing delay</label>
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
          <span className="setting-field-label">Browser window size</span>
          <span className="setting-field-value">
            {activePreset ? `${activePreset.label} ${videoSize}` : `Custom ${videoSize}`}
          </span>
        </div>
        <div className="settings-size-toggle" role="radiogroup" aria-label="Browser window size">
          {BROWSER_SIZE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={clsx('settings-size-opt', videoSize === preset.value && 'active')}
              role="radio"
              aria-checked={videoSize === preset.value}
              title={`${preset.label} (${preset.value})`}
              onClick={() => setVideoSize(preset.value)}
            >
              <span className="settings-size-opt-label">{preset.label}</span>
              <span className="settings-size-opt-value">{preset.value}</span>
            </button>
          ))}
        </div>
        <form className="settings-custom-size" onSubmit={applyCustomSize}>
          <label className="settings-custom-size-field">
            <span>Width</span>
            <input
              type="number"
              min="320"
              max="7680"
              step="1"
              inputMode="numeric"
              value={customWidth}
              onChange={(event) => setCustomSizeParts([event.target.value, customHeight])}
            />
          </label>
          <span className="settings-custom-size-separator">x</span>
          <label className="settings-custom-size-field">
            <span>Height</span>
            <input
              type="number"
              min="320"
              max="7680"
              step="1"
              inputMode="numeric"
              value={customHeight}
              onChange={(event) => setCustomSizeParts([customWidth, event.target.value])}
            />
          </label>
          <button
            type="submit"
            className="settings-custom-size-apply"
            disabled={!customSizeValid || normalizedCustomSizeValue === videoSize}
          >
            Apply
          </button>
        </form>
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
        description="Reset typing speed, between-step pause, browser window size, and outro length to defaults?"
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
