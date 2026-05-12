// @ts-check

/**
 * WordPress.org plugin directory search proxy.
 *
 *   GET /api/plugins/search?q=<term>&page=<n>
 *
 * Proxies api.wordpress.org's keyless query_plugins endpoint, trims the
 * response to just what the UI needs, and caches results in memory for 5
 * minutes. The proxy isolates the UI from CORS / endpoint changes and lets
 * us normalize errors in one place.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 100;
const PER_PAGE = 10;
const MAX_QUERY_LEN = 100;

const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.t > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU position.
  cache.delete(key);
  cache.set(key, entry);
  return entry.v;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { t: Date.now(), v: value });
}

function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').trim();
}

function pickIcon(icons) {
  if (!icons || typeof icons !== 'object') return null;
  return icons['1x'] || icons.default || icons.svg || icons['2x'] || null;
}

function normalize(upstream) {
  const info = upstream && upstream.info ? upstream.info : {};
  const plugins = Array.isArray(upstream && upstream.plugins) ? upstream.plugins : [];
  return {
    page: info.page || 1,
    pages: info.pages || 1,
    results: plugins.map((p) => ({
      slug: p.slug,
      name: stripHtml(p.name),
      author: stripHtml(p.author),
      version: p.version,
      shortDescription: stripHtml(p.short_description),
      icon: pickIcon(p.icons),
      activeInstalls: p.active_installs,
      rating: p.rating,
    })),
  };
}

function register(app) {
  app.get('/api/plugins/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);

    if (!q) return res.status(400).json({ error: 'q is required' });
    if (q.length > MAX_QUERY_LEN) {
      return res.status(400).json({ error: `q too long (max ${MAX_QUERY_LEN})` });
    }

    const cacheKey = `${q}|${page}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    const params = new URLSearchParams({
      action: 'query_plugins',
      search: q,
      per_page: String(PER_PAGE),
      page: String(page),
    });
    for (const f of ['short_description', 'icons', 'rating', 'active_installs']) {
      params.append('fields[]', f);
    }
    const url = `https://api.wordpress.org/plugins/info/1.2/?${params.toString()}`;

    try {
      const upstream = await fetch(url);
      if (!upstream.ok) {
        console.error(`[plugins/search] upstream ${upstream.status} for q=${q}`);
        return res.status(502).json({ error: `Upstream returned ${upstream.status}` });
      }
      const json = await upstream.json();
      const normalized = normalize(json);
      cacheSet(cacheKey, normalized);
      res.set('X-Cache', 'MISS');
      res.json(normalized);
    } catch (err) {
      console.error('[plugins/search] fetch failed:', err.message);
      res.status(502).json({ error: 'Failed to reach WordPress.org' });
    }
  });
}

module.exports = { register };
