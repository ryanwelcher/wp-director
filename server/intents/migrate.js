// @ts-check

/**
 * One-shot migration: port the legacy `directions/*.json` library into
 * `intents/*.json`.
 *
 * Runs on server startup, before the intent loader reads the catalog.
 * For every file in `directions/` (the project-root, gitignored user library):
 *
 *   - filename "go-to-the-posts-page.json" → intent id "go-to-the-posts-page"
 *   - `name` field → `description` + seed example
 *   - no slots (treated as fully concrete actions)
 *   - `actions` (legacy nested groups OR flat list) flattened and copied verbatim
 *   - marker `userSaved: true` so the UI knows it can be deleted
 *
 * The original file is moved (not copied) to `directions.bak/` so reverting a
 * bad migration is a single `mv` away. If the derived id collides with an
 * intent that already exists in `intents/` (e.g. a Phase 2 built-in), the
 * file is still backed up but not ported, and a one-line notice is logged.
 *
 * The migration is idempotent: once `directions/` is empty (or doesn't exist),
 * this is a no-op on subsequent startups.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIRECTIONS_DIR = path.join(ROOT, 'directions');
const BACKUP_DIR = path.join(ROOT, 'directions.bak');
const INTENTS_DIR = path.join(ROOT, 'intents');

/**
 * Flatten a legacy directions file's `actions` field into the flat list of
 * low-level steps an intent expects. The legacy format wraps low-level
 * actions in labeled groups (`[{ label, actions: [...] }, ...]`) but newer
 * user-saved files store actions directly. Accept both.
 *
 * @param {unknown} raw
 * @returns {Array<Record<string, unknown>>}
 */
function flattenLegacyActions(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && Array.isArray(/** @type {any} */ (entry).actions)) {
      for (const step of /** @type {any} */ (entry).actions) {
        if (step && typeof step === 'object') out.push(step);
      }
    } else if (entry && typeof entry === 'object') {
      out.push(/** @type {Record<string, unknown>} */ (entry));
    }
  }
  return out;
}

/**
 * Move a file using fs.renameSync, falling back to copy+unlink when source
 * and destination live on different devices.
 *
 * @param {string} src
 * @param {string} dest
 */
function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err && /** @type {any} */ (err).code === 'EXDEV') {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

/**
 * Convert a directions filename ("go-to-add-post.json") to an intent id
 * ("go-to-add-post"). Throws on names that don't satisfy the intent id
 * rules so a malformed legacy file fails loudly instead of silently being
 * skipped.
 *
 * @param {string} filename
 */
function filenameToId(filename) {
  const base = filename.replace(/\.json$/i, '');
  if (!/^[a-z0-9-]+$/.test(base)) {
    throw new Error(`directions/${filename}: filename is not safe for use as an intent id`);
  }
  return base;
}

/**
 * Run the migration. Safe to call on every startup — does nothing when there
 * are no legacy files left to port.
 *
 * @returns {{ migrated: string[], skipped: string[] }}
 */
function migrate() {
  const result = { migrated: /** @type {string[]} */ ([]), skipped: /** @type {string[]} */ ([]) };
  if (!fs.existsSync(DIRECTIONS_DIR)) return result;

  const files = fs.readdirSync(DIRECTIONS_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return result;

  if (!fs.existsSync(INTENTS_DIR)) fs.mkdirSync(INTENTS_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  for (const filename of files) {
    const srcPath = path.join(DIRECTIONS_DIR, filename);
    const backupPath = path.join(BACKUP_DIR, filename);

    let id;
    try {
      id = filenameToId(filename);
    } catch (err) {
      console.warn(`[intents/migrate] ${err.message} — backing up without porting`);
      moveFile(srcPath, backupPath);
      result.skipped.push(filename);
      continue;
    }

    const intentPath = path.join(INTENTS_DIR, `${id}.json`);
    if (fs.existsSync(intentPath)) {
      console.warn(`[intents/migrate] ${filename}: intent "${id}" already exists — backing up legacy copy without porting`);
      moveFile(srcPath, backupPath);
      result.skipped.push(filename);
      continue;
    }

    let legacy;
    try {
      legacy = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    } catch (err) {
      console.warn(`[intents/migrate] ${filename}: could not parse — backing up without porting (${err.message})`);
      moveFile(srcPath, backupPath);
      result.skipped.push(filename);
      continue;
    }

    const name = typeof legacy?.name === 'string' && legacy.name.trim() ? legacy.name.trim() : id;
    const actions = flattenLegacyActions(legacy?.actions ?? legacy?.steps ?? []);

    const intent = {
      id,
      description: name,
      examples: [name],
      slots: [],
      label: name,
      actions,
      userSaved: true,
    };

    fs.writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    moveFile(srcPath, backupPath);
    result.migrated.push(id);
  }

  if (result.migrated.length || result.skipped.length) {
    console.log(
      `[intents/migrate] ported ${result.migrated.length} direction(s), skipped ${result.skipped.length}` +
      (result.migrated.length ? ` — migrated: ${result.migrated.join(', ')}` : '')
    );
  }
  return result;
}

module.exports = { migrate };
