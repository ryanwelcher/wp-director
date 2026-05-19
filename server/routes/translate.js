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

function register(app) {
  app.post('/api/translate', (req, res) => {
    if (req.query.v === '2') return intentTranslate(req, res);
    return legacyTranslate(req, res);
  });
  app.post('/api/translate/v2', intentTranslate);
}

module.exports = { register };
