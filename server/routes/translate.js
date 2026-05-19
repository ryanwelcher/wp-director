// @ts-check

/**
 * Natural-language → directions translation.
 *
 * Two pipelines live here during the intent-library rollout:
 *
 *   POST /api/translate         (legacy free-form generation; Claude produces
 *                                the full action JSON from STEPS_PROMPT)
 *   POST /api/translate/v2      (intent-library: classify → expand canonical
 *                                action sequences from intents/*.json)
 *
 * Both return the same `{ directions: [{ label, actions }, ...] }` shape so
 * the existing UI works with either. Setting `?v=2` on /api/translate also
 * routes to the new pipeline — handy for opt-in client experiments.
 *
 * The legacy path will be retired in Phase 6 of plans/translate-intent-library.md.
 */

const { client, STEPS_PROMPT, STEPS_TOOL } = require('../claude');
const { classify } = require('../intents/classify');
const { expandAll } = require('../intents/expand');

/**
 * Strip UI-only bookkeeping fields (anything starting with _) from the
 * directions the client sends back to us, so the model isn't distracted
 * by our internal state.
 *
 * @param {unknown} directions
 * @returns {Array<{ label?: string, actions?: Array<Record<string, unknown>> }>}
 */
function cleanDirections(directions) {
  if (!Array.isArray(directions)) return [];
  /** @type {Array<{ label?: string, actions?: Array<Record<string, unknown>> }>} */
  const out = [];
  for (const direction of directions) {
    if (!direction || typeof direction !== 'object') continue;
    const { label, actions } = /** @type {any} */ (direction);
    out.push({
      ...(typeof label === 'string' ? { label } : {}),
      actions: Array.isArray(actions) ? actions : [],
    });
  }
  return out;
}

async function legacyTranslate(req, res) {
  const { command, history = [] } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });

  try {
    const historyContext = history.length
      ? `\n\nSteps added so far:\n${JSON.stringify(history, null, 2)}`
      : '';

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: STEPS_PROMPT + historyContext,
      tools: [STEPS_TOOL],
      tool_choice: { type: 'tool', name: 'add_directions' },
      messages: [{ role: 'user', content: command }],
    });

    const toolUse = message.content.find((b) => b.type === 'tool_use');
    const directions = toolUse?.input?.directions ?? [];
    res.json({ directions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

async function intentTranslate(req, res) {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });

  try {
    const classification = await classify(command);
    const directions = expandAll(classification.intents);
    /** @type {{ directions: unknown, unmatched?: string }} */
    const payload = { directions };
    if (classification.unmatched) payload.unmatched = classification.unmatched;
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Refine an existing direction list using the user's plain-English feedback.
 *
 * Two modes:
 *   - `intent` (default): re-runs intent classification with the original
 *     prompt + feedback combined. The deterministic pipeline guarantees the
 *     result still maps to known intents.
 *   - `freeform`: invokes the legacy STEPS_PROMPT pipeline, passing the
 *     current actions and feedback as context. Used when the directions
 *     being refined originated from the "Try anyway" fallback.
 */
async function refine(req, res) {
  const {
    originalPrompt,
    currentDirections,
    feedback,
    mode = 'intent',
  } = req.body ?? {};
  if (typeof originalPrompt !== 'string' || !originalPrompt.trim()) {
    return res.status(400).json({ error: 'originalPrompt required' });
  }
  if (typeof feedback !== 'string' || !feedback.trim()) {
    return res.status(400).json({ error: 'feedback required' });
  }

  const sanitizedDirections = cleanDirections(currentDirections);

  try {
    if (mode === 'freeform') {
      const system = `${STEPS_PROMPT}

The user's previous prompt produced the following directions, which they want refined (not replaced from scratch):
${JSON.stringify(sanitizedDirections, null, 2)}

Apply the user's feedback as a revision to those directions and emit the full revised direction list.`;
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system,
        tools: [STEPS_TOOL],
        tool_choice: { type: 'tool', name: 'add_directions' },
        messages: [
          {
            role: 'user',
            content: `Original prompt: ${originalPrompt}\n\nFeedback: ${feedback}`,
          },
        ],
      });
      const toolUse = message.content.find((b) => b.type === 'tool_use');
      const directions = toolUse?.input?.directions ?? [];
      return res.json({ directions });
    }

    // Intent mode: combine the original prompt and feedback into a single
    // classification call. The catalog still constrains the output, so a
    // bad refinement reverts to unmatched rather than emitting garbage.
    const combinedPrompt = [
      originalPrompt,
      '',
      'Revision requested by the user (apply this on top of the original):',
      feedback,
    ].join('\n');
    const classification = await classify(combinedPrompt);
    const directions = expandAll(classification.intents);
    /** @type {{ directions: unknown, unmatched?: string }} */
    const payload = { directions };
    if (classification.unmatched) payload.unmatched = classification.unmatched;
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

function register(app) {
  app.post('/api/translate', (req, res) => {
    if (req.query.v === '2') return intentTranslate(req, res);
    return legacyTranslate(req, res);
  });
  app.post('/api/translate/v2', intentTranslate);
  app.post('/api/translate/refine', refine);
}

module.exports = { register };
