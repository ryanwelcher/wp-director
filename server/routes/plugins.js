// @ts-check

/**
 * WordPress.org plugin directory search proxy.
 *
 *   GET /api/plugins/search?q=<term>&page=<n>
 *   GET /api/plugins/info?slug=<slug>
 *
 * Proxies api.wordpress.org's keyless query_plugins / plugin_information
 * endpoints, trims the response to just what the UI needs, and caches results
 * in memory. The proxy isolates the UI from CORS / endpoint changes and lets
 * us normalize errors in one place.
 */

const { createCache, stripHtml } = require('../lib/wporg');

const PER_PAGE = 10;
const MAX_QUERY_LEN = 100;

const cache = createCache();

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
      thumbnail: pickIcon(p.icons),
      activeInstalls: p.active_installs,
      rating: p.rating,
    })),
  };
}

function register(app) {
  app.get('/api/plugins/info', async (req, res) => {
    const slug = typeof req.query.slug === 'string' ? req.query.slug.trim() : '';
    if (!slug) return res.status(400).json({ error: 'slug is required' });
    if (slug.length > MAX_QUERY_LEN || !/^[a-z0-9._-]+$/i.test(slug)) {
      return res.status(400).json({ error: 'invalid slug' });
    }

    const cacheKey = `info|${slug}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    const params = new URLSearchParams({ action: 'plugin_information', slug });
    params.append('fields[]', 'icons');
    const url = `https://api.wordpress.org/plugins/info/1.2/?${params.toString()}`;

    try {
      const upstream = await fetch(url);
      if (!upstream.ok) {
        return res.status(502).json({ error: `Upstream returned ${upstream.status}` });
      }
      const json = await upstream.json();
      if (!json || typeof json !== 'object' || json.error || !json.slug) {
        return res.status(404).json({ error: 'plugin not found' });
      }
      const normalized = {
        slug: json.slug,
        name: stripHtml(json.name),
        author: stripHtml(json.author),
        thumbnail: pickIcon(json.icons),
      };
      cache.set(cacheKey, normalized);
      res.set('X-Cache', 'MISS');
      res.json(normalized);
    } catch (err) {
      console.error('[plugins/info] fetch failed:', err.message);
      res.status(502).json({ error: 'Failed to reach WordPress.org' });
    }
  });

  app.get('/api/plugins/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);

    if (!q) return res.status(400).json({ error: 'q is required' });
    if (q.length > MAX_QUERY_LEN) {
      return res.status(400).json({ error: `q too long (max ${MAX_QUERY_LEN})` });
    }

    const cacheKey = `${q}|${page}`;
    const cached = cache.get(cacheKey);
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
      cache.set(cacheKey, normalized);
      res.set('X-Cache', 'MISS');
      res.json(normalized);
    } catch (err) {
      console.error('[plugins/search] fetch failed:', err.message);
      res.status(502).json({ error: 'Failed to reach WordPress.org' });
    }
  });
}

module.exports = { register };
