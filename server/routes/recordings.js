// @ts-check

/**
 * Recordings list + download.
 *
 *   GET    /api/recordings                  → list all completed recordings
 *   GET    /api/recordings/:dirname/video   → stream the MP4 (or WebM fallback)
 *   DELETE /api/recordings/:dirname         → delete one completed recording
 *
 * "Recordings" == directories under `output/` that have a video file.
 * Playwright names them `actions-runner-<test-name>-chromium`; UI recordings
 * use `<recording-name>-<timestamp>`. We strip the runner/chromium wrapper and
 * parse the timestamp so the UI can show a clean title plus a readable date.
 *
 * Why prefer MP4? After /api/run's ffmpeg step, an MP4 sits alongside the
 * WebM. We serve MP4 when present (universal playback, matches user's chosen
 * size) and fall back to WebM only if conversion failed.
 */

const fs = require('fs');
const path = require('path');
const rangeParser = require('range-parser');
const { OUTPUT_DIR, SCREENCASTS_DIR } = require('../config');
const { findVideoFile } = require('../video');

const TIMESTAMP_PATTERN = /^(.+)-(\d{8}T\d{6}Z)(?:-\d+)?$/;
const RUNNER_PREFIX = 'actions-runner-';
const OUTPUT_ROOT = path.resolve(OUTPUT_DIR);

/**
 * @param {string} dirname  Raw output directory.
 * @returns {string}        Filename without Playwright's wrapper.
 */
function dirnameToFilenameBase(dirname) {
  if (!dirname.startsWith(RUNNER_PREFIX)) return dirname;

  return dirname
    .slice(RUNNER_PREFIX.length)
    .replace(/-chromium(?=(?:-\d+)?$)/, '');
}

/** @param {string} stamp */
function timestampToISO(stamp) {
  const match = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().startsWith(`${year}-${month}-${day}T${hour}:${minute}:${second}`)
    ? date.toISOString()
    : null;
}

/** @param {string} dirname */
function parseRecordingDirname(dirname) {
  const filenameBase = dirnameToFilenameBase(dirname);
  const timestampMatch = filenameBase.match(TIMESTAMP_PATTERN);
  const slug = timestampMatch ? timestampMatch[1] : filenameBase;
  const timestamp = timestampMatch?.[2] ?? null;

  return {
    createdAt: timestamp ? timestampToISO(timestamp) : null,
    filenameBase,
    name: slug.replace(/-/g, ' '),
    slug,
    timestamp,
  };
}

/** @param {string} dirname */
function isListableRecordingDir(dirname) {
  if (dirname.startsWith('.')) return false;
  return !fs.existsSync(path.join(OUTPUT_DIR, dirname, '.wp-director-preview'));
}

/** @param {string} dirname */
function isSafeRecordingDirname(dirname) {
  return /^[a-z0-9-]+$/i.test(dirname);
}

/**
 * Resolve a user-supplied recording directory name to an absolute path.
 * Only listable recording directories under OUTPUT_DIR are accepted.
 *
 * @param {string} dirname
 * @returns {string | null}
 */
function resolveRecordingDir(dirname) {
  if (!isSafeRecordingDirname(dirname)) return null;
  if (!isListableRecordingDir(dirname)) return null;
  if (!findVideoFile(dirname)) return null;

  const dir = path.resolve(OUTPUT_ROOT, dirname);
  if (dir !== OUTPUT_ROOT && !dir.startsWith(`${OUTPUT_ROOT}${path.sep}`)) return null;
  if (!fs.existsSync(dir)) return null;

  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null;

  return dir;
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
      const recording = parseRecordingDirname(dirname);
      return { ...recording, dirname, ext, size: stat.size, mtime: stat.mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
    res.json({ recordings });
  });

  app.get('/api/recordings/:dirname/video', (req, res) => {
    const dirname = req.params.dirname;
    // Filesystem-safe identifier only — rejects traversal attempts.
    if (!isSafeRecordingDirname(dirname)) return res.status(400).end();
    const found = findVideoFile(dirname);
    if (!found) return res.status(404).end();
    const { filenameBase } = parseRecordingDirname(dirname);
    const stat = fs.statSync(found.file);
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.${found.ext}"`);

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

  app.delete('/api/recordings/:dirname', (req, res) => {
    const dirname = req.params.dirname;
    const dir = resolveRecordingDir(dirname);
    if (!dir) return res.status(isSafeRecordingDirname(dirname) ? 404 : 400).json({ error: 'Recording not found' });

    try {
      fs.rmSync(dir, { recursive: true, force: false });
      fs.rmSync(path.join(SCREENCASTS_DIR, `${dirname}.webm`), { force: true });
      res.json({ deleted: true });
    } catch {
      res.status(500).json({ error: 'Could not delete recording' });
    }
  });
}

module.exports = { register };
