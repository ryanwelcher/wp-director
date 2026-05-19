import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from './Dialog.jsx';

const ACTION_COPY = {
  export: {
    confirmLabel: 'Export TXT',
    description: 'Enter a script name before exporting the current script.',
  },
  save: {
    confirmLabel: 'Save Script',
    description: 'Enter a script name before saving the current script.',
  },
};

export function ScriptNameDialog({ action, defaultValue = '', onCancel, onConfirm }) {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef(null);
  const [draftName, setDraftName] = useState(defaultValue);
  const [showError, setShowError] = useState(false);
  const actionCopy = ACTION_COPY[action] ?? ACTION_COPY.save;
  const scriptName = draftName.trim();

  useEffect(() => {
    setDraftName(defaultValue);
    setShowError(false);
  }, [action, defaultValue]);

  function handleSubmit(event) {
    event.preventDefault();
    setShowError(true);
    if (!scriptName) return;
    onConfirm(scriptName);
  }

  return (
    <Dialog
      title="Name this script"
      description={actionCopy.description}
      initialFocusRef={inputRef}
      onClose={onCancel}
    >
      <form className="app-dialog-form" onSubmit={handleSubmit}>
        <label className="app-dialog-field" htmlFor={inputId}>
          <span>Script name</span>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={draftName}
            aria-invalid={showError && !scriptName}
            aria-describedby={showError && !scriptName ? errorId : undefined}
            onChange={(event) => {
              setDraftName(event.target.value);
              if (event.target.value.trim()) setShowError(false);
            }}
          />
        </label>
        {showError && !scriptName && (
          <p id={errorId} className="app-dialog-error" role="alert">
            Enter a script name to continue.
          </p>
        )}
        <div className="app-dialog-actions">
          <button className="app-dialog-btn app-dialog-btn--secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="app-dialog-btn app-dialog-btn--primary" type="submit">
            {actionCopy.confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
