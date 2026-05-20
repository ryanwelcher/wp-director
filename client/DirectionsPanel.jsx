import clsx from 'clsx';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { DirectionGroup } from './DirectionGroup.jsx';
import { DirectionMenu } from './DirectionMenu.jsx';
import { DirectionPicker } from './DirectionPicker.jsx';
import { PoolStatusIndicators } from './PoolStatusIndicators.jsx';
import { Dialog } from './Dialog.jsx';
import { SaveAsIntentDialog } from './SaveAsIntentDialog.jsx';
import { BlueprintPanel } from './Sidebar/BlueprintPanel.jsx';
import { RecordingSettingsPanel } from './Sidebar/RecordingSettingsPanel.jsx';
import { directionsForJSON, errorMessage } from './utils/actions.js';
import {
  useFixDirectionMutation,
  useTranslateFreeFormMutation,
  useTranslateMutation,
} from './utils/apiHooks.js';
import { useRunState } from './context/RunContext.jsx';

function menuPosition(target, width = 200) {
  const rect = target.getBoundingClientRect();
  let left = rect.right + window.scrollX - width;
  if (left < 8) left = 8;
  return {
    top: `${rect.bottom + window.scrollY + 4}px`,
    left: `${left}px`,
  };
}

function pickerPosition(target, width = 220) {
  const rect = target.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  return {
    top: `${rect.bottom + window.scrollY + 4}px`,
    left: `${left}px`,
  };
}

