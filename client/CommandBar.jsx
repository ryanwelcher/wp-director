import { useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { errorMessage } from './utils/actions.js';
import { useTranslateMutation } from './utils/apiHooks.js';

export function CommandBar() {
  const { appendDirections, directions } = useAppState();
  const [command, setCommand] = useState('');
  const translateMutation = useTranslateMutation();
  const loading = translateMutation.isPending;

  async function addCommand() {
    const trimmed = command.trim();
    if (!trimmed || loading) return;

    const toastId = toast.loading('Translating...');

    try {
      const flatHistory = directions.flatMap((group) => group.actions ?? []);
      const data = await translateMutation.mutateAsync({ command: trimmed, history: flatHistory });
      const nextDirections = appendDirections(data.directions ?? []);
      setCommand('');
      toast.update(toastId, {
        render: `Added ${nextDirections.length} direction${nextDirections.length !== 1 ? 's' : ''}`,
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (err) {
      toast.update(toastId, {
        render: errorMessage(err, 'Translation failed'),
        type: 'error',
        isLoading: false,
        autoClose: false,
      });
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
        disabled={loading}
        onChange={(event) => setCommand(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') addCommand();
        }}
      />
      <button id="add-btn" type="button" disabled={loading} onClick={addCommand}>
        Add Direction
      </button>
    </div>
  );
}
