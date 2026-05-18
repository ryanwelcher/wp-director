// @ts-check

/**
 * Recordings list + download.
 *
 *   GET    /api/recordings                       → list all completed recordings
 *   GET    /api/recordings/:dirname/video        → stream the canonical WebM
 *   GET    /api/recordings/:dirname/download     → download as ?format=webm|mp4
 *   DELETE /api/recordings/:dirname              → delete one completed recording
 *
 * "Recordings" == directories under `output/` that have a video file.
 * Playwright names them `actions-runner-<test-name>-chromium`; UI recordings
 * use `<recording-name>-<timestamp>`. We strip the runner/chromium wrapper and
 * parse the timestamp so the UI can show a clean title plus a readable date.
 *
 * WebM is the only persisted artifact. MP4 downloads are produced on demand
 * via ffmpeg, streamed to the response, and never written to disk.
 */

const fs = require('fs');
const path = require('path');
const rangeParser = require('range-parser');
const { OUTPUT_DIR, SCREENCASTS_DIR } = require('../config');
const { findVideoFile, probeVideoSize, spawnMp4Transcode, spawnWebmDownscale } = require('../video');
const { VIDEO_SIZE_PRESETS } = require('../video-size');

/**
 * Resolutions a recording can be downloaded at: the captured source size,
 * plus any preset whose width is strictly smaller. Sorted largest-first.
 *
 * @param {{ width: number, height: number }} sourceSize
 * @returns {{ width: number, height: number }[]}
 */
function allowedSizesFor(sourceSize) {
  const smaller = VIDEO_SIZE_PRESETS
    .filter((p) => p.width < sourceSize.width)
    .map((p) => ({ width: p.width, height: p.height }));
  return [{ width: sourceSize.width, height: sourceSize.height }, ...smaller]
    .sort((a, b) => b.width - a.width);
}

/**
 * Resolve `width`+`height` query params to a target size, or return a status
 * code on rejection. `null` means "no resize" (source resolution).
 *
 * @returns {{ kind: 'source' } | { kind: 'scale', size: { width: number, height: number } } | { kind: 'error', status: number }}
 */
function resolveDownloadSize(query, sourceSize) {
  const rawW = query.width;
  const rawH = query.height;
  if (rawW == null && rawH == null) return { kind: 'source' };
  if (rawW == null || rawH == null) return { kind: 'error', status: 400 };

  const width = Number(rawW);
  const height = Number(rawH);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { kind: 'error', status: 400 };
  }

  if (!sourceSize) return { kind: 'error', status: 400 };
  if (width === sourceSize.width && height === sourceSize.height) {
    return { kind: 'source' };
  }

  const isAllowedPreset = VIDEO_SIZE_PRESETS.some(
    (p) => p.width === width && p.height === height && p.width < sourceSize.width,
  );
  if (!isAllowedPreset) return { kind: 'error', status: 400 };

  return { kind: 'scale', size: { width, height } };
}

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
  app.get('/api/recordings', async (req, res) => {
    if (!fs.existsSync(OUTPUT_DIR)) return res.json({ recordings: [] });
    const entries = fs.readdirSync(OUTPUT_DIR)
      .filter(isListableRecordingDir)
      .map((dirname) => ({ dirname, found: findVideoFile(dirname) }))
      .filter((entry) => entry.found !== null);
    const recordings = await Promise.all(entries.map(async ({ dirname, found }) => {
      const { file, ext } = /** @type {NonNullable<typeof found>} */ (found);
      const stat = fs.statSync(file);
      const recording = parseRecordingDirname(dirname);
      const sourceSize = await probeVideoSize(file);
      const downloadSizes = sourceSize ? allowedSizesFor(sourceSize) : [];
      return { ...recording, dirname, ext, size: stat.size, mtime: stat.mtimeMs, sourceSize, downloadSizes };
    }));
    recordings.sort((a, b) => b.mtime - a.mtime);
    res.json({ recordings });
  });

  app.get('/api/recordings/:dirname/video', (req, res) => {
    const dirname = req.params.dirname;
    // Filesystem-safe identifier only — rejects traversal attempts.
    if (!isSafeRecordingDirname(dirname)) return res.status(400).end();
    const found = findVideoFile(dirname);
    if (!found) return res.status(404).end();
    const { slug } = parseRecordingDirname(dirname);
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

  app.get('/api/recordings/:dirname/download', async (req, res) => {
    const dirname = req.params.dirname;
    if (!isSafeRecordingDirname(dirname)) return res.status(400).end();
    const format = String(req.query.format || '').toLowerCase();
    if (format !== 'webm' && format !== 'mp4') return res.status(400).end();

    const found = findVideoFile(dirname);
    if (!found) return res.status(404).end();
    const { slug } = parseRecordingDirname(dirname);

    const sourceSize = await probeVideoSize(found.file);
    const target = resolveDownloadSize(req.query, sourceSize);
    if (target.kind === 'error') return res.status(target.status).end();

    const outSize = target.kind === 'scale' ? target.size : sourceSize;
    const dimsSuffix = outSize ? `-${outSize.width}x${outSize.height}` : '';
    const filename = `${slug}${dimsSuffix}.${format}`;

    if (format === 'webm' && target.kind === 'source') {
      const stat = fs.statSync(found.file);
      res.setHeader('Content-Type', 'video/webm');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      fs.createReadStream(found.file).pipe(res);
      return;
    }

    const mime = format === 'mp4' ? 'video/mp4' : 'video/webm';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const scaleSize = target.kind === 'scale' ? target.size : null;
    const ff = format === 'mp4'
      ? spawnMp4Transcode(found.file, scaleSize)
      : spawnWebmDownscale(found.file, /** @type {{width:number,height:number}} */ (scaleSize));

    let killed = false;
    const kill = () => {
      if (killed) return;
      killed = true;
      try { ff.kill('SIGKILL'); } catch {}
    };
    res.on('close', () => { if (!res.writableEnded) kill(); });
    ff.stdout.pipe(res);
    ff.stderr.on('data', () => {}); // drain to avoid backpressure
    ff.on('error', () => {
      if (!res.headersSent) res.status(500);
      if (!res.writableEnded) res.end();
    });
    ff.on('close', (code) => {
      if (code !== 0 && !res.writableEnded) res.end();
    });
  });

  app.delete('/api/recordings/:dirname', (req, res) => {
    const dirname = req.params.dirname;
    const dir = resolveRecordingDir(dirname);
    if (!dir) return res.status(isSafeRecordingDirname(dirname) ? 404 : 400).json({ error: 'Recording not found' });

    try {
      fs.rmSync(dir, { recursive: true, force: false });
      res.json({ deleted: true });
    } catch {
      res.status(500).json({ error: 'Could not delete recording' });
    }
  });
}

module.exports = { register };
