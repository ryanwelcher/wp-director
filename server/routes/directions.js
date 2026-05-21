// @ts-check

/**
 * AI-assisted repair for a failed direction.
 *
 *   POST /api/directions/fix
 *     { actions, error, originalPrompt?, label? }
 *     → { actions: [<replacement actions>] }
 *
 * Triggered by the Fix-with-AI button that appears on a direction after a
 * real recording run failed on it. The Playwright error message + the
 * direction's existing actions + the user's original prompt give the model
 * concrete diagnostic context — much sharper than the speculative "fix any
 * step at any time" affordance this replaced.
 *
 * Returns a full replacement for the direction's actions. The UI stages
 * the diff (current vs proposed) so the user accepts or rejects before
 * anything is written. Fixes are one-off: they do NOT modify the underlying
 * intent file when the direction came from an intent. Intent healing is
 * Phase 6.
 */

const { client, STEPS_PROMPT } = require('../claude');

const MODEL = 'claude-sonnet-4-6';
const MAX_USER_CONTEXT_LENGTH = 2000;

const FIX_PREAMBLE = `${STEPS_PROMPT}

---

You are now in **direction-repair mode**. A user just ran a Playwright recording, and one of the directions failed mid-execution. They are asking you to repair it.

You will receive:
- The actions that made up the failing direction (these include selectors, action types, frame-locator setup, etc.)
- The Playwright error message from the moment of failure
- The user's original natural-language prompt that produced this direction (when available)
- Optionally a one-line label describing the direction's intent
- Optionally a user-supplied hint describing the user's own diagnosis or suggested fix

When a user hint is provided, treat it as **authoritative**: it represents the user's diagnosis of what went wrong or how to repair the direction, and they have visibility into the WordPress UI you do not. Follow the hint unless it clearly contradicts the action vocabulary (e.g. it asks for an action type that doesn't exist) or the rest of the action context. If the hint and the Playwright error point in different directions, prefer the hint.

Your job is to emit a replacement \`actions\` array. Guidelines:

- Use the action vocabulary from the system prompt above. Do not invent action types.
- Diagnose from the error: "Timeout" usually means the selector did not appear; "strict mode violation" means the selector matched multiple elements; a missing aria-label or role is usually a selector typo.
- Preserve actions that were not the cause of the failure. Do not rewrite the whole direction unless necessary.
- It is fine to insert a \`waitForSelector\` before a click that timed out, or to swap a brittle CSS selector for a role-based one.
- If the failing action depends on prior frame context (e.g. inside \`iframe[name="editor-canvas"]\`), keep the \`frameLocator\`/\`exitFrame\` bracketing intact.
- If the original direction's intent is impossible to recover (e.g. the selector targets an element that just doesn't exist in this WP version), return the closest functional alternative and rely on the user's diff view to catch a bad call.

Return only the replacement actions, in order. The UI will show a diff against the original.`;

const FIX_TOOL = {
  name: 'fix_direction',
  description: 'Return a replacement actions array for the failed direction.',
  input_schema: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        description: 'The replacement actions, in order. Use the action vocabulary from the system prompt.',
        items: {
          type: 'object',
          properties: { action: { type: 'string' } },
          required: ['action'],
          additionalProperties: true,
        },
        minItems: 1,
      },
    },
    required: ['actions'],
  },
};

async function fixDirection(req, res) {
  const {
    actions,
    error,
    originalPrompt,
    label,
    userContext,
  } = req.body ?? {};
  if (!Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({ error: 'actions must be a non-empty array' });
  }
  const errorMessage = typeof error === 'string'
    ? error
    : (error && typeof error === 'object' && typeof error.message === 'string'
      ? error.message
      : null);
  if (!errorMessage) {
    return res.status(400).json({ error: 'error.message (or error string) required' });
  }
  const trimmedUserContext = typeof userContext === 'string' ? userContext.trim() : '';
  if (trimmedUserContext.length > MAX_USER_CONTEXT_LENGTH) {
    return res.status(400).json({
      error: `userContext must be ${MAX_USER_CONTEXT_LENGTH} characters or fewer`,
    });
  }

  const userBlock = [
    label ? `Direction label: ${label}` : null,
    originalPrompt ? `Original user prompt: ${originalPrompt}` : null,
    `Playwright error from the failed run:\n${errorMessage}`,
    trimmedUserContext
      ? `User hint (authoritative — trust this over your own diagnosis unless it clearly contradicts the action vocabulary):\n${trimmedUserContext}`
      : null,
    `Actions that ran (the last one before the error is the most likely culprit, but any may need adjustment):\n${JSON.stringify(actions, null, 2)}`,
  ].filter(Boolean).join('\n\n');

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: FIX_PREAMBLE,
      tools: [FIX_TOOL],
      tool_choice: { type: 'tool', name: 'fix_direction' },
      messages: [{ role: 'user', content: userBlock }],
    });
    const toolUse = message.content.find((b) => b.type === 'tool_use');
    const replacement = Array.isArray(toolUse?.input?.actions) ? toolUse.input.actions : [];
    if (!replacement.length) {
      return res.status(500).json({ error: 'model returned no replacement actions' });
    }
    res.json({ actions: replacement });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

function register(app) {
  app.post('/api/directions/fix', fixDirection);
}

module.exports = { register };
