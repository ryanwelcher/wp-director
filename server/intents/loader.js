// @ts-check

/**
 * Intent catalog loader.
 *
 * Reads `intents/*.json` at the repository root once at server startup,
 * validates each file against the intent schema, and exposes lookup helpers.
 *
 * Each intent file defines a canonical action sequence keyed by an id; the
 * classifier (server/intents/classify.js) picks an id, the expander
 * (server/intents/expand.js) turns it into resolved actions. The catalog
 * itself is data — adding a new intent is a matter of dropping a JSON file
 * into `intents/` and restarting the server.
 */

const fs = require('fs');
const path = require('path');

const INTENTS_DIR = path.join(__dirname, '..', '..', 'intents');

const SUPPORTED_SLOT_TYPES = new Set(['string', 'boolean', 'number', 'enum']);

/** @type {Map<string, Intent>} */
let catalog = new Map();
/** @type {boolean} */
let loaded = false;

/**
 * @typedef {Object} IntentSlot
 * @property {string} name
 * @property {'string'|'boolean'|'number'|'enum'} type
 * @property {boolean} [optional]
 * @property {*} [default]
 * @property {string[]} [values]              // for enum slots
 * @property {string} [placeholderFor]        // see expand.js placeholder fill (Phase 2)
 *
 * @typedef {Object} Intent
 * @property {string} id
 * @property {string} description
 * @property {string[]} examples
 * @property {IntentSlot[]} slots
 * @property {string} label
 * @property {Array<Record<string, unknown>>} actions
 */

/**
 * Validate one intent definition. Throws on missing/invalid fields so a
 * broken file fails loudly at startup rather than at translation time.
 *
 * @param {string} file - source filename, used in error messages
 * @param {unknown} raw - parsed JSON
 * @returns {Intent}
 */
function validate(file, raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Intent ${file}: expected an object at the top level`);
  }
  const intent = /** @type {any} */ (raw);

  for (const field of ['id', 'description', 'label']) {
    if (typeof intent[field] !== 'string' || !intent[field].trim()) {
      throw new Error(`Intent ${file}: missing or empty string field "${field}"`);
    }
  }
  if (!Array.isArray(intent.examples) || intent.examples.length === 0) {
    throw new Error(`Intent ${file}: "examples" must be a non-empty array`);
  }
  if (!Array.isArray(intent.slots)) {
    throw new Error(`Intent ${file}: "slots" must be an array (use [] for none)`);
  }
  if (!Array.isArray(intent.actions) || intent.actions.length === 0) {
    throw new Error(`Intent ${file}: "actions" must be a non-empty array`);
  }

  const seenSlotNames = new Set();
  for (const slot of intent.slots) {
    if (!slot || typeof slot !== 'object') {
      throw new Error(`Intent ${file}: slot entries must be objects`);
    }
    if (typeof slot.name !== 'string' || !slot.name.trim()) {
      throw new Error(`Intent ${file}: slot is missing a name`);
    }
    if (seenSlotNames.has(slot.name)) {
      throw new Error(`Intent ${file}: duplicate slot name "${slot.name}"`);
    }
    seenSlotNames.add(slot.name);
    if (!SUPPORTED_SLOT_TYPES.has(slot.type)) {
      throw new Error(`Intent ${file}: slot "${slot.name}" has unsupported type "${slot.type}"`);
    }
    if (slot.type === 'enum') {
      if (!Array.isArray(slot.values) || slot.values.length === 0) {
        throw new Error(`Intent ${file}: enum slot "${slot.name}" must declare a non-empty "values" array`);
      }
    }
  }

  return /** @type {Intent} */ (intent);
}

/**
 * Load (or reload) the catalog from disk. Called lazily on first lookup and
 * again at runtime in Phase 5 when a new intent file is saved.
 */
function load() {
  catalog = new Map();
  loaded = true;
  if (!fs.existsSync(INTENTS_DIR)) return;
  for (const file of fs.readdirSync(INTENTS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(INTENTS_DIR, file), 'utf8'));
    const intent = validate(file, raw);
    if (catalog.has(intent.id)) {
      throw new Error(`Intent ${file}: duplicate id "${intent.id}" (already defined in another file)`);
    }
    catalog.set(intent.id, intent);
  }
}

function ensureLoaded() {
  if (!loaded) load();
}

/** @returns {Intent[]} */
function getCatalog() {
  ensureLoaded();
  return Array.from(catalog.values());
}

/**
 * @param {string} id
 * @returns {Intent | undefined}
 */
function getIntent(id) {
  ensureLoaded();
  return catalog.get(id);
}

module.exports = { getCatalog, getIntent, reload: load };