export function DirectionsPanel() {
  const {
    alwaysRunIndices,
    cleanDirections,
    clearDirectionsOnly,
    clearDirectionFailure,
    deleteDirection,
    directions,
    directionsView,
    failPendingDirection,
    insertDirectionAt,
    intentCatalog,
    replaceDirectionActions,
    reorderDirections,
    replaceWithPendingDirection,
    resolvePendingDirection,
    resolveUnmatchedDirection,
    setDirectionsView,
    startFromIndex,
    toggleAlwaysRun,
    toggleDirectionOpen,
    toggleStartFrom,
    updateDirectionLabel,
  } = useAppState();
  const { activeStepIndex } = useRunState();
  const draggingIndexRef = useRef(null);
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [menu, setMenu] = useState(null);
  const [picker, setPicker] = useState(null);
  const [editDirection, setEditDirection] = useState(null);
  const [activeTab, setActiveTab] = useState('directions');
  const [clearDirectionsDialogOpen, setClearDirectionsDialogOpen] = useState(false);
  const translateMutation = useTranslateMutation();
  const translateFreeFormMutation = useTranslateFreeFormMutation();
  const fixDirectionMutation = useFixDirectionMutation();
  const [tryAnywayPending, setTryAnywayPending] = useState(() => new Set());
  const [fixPendingIndex, setFixPendingIndex] = useState(null);
  const [fixProposal, setFixProposal] = useState(null);
  const [saveIntentTarget, setSaveIntentTarget] = useState(null);

  const closePopovers = useCallback(() => {
    setMenu(null);
    setPicker(null);
  }, []);
  const selectTab = useCallback((tab) => {
    closePopovers();
    setActiveTab(tab);
  }, [closePopovers]);
  const activeDirectionRef = useCallback((node) => {
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, []);

  function insertIntent(expandedDirections, insertIndex) {
    if (!expandedDirections?.length) return;
    let index = insertIndex ?? directions.length;
    for (const direction of expandedDirections) {
      insertDirectionAt({ ...direction, _fromIntent: true }, index);
      index += 1;
    }
    toast.success(expandedDirections.length === 1
      ? `Inserted "${expandedDirections[0].label}"`
      : `Inserted ${expandedDirections.length} directions`);
  }

  function buildEditCommand(direction, context) {
    return [
      'Retranslate this existing direction using the user\'s additional context.',
      'Treat the context as a clarification for the current direction, not as a standalone new direction.',
      'Return replacement direction(s) for this direction only.',
      `Current direction intent: ${direction.label}`,
      `Current direction JSON:\n${JSON.stringify(directionsForJSON([direction])[0] ?? { label: direction.label, actions: direction.actions ?? [] }, null, 2)}`,
      `User added context: ${context}`,
    ].join('\n\n');
  }

  async function submitDirectionEdit(index) {
    const direction = directions[index];
    if (!direction) return;

    const context = editDirection?.value?.trim();
    if (!context) return;

    const history = directionsForJSON(directions.slice(0, index)).flatMap((group) => group.actions ?? []);
    const command = buildEditCommand(direction, context);
    const pending = replaceWithPendingDirection(index, direction.label, context);
    setEditDirection(null);
    if (!pending) return;

    try {
      const data = await translateMutation.mutateAsync({ command, history });
      const translatedDirections = data.directions ?? [];

      if (!translatedDirections.length) {
        throw new Error('Translation returned no directions');
      }

      const nextDirections = resolvePendingDirection(pending._id, translatedDirections, context, index);
      toast.success(nextDirections.length === 1 ? 'Updated direction' : `Updated ${nextDirections.length} directions`);
    } catch (err) {
      failPendingDirection(pending._id, err);
      toast.error(errorMessage(err, 'Edit failed'));
    }
  }

  function openSaveAsIntent(index) {
    const direction = directions[index];
    if (!direction || !direction._freeForm) return;
    const prompt = direction._translation?.command || direction.label;
    setSaveIntentTarget({ index, prompt, directions: [direction] });
  }

  async function handleIntentSaved({ prompt }) {
    setSaveIntentTarget(null);
    // After save, re-run the original prompt through the deterministic
    // pipeline so the user sees their new intent in action. Append to the
    // end of the current list — the original free-form direction stays so
    // the diff between paths is obvious.
    if (!prompt) return;
    const history = directionsForJSON(directions).flatMap((group) => group.actions ?? []);
    try {
      const data = await translateMutation.mutateAsync({ command: prompt, history });
      const next = data.directions ?? [];
      if (!next.length) {
        toast.info('Saved — but re-running the prompt produced no directions. Check the proposal\'s examples.');
        return;
      }
      for (const direction of next) {
        insertDirectionAt({ ...direction, _fromIntent: true }, directions.length);
      }
      toast.success(`Saved — re-ran the prompt; ${next.length} direction(s) added.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Saved but re-run failed'));
    }
  }

  async function requestFixDirection(index) {
    const direction = directions[index];
    if (!direction || !direction._failure) return;
    setFixPendingIndex(index);
    try {
      const actions = await fixDirectionMutation.mutateAsync({
        actions: direction.actions || [],
        error: direction._failure.error,
        originalPrompt: direction._translation?.command,
        label: direction.label,
      });
      if (!Array.isArray(actions) || actions.length === 0) {
        toast.error('AI returned no replacement actions.');
        return;
      }
      setFixProposal({
        index,
        originalActions: direction.actions || [],
        replacement: actions,
        fromIntent: !!direction._fromIntent,
        errorMessage: direction._failure.error,
      });
    } catch (err) {
      toast.error(errorMessage(err, 'Fix failed'));
    } finally {
      setFixPendingIndex(null);
    }
  }

  function acceptFixDirection() {
    if (!fixProposal) return;
    const { index, replacement } = fixProposal;
    replaceDirectionActions(index, replacement);
    setFixProposal(null);
    toast.success(replacement.length === 1
      ? 'Direction repaired (1 action).'
      : `Direction repaired (${replacement.length} actions).`);
  }

  function rejectFixDirection() {
    setFixProposal(null);
  }

  async function tryAnywayFreeForm(index) {
    const direction = directions[index];
    if (!direction) return;
    const command = direction._translation?.command;
    if (!command) return;

    const id = direction._id;
    setTryAnywayPending((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });

    const history = directionsForJSON(directions.slice(0, index)).flatMap((group) => group.actions ?? []);

    try {
      const data = await translateFreeFormMutation.mutateAsync({ command, history });
      const translated = data.directions ?? [];
      if (!translated.length) {
        throw new Error('Translation returned no directions');
      }
      // Replacing the unmatched pending direction at its current index keeps
      // the free-form result anchored where the user was already looking.
      const nextDirections = resolvePendingDirection(id, translated, command, index, { freeForm: true });
      toast.success(nextDirections.length === 1 ? 'Added free-form direction' : `Added ${nextDirections.length} free-form directions`);
    } catch (err) {
      // Restore the unmatched panel so the user can retry.
      resolveUnmatchedDirection(id, command);
      toast.error(errorMessage(err, 'Free-form translation failed'));
    } finally {
      setTryAnywayPending((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  const hasDirections = directions.length > 0;

  return (
    <div className="panel" id="directions-panel">
      <div className="script-settings-header">
        <div className="script-settings-tabs" role="tablist" aria-label="Script settings">
          <button
            id="script-tab-directions"
            className={clsx('script-settings-tab', activeTab === 'directions' && 'active')}
            type="button"
            role="tab"
            aria-selected={activeTab === 'directions'}
            aria-controls="script-panel-directions"
            onClick={() => selectTab('directions')}
          >
            Directions <span id="step-count">({directions.length})</span>
          </button>
          <button
            id="script-tab-blueprint"
            className={clsx('script-settings-tab', activeTab === 'blueprint' && 'active')}
            type="button"
            role="tab"
            aria-selected={activeTab === 'blueprint'}
            aria-controls="script-panel-blueprint"
            onClick={() => selectTab('blueprint')}
          >
            Blueprint
            <PoolStatusIndicators tab />
          </button>
          <button
            id="script-tab-recording"
            className={clsx('script-settings-tab', activeTab === 'recording' && 'active')}
            type="button"
            role="tab"
            aria-selected={activeTab === 'recording'}
            aria-controls="script-panel-recording"
            onClick={() => selectTab('recording')}
          >
            Recording Settings
          </button>
        </div>
      </div>

      <div className="script-settings-scroll">
        <div
          id="script-panel-directions"
          className="script-settings-tab-panel"
          role="tabpanel"
          aria-labelledby="script-tab-directions"
          hidden={activeTab !== 'directions'}
        >
          <div className="tab-panel-body">
            <div className="directions-view-switcher">
              <div className="directions-view-toggle" role="group" aria-label="Directions view">
                <button
                  className={clsx('directions-view-toggle-btn', directionsView === 'actions' && 'active')}
                  type="button"
                  aria-pressed={directionsView === 'actions'}
                  onClick={() => setDirectionsView('actions')}
                >
                  Actions
                </button>
                <button
                  className={clsx('directions-view-toggle-btn', directionsView === 'json' && 'active')}
                  type="button"
                  aria-pressed={directionsView === 'json'}
                  onClick={() => setDirectionsView('json')}
                >
                  JSON
                </button>
              </div>
            </div>
  
            {directionsView === 'actions' && (
              <>
                <ul id="step-list">
                  {directions.map((direction, index) => {
                    const isStartFrom = startFromIndex === index;
                    const isAlwaysRun = alwaysRunIndices.has(index);
                    const isSkipped = startFromIndex !== null && index < startFromIndex && !isAlwaysRun;
  
                    return (
                      <DirectionGroup
                        key={direction._id ?? index}
                        direction={direction}
                        dragging={draggingIndex === index}
                        dragOver={dragOverIndex === index}
                        editValue={editDirection?.index === index ? editDirection.value : ''}
                        index={index}
                        isEditing={editDirection?.index === index}
                        isAlwaysRun={isAlwaysRun}
                        isActiveStep={activeStepIndex === index}
                        isSkipped={isSkipped}
                        isStartFrom={isStartFrom}
                        itemRef={activeStepIndex === index ? activeDirectionRef : null}
                        onDragStart={(event) => {
                          if (event.target.tagName === 'INPUT') {
                            event.preventDefault();
                            return;
                          }
                          draggingIndexRef.current = index;
                          setDraggingIndex(index);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', String(index));
                        }}
                        onDragEnd={() => {
                          draggingIndexRef.current = null;
                          setDraggingIndex(null);
                          setDragOverIndex(null);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          if (draggingIndexRef.current !== null && draggingIndexRef.current !== index) {
                            setDragOverIndex(index);
                          }
                        }}
                        onDragLeave={() => {
                          setDragOverIndex((current) => (current === index ? null : current));
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const from = draggingIndexRef.current;
                          if (from !== null && from !== index) {
                            reorderDirections(from, index);
                          }
                          draggingIndexRef.current = null;
                          setDraggingIndex(null);
                          setDragOverIndex(null);
                        }}
                        onEditCancel={() => setEditDirection(null)}
                        onEditChange={(value) => setEditDirection((current) => (
                          current?.index === index ? { ...current, value } : current
                        ))}
                        onEditSubmit={() => submitDirectionEdit(index)}
                        onLabelChange={(label) => updateDirectionLabel(index, label)}
                        onMenu={(event) => {
                          event.stopPropagation();
                          setPicker(null);
                          setMenu({ index, position: menuPosition(event.currentTarget) });
                        }}
                        onToggleAlwaysRun={() => toggleAlwaysRun(index)}
                        onToggleStartFrom={() => toggleStartFrom(index)}
                        onDismissUnmatched={() => deleteDirection(index)}
                        onTryAnyway={() => tryAnywayFreeForm(index)}
                        tryAnywayPending={tryAnywayPending.has(direction._id)}
                        fixPending={fixPendingIndex === index}
                        onFixDirection={() => requestFixDirection(index)}
                        onDismissFailure={() => clearDirectionFailure(index)}
                      />
                    );
                  })}
                </ul>
  
                {!hasDirections && <p id="empty-hint" className="hint">Type a command above, or insert a direction below.</p>}
  
                <div id="direction-insert-bottom" className="directions-tab-actions">
                  <button
                    className="direction-insert-plus direction-insert-plus--bottom"
                    title="Insert direction"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenu(null);
                      setPicker({ anchorIndex: null, position: pickerPosition(event.currentTarget) });
                    }}
                  >
                    + Insert direction
                  </button>
                  <button
                    className="direction-insert-plus direction-insert-plus--bottom"
                    title="Clear all directions"
                    type="button"
                    disabled={!hasDirections}
                    onClick={() => setClearDirectionsDialogOpen(true)}
                  >
                    × Clear directions
                  </button>
                </div>
              </>
            )}
  
            {directionsView === 'json' && (
              <pre id="steps-json-view">{JSON.stringify(cleanDirections, null, 2)}</pre>
            )}
          </div>
        </div>

        <div
          id="script-panel-blueprint"
          className="script-settings-tab-panel"
          role="tabpanel"
          aria-labelledby="script-tab-blueprint"
          hidden={activeTab !== 'blueprint'}
        >
          <BlueprintPanel />
        </div>

        <div
          id="script-panel-recording"
          className="script-settings-tab-panel"
          role="tabpanel"
          aria-labelledby="script-tab-recording"
          hidden={activeTab !== 'recording'}
        >
          <RecordingSettingsPanel />
        </div>
      </div>

      {activeTab === 'directions' && menu && directions[menu.index] && (
        <>
          <button className="popover-backdrop" type="button" aria-label="Close menu" onClick={closePopovers} />
          <DirectionMenu
            direction={directions[menu.index]}
            position={menu.position}
            onClose={() => setMenu(null)}
            onDelete={() => deleteDirection(menu.index)}
            onEdit={() => {
              setEditDirection({ index: menu.index, value: '' });
            }}
            onInsert={() => setPicker({ anchorIndex: menu.index, position: menu.position })}
            onSaveAsIntent={() => openSaveAsIntent(menu.index)}
            onToggle={() => toggleDirectionOpen(menu.index)}
          />
        </>
      )}

      {activeTab === 'directions' && picker && (
        <>
          <button className="popover-backdrop" type="button" aria-label="Close direction picker" onClick={closePopovers} />
          <DirectionPicker
            anchorIndex={picker.anchorIndex}
            entries={intentCatalog}
            position={picker.position}
            onClose={() => setPicker(null)}
            onSelect={insertIntent}
          />
        </>
      )}

      {saveIntentTarget && (
        <SaveAsIntentDialog
          prompt={saveIntentTarget.prompt}
          directions={saveIntentTarget.directions}
          existingIds={intentCatalog.map((intent) => intent.id)}
          onClose={() => setSaveIntentTarget(null)}
          onSaved={handleIntentSaved}
        />
      )}

      {fixProposal && (
        <Dialog
          title="Apply AI fix to failed direction?"
          description={
            fixProposal.fromIntent
              ? 'This is a saved direction. The fix applies to the current step list only — the saved version is unchanged.'
              : 'Review the proposed replacement before applying. The original error from the failed run is shown for reference.'
          }
          onClose={rejectFixDirection}
          className="app-dialog--wide"
        >
          <pre className="direction-fix-error">{fixProposal.errorMessage}</pre>
          <div className="direction-fix-diff">
            <div className="direction-fix-side">
              <h3>Current ({fixProposal.originalActions.length})</h3>
              <pre>{JSON.stringify(fixProposal.originalActions, null, 2)}</pre>
            </div>
            <div className="direction-fix-side">
              <h3>Proposed ({fixProposal.replacement.length})</h3>
              <pre>{JSON.stringify(fixProposal.replacement, null, 2)}</pre>
            </div>
          </div>
          <div className="app-dialog-actions">
            <button className="app-dialog-btn app-dialog-btn--secondary" type="button" onClick={rejectFixDirection}>
              Reject
            </button>
            <button className="app-dialog-btn app-dialog-btn--primary" type="button" onClick={acceptFixDirection}>
              Accept replacement
            </button>
          </div>
        </Dialog>
      )}

      {clearDirectionsDialogOpen && (
        <Dialog
          title="Clear directions?"
          description="Remove all directions from the editor? Recording settings and blueprint will not change. This cannot be undone."
          onClose={() => setClearDirectionsDialogOpen(false)}
        >
          <div className="app-dialog-actions">
            <button
              className="app-dialog-btn app-dialog-btn--secondary"
              type="button"
              onClick={() => setClearDirectionsDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              className="app-dialog-btn app-dialog-btn--danger"
              type="button"
              onClick={() => {
                clearDirectionsOnly();
                setClearDirectionsDialogOpen(false);
              }}
            >
              Clear directions
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
