import { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from '../context/AppStateContext.jsx';
import { blueprintToForm, useBlueprintFormState } from '../state/useBlueprintFormState.js';
import { errorMessage } from '../utils/actions.js';
import { api } from '../utils/api.js';
import { EnvironmentSection } from '../blueprint/EnvironmentSection.jsx';
import { SiteSettingsSection } from '../blueprint/SiteSettingsSection.jsx';
import { SlugListSection } from '../blueprint/SlugListSection.jsx';
import { ContentSection } from '../blueprint/ContentSection.jsx';
import { SectionBadge } from './SectionBadge.jsx';


export function BlueprintPanel() {
  const { blueprint: appBlueprint, defaultBlueprint, setBlueprint, isBlueprintModified, poolStatus, setPoolStatus } = useAppState();
  const { formState, updateForm, loadBlueprint, compiledBlueprint } =
    useBlueprintFormState(appBlueprint);

  const [isSaving, setIsSaving] = useState(false);

  // Compare on form-state (not compiled JSON) so incidental key-order / shape
  // differences in the on-disk blueprint don't make the form look "dirty".
  const savedForm = useMemo(() => blueprintToForm(appBlueprint), [appBlueprint]);
  const defaultForm = useMemo(() => blueprintToForm(defaultBlueprint), [defaultBlueprint]);
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(formState) !== JSON.stringify(savedForm),
    [formState, savedForm],
  );
  const isAtDefault = useMemo(
    () => JSON.stringify(formState) === JSON.stringify(defaultForm),
    [formState, defaultForm],
  );

  const [poolMsgVisible, setPoolMsgVisible] = useState(!poolStatus.ready);
  const [poolMsgFading, setPoolMsgFading] = useState(false);

  useEffect(() => {
    if (!poolStatus.ready) {
      setPoolMsgFading(false);
      setPoolMsgVisible(true);
    } else if (poolMsgVisible) {
      setPoolMsgFading(true);
      const t = setTimeout(() => setPoolMsgVisible(false), 600);
      return () => clearTimeout(t);
    }
  }, [poolStatus.ready]);

  async function handleSave() {
    setIsSaving(true);
    setPoolMsgFading(false);
    setPoolMsgVisible(true);
    setPoolStatus(prev => ({ ...prev, ready: false }));
    try {
      await api.saveBlueprint(compiledBlueprint);
      setBlueprint(compiledBlueprint);
      try {
        const fresh = await api.getPoolStatus();
        setPoolStatus(fresh);
      } catch {}
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save blueprint'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    if (!defaultBlueprint) return;
    if (!window.confirm('Reset all fields to the default blueprint? Your current changes will be lost.')) return;
    setIsSaving(true);
    setPoolMsgFading(false);
    setPoolMsgVisible(true);
    setPoolStatus(prev => ({ ...prev, ready: false }));
    try {
      const bp = await api.resetBlueprint();
      const target = bp ?? defaultBlueprint;
      loadBlueprint(target);
      setBlueprint(target);
      try {
        const fresh = await api.getPoolStatus();
        setPoolStatus(fresh);
      } catch {}
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reset blueprint'));
    } finally {
      setIsSaving(false);
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
          {poolMsgVisible && (
            <p
              className={`blueprint-pool-status${poolMsgFading ? ' blueprint-pool-status--fading' : ''}`}
              role="status"
            >
              Configuring environment…
            </p>
          )}
          <button
            type="button"
            className="bp-action-btn bp-action-btn--ghost"
            onClick={handleReset}
            disabled={!defaultBlueprint || isAtDefault || isSaving}
          >
            Reset
          </button>
          <button
            type="button"
            className="bp-action-btn bp-action-btn--primary"
            onClick={handleSave}
            disabled={isSaving || !hasUnsavedChanges}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </details>
  );
}
