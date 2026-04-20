// @ts-check

/**
 * Recordings list + download.
 *
 *   GET /api/recordings                  → list all completed recordings
 *   GET /api/recordings/:dirname/video   → stream the MP4 (or WebM fallback)
 *
 * "Recordings" == directories under `output/` that have a video file.
 * Playwright names them `steps-runner-<test-name>-chromium`; we strip the
 * prefix/suffix to recover a readable slug and name for the UI.
 *
 * Why prefer MP4? After /api/run's ffmpeg step, an MP4 sits alongside the
 * WebM. We serve MP4 when present (universal playback, matches user's chosen
 * size) and fall back to WebM only if conversion failed.
 */

const fs = require('fs');
const { OUTPUT_DIR } = require('../config');
const { findVideoFile } = require('../video');

/**
 * @param {string} dirname  Raw Playwright output directory.
 * @returns {string}        "my-recording" from "steps-runner-my-recording-chromium"
 */
function dirnameToSlug(dirname) {
  return dirname.replace(/^steps-runner-/, '').replace(/-chromium$/, '');
}

function register(app) {
  app.get('/api/recordings', (req, res) => {
    if (!fs.existsSync(OUTPUT_DIR)) return res.json({ recordings: [] });
    const dirs = fs.readdirSync(OUTPUT_DIR).filter(d => findVideoFile(d) !== null);
    const recordings = dirs.map((dirname) => {
      const found = findVideoFile(dirname);
      // findVideoFile returned non-null from the filter above, so this is safe.
      const { file, ext } = /** @type {NonNullable<typeof found>} */ (found);
      const stat = fs.statSync(file);
      const slug = dirnameToSlug(dirname);
      const name = slug.replace(/-/g, ' ');
      return { name, slug, dirname, ext, size: stat.size, mtime: stat.mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
    res.json({ recordings });
  });

  app.get('/api/recordings/:dirname/video', (req, res) => {
    const dirname = req.params.dirname;
    // Filesystem-safe identifier only — rejects traversal attempts.
    if (!/^[a-z0-9-]+$/i.test(dirname)) return res.status(400).end();
    const found = findVideoFile(dirname);
    if (!found) return res.status(404).end();
    const slug = dirnameToSlug(dirname);
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.${found.ext}"`);
    fs.createReadStream(found.file).pipe(res);
  });
}

module.exports = { register };
