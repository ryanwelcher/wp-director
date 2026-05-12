// @ts-check

/**
 * Failed-preview cleanup.
 *
 *   GET    /api/previews   → { count, items: [{ dirname, mtime }] }
 *   DELETE /api/previews   → empty PREVIEW_OUTPUT_DIR
 *
 * Preview runs write a video to `output/.previews/preview-<slug>-<timestamp>/`
 * so a failing run leaves a debuggable artifact. Successful previews are
 * deleted by the runner itself; what remains here is the failure backlog.
 */

const fs = require('fs');
const path = require('path');
const { PREVIEW_OUTPUT_DIR } = require('../config');

function listPreviewDirs() {
  if (!fs.existsSync(PREVIEW_OUTPUT_DIR)) return [];
  return fs.readdirSync(PREVIEW_OUTPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(PREVIEW_OUTPUT_DIR, entry.name);
      const stat = fs.statSync(dir);
      return { dirname: entry.name, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function register(app) {
  app.get('/api/previews', (req, res) => {
    const items = listPreviewDirs();
    res.json({ count: items.length, items });
  });

  app.delete('/api/previews', (req, res) => {
    try {
      if (fs.existsSync(PREVIEW_OUTPUT_DIR)) {
        fs.rmSync(PREVIEW_OUTPUT_DIR, { recursive: true, force: true });
      }
      res.json({ cleared: true });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Could not clear previews' });
    }
  });
}

module.exports = { register };
