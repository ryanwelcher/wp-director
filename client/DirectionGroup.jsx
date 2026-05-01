import { describePlain } from './utils/actions.js';

export function DirectionGroup({
  direction,
  dragging,
  dragOver,
  index,
  isAlwaysRun,
  isSkipped,
  isStartFrom,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
  onLabelChange,
  onMenu,
  onToggleAlwaysRun,
  onToggleStartFrom,
}) {
  const className = [
    'direction-group',
    dragging ? 'dragging' : '',
    dragOver ? 'drag-over' : '',
    isStartFrom ? 'start-from' : '',
    isSkipped ? 'skipped' : '',
    isAlwaysRun ? 'always-run' : '',
  ].filter(Boolean).join(' ');

  return (
    <li
      className={className}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="direction-group-header">
        <span className="drag-handle" title="Drag to reorder">&#10303;</span>
        <span className="index">{index + 1}</span>
        <input
          className="direction-label-input"
          value={direction.label}
          title="Edit label"
          onChange={(event) => onLabelChange(event.target.value)}
          onDragStart={(event) => event.preventDefault()}
        />
        <button
          className="direction-start-btn"
          title={isStartFrom ? 'Clear preview start point' : 'Preview from this step'}
          type="button"
          onClick={onToggleStartFrom}
        >
          &#9655;
        </button>
        <button
          className="direction-pin-btn"
          title={isAlwaysRun ? 'Remove always-run' : 'Always run (even when skipping earlier steps)'}
          type="button"
          onClick={onToggleAlwaysRun}
        >
          &#128204;
        </button>
        <button className="direction-menu-btn" title="More actions" type="button" onClick={onMenu}>
          &#8943;
        </button>
      </div>

      {direction._open && direction.actions?.length > 0 && (
        <ul className="direction-inner-list">
          {direction.actions.map((action, actionIndex) => (
            <li className="direction-inner-item" key={`${action.action}-${actionIndex}`}>
              {describePlain(action)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
