// @ts-check

/**
 * Saved-script CRUD.
 *
 *   GET    /api/scripts            → list saved recordings (name, actionCount, actions)
 *   POST   /api/scripts/save       → write scripts/<name>.json
 *   DELETE /api/scripts/:filename  → remove a saved recording
 *
 * On-disk layout: `scripts/<slug>.json` where each file is
 *   { "name": "human readable", "actions": [ ... ] }
 *
 * `recordings/actions-runner.spec.js` reads this directory at test-collection
 * time and generates one Playwright test per file, keyed by `name`. The
 * runner endpoints (/api/run, /api/run/batch) use `--grep <name>` to isolate
 * one test out of the batch.
 *
 * Security: the DELETE route path-parameter is regex-validated so it can't
 * traverse out of the scripts/ directory.
 */

const fs = require('fs');
const path = require('path');
const { STEPS_DIR, SAFE_FILENAME_RE } = require('../config');

/**
 * Normalize a user-provided name into a safe on-disk filename.
 * Replaces anything outside [a-z0-9-] with a hyphen, lowercases the result.
 *
 * @param {string} name
 * @returns {string}
 */
function nameToFilename(name) {
  return `${name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.json`;
}

function register(app) {
  app.get('/api/scripts', (req, res) => {
    if (!fs.existsSync(STEPS_DIR)) return res.json({ scripts: [] });
    const files = fs.readdirSync(STEPS_DIR).filter(f => f.endsWith('.json'));
    const scripts = files.map(f => {
      try {
        const def = JSON.parse(fs.readFileSync(path.join(STEPS_DIR, f), 'utf8'));
        // Support new `directions` key plus legacy `actions`/`steps` keys
        const raw = def.directions ?? def.actions ?? def.steps ?? [];
        const directions = raw.map(s =>
          s.label != null ? s : { label: s.action, actions: [s] }
        );
        return {
          name: def.name,
          filename: f,
          directionCount: directions.length,
          directions,
        };
      } catch {
        // Skip malformed files rather than failing the whole listing.
        return null;
      }
    }).filter(Boolean);
    res.json({ scripts });
  });

  app.post('/api/scripts/save', (req, res) => {
    const { name = `recording-${Date.now()}`, directions = [] } = req.body;
    if (!fs.existsSync(STEPS_DIR)) fs.mkdirSync(STEPS_DIR);
    const filename = nameToFilename(name);
    fs.writeFileSync(path.join(STEPS_DIR, filename), JSON.stringify({ name, directions }, null, 2));
    res.json({ filename });
  });

  app.delete('/api/scripts/:filename', (req, res) => {
    const filename = req.params.filename;
    // Reject any filename containing path separators or unexpected chars.
    if (!SAFE_FILENAME_RE.test(filename)) {
      return res.status(400).json({ error: 'invalid filename' });
    }
    const filePath = path.join(STEPS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  });
}

module.exports = { register, nameToFilename };
