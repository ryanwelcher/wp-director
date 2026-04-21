// @ts-check

/**
 * POST /api/translate — natural-language → step definitions.
 *
 * Accepts `{ command, history }`:
 *   - command:  user's English description of what to do next
 *   - history:  steps already added in this session (optional; used as context
 *               so the model can be order-aware, e.g. "delete the first block
 *               I added" makes sense relative to prior steps)
 *
 * Responds with `{ steps: Array<StepObject> }`. Because the tool use is forced
 * (`tool_choice: { type: 'tool', name: 'add_steps' }`), Claude's reply is
 * always a single `tool_use` block whose `input.steps` is the array we want.
 */

const { client, STEPS_PROMPT, STEPS_TOOL } = require('../claude');

function register(app) {
  app.post('/api/translate', async (req, res) => {
    const { command, history = [] } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });

    try {
      // Inline session context so the model knows where we are in the flow.
      const historyContext = history.length
        ? `\n\nSteps added so far:\n${JSON.stringify(history, null, 2)}`
        : '';

      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: STEPS_PROMPT + historyContext,
        tools: [STEPS_TOOL],
        tool_choice: { type: 'tool', name: 'add_steps' },
        messages: [{ role: 'user', content: command }],
      });

      const toolUse = message.content.find((b) => b.type === 'tool_use');
      const steps = toolUse?.input?.steps ?? [];
      res.json({ steps });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
