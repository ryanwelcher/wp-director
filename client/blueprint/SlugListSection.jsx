import clsx from 'clsx';
import { useState } from 'react';

export function SlugListSection({ title, sectionId, items, onUpdate, itemType, inputId, inputPlaceholder }) {
  const [slugInput, setSlugInput] = useState('');

  const slugTrimmed = slugInput.trim();
  const isDuplicate = items.some((item) => item.slug === slugTrimmed);
  const canAdd = slugTrimmed.length > 0 && !isDuplicate;
  const dupWarnId = `${inputId}-dup-warn`;

  function addItem() {
    if (!canAdd) return;
    onUpdate([...items, { slug: slugTrimmed }]);
    setSlugInput('');
  }

  function removeItem(index) {
    onUpdate(items.filter((_, i) => i !== index));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') addItem();
  }

  return (
    <section className="blueprint-form-section">
      <details className="bfs-collapsible">
      <summary className="bfs-summary" id={sectionId}>{title}</summary>
      <div className="bf-fields">
        <div className="bf-slug-row">
          <input
            id={inputId}
            type="text"
            className={clsx('bf-input', isDuplicate && slugTrimmed && 'bf-input-warn')}
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            aria-label={`${title.slice(0, -1)} slug`}
            aria-describedby={isDuplicate && slugTrimmed ? dupWarnId : undefined}
          />
          <button
            type="button"
            className="bf-add-btn"
            onClick={addItem}
            disabled={!canAdd}
            aria-label={`Add ${itemType}`}
          >
            Add
          </button>
        </div>

        {isDuplicate && slugTrimmed && (
          <p id={dupWarnId} className="bf-warn">
            "{slugTrimmed}" is already in the list.
          </p>
        )}

        {items.length > 0 && (
          <ul className="bf-item-list" aria-label={`${title} list`}>
            {items.map((item, index) => (
              <li key={item.slug} className="bf-item">
                <span className="bf-item-slug">{item.slug}</span>
                <button
                  type="button"
                  className="bf-remove-btn"
                  onClick={() => removeItem(index)}
                  aria-label={`Remove ${itemType} ${item.slug}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </details>
    </section>
  );
}
