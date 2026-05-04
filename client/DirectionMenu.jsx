export function DirectionMenu({ direction, onClose, onDelete, onInsert, onSave, onToggle, position }) {
  if (!position) return null;
  const isResolved = !direction._translation?.status || direction._translation.status === 'resolved';

  function handleClick(callback) {
    return (event) => {
      event.stopPropagation();
      callback();
      onClose();
    };
  }

  return (
    <div className="direction-menu" style={{ top: position.top, left: position.left }} onClick={(event) => event.stopPropagation()}>
      {isResolved && (
        <button className="direction-menu-item direction-menu-toggle" type="button" onClick={handleClick(onToggle)}>
          {direction._open ? '\u25B2 Hide steps' : '\u25BC Show steps'}
        </button>
      )}
      <button className="direction-menu-item direction-menu-insert" type="button" onClick={handleClick(onInsert)}>
        + Insert direction
      </button>
      {isResolved && !direction._fromDirection && (
        <button className="direction-menu-item direction-menu-save" type="button" onClick={handleClick(onSave)}>
          &#128190; Save direction
        </button>
      )}
      <div className="direction-menu-divider" />
      <button className="direction-menu-item direction-menu-item--danger" type="button" onClick={handleClick(onDelete)}>
        &#10005; Delete step
      </button>
    </div>
  );
}
