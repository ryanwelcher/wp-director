import clsx from 'clsx';
import { describePlain } from './utils/actions.js';

export function DirectionGroup({
  direction,
  dragging,
  dragOver,
  index,
  isAlwaysRun,
  isActiveStep,
  isSkipped,
  isStartFrom,
  itemRef,
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
  const translationStatus = direction._translation?.status;
  const translationError = direction._translation?.error;
  const isTranslating = translationStatus === 'pending';
  const isTranslationError = translationStatus === 'error';
  const isResolved = !translationStatus || translationStatus === 'resolved';
  const className = clsx(
    'direction-group',
    dragging && 'dragging',
    dragOver && 'drag-over',
    isActiveStep && 'active-step',
    isStartFrom && 'start-from',
    isSkipped && 'skipped',
    isAlwaysRun && 'always-run',
    isTranslating && 'is-translating',
    isTranslationError && 'has-translation-error',
  );

  return (
    <li
      ref={itemRef}
      className={className}
      aria-busy={isTranslating}
      draggable={isResolved}
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
          disabled={!isResolved}
          onChange={(event) => onLabelChange(event.target.value)}
          onDragStart={(event) => event.preventDefault()}
        />
        <button
          className="direction-start-btn"
          title={isStartFrom ? 'Clear play start point' : 'Play from this step'}
          type="button"
          disabled={!isResolved}
          onClick={onToggleStartFrom}
        >
          &#9655;
        </button>
        <button
          className="direction-pin-btn"
          title={isAlwaysRun ? 'Remove always-run' : 'Always run (even when skipping earlier steps)'}
          type="button"
          disabled={!isResolved}
          onClick={onToggleAlwaysRun}
        >
          &#128204;
        </button>
        <button className="direction-menu-btn" title="More actions" type="button" onClick={onMenu}>
          &#8943;
        </button>
      </div>

      {isTranslating && (
        <div className="direction-translation-state">
          <span className="direction-spinner" aria-hidden="true" />
          <span>Translating direction...</span>
        </div>
      )}

      {isTranslationError && (
        <div className="direction-translation-state direction-translation-state--error">
          {translationError || 'Translation failed'}
        </div>
      )}

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
