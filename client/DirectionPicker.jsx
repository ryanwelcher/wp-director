import { useState } from 'react';

export function DirectionPicker({ anchorIndex, entries, onClose, onSelect, position }) {
  const [insertAbove, setInsertAbove] = useState(false);
  if (!position) return null;

  const hasPositionToggle = anchorIndex !== null;

  function selectEntry(filename) {
    const insertIndex = anchorIndex === null
      ? null
      : (insertAbove ? anchorIndex : anchorIndex + 1);
    onSelect(filename, insertIndex);
    onClose();
  }

  return (
    <div className="direction-picker" style={{ top: position.top, left: position.left }} onClick={(event) => event.stopPropagation()}>
      {hasPositionToggle && (
        <>
          <div className="direction-picker-position">
            <button
              className={`direction-picker-pos-btn${!insertAbove ? ' active' : ''}`}
              type="button"
              onClick={() => setInsertAbove(false)}
            >
              &#8595; Below
            </button>
            <button
              className={`direction-picker-pos-btn${insertAbove ? ' active' : ''}`}
              type="button"
              onClick={() => setInsertAbove(true)}
            >
              &#8593; Above
            </button>
          </div>
          <div className="direction-picker-divider" />
        </>
      )}

      {entries.map((entry) => (
        <button
          key={entry.filename}
          className={`direction-picker-item${entry.builtin ? ' direction-picker-item--builtin' : ''}`}
          type="button"
          onClick={() => selectEntry(entry.filename)}
        >
          {entry.name}
        </button>
      ))}
    </div>
  );
}
