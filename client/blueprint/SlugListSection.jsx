import clsx from 'clsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PluginSearchSuggestions } from './PluginSearchSuggestions.jsx';

const SEARCH_DEBOUNCE_MS = 250;

export function SlugListSection({
  title,
  sectionId,
  items,
  onUpdate,
  itemType,
  inputId,
  inputPlaceholder,
  onSearch,
  nameMap,
  onLearnName,
}) {
  const [slugInput, setSlugInput] = useState('');
  const [searchState, setSearchState] = useState({
    results: [],
    loading: false,
    error: null,
    query: '',
    page: 1,
    pages: 1,
  });
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const blurTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const [dropdownCoords, setDropdownCoords] = useState(null);

  const slugTrimmed = slugInput.trim();
  const isDuplicate = items.some((item) => item.slug === slugTrimmed);
  const canAdd = slugTrimmed.length > 0 && !isDuplicate;
  const dupWarnId = `${inputId}-dup-warn`;
  const listId = `${inputId}-suggestions`;
  const existingSlugs = useMemo(() => new Set(items.map((i) => i.slug)), [items]);

  useEffect(() => {
    if (!onSearch) return undefined;
    if (!slugTrimmed) {
      setSearchState({ results: [], loading: false, error: null, query: '', page: 1, pages: 1 });
      setActiveIndex(-1);
      return undefined;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSearchState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await onSearch(slugTrimmed, { page: 1, signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        setSearchState({
          results: Array.isArray(data?.results) ? data.results : [],
          loading: false,
          error: null,
          query: slugTrimmed,
          page: data?.page || 1,
          pages: data?.pages || 1,
        });
        setActiveIndex(-1);
      } catch (err) {
        if (err.name === 'AbortError' || ctrl.signal.aborted) return;
        setSearchState({
          results: [],
          loading: false,
          error: err.message || 'search failed',
          query: slugTrimmed,
          page: 1,
          pages: 1,
        });
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [slugTrimmed, onSearch]);

  async function loadMore() {
    if (!onSearch) return;
    if (searchState.loading) return;
    if (searchState.page >= searchState.pages) return;
    if (!searchState.query) return;

    const nextPage = searchState.page + 1;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearchState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await onSearch(searchState.query, { page: nextPage, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      const more = Array.isArray(data?.results) ? data.results : [];
      setSearchState((s) => ({
        ...s,
        results: [...s.results, ...more],
        loading: false,
        page: data?.page || nextPage,
        pages: data?.pages || s.pages,
      }));
    } catch (err) {
      if (err.name === 'AbortError' || ctrl.signal.aborted) return;
      setSearchState((s) => ({ ...s, loading: false, error: err.message || 'failed to load more' }));
    }
  }

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    clearTimeout(blurTimeoutRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  function addSlug(slug, name) {
    const cleaned = slug.trim();
    if (!cleaned || existingSlugs.has(cleaned)) return;
    if (name && onLearnName) onLearnName(cleaned, name);
    onUpdate([...items, { slug: cleaned }]);
    setSlugInput('');
    setSearchState({ results: [], loading: false, error: null, query: '', page: 1, pages: 1 });
    setActiveIndex(-1);
  }

  function addFromInput() {
    if (!canAdd) return;
    addSlug(slugTrimmed, null);
  }

  function removeItem(index) {
    onUpdate(items.filter((_, i) => i !== index));
  }

  function handleKeyDown(e) {
    const hasSuggestions = onSearch && searchState.results.length > 0;
    if (hasSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, searchState.results.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSearchState({ results: [], loading: false, error: null, query: '' });
        setActiveIndex(-1);
        return;
      }
      if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        const r = searchState.results[activeIndex];
        if (r) addSlug(r.slug, r.name);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromInput();
    }
  }

  function handleBlur() {
    // Delay so suggestion onMouseDown click can register before the dropdown
    // hides on blur.
    clearTimeout(blurTimeoutRef.current);
    blurTimeoutRef.current = setTimeout(() => setIsFocused(false), 120);
  }

  function handleFocus() {
    clearTimeout(blurTimeoutRef.current);
    setIsFocused(true);
  }

  const showSuggestions =
    onSearch &&
    isFocused &&
    slugTrimmed.length > 0 &&
    (searchState.loading ||
      searchState.error ||
      searchState.results.length > 0 ||
      searchState.query === slugTrimmed);

  useLayoutEffect(() => {
    if (!showSuggestions || !inputRef.current) {
      setDropdownCoords(null);
      return undefined;
    }
    const update = () => {
      if (!inputRef.current) return;
      const r = inputRef.current.getBoundingClientRect();
      setDropdownCoords({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showSuggestions]);

  return (
    <section className="blueprint-form-section">
      <details className="bfs-collapsible">
      <summary className="bfs-summary" id={sectionId}>{title}</summary>
      <div className="bf-fields">
        <div className="bf-slug-row">
          <div className="bf-slug-input-wrap">
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              className={clsx('bf-input', isDuplicate && slugTrimmed && 'bf-input-warn')}
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onBlur={handleBlur}
              placeholder={inputPlaceholder}
              aria-label={`${title.slice(0, -1)} slug`}
              aria-describedby={isDuplicate && slugTrimmed ? dupWarnId : undefined}
              aria-autocomplete={onSearch ? 'list' : undefined}
              aria-controls={onSearch ? listId : undefined}
              aria-expanded={onSearch ? showSuggestions : undefined}
              autoComplete="off"
            />
            {showSuggestions && dropdownCoords && createPortal(
              <div
                className="bf-suggestions-portal"
                style={{
                  position: 'fixed',
                  top: dropdownCoords.top,
                  left: dropdownCoords.left,
                  width: dropdownCoords.width,
                }}
              >
                <PluginSearchSuggestions
                  query={slugTrimmed}
                  results={searchState.results}
                  loading={searchState.loading}
                  error={searchState.error}
                  existingSlugs={existingSlugs}
                  activeIndex={activeIndex}
                  listId={listId}
                  hasMore={searchState.page < searchState.pages}
                  onLoadMore={loadMore}
                  onSelect={(r) => addSlug(r.slug, r.name)}
                  onHoverIndex={setActiveIndex}
                />
              </div>,
              document.body,
            )}
          </div>
          <button
            type="button"
            className="bf-add-btn"
            onClick={addFromInput}
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
            {items.map((item, index) => {
              const displayName = (nameMap && nameMap[item.slug]) || item.slug;
              return (
                <li key={item.slug} className="bf-item">
                  <span className="bf-item-label">
                    <span className="bf-item-primary">{displayName}</span>
                  </span>
                  <button
                    type="button"
                    className="bf-remove-btn"
                    onClick={() => removeItem(index)}
                    aria-label={`Remove ${itemType} ${item.slug}`}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </details>
    </section>
  );
}
