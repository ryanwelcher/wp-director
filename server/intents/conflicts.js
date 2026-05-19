// @ts-check

/**
 * Conflict check for save-as-intent.
 *
 * Before writing a new intent file, run each of the proposed example
 * phrases through classify(). If the classifier confidently maps a phrase
 * to a *different* existing intent, that's a collision — saving would
 * mean the new intent never wins for that phrase, or worse, the existing
 * intent loses other phrases to it.
 *
 * The UI uses this to surface collisions inline so the user can rename,
 * edit examples, or override. The save endpoint also runs it as a final
 * defense before writing to disk.
 *
 * Implementation: classification is treated as authoritative — if the
 * model returns a non-empty `intents` array whose first entry's id is
 * not the proposed id, we report it. Multi-intent classifications
 * (composite prompts) also count: if any returned intent is unrelated,
 * the phrase is too ambiguous to be a good example.
 */

const { classify } = require('./classify');

/**
 * @typedef {Object} Conflict
 * @property {string} example - the user-proposed example phrase
 * @property {string} intentId - the existing intent the classifier picked instead
 * @property {string[]} alsoMatched - other ids returned alongside (composite)
 *
 * @param {Object} args
 * @param {string} args.proposedId - the id the user wants to save under
 * @param {string[]} args.examples - the proposed example phrases
 * @returns {Promise<Conflict[]>}
 */
async function findConflicts({ proposedId, examples }) {
  if (!Array.isArray(examples) || examples.length === 0) return [];

  /** @type {Conflict[]} */
  const conflicts = [];

  // Classifier calls are independent — fan them out so the UI doesn't
  // wait N×latency in a serial chain. Ten parallel calls is well within
  // the API's burst budget for this kind of one-shot interactive request.
  const results = await Promise.all(
    examples.map(async (example) => ({ example, result: await classify(example) })),
  );

  for (const { example, result } of results) {
    const ids = (result.intents || []).map((i) => i.id);
    if (ids.length === 0) continue; // unmatched is fine — no conflict
    const otherIds = ids.filter((id) => id !== proposedId);
    if (otherIds.length === 0) continue; // already classifies to the proposed id
    conflicts.push({
      example,
      intentId: otherIds[0],
      alsoMatched: otherIds.slice(1),
    });
  }
  return conflicts;
}

module.exports = { findConflicts };
