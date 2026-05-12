import clsx from 'clsx';

export function WpOrgSuggestions({
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
  variant = 'plugin',
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
        <div className="bf-suggestions-status">
          No {variant}s found for "{query}"
        </div>
      )}
      {results.map((r, i) => {
        const isAdded = existingSlugs.has(r.slug);
        return (
          <div key={r.slug} className="bf-suggestion-row">
            <button
              type="button"
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
                <img
                  src={r.thumbnail}
                  alt=""
                  className={clsx('bf-suggestion-icon', variant === 'theme' && 'bf-suggestion-icon--theme')}
                />
              ) : (
                <span
                  className={clsx(
                    'bf-suggestion-icon',
                    'bf-suggestion-icon--placeholder',
                    variant === 'theme' && 'bf-suggestion-icon--theme',
                  )}
                  aria-hidden="true"
                />
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
            {r.previewUrl && (
              <a
                className="bf-suggestion-preview"
                href={r.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View ${r.name} on WordPress.org`}
                onMouseDown={(e) => {
                  // Open on mousedown for left-click — the input-blur path on
                  // the parent section can tear the portal down before a
                  // synthesized click would fire on the anchor.
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(r.previewUrl, '_blank', 'noopener,noreferrer');
                }}
                onClick={(e) => {
                  // Suppress the duplicate left-click open. Keyboard activation
                  // (Enter) fires click with detail === 0; let it fall through.
                  if (e.detail > 0) e.preventDefault();
                }}
              >
                ↗
              </a>
            )}
          </div>
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
