// @ts-check

/**
 * Recordings list + download.
 *
 *   GET /api/recordings                  → list all completed recordings
 *   GET /api/recordings/:dirname/video   → stream the MP4 (or WebM fallback)
 *
 * "Recordings" == directories under `output/` that have a video file.
 * Playwright names them `actions-runner-<test-name>-chromium`; we strip the
 * prefix/suffix to recover a readable slug and name for the UI.
 *
 * Why prefer MP4? After /api/run's ffmpeg step, an MP4 sits alongside the
 * WebM. We serve MP4 when present (universal playback, matches user's chosen
 * size) and fall back to WebM only if conversion failed.
 */

const fs = require('fs');
const path = require('path');
const rangeParser = require('range-parser');
const { OUTPUT_DIR } = require('../config');
const { findVideoFile } = require('../video');

/**
 * @param {string} dirname  Raw Playwright output directory.
 * @returns {string}        "my-recording" from "actions-runner-my-recording-chromium"
 */
function dirnameToSlug(dirname) {
  return dirname.replace(/^actions-runner-/, '').replace(/-chromium$/, '');
}

/** @param {string} dirname */
function isListableRecordingDir(dirname) {
  if (dirname.startsWith('.')) return false;
  return !fs.existsSync(path.join(OUTPUT_DIR, dirname, '.wp-director-preview'));
}

function register(app) {
  app.get('/api/recordings', (req, res) => {
    if (!fs.existsSync(OUTPUT_DIR)) return res.json({ recordings: [] });
    const dirs = fs.readdirSync(OUTPUT_DIR).filter(d => isListableRecordingDir(d) && findVideoFile(d) !== null);
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
    const stat = fs.statSync(found.file);
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.${found.ext}"`);

    if (!range) {
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(found.file).pipe(res);
      return;
    }

    const parsedRange = rangeParser(stat.size, range);
    if (parsedRange === -1 || parsedRange === -2 || parsedRange.type !== 'bytes' || parsedRange.length !== 1) {
      res.status(416)
        .setHeader('Content-Range', `bytes */${stat.size}`)
        .end();
      return;
    }

    const { start, end } = parsedRange[0];
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(found.file, { start, end }).pipe(res);
  });
}

module.exports = { register };
