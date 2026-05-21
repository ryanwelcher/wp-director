import { TrashIcon } from './Sidebar/TrashIcon.jsx';

const MENU_ICONS = {
  edit: (
    <>
      <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17l-1 3Z" />
      <path d="m14 7 3 3" />
    </>
  ),
  insert: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  stepsHidden: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  stepsShown: (
    <>
      <path d="m4 4 16 16" />
      <path d="M9.5 5.3A9.6 9.6 0 0 1 12 5c6 0 9.5 7 9.5 7a17.8 17.8 0 0 1-2.6 3.4" />
      <path d="M14.1 14.1A3 3 0 0 1 9.9 9.9" />
      <path d="M6.6 6.6A17.7 17.7 0 0 0 2.5 12s3.5 7 9.5 7a9.5 9.5 0 0 0 4.8-1.4" />
    </>
  ),
};

function MenuIcon({ name }) {
  return (
    <svg className="recording-action-icon direction-menu-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {MENU_ICONS[name]}
    </svg>
  );
}

export function DirectionMenu({ direction, onClose, onDelete, onEdit, onInsert, onToggle, position }) {
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
          <MenuIcon name={direction._open ? 'stepsShown' : 'stepsHidden'} />
          <span>{direction._open ? 'Hide steps' : 'Show steps'}</span>
        </button>
      )}
      <button className="direction-menu-item direction-menu-insert" type="button" onClick={handleClick(onInsert)}>
        <MenuIcon name="insert" />
        <span>Insert direction</span>
      </button>
      {isResolved && (
        <button className="direction-menu-item direction-menu-edit" type="button" onClick={handleClick(onEdit)}>
          <MenuIcon name="edit" />
          <span>Edit</span>
        </button>
      )}
      <div className="direction-menu-divider" />
      <button className="direction-menu-item direction-menu-item--danger" type="button" onClick={handleClick(onDelete)}>
        <TrashIcon className="recording-action-icon direction-menu-icon" />
        <span>Delete step</span>
      </button>
    </div>
  );
}
