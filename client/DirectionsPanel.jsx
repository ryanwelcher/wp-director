import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { DirectionGroup } from './DirectionGroup.jsx';
import { DirectionMenu } from './DirectionMenu.jsx';
import { DirectionPicker } from './DirectionPicker.jsx';
import { errorMessage, flattenDirectionActions } from './utils/actions.js';
import { fetchJSON, postJSON } from './utils/api.js';

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
    loadDirectionLibrary,
    reorderDirections,
    setDirectionsView,
    startFromIndex,
    toggleAlwaysRun,
    toggleDirectionOpen,
    toggleStartFrom,
    updateDirectionLabel,
  } = useAppState();
  const draggingIndexRef = useRef(null);
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [menu, setMenu] = useState(null);
  const [picker, setPicker] = useState(null);

  useEffect(() => {
    function closeMenus() {
      setMenu(null);
      setPicker(null);
    }

    if (menu || picker) {
      setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
    }
  }, [menu, picker]);

  async function insertDirection(filename, insertIndex) {
    try {
      const data = await fetchJSON(`/api/directions/${filename}`);
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
      const data = await postJSON('/api/directions/save', {
        name: group.label,
        actions: [group],
      });
      toast.success(`Saved direction "${group.label}"`);
      await loadDirectionLibrary();
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
                  key={`${direction.label}-${index}`}
                  direction={direction}
                  dragging={draggingIndex === index}
                  dragOver={dragOverIndex === index}
                  index={index}
                  isAlwaysRun={isAlwaysRun}
                  isSkipped={isSkipped}
                  isStartFrom={isStartFrom}
                  onDelete={() => deleteDirection(index)}
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
        <DirectionMenu
          direction={directions[menu.index]}
          position={menu.position}
          onClose={() => setMenu(null)}
          onDelete={() => deleteDirection(menu.index)}
          onInsert={() => setPicker({ anchorIndex: menu.index, position: menu.position })}
          onSave={() => saveDirection(menu.index)}
          onToggle={() => toggleDirectionOpen(menu.index)}
        />
      )}

      {picker && (
        <DirectionPicker
          anchorIndex={picker.anchorIndex}
          entries={libraryEntries}
          position={picker.position}
          onClose={() => setPicker(null)}
          onSelect={insertDirection}
        />
      )}
    </div>
  );
}
