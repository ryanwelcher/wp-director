const WP_VERSIONS = [
  'latest', '6.8', '6.7', '6.6', '6.5', '6.4', '6.3', '6.2', '6.1', '6.0', '5.9',
];

const PHP_VERSIONS = [
  'latest', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4',
];

const LANDING_PAGE_PRESETS = [
  { label: 'Dashboard',    value: '/wp-admin/' },
  { label: 'Posts',        value: '/wp-admin/edit.php' },
  { label: 'New Post',     value: '/wp-admin/post-new.php' },
  { label: 'Pages',        value: '/wp-admin/edit.php?post_type=page' },
  { label: 'Site Editor',  value: '/wp-admin/site-editor.php' },
];

export function EnvironmentSection({ formState, updateForm }) {
  const isPreset = LANDING_PAGE_PRESETS.some((p) => p.value === formState.landingPage);

  return (
    <section className="blueprint-form-section" aria-labelledby="section-environment">
      <h3 id="section-environment" className="blueprint-form-section-title">Environment</h3>
      <div className="bf-fields">

        {/* Version row */}
        <div className="bf-field-pair">
          <div className="bf-field">
            <label className="bf-label" htmlFor="bf-wp-version">WordPress Version</label>
            <select
              id="bf-wp-version"
              className="bf-select"
              value={formState.wpVersion}
              onChange={(e) => updateForm({ wpVersion: e.target.value })}
            >
              {WP_VERSIONS.map((v) => (
                <option key={v} value={v}>{v === 'latest' ? 'Latest' : v}</option>
              ))}
            </select>
          </div>
          <div className="bf-field">
            <label className="bf-label" htmlFor="bf-php-version">PHP Version</label>
            <select
              id="bf-php-version"
              className="bf-select"
              value={formState.phpVersion}
              onChange={(e) => updateForm({ phpVersion: e.target.value })}
            >
              {PHP_VERSIONS.map((v) => (
                <option key={v} value={v}>{v === 'latest' ? 'Latest' : v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Landing page */}
        <div className="bf-field">
          <label className="bf-label" htmlFor="bf-landing-page">Landing Page</label>
          <div className="bf-landing-page-row">
            <input
              id="bf-landing-page"
              type="text"
              className="bf-input"
              value={formState.landingPage}
              onChange={(e) => updateForm({ landingPage: e.target.value })}
              placeholder="/wp-admin/"
              aria-label="Landing page URL"
            />
            <select
              className="bf-select bf-select-preset"
              value={isPreset ? formState.landingPage : ''}
              onChange={(e) => { if (e.target.value) updateForm({ landingPage: e.target.value }); }}
              aria-label="Choose a preset landing page"
            >
              {!isPreset && (
                <option value="" disabled>Presets…</option>
              )}
              {LANDING_PAGE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Networking toggle */}
        <label className="bf-toggle-row" htmlFor="bf-networking">
          <div className="bf-toggle-text">
            <span className="bf-toggle-title">Enable Networking</span>
            <span className="bf-help">Allow WordPress HTTP functions to make external requests</span>
          </div>
          <span className="bf-toggle" aria-hidden="true">
            <input
              type="checkbox"
              id="bf-networking"
              checked={formState.networking}
              onChange={(e) => updateForm({ networking: e.target.checked })}
            />
            <span className="bf-toggle-track" />
          </span>
        </label>

      </div>
    </section>
  );
}
