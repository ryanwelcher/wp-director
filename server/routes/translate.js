// @ts-check

/**
 * Natural-language → directions translation.
 *
 *   POST /api/translate           intent-library pipeline (classify → expand
 *                                 canonical action sequences from intents/*.json).
 *   POST /api/translate/freeform  legacy free-form generation; kept solely as
 *                                 the backend for the UI's "Try anyway" button
 *                                 when the classifier returns `unmatched`.
 *
 * Both return `{ directions: [{ label, actions }, ...] }`; the intent endpoint
 * may also include `unmatched`.
 */

const { client, STEPS_PROMPT, STEPS_TOOL } = require('../claude');
const { classify } = require('../intents/classify');
const { expandAll } = require('../intents/expand');

async function freeformTranslate(req, res) {
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
  app.post('/api/translate', intentTranslate);
  app.post('/api/translate/freeform', freeformTranslate);
}

module.exports = { register };
