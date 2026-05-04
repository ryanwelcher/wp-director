import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { useRunState } from './context/RunContext.jsx';
import { errorMessage } from './utils/actions.js';
import { useSaveScriptMutation } from './utils/apiHooks.js';

const VIDEO_SIZES = ['1280x720', '1920x1080', '3840x2160'];
const VIDEO_LABELS = {
  '1280x720': '720p',
  '1920x1080': '1080p',
  '3840x2160': '4K',
};

export function DirectionToolbar() {
  const {
    cleanDirections,
    clearDirections,
    currentEndPause,
    directions,
    endPause,
    name,
    setEndPause,
    setName,
    setVideoSize,
    startFromIndex,
    videoSize,
  } = useAppState();
  const { running, runActions, stopRun } = useRunState();
  const saveScriptMutation = useSaveScriptMutation();
  const hasDirections = directions.length > 0;

  async function saveScript() {
    const scriptName = name.trim() || `recording-${Date.now()}`;
    try {
      await saveScriptMutation.mutateAsync({
        name: scriptName,
        directions: cleanDirections,
        endPause: currentEndPause,
      });
      toast.success(`Saved "${scriptName}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Save failed'));
    }
  }

  function exportTxt() {
    const scriptName = name.trim() || 'recording';
    const lines = directions.map((group, index) => `${index + 1}. ${group.label}`);
    const text = `${scriptName}\n${'-'.repeat(scriptName.length)}\n\n${lines.join('\n')}\n`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = `${scriptName}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function handleRun(preview) {
    try {
      await runActions({ preview });
    } catch {
      // The run context already surfaces the failure through a toast.
    }
  }

  return (
    <div className="direction-bar">
      <label>
        Name:
        <input
          id="name-input"
          type="text"
          placeholder="Add script name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <button className="secondary" type="button" disabled={!hasDirections} onClick={saveScript}>
        Save Script
      </button>
      <button className="secondary" type="button" disabled={!hasDirections} onClick={exportTxt}>
        Export TXT
      </button>
      <button className="secondary" type="button" onClick={clearDirections}>
        Clear
      </button>

      {!running && (
        <button
          className="primary"
          type="button"
          disabled={!hasDirections}
          title={startFromIndex !== null ? 'Record full script (preview start point ignored)' : 'Record'}
          onClick={() => handleRun(false)}
        >
          &#9654; Record
        </button>
      )}

      {running && (
        <button className="danger" type="button" onClick={stopRun}>
          &#9646;&#9646; Stop
        </button>
      )}

      {!running && (
        <button className="secondary" type="button" disabled={!hasDirections} onClick={() => handleRun(true)}>
          &#9654; Preview
        </button>
      )}

      <div className="size-toggle" role="radiogroup" aria-label="Video size">
        {VIDEO_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            className={`size-opt${videoSize === size ? ' active' : ''}`}
            data-size={size}
            role="radio"
            aria-checked={videoSize === size}
            title={`${VIDEO_LABELS[size]} (${size.replace('x', 'x')})`}
            onClick={() => setVideoSize(size)}
          >
            {VIDEO_LABELS[size]}
          </button>
        ))}
      </div>

      <label>
        Outro length:
        <input
          id="end-pause-input"
          type="range"
          min="0"
          max="10"
          step="0.5"
          value={endPause}
          onChange={(event) => setEndPause(event.target.value)}
        />
        <span id="end-pause-display">{endPause}s</span>
      </label>
    </div>
  );
}
