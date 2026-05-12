import { useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { useRunState } from './context/RunContext.jsx';
import { Dialog } from './Dialog.jsx';
import { ScriptNameDialog } from './ScriptNameDialog.jsx';
import { errorMessage } from './utils/actions.js';
import { useSaveScriptMutation } from './utils/apiHooks.js';

export function DirectionToolbar() {
  const {
    blueprint,
    cleanDirections,
    clearDirections,
    currentEndPause,
    currentStepPause,
    currentTypingDelay,
    currentVideoSize,
    name,
    poolStatus,
    runDirections,
    setName,
    startFromIndex,
  } = useAppState();
  const { running, runActions, stopRun } = useRunState();
  const saveScriptMutation = useSaveScriptMutation();
  const [pendingNamedAction, setPendingNamedAction] = useState(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const hasResolvedDirections = runDirections.length > 0;
  const poolLabel = poolStatus.ready ? null : `Playground warming up (${poolStatus.warm}/${poolStatus.total} ready). The run will start when an instance is available.`;
  const currentScriptName = name.trim();

  async function saveScript(scriptName) {
    const trimmedName = scriptName.trim();
    if (!trimmedName) return;

    try {
      await saveScriptMutation.mutateAsync({
        name: trimmedName,
        directions: cleanDirections,
        blueprint,
        recordingSettings: {
          endPause: currentEndPause,
          stepPause: currentStepPause,
          typingDelay: currentTypingDelay,
          videoSize: currentVideoSize,
        },
      });
      toast.success(`Saved "${trimmedName}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Save failed'));
    }
  }

  function exportTxt(scriptName) {
    const trimmedName = scriptName.trim();
    if (!trimmedName) return;

    const lines = cleanDirections.map((group, index) => `${index + 1}. ${group.label}`);
    const text = `${trimmedName}\n${'-'.repeat(trimmedName.length)}\n\n${lines.join('\n')}\n`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = `${trimmedName}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function handleRun(preview, scriptName) {
    try {
      await runActions({ preview, scriptName });
    } catch {
      // The run context already surfaces the failure through a toast.
    }
  }

  function executeNamedAction(action, scriptName) {
    if (action === 'record') {
      handleRun(false, scriptName);
    } else if (action === 'preview') {
      handleRun(true, scriptName);
    } else if (action === 'save') {
      saveScript(scriptName);
    } else if (action === 'export') {
      exportTxt(scriptName);
    }
  }

  function runWithScriptName(action) {
    if (currentScriptName) {
      executeNamedAction(action, currentScriptName);
      return;
    }

    setPendingNamedAction(action);
  }

  function confirmScriptName(scriptName) {
    const action = pendingNamedAction;
    setName(scriptName);
    setPendingNamedAction(null);
    executeNamedAction(action, scriptName);
  }

  return (
    <>
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

        <button className="secondary" type="button" disabled={!hasResolvedDirections} onClick={() => runWithScriptName('save')}>
          Save Script
        </button>
        <button className="secondary" type="button" disabled={!hasResolvedDirections} onClick={() => runWithScriptName('export')}>
          Export TXT
        </button>
        <button className="secondary" type="button" onClick={() => setClearDialogOpen(true)}>
          Clear
        </button>

        {!running && (
          <button
            className="primary"
            type="button"
            disabled={!hasResolvedDirections}
            title={poolLabel ?? (startFromIndex !== null ? 'Record full script (preview start point ignored)' : 'Record')}
            onClick={() => runWithScriptName('record')}
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
            onClick={() => runWithScriptName('preview')}
          >
            &#9654; Preview
          </button>
        )}
      </div>

      {pendingNamedAction && (
        <ScriptNameDialog
          action={pendingNamedAction}
          defaultValue={name}
          onCancel={() => setPendingNamedAction(null)}
          onConfirm={confirmScriptName}
        />
      )}

      {clearDialogOpen && (
        <Dialog
          title="Clear workspace?"
          description="This will remove all directions, reset recording settings to defaults, and reset the blueprint to the default. This cannot be undone."
          closeDisabled={clearing}
          onClose={() => { if (!clearing) setClearDialogOpen(false); }}
        >
          <div className="app-dialog-actions">
            <button
              className="app-dialog-btn app-dialog-btn--secondary"
              type="button"
              disabled={clearing}
              onClick={() => setClearDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              className="app-dialog-btn app-dialog-btn--danger"
              type="button"
              disabled={clearing}
              onClick={async () => {
                setClearing(true);
                try {
                  await clearDirections();
                  setClearDialogOpen(false);
                } catch (err) {
                  toast.error(errorMessage(err, 'Could not clear workspace'));
                } finally {
                  setClearing(false);
                }
              }}
            >
              {clearing ? 'Clearing...' : 'Clear'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
