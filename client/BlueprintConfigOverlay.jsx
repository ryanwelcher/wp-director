import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { useAppState } from './context/AppStateContext.jsx';
import { useBlueprintFormState } from './state/useBlueprintFormState.js';
import { errorMessage } from './utils/actions.js';
import { postJSON } from './utils/api.js';
import { EnvironmentSection } from './blueprint/EnvironmentSection.jsx';
import { SiteSettingsSection } from './blueprint/SiteSettingsSection.jsx';
import { SlugListSection } from './blueprint/SlugListSection.jsx';
import { ContentSection } from './blueprint/ContentSection.jsx';

const FOCUSABLE_SELECTORS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BlueprintConfigOverlay({ onClose }) {
  const { blueprint: appBlueprint, defaultBlueprint, setBlueprint } = useAppState();
  const { formState, updateForm, loadBlueprint, compiledBlueprint, hasExtraSteps } =
    useBlueprintFormState(appBlueprint);

  const [activeTab, setActiveTab] = useState('form');
  const [jsonDraft, setJsonDraft] = useState(() =>
    JSON.stringify(compiledBlueprint, null, 2),
  );
  const [jsonError, setJsonError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const skipSyncRef = useRef(false);
  const overlayRef = useRef(null);
  // Updated synchronously each render so the Escape handler always reads fresh state
  const closeStateRef = useRef(null);
  closeStateRef.current = { activeTab, jsonDraft, compiledBlueprint };

  // Sync compiled blueprint → JSON textarea whenever form state changes.
  // Skip one cycle after a JSON→form parse to avoid clobbering cursor position.
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setJsonDraft(JSON.stringify(compiledBlueprint, null, 2));
    setJsonError('');
  }, [compiledBlueprint]);

  // Lock body scroll while overlay is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Escape key → auto-save and close. Registers once; reads latest state via ref.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key !== 'Escape') return;
      const { activeTab: tab, jsonDraft: draft, compiledBlueprint: compiled } = closeStateRef.current;
      let bp = compiled;
      if (tab === 'json') {
        try { bp = JSON.parse(draft); } catch { /* use compiled */ }
      }
      persist(bp).catch(() => {});
      onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus trap
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const focusableEls = () => Array.from(overlay.querySelectorAll(FOCUSABLE_SELECTORS));
    focusableEls()[0]?.focus();

    function trapFocus(e) {
      if (e.key !== 'Tab') return;
      const els = focusableEls();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    overlay.addEventListener('keydown', trapFocus);
    return () => overlay.removeEventListener('keydown', trapFocus);
  }, []);

  function currentBlueprint() {
    // If the JSON tab is active, use the draft JSON (may differ from compiled form)
    if (activeTab === 'json') {
      try { return JSON.parse(jsonDraft); } catch { /* fall through */ }
    }
    return compiledBlueprint;
  }

  async function persist(bp) {
    await postJSON('/api/save-blueprint', { blueprint: bp });
    setBlueprint(bp);
  }

  // Auto-save then close — fire-and-forget, never blocks the close
  function handleClose() {
    persist(currentBlueprint()).catch(() => {});
    onClose();
  }

  async function handleSaveAndClose() {
    setIsSaving(true);
    try {
      await persist(currentBlueprint());
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save blueprint'));
    } finally {
      setIsSaving(false);
    }
  }

  function handleReset() {
    if (!defaultBlueprint) return;
    if (!window.confirm('Reset all fields to the default blueprint? Your current changes will be lost.')) return;
    loadBlueprint(defaultBlueprint);
  }

  async function handlePreview() {
    setIsPreviewLoading(true);
    try {
      const bp = currentBlueprint();
      const { url } = await postJSON('/api/preview-blueprint', { blueprint: bp });
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start preview'));
    } finally {
      setIsPreviewLoading(false);
    }
  }

  function switchTab(newTab) {
    if (activeTab === 'json' && newTab === 'form') {
      // Parse JSON → form on leaving the JSON tab; block switch on error
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

  return createPortal(
    <div
      className="blueprint-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Configure Blueprint"
      ref={overlayRef}
    >
      {/* Header */}
      <div className="blueprint-overlay-header">
        <h2 className="blueprint-overlay-title">Configure Blueprint</h2>
        <div className="blueprint-overlay-actions">
          <button
            type="button"
            className="bp-action-btn bp-action-btn--ghost"
            onClick={handlePreview}
            disabled={isPreviewLoading}
            aria-label="Test current blueprint in a new Playground tab"
          >
            {isPreviewLoading ? 'Starting…' : 'Test in Playground'}
          </button>
          <button
            type="button"
            className="bp-action-btn bp-action-btn--ghost"
            onClick={handleReset}
            disabled={!defaultBlueprint}
            aria-label="Reset all fields to the default blueprint"
          >
            Reset to Default
          </button>
          <button
            type="button"
            className="bp-action-btn bp-action-btn--primary"
            onClick={handleSaveAndClose}
            disabled={isSaving}
            aria-label="Save blueprint and close panel"
          >
            {isSaving ? 'Saving…' : 'Save / Apply'}
          </button>
        </div>
        <button
          className="blueprint-overlay-close"
          type="button"
          aria-label="Close Configure Blueprint panel"
          onClick={handleClose}
        >
          ✕
        </button>
      </div>

      {/* Tab bar */}
      <div className="blueprint-overlay-tabs" role="tablist" aria-label="Blueprint editor tabs">
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

      {/* Tab panels */}
      <div className="blueprint-overlay-body">
        {/* Form tab */}
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

        {/* JSON tab */}
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
    </div>,
    document.body,
  );
}
