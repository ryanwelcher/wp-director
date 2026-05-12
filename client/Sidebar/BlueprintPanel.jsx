import clsx from 'clsx';
import { useEffect, useState, useMemo } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from '../context/AppStateContext.jsx';
import { blueprintToForm, useBlueprintFormState } from '../state/useBlueprintFormState.js';
import { errorMessage } from '../utils/actions.js';
import { api } from '../utils/api.js';
import { EnvironmentSection } from '../blueprint/EnvironmentSection.jsx';
import { SiteSettingsSection } from '../blueprint/SiteSettingsSection.jsx';
import { SlugListSection } from '../blueprint/SlugListSection.jsx';
import { ContentSection } from '../blueprint/ContentSection.jsx';

export function BlueprintPanel() {
  const { blueprint: appBlueprint, defaultBlueprint, setBlueprint } = useAppState();
  const { formState, updateForm, loadBlueprint, compiledBlueprint } =
    useBlueprintFormState(appBlueprint);

  const [isApplying, setIsApplying] = useState(false);
  const [pluginNames, setPluginNames] = useState({});

  // Resolve display names for any plugin slug we haven't seen yet. Fires on
  // initial load and whenever the plugins list grows by a free-form slug.
  // Server caches WP.org lookups for 5 min, so reloads are cheap.
  useEffect(() => {
    const missing = formState.plugins
      .map((p) => p.slug)
      .filter((slug) => slug && !pluginNames[slug]);
    if (missing.length === 0) return undefined;

    let cancelled = false;
    Promise.all(
      missing.map(async (slug) => {
        try {
          const info = await api.getPluginInfo(slug);
          return [slug, info?.name || null];
        } catch {
          return [slug, null];
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const patch = {};
      for (const [slug, name] of pairs) if (name) patch[slug] = name;
      if (Object.keys(patch).length > 0) {
        setPluginNames((prev) => ({ ...prev, ...patch }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [formState.plugins, pluginNames]);

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

  async function handleReset() {
    if (!defaultBlueprint) return;
    if (!window.confirm('Reset all fields to the default blueprint? Your current changes will be lost.')) return;
    setIsApplying(true);
    try {
      const bp = await api.resetBlueprint();
      const target = bp ?? defaultBlueprint;
      loadBlueprint(target);
      setBlueprint(target);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reset blueprint'));
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <div className="blueprint-body blueprint-body--embedded">
      <EnvironmentSection formState={formState} updateForm={updateForm} />
      <SiteSettingsSection formState={formState} updateForm={updateForm} />
      <SlugListSection
        title="Plugins" sectionId="section-plugins"
        items={formState.plugins} onUpdate={(plugins) => updateForm({ plugins })}
        itemType="plugin" inputId="bf-plugin-slug"
        inputPlaceholder="Search WordPress.org or enter a slug"
        onSearch={(q, opts) => api.searchPlugins(q, opts)}
        nameMap={pluginNames}
        onLearnName={(slug, name) => setPluginNames((prev) => ({ ...prev, [slug]: name }))}
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
        <button
          type="button"
          className="bp-action-btn bp-action-btn--ghost"
          onClick={handleReset}
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
    </div>
  );
}
