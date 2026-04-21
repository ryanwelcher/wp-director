// @ts-check

/**
 * Directions CRUD — reusable step sequences insertable into any script.
 *
 *   GET    /api/directions            → list built-ins + user entries ({ builtin, filename, name, directionCount })
 *   GET    /api/directions/:filename  → full action data for one entry
 *   POST   /api/directions/save       → write directions/<name>.json
 *   PUT    /api/directions/:filename  → rename a user entry (403 for built-ins)
 *   DELETE /api/directions/:filename  → delete a user entry (403 for built-ins)
 *
 * Built-ins live in src/directions/ (committed). User entries live in directions/
 * at the project root (gitignored).
 */

const fs = require('fs');
const path = require('path');
const { DIRECTIONS_DIR, BUILTIN_DIRECTIONS_DIR } = require('../config');
const { nameToFilename } = require('./scripts');

/** @param {string} dir @param {boolean} builtin */
function readEntries(dir, builtin) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const def = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const rawActions = def.actions ?? def.steps ?? [];
        return { name: def.name, filename: f, directionCount: rawActions.length, builtin };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** @param {string} filename */
function isBuiltin(filename) {
  return fs.existsSync(path.join(BUILTIN_DIRECTIONS_DIR, filename));
}

function register(app) {
  app.get('/api/directions', (req, res) => {
    const builtins = readEntries(BUILTIN_DIRECTIONS_DIR, true);
    const user = readEntries(DIRECTIONS_DIR, false);
    res.json({ directions: [...builtins, ...user] });
  });

  app.get('/api/directions/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!/^[a-z0-9-]+\.json$/i.test(filename)) {
      return res.status(400).json({ error: 'invalid filename' });
    }
    const builtinPath = path.join(BUILTIN_DIRECTIONS_DIR, filename);
    const userPath = path.join(DIRECTIONS_DIR, filename);
    const filePath = fs.existsSync(builtinPath) ? builtinPath : userPath;
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
    try {
      const def = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const rawActions = def.actions ?? def.steps ?? [];
      res.json({ name: def.name, filename, actions: rawActions, builtin: fs.existsSync(builtinPath) });
    } catch {
      res.status(500).json({ error: 'could not read direction' });
    }
  });

  app.post('/api/directions/save', (req, res) => {
    const { name = `direction-${Date.now()}`, actions = [] } = req.body;
    if (!fs.existsSync(DIRECTIONS_DIR)) fs.mkdirSync(DIRECTIONS_DIR);
    const filename = nameToFilename(name);
    if (isBuiltin(filename) || fs.existsSync(path.join(DIRECTIONS_DIR, filename))) {
      return res.status(409).json({ error: `A direction named "${name}" already exists.` });
    }
    fs.writeFileSync(path.join(DIRECTIONS_DIR, filename), JSON.stringify({ name, actions }, null, 2));
    res.json({ filename });
  });

  app.put('/api/directions/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!/^[a-z0-9-]+\.json$/i.test(filename)) {
      return res.status(400).json({ error: 'invalid filename' });
    }
    if (isBuiltin(filename)) return res.status(403).json({ error: 'cannot modify built-in directions' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const oldPath = path.join(DIRECTIONS_DIR, filename);
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'not found' });
    const def = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    def.name = name;
    const newFilename = nameToFilename(name);
    fs.writeFileSync(path.join(DIRECTIONS_DIR, newFilename), JSON.stringify(def, null, 2));
    if (newFilename !== filename) fs.unlinkSync(oldPath);
    res.json({ filename: newFilename });
  });

  app.delete('/api/directions/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!/^[a-z0-9-]+\.json$/i.test(filename)) {
      return res.status(400).json({ error: 'invalid filename' });
    }
    if (isBuiltin(filename)) return res.status(403).json({ error: 'cannot delete built-in directions' });
    const filePath = path.join(DIRECTIONS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  });
}

module.exports = { register };
