// @ts-check

/**
 * WordPress.org theme directory search proxy.
 *
 *   GET /api/themes/search?q=<term>&page=<n>
 *   GET /api/themes/info?slug=<slug>
 *
 * Mirrors server/routes/plugins.js for themes. The themes endpoint differs
 * from plugins in a few field names: `screenshot_url` (a single image) instead
 * of `icons`, `author` is an object (not an HTML string), and there's no
 * `active_installs` (we surface `downloaded` instead).
 */

const { createCache, stripHtml, normalizeThumbnail } = require('../lib/wporg');

const PER_PAGE = 10;
const MAX_QUERY_LEN = 100;
const MAX_DESC_LEN = 200;

const cache = createCache();

function authorString(author) {
  if (!author) return '';
  if (typeof author === 'string') return stripHtml(author);
  return stripHtml(author.display_name || author.user_nicename || '');
}

function shortDescription(s) {
  const text = stripHtml(s);
  if (text.length <= MAX_DESC_LEN) return text;
  return `${text.slice(0, MAX_DESC_LEN - 1).trimEnd()}…`;
}

function normalize(upstream) {
  const info = upstream && upstream.info ? upstream.info : {};
  const themes = Array.isArray(upstream && upstream.themes) ? upstream.themes : [];
  return {
    page: info.page || 1,
    pages: info.pages || 1,
    results: themes.map((t) => ({
      slug: t.slug,
      name: stripHtml(t.name),
      author: authorString(t.author),
      version: t.version,
      shortDescription: shortDescription(t.description),
      thumbnail: normalizeThumbnail(t.screenshot_url),
      previewUrl: t.preview_url || null,
      downloaded: t.downloaded,
      rating: t.rating,
    })),
  };
}

function register(app) {
  app.get('/api/themes/info', async (req, res) => {
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

    const params = new URLSearchParams({ action: 'theme_information', slug });
    const url = `https://api.wordpress.org/themes/info/1.2/?${params.toString()}`;

    try {
      const upstream = await fetch(url);
      if (!upstream.ok) {
        return res.status(502).json({ error: `Upstream returned ${upstream.status}` });
      }
      const json = await upstream.json();
      // WP.org returns `false` (not an error envelope) for unknown theme slugs.
      if (!json || typeof json !== 'object' || !json.slug) {
        return res.status(404).json({ error: 'theme not found' });
      }
      const normalized = {
        slug: json.slug,
        name: stripHtml(json.name),
        author: authorString(json.author),
        thumbnail: normalizeThumbnail(json.screenshot_url),
      };
      cache.set(cacheKey, normalized);
      res.set('X-Cache', 'MISS');
      res.json(normalized);
    } catch (err) {
      console.error('[themes/info] fetch failed:', err.message);
      res.status(502).json({ error: 'Failed to reach WordPress.org' });
    }
  });

  app.get('/api/themes/search', async (req, res) => {
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
      action: 'query_themes',
      search: q,
      per_page: String(PER_PAGE),
      page: String(page),
    });
    for (const f of ['description', 'screenshot_url', 'preview_url', 'rating', 'downloaded']) {
      params.append('fields[]', f);
    }
    const url = `https://api.wordpress.org/themes/info/1.2/?${params.toString()}`;

    try {
      const upstream = await fetch(url);
      if (!upstream.ok) {
        console.error(`[themes/search] upstream ${upstream.status} for q=${q}`);
        return res.status(502).json({ error: `Upstream returned ${upstream.status}` });
      }
      const json = await upstream.json();
      const normalized = normalize(json);
      cache.set(cacheKey, normalized);
      res.set('X-Cache', 'MISS');
      res.json(normalized);
    } catch (err) {
      console.error('[themes/search] fetch failed:', err.message);
      res.status(502).json({ error: 'Failed to reach WordPress.org' });
    }
  });
}

module.exports = { register };
