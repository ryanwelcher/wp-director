// @ts-check

/**
 * POST /api/refine — AI-assisted correction of a failing Playwright step.
 *
 * Accepts `{ step, error, history }`:
 *   - step:    the action object (or array of actions) that failed
 *   - error:   the Playwright error text captured from stderr
 *   - history: steps already in the recording (optional context)
 *
 * Responds with `{ directions: Array<Direction> }` — same shape as /api/translate,
 * so the client can reuse the same accept/discard flow.
 */

const { client, STEPS_PROMPT, STEPS_TOOL } = require('../claude');

const REFINE_PREFIX = `You are fixing a failing Playwright step in a WordPress recording.
The step below produced the attached Playwright error. Analyze the error and return a
corrected replacement direction (one direction with one or more actions).
Common fixes: wrong selector, missing waitForSelector, wrong action type, iframe context missing.`;

function register(app) {
  app.post('/api/refine', async (req, res) => {
    const { step, error, history = [] } = req.body;
    if (!step) return res.status(400).json({ error: 'step required' });
    if (!error) return res.status(400).json({ error: 'error required' });

    try {
      const historyContext = history.length
        ? `\n\nFull recording context (steps so far):\n${JSON.stringify(history, null, 2)}`
        : '';

      const userMessage = `Failing step:\n${JSON.stringify(step, null, 2)}\n\nPlaywright error:\n${error}`;

      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: REFINE_PREFIX + '\n\n' + STEPS_PROMPT + historyContext,
        tools: [STEPS_TOOL],
        tool_choice: { type: 'tool', name: 'add_directions' },
        messages: [{ role: 'user', content: userMessage }],
      });

      const toolUse = message.content.find((b) => b.type === 'tool_use');
      const directions = toolUse?.input?.directions ?? [];
      res.json({ directions });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
