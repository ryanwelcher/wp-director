import { useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { errorMessage } from './utils/actions.js';
import { useTranslateMutation } from './utils/apiHooks.js';
import { toastAddedDirections } from './utils/toasts.js';

export function CommandBar() {
  const {
    appendPendingDirection,
    cleanDirections,
    failPendingDirection,
    resolvePendingDirection,
  } = useAppState();
  const [command, setCommand] = useState('');
  const translateMutation = useTranslateMutation();

  async function addCommand() {
    const trimmed = command.trim();
    if (!trimmed) return;

    const pending = appendPendingDirection(trimmed);
    const flatHistory = cleanDirections.flatMap((group) => group.actions ?? []);
    setCommand('');

    try {
      const data = await translateMutation.mutateAsync({ command: trimmed, history: flatHistory });
      const translatedDirections = data.directions ?? [];

      if (!translatedDirections.length) {
        throw new Error('Translation returned no directions');
      }

      const nextDirections = resolvePendingDirection(pending._id, translatedDirections, trimmed);
      toastAddedDirections(nextDirections.length);
    } catch (err) {
      failPendingDirection(pending._id, err);
      toast.error(errorMessage(err, 'Translation failed'));
    }
  }

  return (
    <div className="command-bar">
      <input
        id="command-input"
        type="text"
        placeholder="e.g. install the advanced query loop plugin and activate it"
        autoComplete="off"
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') addCommand();
        }}
      />
      <button id="add-btn" type="button" disabled={!command.trim()} onClick={addCommand}>
        Add Direction
      </button>
    </div>
  );
}
