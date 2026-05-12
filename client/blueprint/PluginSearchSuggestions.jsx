import clsx from 'clsx';

export function PluginSearchSuggestions({
  query,
  results,
  loading,
  error,
  existingSlugs,
  activeIndex,
  listId,
  onSelect,
  onHoverIndex,
}) {
  if (!query) return null;

  const showEmpty = !loading && !error && results.length === 0;

  return (
    <div className="bf-suggestions" id={listId} role="listbox">
      {loading && <div className="bf-suggestions-status">Searching WordPress.org…</div>}
      {error && (
        <div className="bf-suggestions-status bf-suggestions-error">
          Couldn't reach WordPress.org — {error}
        </div>
      )}
      {showEmpty && (
        <div className="bf-suggestions-status">No plugins found for "{query}"</div>
      )}
      {results.map((r, i) => {
        const isAdded = existingSlugs.has(r.slug);
        return (
          <button
            type="button"
            key={r.slug}
            role="option"
            aria-selected={i === activeIndex}
            disabled={isAdded}
            className={clsx(
              'bf-suggestion',
              i === activeIndex && 'is-active',
              isAdded && 'is-added',
            )}
            onMouseEnter={() => onHoverIndex(i)}
            onMouseDown={(e) => {
              // Prevent input blur before click registers.
              e.preventDefault();
              if (!isAdded) onSelect(r);
            }}
          >
            {r.icon ? (
              <img src={r.icon} alt="" className="bf-suggestion-icon" />
            ) : (
              <span className="bf-suggestion-icon bf-suggestion-icon--placeholder" aria-hidden="true" />
            )}
            <span className="bf-suggestion-body">
              <span className="bf-suggestion-name">{r.name}</span>
              {r.author && <span className="bf-suggestion-meta">by {r.author}</span>}
              {r.shortDescription && (
                <span className="bf-suggestion-desc">{r.shortDescription}</span>
              )}
            </span>
            {isAdded && <span className="bf-suggestion-added">Added</span>}
          </button>
        );
      })}
    </div>
  );
}
