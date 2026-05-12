import clsx from 'clsx';

export function PluginSearchSuggestions({
  query,
  results,
  loading,
  error,
  existingSlugs,
  activeIndex,
  listId,
  hasMore,
  onSelect,
  onHoverIndex,
  onLoadMore,
}) {
  if (!query) return null;

  const hasResults = results.length > 0;
  const showInitialLoading = loading && !hasResults;
  const showEmpty = !loading && !error && !hasResults;
  const showInlineLoading = loading && hasResults;

  return (
    <div className="bf-suggestions" id={listId} role="listbox">
      {showInitialLoading && (
        <div className="bf-suggestions-status">
          <span className="bf-spinner" aria-hidden="true" />
          Searching WordPress.org…
        </div>
      )}
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
              e.preventDefault();
              if (!isAdded) onSelect(r);
            }}
          >
            {r.thumbnail ? (
              <img src={r.thumbnail} alt="" className="bf-suggestion-icon" />
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
      {hasMore && !showInlineLoading && (
        <button
          type="button"
          className="bf-suggestions-more"
          onMouseDown={(e) => {
            e.preventDefault();
            onLoadMore?.();
          }}
        >
          Show more
        </button>
      )}
      {showInlineLoading && (
        <div className="bf-suggestions-status bf-suggestions-status--inline">
          <span className="bf-spinner" aria-hidden="true" />
          Loading…
        </div>
      )}
    </div>
  );
}
