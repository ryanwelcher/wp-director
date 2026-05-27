// @ts-check

/**
 * Intent → direction expander.
 *
 * Takes a classified intent (`{ id, slots }`) and produces a single
 * direction `{ label, actions }` that matches the existing /api/translate
 * response shape. Pure data transformation — no model calls.
 *
 * Features:
 *   - Slot defaulting (`default` when slot omitted; optional slots resolve to undefined)
 *   - Enum validation (rejects values not in the slot's `values` array)
 *   - String interpolation of `{{slot}}` placeholders inside string values
 *   - Whole-value substitution (when a value is exactly `"{{slot}}"`, the
 *     resolved value preserves its native type — boolean stays boolean, etc.)
 *   - `when` conditional: an action containing `when: "{{slot}}"` is included
 *     only when the referenced slot resolves to a truthy value.
 *   - Placeholder fill: a slot declared with `placeholderFor: "<sibling>"`
 *     that was left empty by the classifier is filled with an indexed
 *     placeholder derived from the sibling slot value — e.g. five
 *     consecutive `insert-block` intents with empty `content` slots
 *     resolve to "Paragraph 1" through "Paragraph 5".
 */

const { getIntent } = require('./loader');
const { getRandomText } = require('../../shared/random-text');
const wpCoreBlocks = require('../../shared/wp-core-blocks.json');

// Suggestion lists indexed by the name used in a slot's `suggestions` field.
// Mirrors client/DirectionPicker.jsx so the natural-language path normalizes
// labels ("Query Loop") to identifiers ("query") before substitution.
const SUGGESTION_LISTS = {
  'wp-core-blocks': wpCoreBlocks,
};

// Canonicalize so "Query Loop", "query loop", "query-loop", "Query_Loop"
// all reduce to the same key. Used for label/value matching only.
function canonicalKey(s) {
  return String(s).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
}

function normalizeAgainstSuggestions(slot, value) {
  if (typeof value !== 'string' || !value) return value;
  if (!slot.suggestions) return value;
  const list = Array.isArray(slot.suggestions)
    ? slot.suggestions
    : SUGGESTION_LISTS[slot.suggestions];
  if (!list) return value;
  const key = canonicalKey(value);
  for (const opt of list) {
    if (typeof opt === 'string') {
      if (canonicalKey(opt) === key) return opt;
      continue;
    }
    if (opt.value && canonicalKey(opt.value) === key) return opt.value;
    if (opt.label && canonicalKey(opt.label) === key) return opt.value;
  }
  return value;
}

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
 * @property {number[]} [_placeholders] - indices into `actions` whose final
 *   values were derived from the placeholder filler (e.g. "Paragraph 1").
 *   Carried back to the UI so those rows can be flagged as edit-me content.
 */

/**
 * Resolve user-supplied slot values against the intent's declared slot schema.
 * Applies defaults, fills in undefineds for optional slots, validates enum
 * values, and runs the indexed placeholder filler for empty slots declared
 * with `placeholderFor`. Throws on missing required slots or invalid enum
 * values.
 *
 * @param {Intent} intent
 * @param {Record<string, unknown>} provided
 * @param {Record<string, number>} [placeholderCounters] - shared across an
 *   expandAll() call so multiple intents with the same `placeholderFor`
 *   sibling produce contiguous indices (Paragraph 1, Paragraph 2, ...).
 * @returns {{ resolved: Record<string, unknown>, placeholderSlotNames: string[] }}
 */
function resolveSlots(intent, provided, placeholderCounters) {
  /** @type {Record<string, unknown>} */
  const resolved = {};
  // Placeholder-bearing slots are deferred so their fill can read the
  // already-resolved sibling slot value on the second pass.
  /** @type {IntentSlot[]} */
  const placeholderSlots = [];

  for (const slot of intent.slots) {
    const value = normalizeAgainstSuggestions(slot, provided[slot.name]);
    const empty = value === undefined || value === null || value === '';
    if (empty && slot.placeholderFor) {
      placeholderSlots.push(slot);
      continue;
    }
    if (empty) {
      if (slot.default !== undefined) {
        resolved[slot.name] = slot.default;
      } else if (!slot.optional) {
        throw new Error(`Intent "${intent.id}": missing required slot "${slot.name}"`);
      }
      continue;
    }
    if (slot.type === 'enum' && !slot.values.includes(String(value))) {
      throw new Error(
        `Intent "${intent.id}": slot "${slot.name}" value "${value}" not in enum [${slot.values.join(', ')}]`,
      );
    }
    resolved[slot.name] = value;
  }

  const counters = placeholderCounters || {};
  /** @type {string[]} */
  const placeholderSlotNames = [];
  for (const slot of placeholderSlots) {
    const sibling = resolved[slot.placeholderFor];
    if (sibling === undefined || sibling === null || sibling === '') {
      // Sibling never resolved — can't generate a sensible placeholder.
      if (!slot.optional) {
        throw new Error(
          `Intent "${intent.id}": slot "${slot.name}" needs sibling "${slot.placeholderFor}" to generate a placeholder`,
        );
      }
      continue;
    }
    const key = String(sibling);
    counters[key] = (counters[key] || 0) + 1;
    resolved[slot.name] = `${key[0].toUpperCase()}${key.slice(1)} ${counters[key]}`;
    placeholderSlotNames.push(slot.name);
  }
  return { resolved, placeholderSlotNames };
}

