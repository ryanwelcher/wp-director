import { useState } from 'react';

export function ThemesSection({ formState, updateForm }) {
  const [slugInput, setSlugInput] = useState('');

  const themes = formState.themes;

  const slugTrimmed = slugInput.trim();
  const isDuplicate = themes.some((t) => t.slug === slugTrimmed);
  const canAdd = slugTrimmed.length > 0 && !isDuplicate;

  function addTheme() {
    if (!canAdd) return;
    updateForm({ themes: [...themes, { slug: slugTrimmed, activate: true }] });
    setSlugInput('');
  }

  function removeTheme(index) {
    updateForm({ themes: themes.filter((_, i) => i !== index) });
  }

  function toggleActivate(index) {
    const updated = themes.map((t, i) =>
      i === index ? { ...t, activate: !t.activate } : t,
    );
    updateForm({ themes: updated });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') addTheme();
  }

  return (
    <section className="blueprint-form-section" aria-labelledby="section-themes">
      <h3 id="section-themes" className="blueprint-form-section-title">Themes</h3>
      <div className="bf-fields">
        <div className="bf-slug-row">
          <input
            id="bf-theme-slug"
            type="text"
            className={`bf-input${isDuplicate && slugTrimmed ? ' bf-input-warn' : ''}`}
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="WordPress.org theme slug"
            aria-label="Theme slug"
            aria-describedby={isDuplicate && slugTrimmed ? 'bf-theme-dup-warn' : undefined}
          />
          <button
            type="button"
            className="bf-add-btn"
            onClick={addTheme}
            disabled={!canAdd}
            aria-label="Add theme"
          >
            Add
          </button>
        </div>
        {isDuplicate && slugTrimmed && (
          <p id="bf-theme-dup-warn" className="bf-warn">
            "{slugTrimmed}" is already in the list.
          </p>
        )}

        {themes.length > 0 && (
          <ul className="bf-item-list" aria-label="Theme list">
            {themes.map((theme, index) => (
              <li key={theme.slug} className="bf-item">
                <span className="bf-item-slug">{theme.slug}</span>
                <label className="bf-item-toggle" htmlFor={`bf-theme-activate-${index}`}>
                  <span className="bf-toggle" aria-hidden="true">
                    <input
                      type="checkbox"
                      id={`bf-theme-activate-${index}`}
                      checked={theme.activate}
                      onChange={() => toggleActivate(index)}
                    />
                    <span className="bf-toggle-track" />
                  </span>
                  <span className="bf-item-toggle-label">Activate</span>
                </label>
                <button
                  type="button"
                  className="bf-remove-btn"
                  onClick={() => removeTheme(index)}
                  aria-label={`Remove theme ${theme.slug}`}
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
