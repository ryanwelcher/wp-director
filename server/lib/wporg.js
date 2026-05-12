// @ts-check

/**
 * Shared helpers for the WordPress.org plugin/theme directory proxies.
 *
 * Each route gets its own cache instance via createCache() so keys don't have
 * to be prefixed and TTLs can diverge later without entangling consumers.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX = 100;

function createCache({ ttlMs = DEFAULT_TTL_MS, max = DEFAULT_MAX } = {}) {
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.t > ttlMs) {
      store.delete(key);
      return null;
    }
    // Refresh LRU position.
    store.delete(key);
    store.set(key, entry);
    return entry.v;
  }

  function set(key, value) {
    if (store.size >= max) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { t: Date.now(), v: value });
  }

  return { get, set };
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const n = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    const v = NAMED_ENTITIES[code.toLowerCase()];
    return v != null ? v : match;
  });
}

function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return decodeEntities(s.replace(/<[^>]*>/g, '')).trim();
}

// WP.org sometimes returns protocol-relative URLs (`//ts.w.org/...`). Force
// https so the browser doesn't have to guess.
function normalizeThumbnail(url) {
  if (typeof url !== 'string' || !url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

module.exports = {
  createCache,
  stripHtml,
  normalizeThumbnail,
};
