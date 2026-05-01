import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from '../context/AppStateContext.jsx';
import { errorMessage } from '../utils/actions.js';
import { postJSON } from '../utils/api.js';
import { SectionBadge } from './SectionBadge.jsx';

export function BlueprintPanel() {
  const {
    blueprint,
    defaultBlueprint,
    isBlueprintModified,
    setBlueprint,
  } = useAppState();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const skipNextSyncRef = useRef(false);

  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    setDraft(blueprint ? JSON.stringify(blueprint, null, 2) : '');
    setError('');
  }, [blueprint]);

  function editBlueprint(value) {
    setDraft(value);

    if (!value.trim()) {
      skipNextSyncRef.current = true;
      setBlueprint(defaultBlueprint);
      setError('');
      return;
    }

    try {
      skipNextSyncRef.current = true;
      setBlueprint(JSON.parse(value));
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Invalid JSON'));
    }
  }

  async function testBlueprint() {
    if (!blueprint) return;
    setTesting(true);

    try {
      const data = await postJSON('/api/preview-blueprint', { blueprint });
      window.open(data.url, '_blank');
    } catch (err) {
      const message = errorMessage(err, 'Failed to start preview');
      setError(message);
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }

  function resetBlueprint() {
    setBlueprint(defaultBlueprint);
    setDraft(defaultBlueprint ? JSON.stringify(defaultBlueprint, null, 2) : '');
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
