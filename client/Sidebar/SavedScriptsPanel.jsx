import { useCallback, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog } from '../Dialog.jsx';
import { useAppState } from '../context/AppStateContext.jsx';
import { useRunState } from '../context/RunContext.jsx';
import { errorMessage } from '../utils/actions.js';
import { useDeleteScriptMutation } from '../utils/apiHooks.js';
import { SectionBadge } from './SectionBadge.jsx';
import { TrashIcon } from './TrashIcon.jsx';

export function SavedScriptsPanel() {
  const {
    loadScriptIntoEditor,
    poolStatus,
    savedScripts,
    selectedScripts,
    setSelectedScripts,
  } = useAppState();
  const { recordAll, running } = useRunState();
  const deleteScriptMutation = useDeleteScriptMutation();
  const [pendingLoadScript, setPendingLoadScript] = useState(null);
  const [pendingDeleteScript, setPendingDeleteScript] = useState(null);
  const [loadingScript, setLoadingScript] = useState(false);
  const deletingScript = deleteScriptMutation.isPending;
  const partiallySelected = selectedScripts.length > 0 && selectedScripts.length < savedScripts.length;
  const poolLabel = poolStatus.ready ? undefined : `Playground warming up (${poolStatus.warm}/${poolStatus.total} ready). The run will start when an instance is available.`;
  const setSelectAllRef = useCallback((node) => {
    if (node) node.indeterminate = partiallySelected;
  }, [partiallySelected]);

  function closeDeleteDialog() {
    if (!deletingScript) setPendingDeleteScript(null);
  }

  async function confirmDeleteScript() {
    if (!pendingDeleteScript) return;

    try {
      await deleteScriptMutation.mutateAsync(pendingDeleteScript.filename);
      setSelectedScripts((current) => current.filter((name) => name !== pendingDeleteScript.name));
      toast.success(`Deleted script "${pendingDeleteScript.name}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    } finally {
      setPendingDeleteScript(null);
    }
  }

  async function handleRecordAll() {
    try {
      await recordAll();
    } catch {
      // Run failures are displayed by RunProvider.
    }
  }

  function closeLoadDialog() {
    if (!loadingScript) setPendingLoadScript(null);
  }

  async function confirmLoadScript() {
    if (!pendingLoadScript) return;

    setLoadingScript(true);
    try {
      await loadScriptIntoEditor(pendingLoadScript);
      toast.success(`Loaded "${pendingLoadScript.name}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Load failed'));
    } finally {
      setLoadingScript(false);
      setPendingLoadScript(null);
    }
  }

  const allSelected = savedScripts.length > 0 && selectedScripts.length === savedScripts.length;

  return (
    <>
      <details id="saved-scripts-section">
        <summary>
          <span>Saved Scripts</span>
          <SectionBadge hidden={savedScripts.length === 0}>{savedScripts.length}</SectionBadge>
        </summary>
        <div className="saved-scripts-body">
          <div id="saved-scripts-list">
            {!savedScripts.length && <p className="hint">No scripts saved yet.</p>}

            {savedScripts.map((script) => (
              <div className="saved-script-item" key={script.filename}>
                <label className="script-name" title={script.name}>
                  <input
                    type="checkbox"
                    className="script-checkbox"
                    checked={selectedScripts.includes(script.name)}
                    onChange={(event) => {
                      setSelectedScripts((current) => (
                        event.target.checked
                          ? [...new Set([...current, script.name])]
                          : current.filter((name) => name !== script.name)
                      ));
                    }}
                  />
                  <span className="script-name-text">{script.name}</span>
                </label>
                <span className="script-meta">
                  {script.directionCount} direction{script.directionCount !== 1 ? 's' : ''}
                </span>
                <button
                  className="script-load-btn secondary"
                  type="button"
                  disabled={running || loadingScript}
                  onClick={() => setPendingLoadScript(script)}
                >
                  Load
                </button>
                <button
                  className="script-delete-btn sidebar-delete-icon-btn danger"
                  type="button"
                  aria-label={`Delete ${script.name}`}
                  title="Delete"
                  disabled={deletingScript && deleteScriptMutation.variables === script.filename}
                  onClick={() => setPendingDeleteScript(script)}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>

          <div className="saved-scripts-footer">
            <label className="select-all-label">
              <input
                ref={setSelectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={(event) => {
                  setSelectedScripts(event.target.checked ? savedScripts.map((script) => script.name) : []);
                }}
              /> Select all
            </label>
            <span className="hint-inline">{selectedScripts.length} selected</span>
            <button
              id="record-all-btn"
              className="primary"
              type="button"
              disabled={selectedScripts.length === 0 || running}
              title={poolLabel}
              onClick={handleRecordAll}
            >
              &#9654; Record All
            </button>
          </div>
        </div>
      </details>

      {pendingLoadScript && (
        <Dialog
          title="Load saved script?"
          description={`Loading "${pendingLoadScript.name}" will replace the current directions, blueprint, and recording settings. Unsaved changes will be lost.`}
          closeDisabled={loadingScript}
          onClose={closeLoadDialog}
        >
          <div className="app-dialog-actions">
            <button
              className="app-dialog-btn app-dialog-btn--secondary"
              type="button"
              disabled={loadingScript}
              onClick={closeLoadDialog}
            >
              Cancel
            </button>
            <button
              className="app-dialog-btn app-dialog-btn--danger"
              type="button"
              disabled={loadingScript}
              onClick={confirmLoadScript}
            >
              {loadingScript ? 'Loading...' : 'Load script'}
            </button>
          </div>
        </Dialog>
      )}

      {pendingDeleteScript && (
        <Dialog
          title="Delete saved script?"
          description={`Delete "${pendingDeleteScript.name}"? This cannot be undone.`}
          closeDisabled={deletingScript}
          onClose={closeDeleteDialog}
        >
          <div className="app-dialog-actions">
            <button
              className="app-dialog-btn app-dialog-btn--secondary"
              type="button"
              disabled={deletingScript}
              onClick={closeDeleteDialog}
            >
              Cancel
            </button>
            <button
              className="app-dialog-btn app-dialog-btn--danger"
              type="button"
              disabled={deletingScript}
              onClick={confirmDeleteScript}
            >
              {deletingScript ? 'Deleting...' : 'Delete script'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