/**
 * Walk a template value and report whether any string within references the
 * named slot via `{{name}}`. Used to flag actions whose final value came from
 * the placeholder filler so the UI can render an "edit me" badge.
 *
 * @param {unknown} value
 * @param {string} slotName
 * @returns {boolean}
 */
function templateReferencesSlot(value, slotName) {
  if (typeof value === 'string') {
    PLACEHOLDER_RE.lastIndex = 0;
    let match;
    while ((match = PLACEHOLDER_RE.exec(value)) !== null) {
      if (match[1] === slotName) return true;
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((v) => templateReferencesSlot(v, slotName));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((v) => templateReferencesSlot(v, slotName));
  }
  return false;
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
 * @param {Record<string, number>} [placeholderCounters] - shared counter
 *   map for `placeholderFor` slots, scoped to one expandAll() call.
 * @returns {ExpandedDirection}
 */
function expand(entry, placeholderCounters) {
  if (!entry || typeof entry !== 'object' || !entry.id) {
    throw new Error('expand(): entry must be an object with an "id" field');
  }
  const intent = getIntent(entry.id);
  if (!intent) {
    throw new Error(`expand(): no intent registered with id "${entry.id}"`);
  }

  // Random-text pre-fill: when the user asked for "random text" (randomLength
  // set) and didn't supply explicit content, populate `content` with a
  // lorem-ipsum snippet before placeholder fill kicks in. The snippet is
  // ready to use, so we deliberately don't mark it as an edit-me placeholder.
  const inputSlots = { ...(entry.slots || {}) };
  if (inputSlots.randomLength && !inputSlots.content) {
    const length = String(inputSlots.randomLength);
    if (length === 'short' || length === 'medium' || length === 'long') {
      inputSlots.content = getRandomText(length);
    }
  }

  const { resolved: slots, placeholderSlotNames } = resolveSlots(
    intent,
    inputSlots,
    placeholderCounters,
  );

  // Synthetic boolean flags for `when` branching on the `mode` slot. Keeps
  // the `when` evaluator a simple truthy check while letting intents pick
  // between sibling actions by mode (typed vs programmatic, etc.).
  if (slots.mode !== undefined) {
    slots.modeIsTyped = slots.mode === 'typed';
    slots.modeIsProgrammatic = slots.mode === 'programmatic';
  }

  /** @type {Array<Record<string, unknown>>} */
  const actions = [];
  /** @type {number[]} */
  const placeholderIndices = [];
  for (const template of intent.actions) {
    const usesPlaceholder = placeholderSlotNames.some((name) => templateReferencesSlot(template, name));
    const resolved = /** @type {Record<string, unknown>} */ (substitute(template, slots));
    if ('when' in resolved) {
      const condition = resolved.when;
      delete resolved.when;
      if (!condition) continue;
    }
    if (usesPlaceholder) placeholderIndices.push(actions.length);
    actions.push(resolved);
  }

  const label = /** @type {string} */ (substitute(intent.label, slots));
  /** @type {ExpandedDirection} */
  const direction = { label, actions };
  if (placeholderIndices.length) direction._placeholders = placeholderIndices;
  return direction;
}

/**
 * Expand a sequence of classified intents into the flat directions array
 * the UI consumes. Empty input returns an empty list — the caller decides
 * what to do when classification found nothing.
 *
 * A single counter map is threaded through all entries so that placeholder
 * fill is contiguous across intents — five "add a paragraph" intents in
 * one response yield Paragraph 1 through Paragraph 5, not five copies of
 * Paragraph 1.
 *
 * @param {ClassifiedIntent[]} entries
 * @returns {ExpandedDirection[]}
 */
function expandAll(entries) {
  /** @type {Record<string, number>} */
  const placeholderCounters = {};
  return (entries || []).map((entry) => expand(entry, placeholderCounters));
}

module.exports = { expand, expandAll };
