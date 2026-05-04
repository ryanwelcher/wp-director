import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from '../context/AppStateContext.jsx';
import { useBlueprintFormState } from '../state/useBlueprintFormState.js';
import { errorMessage } from '../utils/actions.js';
import { api } from '../utils/api.js';
import { EnvironmentSection } from '../blueprint/EnvironmentSection.jsx';
import { SiteSettingsSection } from '../blueprint/SiteSettingsSection.jsx';
import { SlugListSection } from '../blueprint/SlugListSection.jsx';
import { ContentSection } from '../blueprint/ContentSection.jsx';
import { SectionBadge } from './SectionBadge.jsx';


export function BlueprintPanel() {
  const { blueprint: appBlueprint, defaultBlueprint, setBlueprint, isBlueprintModified, poolStatus } = useAppState();
  const { formState, updateForm, loadBlueprint, compiledBlueprint, hasExtraSteps } =
    useBlueprintFormState(appBlueprint);

  const [activeTab, setActiveTab] = useState('form');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(compiledBlueprint, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const skipSyncRef = useRef(false);

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setJsonDraft(JSON.stringify(compiledBlueprint, null, 2));
    setJsonError('');
  }, [compiledBlueprint]);

  function currentBlueprint() {
    if (activeTab === 'json') {
      try { return JSON.parse(jsonDraft); } catch { /* fall through */ }
    }
    return compiledBlueprint;
  }

  async function persist(bp) {
    await api.saveBlueprint(bp);
    setBlueprint(bp);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await persist(currentBlueprint());
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save blueprint'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    if (!defaultBlueprint) return;
    if (!window.confirm('Reset all fields to the default blueprint? Your current changes will be lost.')) return;
    try {
      const bp = await api.resetBlueprint();
      const target = bp ?? defaultBlueprint;
      loadBlueprint(target);
      setBlueprint(target);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reset blueprint'));
    }
  }

  function switchTab(newTab) {
    if (activeTab === 'json' && newTab === 'form') {
      try {
        const parsed = JSON.parse(jsonDraft);
        skipSyncRef.current = true;
        loadBlueprint(parsed);
        setJsonError('');
        setActiveTab(newTab);
      } catch (err) {
        setJsonError(errorMessage(err, 'Invalid JSON'));
      }
    } else {
      setActiveTab(newTab);
    }
  }

  return (
    <details id="blueprint-section">
      <summary>
        <span>Environment / Blueprint</span>
        <SectionBadge hidden={!isBlueprintModified}>custom</SectionBadge>
      </summary>
      <div className="blueprint-body">
        <div className="blueprint-panel-actions">
          <button
            type="button"
            className="bp-action-btn bp-action-btn--ghost"
            onClick={handleReset}
            disabled={!defaultBlueprint}
          >
            Reset
          </button>
          <button
            type="button"
            className="bp-action-btn bp-action-btn--primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {!poolStatus.ready && (
          <p className="blueprint-pool-status" role="status">
            Playground warming up — {poolStatus.warm}/{poolStatus.total} ready
          </p>
        )}

        <div className="blueprint-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'form'}
            aria-controls="blueprint-tab-form"
            className={`blueprint-tab-btn${activeTab === 'form' ? ' active' : ''}`}
            onClick={() => switchTab('form')}
          >
            Form
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'json'}
            aria-controls="blueprint-tab-json"
            className={`blueprint-tab-btn${activeTab === 'json' ? ' active' : ''}`}
            onClick={() => switchTab('json')}
          >
            JSON
          </button>
        </div>

        <div
          id="blueprint-tab-form"
          role="tabpanel"
          hidden={activeTab !== 'form'}
          className="blueprint-form-tab"
        >
          {hasExtraSteps && (
            <div className="blueprint-notice" role="status">
              This blueprint contains advanced steps that are only editable in the JSON tab. They are preserved in the compiled output.
            </div>
          )}
          <EnvironmentSection formState={formState} updateForm={updateForm} />
          <SiteSettingsSection formState={formState} updateForm={updateForm} />
          <SlugListSection
            title="Plugins" sectionId="section-plugins"
            items={formState.plugins} onUpdate={(plugins) => updateForm({ plugins })}
            itemType="plugin" inputId="bf-plugin-slug"
            inputPlaceholder="WordPress.org plugin slug"
          />
          <SlugListSection
            title="Themes" sectionId="section-themes"
            items={formState.themes} onUpdate={(themes) => updateForm({ themes })}
            itemType="theme" inputId="bf-theme-slug"
            inputPlaceholder="WordPress.org theme slug"
          />
          <ContentSection formState={formState} updateForm={updateForm} />
        </div>

        <div
          id="blueprint-tab-json"
          role="tabpanel"
          hidden={activeTab !== 'json'}
          className="blueprint-json-tab"
        >
          <textarea
            id="blueprint-preview"
            spellCheck="false"
            className={jsonError ? 'invalid' : ''}
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
            aria-label="Blueprint JSON editor"
            aria-describedby={jsonError ? 'blueprint-json-error' : undefined}
          />
          {jsonError && (
            <p id="blueprint-json-error" className="blueprint-json-error">
              {jsonError}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
