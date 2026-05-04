import { useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from '../context/AppStateContext.jsx';
import { errorMessage } from '../utils/actions.js';
import { usePreviewBlueprintMutation } from '../utils/apiHooks.js';
import { SectionBadge } from './SectionBadge.jsx';

function formatBlueprint(blueprint) {
  return blueprint ? JSON.stringify(blueprint, null, 2) : '';
}

export function BlueprintPanel() {
  const {
    blueprint,
    defaultBlueprint,
    isBlueprintModified,
    setBlueprint,
  } = useAppState();
  const [draftOverride, setDraftOverride] = useState(null);
  const [error, setError] = useState('');
  const previewBlueprintMutation = usePreviewBlueprintMutation();
  const testing = previewBlueprintMutation.isPending;
  const draft = draftOverride ?? formatBlueprint(blueprint);

  function editBlueprint(value) {
    setDraftOverride(value);

    if (!value.trim()) {
      setBlueprint(defaultBlueprint);
      setError('');
      return;
    }

    try {
      setBlueprint(JSON.parse(value));
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Invalid JSON'));
    }
  }

  async function testBlueprint() {
    if (!blueprint) return;

    try {
      const data = await previewBlueprintMutation.mutateAsync(blueprint);
      window.open(data.url, '_blank');
    } catch (err) {
      const message = errorMessage(err, 'Failed to start preview');
      setError(message);
      toast.error(message);
    }
  }

  function resetBlueprint() {
    setBlueprint(defaultBlueprint);
    setDraftOverride(null);
    setError('');
  }

  return (
    <details id="blueprint-section">
      <summary>
        <span>Environment / Blueprint</span>
        <SectionBadge hidden={!isBlueprintModified}>custom</SectionBadge>
      </summary>
      <div className="blueprint-body">
        <div className="blueprint-toolbar">
          <button className="secondary" type="button" disabled={testing} onClick={testBlueprint}>
            {testing ? 'Starting...' : '\u25B6 Test in Playground'}
          </button>
          <button className="secondary" type="button" onClick={resetBlueprint}>
            Reset to default
          </button>
        </div>
        <div className="blueprint-editor">
          <textarea
            id="blueprint-preview"
            spellCheck="false"
            className={error ? 'invalid' : ''}
            value={draft}
            onChange={(event) => editBlueprint(event.target.value)}
          />
          <p id="blueprint-error" className={`json-error${error ? '' : ' hidden'}`}>
            {error}
          </p>
        </div>
      </div>
    </details>
  );
}
