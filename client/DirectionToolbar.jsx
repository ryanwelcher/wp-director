import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { useRunState } from './context/RunContext.jsx';
import { errorMessage } from './utils/actions.js';
import { useSaveScriptMutation } from './utils/apiHooks.js';

export function DirectionToolbar() {
  const {
    cleanDirections,
    clearDirections,
    currentEndPause,
    currentStepPause,
    currentTypingDelay,
    name,
    poolStatus,
    runDirections,
    setName,
    startFromIndex,
    videoSize,
  } = useAppState();
  const { running, runActions, stopRun } = useRunState();
  const saveScriptMutation = useSaveScriptMutation();
  const hasResolvedDirections = runDirections.length > 0;
  const poolLabel = poolStatus.ready ? null : `Playground warming up (${poolStatus.warm}/${poolStatus.total} ready). The run will start when an instance is available.`;

  async function saveScript() {
    const scriptName = name.trim() || `recording-${Date.now()}`;
    try {
      await saveScriptMutation.mutateAsync({
        name: scriptName,
        directions: cleanDirections,
        endPause: currentEndPause,
        stepPause: currentStepPause,
        typingDelay: currentTypingDelay,
        videoSize,
      });
      toast.success(`Saved "${scriptName}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Save failed'));
    }
  }

  function exportTxt() {
    const scriptName = name.trim() || 'recording';
    const lines = cleanDirections.map((group, index) => `${index + 1}. ${group.label}`);
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

      <button className="secondary" type="button" disabled={!hasResolvedDirections} onClick={saveScript}>
        Save Script
      </button>
      <button className="secondary" type="button" disabled={!hasResolvedDirections} onClick={exportTxt}>
        Export TXT
      </button>
      <button className="secondary" type="button" onClick={clearDirections}>
        Clear
      </button>

      {!running && (
        <button
          className="primary"
          type="button"
          disabled={!hasResolvedDirections}
          title={poolLabel ?? (startFromIndex !== null ? 'Record full script (preview start point ignored)' : 'Record')}
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
        <button
          className="secondary"
          type="button"
          disabled={!hasResolvedDirections}
          title={poolLabel ?? 'Preview'}
          onClick={() => handleRun(true)}
        >
          &#9654; Preview
        </button>
      )}
    </div>
  );
}
