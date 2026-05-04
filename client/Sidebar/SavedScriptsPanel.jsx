import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from '../context/AppStateContext.jsx';
import { useRunState } from '../context/RunContext.jsx';
import { errorMessage } from '../utils/actions.js';
import { useDeleteScriptMutation } from '../utils/apiHooks.js';
import { SectionBadge } from './SectionBadge.jsx';

export function SavedScriptsPanel() {
  const {
    loadScriptIntoEditor,
    savedScripts,
    selectedScripts,
    setSelectedScripts,
  } = useAppState();
  const { recordAll, running } = useRunState();
  const deleteScriptMutation = useDeleteScriptMutation();
  const selectAllRef = useRef(null);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = selectedScripts.length > 0 && selectedScripts.length < savedScripts.length;
  }, [savedScripts.length, selectedScripts.length]);

  async function deleteScript(script) {
    try {
      await deleteScriptMutation.mutateAsync(script.filename);
      setSelectedScripts((current) => current.filter((name) => name !== script.name));
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    }
  }

  async function handleRecordAll() {
    try {
      await recordAll();
    } catch {
      // Run failures are displayed by RunProvider.
    }
  }

  const allSelected = savedScripts.length > 0 && selectedScripts.length === savedScripts.length;

  return (
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
              <span className="script-name">{script.name}</span>
              <span className="script-meta">
                {script.directionCount} direction{script.directionCount !== 1 ? 's' : ''}
              </span>
              <button className="script-load-btn secondary" type="button" onClick={() => {
                loadScriptIntoEditor(script);
                toast.success(`Loaded "${script.name}"`);
              }}>
                Load
              </button>
              <button className="script-delete-btn danger" type="button" onClick={() => deleteScript(script)}>
                Delete
              </button>
            </div>
          ))}
        </div>

        <div className="saved-scripts-footer">
          <label className="select-all-label">
            <input
              ref={selectAllRef}
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
            onClick={handleRecordAll}
          >
            &#9654; Record All
          </button>
        </div>
      </div>
    </details>
  );
}
