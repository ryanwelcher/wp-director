import { useCallback, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { DirectionGroup } from './DirectionGroup.jsx';
import { DirectionMenu } from './DirectionMenu.jsx';
import { DirectionPicker } from './DirectionPicker.jsx';
import { directionsForJSON, errorMessage, flattenDirectionActions } from './utils/actions.js';
import {
  useDirectionLoader,
  useSaveDirectionMutation,
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
    deleteDirection,
    directions,
    directionsView,
    insertDirectionAt,
    libraryEntries,
    reorderDirections,
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
  const loadDirection = useDirectionLoader();
  const saveDirectionMutation = useSaveDirectionMutation();

  const closePopovers = useCallback(() => {
    setMenu(null);
    setPicker(null);
  }, []);
  const activeDirectionRef = useCallback((node) => {
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, []);

  async function insertDirection(filename, insertIndex) {
    try {
      const data = await loadDirection(filename);
      const flatSteps = flattenDirectionActions(data.actions ?? []);
      const index = insertIndex ?? directions.length;
      insertDirectionAt({ label: data.name, actions: flatSteps, _fromDirection: true }, index);
      toast.success(`Inserted "${data.name}"`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load direction'));
    }
  }

  async function saveDirection(index) {
    const group = directions[index];
    if (!group) return;

    try {
      const data = await saveDirectionMutation.mutateAsync({
        name: group.label,
        actions: directionsForJSON([group]),
      });
      toast.success(`Saved direction "${group.label}"`);
      return data;
    } catch (err) {
      toast.error(errorMessage(err, 'Save failed'));
      return null;
    }
  }

  const hasDirections = directions.length > 0;

  return (
    <div className="panel" id="directions-panel">
      <div className="panel-header">
        <h2>Directions <span id="step-count">({directions.length})</span></h2>
        <button
          className="view-toggle-btn"
          type="button"
          hidden={!hasDirections}
          onClick={() => setDirectionsView(directionsView === 'actions' ? 'json' : 'actions')}
        >
          {directionsView === 'actions' ? 'Show JSON' : 'Show Actions'}
        </button>
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
                  index={index}
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
                  onLabelChange={(label) => updateDirectionLabel(index, label)}
                  onMenu={(event) => {
                    event.stopPropagation();
                    setPicker(null);
                    setMenu({ index, position: menuPosition(event.currentTarget) });
                  }}
                  onToggleAlwaysRun={() => toggleAlwaysRun(index)}
                  onToggleStartFrom={() => toggleStartFrom(index)}
                />
              );
            })}
          </ul>

          {!hasDirections && <p id="empty-hint" className="hint">Type a command above, or insert a direction below.</p>}

          <div id="direction-insert-bottom">
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
          </div>
        </>
      )}

      {directionsView === 'json' && (
        <pre id="steps-json-view">{JSON.stringify(cleanDirections, null, 2)}</pre>
      )}

      {menu && directions[menu.index] && (
        <>
          <button className="popover-backdrop" type="button" aria-label="Close menu" onClick={closePopovers} />
          <DirectionMenu
            direction={directions[menu.index]}
            position={menu.position}
            onClose={() => setMenu(null)}
            onDelete={() => deleteDirection(menu.index)}
            onInsert={() => setPicker({ anchorIndex: menu.index, position: menu.position })}
            onSave={() => saveDirection(menu.index)}
            onToggle={() => toggleDirectionOpen(menu.index)}
          />
        </>
      )}

      {picker && (
        <>
          <button className="popover-backdrop" type="button" aria-label="Close direction picker" onClick={closePopovers} />
          <DirectionPicker
            anchorIndex={picker.anchorIndex}
            entries={libraryEntries}
            position={picker.position}
            onClose={() => setPicker(null)}
            onSelect={insertDirection}
          />
        </>
      )}
    </div>
  );
}
