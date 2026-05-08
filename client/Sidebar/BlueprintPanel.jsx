import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
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

const SLOT_STATUS_LABELS = {
  active: 'In use',
  booting: 'Loading',
  idle: 'Idle',
  warm: 'Ready and warm',
};

function statusLabel(status) {
  return SLOT_STATUS_LABELS[status] ?? 'Unknown';
}

function poolSlotTitle(slot) {
  const port = slot.port ? ` (port ${slot.port})` : '';
  return `Playground ${slot.index + 1}${port}: ${statusLabel(slot.status)}`;
}

function poolSlotClass(status) {
  return SLOT_STATUS_LABELS[status] ? status : 'unknown';
}

function inferredPoolSlots(poolStatus) {
  if (Array.isArray(poolStatus.slots) && poolStatus.slots.length > 0) {
    return poolStatus.slots;
  }

  const total = Number(poolStatus.total) || 0;
  const warm = Number(poolStatus.warm) || 0;
  const booting = Number(poolStatus.booting) || 0;

  return Array.from({ length: total }, (_, index) => ({
    index,
    port: null,
    status: index < warm ? 'warm' : index < warm + booting ? 'booting' : 'idle',
  }));
}

export function BlueprintPanel() {
  const { blueprint: appBlueprint, defaultBlueprint, setBlueprint, isBlueprintModified, poolStatus, setPoolStatus } = useAppState();
  const { formState, updateForm, loadBlueprint, compiledBlueprint } =
    useBlueprintFormState(appBlueprint);

  const [isSaving, setIsSaving] = useState(false);
  const [poolTooltip, setPoolTooltip] = useState(null);

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
  const poolSlots = useMemo(() => inferredPoolSlots(poolStatus), [poolStatus]);

  async function handleSave() {
    setIsSaving(true);
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

  function showPoolTooltip(text, target) {
    const rect = target.getBoundingClientRect();
    const minX = 140;
    const maxX = Math.max(minX, window.innerWidth - minX);
    const centerX = rect.left + rect.width / 2;
    setPoolTooltip({
      text,
      left: Math.min(Math.max(centerX, minX), maxX),
      top: rect.top - 8,
    });
  }

  function hidePoolTooltip() {
    setPoolTooltip(null);
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
          {poolSlots.length > 0 && (
            <div className="blueprint-pool-indicators" aria-label="Playground pool status">
              {poolSlots.map((slot) => {
                const title = poolSlotTitle(slot);
                return (
                  <span
                    key={slot.port ?? slot.index}
                    className={`blueprint-pool-indicator blueprint-pool-indicator--${poolSlotClass(slot.status)}`}
                    aria-label={title}
                    role="img"
                    tabIndex={0}
                    onBlur={hidePoolTooltip}
                    onFocus={(event) => showPoolTooltip(title, event.currentTarget)}
                    onMouseEnter={(event) => showPoolTooltip(title, event.currentTarget)}
                    onMouseLeave={hidePoolTooltip}
                  />
                );
              })}
            </div>
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
        {poolTooltip && createPortal(
          <div
            className="blueprint-pool-tooltip"
            role="tooltip"
            style={{
              left: `${poolTooltip.left}px`,
              top: `${poolTooltip.top}px`,
            }}
          >
            {poolTooltip.text}
          </div>,
          document.body,
        )}
      </div>
    </details>
  );
}
