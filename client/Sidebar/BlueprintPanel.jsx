import clsx from 'clsx';
import { useState, useMemo } from 'react';
import { toast } from 'react-toastify';
import { Dialog } from '../Dialog.jsx';
import { useAppState } from '../context/AppStateContext.jsx';
import { blueprintToForm, useBlueprintFormState } from '../state/useBlueprintFormState.js';
import { useSlugNameResolver } from '../state/useSlugNameResolver.js';
import { errorMessage } from '../utils/actions.js';
import { api } from '../utils/api.js';
import { EnvironmentSection } from '../blueprint/EnvironmentSection.jsx';
import { SiteSettingsSection } from '../blueprint/SiteSettingsSection.jsx';
import { SlugListSection } from '../blueprint/SlugListSection.jsx';
import { ContentSection } from '../blueprint/ContentSection.jsx';

export function BlueprintPanel() {
  const { blueprint: appBlueprint, defaultBlueprint, setBlueprint, resetBlueprintToDefault } = useAppState();
  const { formState, updateForm, compiledBlueprint } =
    useBlueprintFormState(appBlueprint);

  const [isApplying, setIsApplying] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [pluginNames, learnPluginName] = useSlugNameResolver(formState.plugins, api.getPluginInfo);
  const [themeNames, learnThemeName] = useSlugNameResolver(formState.themes, api.getThemeInfo);

  // Compare on form-state (not compiled JSON) so incidental key-order / shape
  // differences in the on-disk blueprint don't make the form look "dirty".
  const appliedForm = useMemo(() => blueprintToForm(appBlueprint), [appBlueprint]);
  const defaultForm = useMemo(() => blueprintToForm(defaultBlueprint), [defaultBlueprint]);
  const hasUnappliedChanges = useMemo(
    () => JSON.stringify(formState) !== JSON.stringify(appliedForm),
    [formState, appliedForm],
  );
  const isAtDefault = useMemo(
    () => JSON.stringify(formState) === JSON.stringify(defaultForm),
    [formState, defaultForm],
  );

  async function handleApply() {
    setIsApplying(true);
    try {
      await api.saveBlueprint(compiledBlueprint);
      setBlueprint(compiledBlueprint);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not apply blueprint'));
    } finally {
      setIsApplying(false);
    }
  }

  function openResetDialog() {
    if (!defaultBlueprint) return;
    setResetDialogOpen(true);
  }

  function closeResetDialog() {
    if (!isApplying) setResetDialogOpen(false);
  }

  async function confirmReset() {
    setIsApplying(true);
    try {
      await resetBlueprintToDefault();
      setResetDialogOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reset blueprint'));
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <>
    <div className="tab-panel-body">
      <EnvironmentSection formState={formState} updateForm={updateForm} />
      <SiteSettingsSection formState={formState} updateForm={updateForm} />
      <SlugListSection
        title="Plugins" sectionId="section-plugins"
        items={formState.plugins} onUpdate={(plugins) => updateForm({ plugins })}
        itemType="plugin" inputId="bf-plugin-slug"
        inputPlaceholder="Search WordPress.org or enter a slug"
        onSearch={api.searchPlugins}
        nameMap={pluginNames}
        onLearnName={learnPluginName}
      />
      <SlugListSection
        title="Themes" sectionId="section-themes"
        items={formState.themes} onUpdate={(themes) => updateForm({ themes })}
        itemType="theme" inputId="bf-theme-slug"
        inputPlaceholder="Search WordPress.org or enter a slug"
        variant="theme"
        onSearch={api.searchThemes}
        nameMap={themeNames}
        onLearnName={learnThemeName}
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
    </div>

    <div className="tab-panel-footer">
      <button
        type="button"
        className="bp-action-btn bp-action-btn--ghost"
        onClick={openResetDialog}
        disabled={!defaultBlueprint || isAtDefault || isApplying}
      >
        Reset
      </button>
      <button
        type="button"
        className={clsx('bp-action-btn bp-action-btn--primary', isApplying && 'is-loading')}
        onClick={handleApply}
        disabled={isApplying || !hasUnappliedChanges}
      >
        Apply
      </button>
    </div>

    {resetDialogOpen && (
      <Dialog
        title="Reset blueprint?"
        description="Reset all fields to the default blueprint? Your current changes will be lost."
        closeDisabled={isApplying}
        onClose={closeResetDialog}
      >
        <div className="app-dialog-actions">
          <button
            className="app-dialog-btn app-dialog-btn--secondary"
            type="button"
            disabled={isApplying}
            onClick={closeResetDialog}
          >
            Cancel
          </button>
          <button
            className="app-dialog-btn app-dialog-btn--danger"
            type="button"
            disabled={isApplying}
            onClick={confirmReset}
          >
            {isApplying ? 'Resetting...' : 'Reset'}
          </button>
        </div>
      </Dialog>
    )}
    </>
  );
}
