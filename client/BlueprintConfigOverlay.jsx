import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from './context/AppStateContext.jsx';
import { useBlueprintFormState } from './state/useBlueprintFormState.js';
import { errorMessage } from './utils/actions.js';
import { EnvironmentSection } from './blueprint/EnvironmentSection.jsx';
import { SiteSettingsSection } from './blueprint/SiteSettingsSection.jsx';

const FOCUSABLE_SELECTORS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PLACEHOLDER_SECTIONS = [
  { id: 'plugins', label: 'Plugins', description: 'Install and activate plugins from WordPress.org.' },
  { id: 'themes',  label: 'Themes',  description: 'Install and activate themes from WordPress.org.' },
  { id: 'content', label: 'Content', description: 'Generate sample posts or import a WXR file.' },
];

export function BlueprintConfigOverlay({ onClose }) {
  const { blueprint: appBlueprint } = useAppState();
  const { formState, updateForm, loadBlueprint, compiledBlueprint, hasExtraSteps } =
    useBlueprintFormState(appBlueprint);

  const [activeTab, setActiveTab] = useState('form');
  const [jsonDraft, setJsonDraft] = useState(() =>
    JSON.stringify(compiledBlueprint, null, 2),
  );
  const [jsonError, setJsonError] = useState('');
  const skipSyncRef = useRef(false);

  const overlayRef = useRef(null);

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

  // Escape key closes
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
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
        <button
          className="blueprint-overlay-close"
          type="button"
          aria-label="Close Configure Blueprint panel"
          onClick={onClose}
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
          {PLACEHOLDER_SECTIONS.map(({ id, label, description }) => (
            <section key={id} className="blueprint-form-section" aria-labelledby={`section-${id}`}>
              <h3 id={`section-${id}`} className="blueprint-form-section-title">{label}</h3>
              <p className="blueprint-form-section-placeholder">{description}</p>
            </section>
          ))}
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
