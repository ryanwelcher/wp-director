import { useState } from 'react';

export function PluginsSection({ formState, updateForm }) {
  const [slugInput, setSlugInput] = useState('');

  const plugins = formState.plugins;

  const slugTrimmed = slugInput.trim();
  const isDuplicate = plugins.some((p) => p.slug === slugTrimmed);
  const canAdd = slugTrimmed.length > 0 && !isDuplicate;

  function addPlugin() {
    if (!canAdd) return;
    updateForm({ plugins: [...plugins, { slug: slugTrimmed, activate: true }] });
    setSlugInput('');
  }

  function removePlugin(index) {
    updateForm({ plugins: plugins.filter((_, i) => i !== index) });
  }

  function toggleActivate(index) {
    const updated = plugins.map((p, i) =>
      i === index ? { ...p, activate: !p.activate } : p,
    );
    updateForm({ plugins: updated });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') addPlugin();
  }

  return (
    <section className="blueprint-form-section" aria-labelledby="section-plugins">
      <h3 id="section-plugins" className="blueprint-form-section-title">Plugins</h3>
      <div className="bf-fields">
        <div className="bf-slug-row">
          <input
            id="bf-plugin-slug"
            type="text"
            className={`bf-input${isDuplicate && slugTrimmed ? ' bf-input-warn' : ''}`}
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="WordPress.org plugin slug"
            aria-label="Plugin slug"
            aria-describedby={isDuplicate && slugTrimmed ? 'bf-plugin-dup-warn' : undefined}
          />
          <button
            type="button"
            className="bf-add-btn"
            onClick={addPlugin}
            disabled={!canAdd}
            aria-label="Add plugin"
          >
            Add
          </button>
        </div>
        {isDuplicate && slugTrimmed && (
          <p id="bf-plugin-dup-warn" className="bf-warn">
            "{slugTrimmed}" is already in the list.
          </p>
        )}

        {plugins.length > 0 && (
          <ul className="bf-item-list" aria-label="Plugin list">
            {plugins.map((plugin, index) => (
              <li key={plugin.slug} className="bf-item">
                <span className="bf-item-slug">{plugin.slug}</span>
                <label className="bf-item-toggle" htmlFor={`bf-plugin-activate-${index}`}>
                  <span className="bf-toggle" aria-hidden="true">
                    <input
                      type="checkbox"
                      id={`bf-plugin-activate-${index}`}
                      checked={plugin.activate}
                      onChange={() => toggleActivate(index)}
                    />
                    <span className="bf-toggle-track" />
                  </span>
                  <span className="bf-item-toggle-label">Activate</span>
                </label>
                <button
                  type="button"
                  className="bf-remove-btn"
                  onClick={() => removePlugin(index)}
                  aria-label={`Remove plugin ${plugin.slug}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
