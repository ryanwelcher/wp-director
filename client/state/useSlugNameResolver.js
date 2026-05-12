import { useEffect, useState } from 'react';

/**
 * Resolves human-readable display names for a list of WP.org slugs by calling
 * the supplied `fetchInfo` API helper. Fires whenever the slug list grows by a
 * slug we haven't seen. Server caches lookups for 5 min, so reloads are cheap.
 *
 * Returns `[nameMap, learnName]`:
 *   - `nameMap`  — { [slug]: name }
 *   - `learnName(slug, name)` — record a name learned elsewhere (e.g. by
 *     clicking a search suggestion that already carries the name)
 */
export function useSlugNameResolver(items, fetchInfo) {
  const [nameMap, setNameMap] = useState({});

  useEffect(() => {
    const missing = items
      .map((it) => it.slug)
      .filter((slug) => slug && !nameMap[slug]);
    if (missing.length === 0) return undefined;

    let cancelled = false;
    Promise.all(
      missing.map(async (slug) => {
        try {
          const info = await fetchInfo(slug);
          return [slug, info?.name || null];
        } catch {
          return [slug, null];
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const patch = {};
      for (const [slug, name] of pairs) if (name) patch[slug] = name;
      if (Object.keys(patch).length > 0) {
        setNameMap((prev) => ({ ...prev, ...patch }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [items, nameMap, fetchInfo]);

  function learnName(slug, name) {
    setNameMap((prev) => ({ ...prev, [slug]: name }));
  }

  return [nameMap, learnName];
}
