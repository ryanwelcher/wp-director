import { useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { normalizeDirections, errorMessage } from './utils/actions.js';
import { postJSON } from './utils/api.js';

export function CommandBar() {
  const { directions, setDirections } = useAppState();
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);

  async function addCommand() {
    const trimmed = command.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    const toastId = toast.loading('Translating...');

    try {
      const flatHistory = directions.flatMap((group) => group.actions ?? []);
      const data = await postJSON('/api/translate', { command: trimmed, history: flatHistory });
      const nextDirections = normalizeDirections(data.directions ?? []);
      setDirections((current) => [...current, ...nextDirections]);
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
    } finally {
      setLoading(false);
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
