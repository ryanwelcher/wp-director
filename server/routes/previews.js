// @ts-check

/**
 * Latest disposable video endpoints.
 *
 *   GET    /api/previews              → metadata for the current disposable video cache
 *   GET    /api/previews/latest/video → stream the latest disposable WebM
 *   POST   /api/previews/latest/save  → copy latest disposable WebM as a recording
 *   DELETE /api/previews              → empty disposable video cache
 *
 * Play writes a single replaceable video to `output/.previews/latest/`.
 * Saving promotes that WebM into `output/`. MP4 downloads are generated on demand.
 */

const fs = require('fs');
const path = require('path');
const rangeParser = require('range-parser');
const { OUTPUT_DIR, PREVIEW_OUTPUT_DIR } = require('../config');
const { timestamp, timestampedDirname, uniqueDir } = require('../output-paths');
const { nameToFilename } = require('./scripts');

const LATEST_VIDEO_DIRNAME = 'latest';

function latestVideoDir() {
  return path.join(PREVIEW_OUTPUT_DIR, LATEST_VIDEO_DIRNAME);
}

function latestVideoPath() {
  return path.join(latestVideoDir(), 'video.webm');
}

function listPreviewDirs() {
  let entries;
  try {
    entries = fs.readdirSync(PREVIEW_OUTPUT_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(PREVIEW_OUTPUT_DIR, entry.name);
      const stat = fs.statSync(dir);
      return { dirname: entry.name, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function latestVideoMetadata() {
  const file = latestVideoPath();
  if (!fs.existsSync(file)) return null;

  const dir = latestVideoDir();
  const stat = fs.statSync(file);
  const metaPath = path.join(dir, 'video.json');
  const legacyMetaPath = path.join(dir, 'preview.json');
  let meta = {};

  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    try {
      meta = JSON.parse(fs.readFileSync(legacyMetaPath, 'utf8'));
    } catch {}
  }

  return {
    dirname: LATEST_VIDEO_DIRNAME,
    name: meta.name || 'Play',
    createdAt: meta.createdAt || stat.mtime.toISOString(),
    size: stat.size,
    mtime: stat.mtimeMs,
  };
}

function sendVideoFile(req, res, file, filenameBase) {
  const stat = fs.statSync(file);
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'video/webm');
  res.setHeader('Content-Disposition', `inline; filename="${filenameBase}.webm"`);

  if (!range) {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(file).pipe(res);
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
  fs.createReadStream(file, { start, end }).pipe(res);
}

function register(app) {
  app.get('/api/previews', (req, res) => {
    const items = listPreviewDirs();
    res.json({ count: items.length, items, latest: latestVideoMetadata() });
  });

  app.get('/api/previews/latest/video', (req, res) => {
    const file = latestVideoPath();
    const meta = latestVideoMetadata();

    if (!meta || !fs.existsSync(file)) return res.status(404).end();
    sendVideoFile(req, res, file, nameToFilename(meta.name).replace(/\.json$/i, ''));
  });

  app.post('/api/previews/latest/save', async (req, res) => {
    const source = latestVideoPath();
    if (!fs.existsSync(source)) return res.status(404).json({ error: 'No video to save' });

    const rawName = String(req.body?.name || latestVideoMetadata()?.name || `recording-${Date.now()}`).trim();
    const name = rawName || `recording-${Date.now()}`;
    const slug = nameToFilename(name).replace(/\.json$/i, '');
    const dirname = path.basename(uniqueDir(path.join(OUTPUT_DIR, timestampedDirname(slug, timestamp()))));
    const outputDir = path.join(OUTPUT_DIR, dirname);
    const outputWebm = path.join(outputDir, 'video.webm');

    try {
      fs.mkdirSync(outputDir, { recursive: true });
      fs.copyFileSync(source, outputWebm);

      const stat = fs.statSync(outputWebm);
      res.json({
        dirname,
        name,
        createdAt: stat.mtime.toISOString(),
        videoUrl: `/api/recordings/${encodeURIComponent(dirname)}/video`,
      });
    } catch (err) {
      try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch {}
      res.status(500).json({ error: err.message || 'Could not save video' });
    }
  });

  app.delete('/api/previews', (req, res) => {
    try {
      fs.rmSync(PREVIEW_OUTPUT_DIR, { recursive: true, force: true });
      res.json({ cleared: true });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Could not clear videos' });
    }
  });
}

module.exports = { register };
