// @ts-check

/**
 * Intent → direction expander.
 *
 * Takes a classified intent (`{ id, slots }`) and produces a single
 * direction `{ label, actions }` that matches the existing /api/translate
 * response shape. Pure data transformation — no model calls.
 *
 * Features implemented in Phase 1:
 *   - Slot defaulting (`default` when slot omitted; optional slots resolve to undefined)
 *   - Enum validation (rejects values not in the slot's `values` array)
 *   - String interpolation of `{{slot}}` placeholders inside string values
 *   - Whole-value substitution (when a value is exactly `"{{slot}}"`, the
 *     resolved value preserves its native type — boolean stays boolean, etc.)
 *   - `when` conditional: an action containing `when: "{{slot}}"` is included
 *     only when the referenced slot resolves to a truthy value.
 *
 * Placeholder-fill (indexed `"Paragraph 1"` defaults for empty content slots)
 * lands in Phase 2 alongside the `insert-block` intent.
 */

const { getIntent } = require('./loader');

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const WHOLE_PLACEHOLDER_RE = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;

/**
 * @typedef {import('./loader').Intent} Intent
 * @typedef {import('./loader').IntentSlot} IntentSlot
 *
 * @typedef {Object} ClassifiedIntent
 * @property {string} id
 * @property {Record<string, unknown>} [slots]
 *
 * @typedef {Object} ExpandedDirection
 * @property {string} label
 * @property {Array<Record<string, unknown>>} actions
 */

/**
 * Resolve user-supplied slot values against the intent's declared slot schema.
 * Applies defaults, fills in undefineds for optional slots, and validates
 * enum values. Throws on missing required slots or invalid enum values.
 *
 * @param {Intent} intent
 * @param {Record<string, unknown>} provided
 * @returns {Record<string, unknown>}
 */
function resolveSlots(intent, provided) {
  /** @type {Record<string, unknown>} */
  const resolved = {};
  for (const slot of intent.slots) {
    const value = provided[slot.name];
    if (value === undefined || value === null || value === '') {
      if (slot.optional) {
        resolved[slot.name] = slot.default !== undefined ? slot.default : undefined;
      } else if (slot.default !== undefined) {
        resolved[slot.name] = slot.default;
      } else {
        throw new Error(`Intent "${intent.id}": missing required slot "${slot.name}"`);
      }
      continue;
    }
    if (slot.type === 'enum') {
      if (!slot.values || !slot.values.includes(String(value))) {
        throw new Error(
          `Intent "${intent.id}": slot "${slot.name}" value "${value}" not in enum [${(slot.values || []).join(', ')}]`,
        );
      }
    }
    resolved[slot.name] = value;
  }
  return resolved;
}

/**
 * Substitute `{{slot}}` placeholders in a value, recursing into objects
 * and arrays. A string that is *exactly* `"{{slot}}"` resolves to the
 * slot's native value (so booleans/numbers survive); embedded placeholders
 * fall back to string interpolation.
 *
 * @param {unknown} value
 * @param {Record<string, unknown>} slots
 * @returns {unknown}
 */
function substitute(value, slots) {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_PLACEHOLDER_RE);
    if (whole) {
      return slots[whole[1]];
    }
    return value.replace(PLACEHOLDER_RE, (_, name) => {
      const v = slots[name];
      return v === undefined || v === null ? '' : String(v);
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => substitute(v, slots));
  }
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substitute(v, slots);
    }
    return out;
  }
  return value;
}

/**
 * Expand a single classified intent into a direction.
 *
 * @param {ClassifiedIntent} entry
 * @returns {ExpandedDirection}
 */
function expand(entry) {
  if (!entry || typeof entry !== 'object' || !entry.id) {
    throw new Error('expand(): entry must be an object with an "id" field');
  }
  const intent = getIntent(entry.id);
  if (!intent) {
    throw new Error(`expand(): no intent registered with id "${entry.id}"`);
  }

  const slots = resolveSlots(intent, entry.slots || {});

  /** @type {Array<Record<string, unknown>>} */
  const actions = [];
  for (const template of intent.actions) {
    if ('when' in template) {
      const condition = substitute(template.when, slots);
      if (!condition) continue;
    }
    const resolved = /** @type {Record<string, unknown>} */ (substitute(template, slots));
    delete resolved.when;
    actions.push(resolved);
  }

  const label = /** @type {string} */ (substitute(intent.label, slots));
  return { label, actions };
}

/**
 * Expand a sequence of classified intents into the flat directions array
 * the UI consumes. Empty input returns an empty list — the caller decides
 * what to do when classification found nothing.
 *
 * @param {ClassifiedIntent[]} entries
 * @returns {ExpandedDirection[]}
 */
function expandAll(entries) {
  return (entries || []).map(expand);
}

module.exports = { expand, expandAll };
