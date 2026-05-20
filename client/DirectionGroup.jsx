import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { describePlain } from './utils/actions.js';

export function DirectionGroup({
  direction,
  dragging,
  dragOver,
  editValue = '',
  index,
  isEditing,
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
  onEditCancel,
  onEditChange,
  onEditSubmit,
  onLabelChange,
  onMenu,
  onDismissUnmatched,
  onToggleAlwaysRun,
  onToggleStartFrom,
  onTryAnyway,
  tryAnywayPending,
  fixPending,
  onFixDirection,
  onDismissFailure,
}) {
  const translationStatus = direction._translation?.status;
  const translationError = direction._translation?.error;
  const isTranslating = translationStatus === 'pending';
  const isTranslationError = translationStatus === 'error';
  const isUnmatched = translationStatus === 'unmatched';
  const isResolved = !translationStatus || translationStatus === 'resolved';
  const isFreeForm = !!direction._freeForm;
  const failure = direction._failure;
  const placeholderSet = direction._placeholders?.length
    ? new Set(direction._placeholders)
    : null;
  const unmatchedCommand = direction._translation?.command ?? '';
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
    isUnmatched && 'is-unmatched',
    isFreeForm && 'is-free-form',
    isEditing && 'is-editing',
    failure && 'has-failure',
  );
  const editInputRef = useRef(null);

  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [isEditing]);

  return (
    <li
      ref={itemRef}
      className={className}
      aria-busy={isTranslating}
      draggable={isResolved && !isEditing}
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
          disabled={!isResolved || isEditing}
          onChange={(event) => onLabelChange(event.target.value)}
          onDragStart={(event) => event.preventDefault()}
        />
        <button
          className="direction-start-btn"
          title={isStartFrom ? 'Clear play start point' : 'Play from this step'}
          type="button"
          disabled={!isResolved || isEditing}
          onClick={onToggleStartFrom}
        >
          &#9655;
        </button>
        <button
          className="direction-pin-btn"
          title={isAlwaysRun ? 'Remove always-run' : 'Always run (even when skipping earlier steps)'}
          type="button"
          disabled={!isResolved || isEditing}
          onClick={onToggleAlwaysRun}
        >
          &#128204;
        </button>
        <button className="direction-menu-btn" title="More actions" type="button" disabled={!isResolved || isEditing} onClick={onMenu}>
          &#8943;
        </button>
      </div>

      {isEditing && isResolved && (
        <form
          className="direction-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            onEditSubmit();
          }}
        >
          <input
            ref={editInputRef}
            className="direction-edit-input"
            type="text"
            value={editValue}
            aria-label="Additional context for this direction"
            placeholder="Tell AI what to change or clarify..."
            onChange={(event) => onEditChange(event.target.value)}
            onDragStart={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onEditCancel();
              }
            }}
          />
          <button className="direction-edit-btn direction-edit-btn--secondary" type="button" onClick={onEditCancel}>
            Cancel
          </button>
          <button className="direction-edit-btn direction-edit-btn--primary" type="submit" disabled={!editValue.trim()}>
            Send
          </button>
        </form>
      )}

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

      {isUnmatched && (
        <div className="direction-unmatched-state">
          <p className="direction-unmatched-message">
            No saved direction matched <em>“{unmatchedCommand}”</em>. See the
            {' '}<strong>Directions</strong> panel in the sidebar for what's supported.
          </p>
          <div className="direction-unmatched-actions">
            <button
              className="direction-unmatched-try"
              type="button"
              disabled={tryAnywayPending}
              onClick={onTryAnyway}
            >
              {tryAnywayPending ? 'Generating…' : 'Try anyway with free-form generation'}
            </button>
            <button
              className="direction-unmatched-dismiss"
              type="button"
              disabled={tryAnywayPending}
              onClick={onDismissUnmatched}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {failure && isResolved && (
        <div className="direction-failure">
          <div className="direction-failure-header">
            <span className="direction-failure-icon" aria-hidden="true">⚠</span>
            <span className="direction-failure-title">Recording failed at this direction</span>
            <button
              className="direction-failure-dismiss"
              type="button"
              onClick={onDismissFailure}
              aria-label="Dismiss failure marker"
              title="Dismiss"
            >
              ×
            </button>
          </div>
          <pre className="direction-failure-message">{failure.error}</pre>
          <div className="direction-failure-actions">
            <button
              className="direction-failure-fix"
              type="button"
              disabled={fixPending}
              onClick={onFixDirection}
            >
              {fixPending ? 'Asking AI…' : 'Fix with AI'}
            </button>
          </div>
        </div>
      )}

      {direction._open && direction.actions?.length > 0 && (
        <ul className="direction-inner-list">
          {direction.actions.map((action, actionIndex) => {
            const isPlaceholder = placeholderSet?.has(actionIndex);
            return (
              <li
                className={clsx('direction-inner-item', isPlaceholder && 'is-placeholder')}
                key={`${action.action}-${actionIndex}`}
              >
                {describePlain(action)}
                {isPlaceholder && (
                  <span
                    className="direction-placeholder-badge"
                    title="Auto-filled placeholder — edit before recording"
                  >
                    placeholder
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
