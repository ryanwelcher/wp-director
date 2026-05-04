const FIELDS = [
  {
    id:          'bf-blog-name',
    label:       'Site Name',
    key:         'blogName',
    type:        'text',
    placeholder: 'My Playground Site',
  },
  {
    id:          'bf-blog-desc',
    label:       'Tagline',
    key:         'blogDescription',
    type:        'text',
    placeholder: 'A disposable WordPress site for recording',
  },
  {
    id:          'bf-admin-email',
    label:       'Admin Email',
    key:         'adminEmail',
    type:        'email',
    placeholder: 'admin@example.com',
  },
  {
    id:          'bf-timezone',
    label:       'Timezone',
    key:         'timezone',
    type:        'text',
    placeholder: 'America/New_York',
  },
  {
    id:          'bf-language',
    label:       'Language / Locale',
    key:         'language',
    type:        'text',
    placeholder: 'fr_FR  (leave blank for English)',
  },
  {
    id:          'bf-permalink',
    label:       'Permalink Structure',
    key:         'permalinkStructure',
    type:        'text',
    placeholder: '/%postname%/',
  },
];

export function SiteSettingsSection({ formState, updateForm }) {
  return (
    <section className="blueprint-form-section">
      <details className="bfs-collapsible">
        <summary className="bfs-summary" id="section-site-settings">Site Settings</summary>
        <div className="bf-fields">
          {FIELDS.map(({ id, label, key, type, placeholder }) => (
            <div key={id} className="bf-field">
              <label className="bf-label" htmlFor={id}>{label}</label>
              <input
                id={id}
                type={type}
                className="bf-input"
                value={formState[key]}
                onChange={(e) => updateForm({ [key]: e.target.value })}
                placeholder={placeholder}
              />
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
