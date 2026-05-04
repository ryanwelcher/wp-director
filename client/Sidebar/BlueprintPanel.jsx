import { useState } from 'react';
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
  const { formState, updateForm, loadBlueprint, compiledBlueprint } =
    useBlueprintFormState(appBlueprint);

  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    try {
      await api.saveBlueprint(compiledBlueprint);
      setBlueprint(compiledBlueprint);
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

  return (
    <details id="blueprint-section">
      <summary>
        <span>Environment / Blueprint</span>
        <SectionBadge hidden={!isBlueprintModified}>custom</SectionBadge>
      </summary>
      <div className="blueprint-body">
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

        <section className="blueprint-form-section">
          <details className="bfs-collapsible">
            <summary className="bfs-summary">JSON</summary>
            <pre className="bfs-json-preview">
              {JSON.stringify(compiledBlueprint, null, 2)}
            </pre>
          </details>
        </section>

        <div className="blueprint-panel-actions">
          {!poolStatus.ready && (
            <p className="blueprint-pool-status" role="status">
              Playground warming up — {poolStatus.warm}/{poolStatus.total} ready
            </p>
          )}
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
      </div>
    </details>
  );
}
