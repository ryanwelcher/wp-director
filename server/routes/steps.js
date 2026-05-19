// @ts-check

/**
 * Per-step AI fix.
 *
 *   POST /api/steps/fix
 *     { step, surroundingActions, originalPrompt?, hint? }
 *     → { steps: [<replacement action>, ...] }
 *
 * Used by the ✨ button on each action row. Given a single action the
 * user is unhappy with, plus the surrounding actions in the same direction
 * (for context — selectors, frame state, prior block selections), ask
 * Claude to return a replacement: usually one action, occasionally a
 * short sequence if the original was doing too much.
 *
 * Replacements are staged in a diff view in the UI — the user can accept
 * (substitute the original step) or reject (no change). Fixes are *not*
 * written back to any underlying intent file; that's the intent-healing
 * flow deferred to Phase 6. The UI shows a one-off note for steps that
 * originated from an intent so the user knows the catalog isn't being
 * mutated.
 */

const { client, STEPS_PROMPT } = require('../claude');

const MODEL = 'claude-sonnet-4-6';

const FIX_PREAMBLE = `${STEPS_PROMPT}

---

You are now in **step-fix mode**. The user has selected ONE step from a longer recording and asked you to repair it. They may or may not include a hint about what's wrong. Your job:

- Inspect the step in context (surrounding actions tell you what frame the cursor is in, what was just clicked, etc.).
- Return a replacement — usually one action, occasionally a short sequence (2–3 actions) if the original was doing too much.
- Do not touch surrounding actions; only the step you're given. The UI will splice your replacement in place.
- Selectors must match the documented action vocabulary above. Do not invent action types or selector formats.
- If the original step looks fine and the hint doesn't suggest a real change, return the original step unmodified — the user will see no diff and the staging UI will dismiss itself.`;

const FIX_TOOL = {
  name: 'fix_step',
  description: 'Return a replacement action (or short sequence) for the step the user is repairing.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: 'Replacement steps. Usually length 1; up to 3 if the original was doing too much. Each step uses the action vocabulary from the system prompt.',
        items: {
          type: 'object',
          properties: { action: { type: 'string' } },
          required: ['action'],
          additionalProperties: true,
        },
        minItems: 1,
        maxItems: 3,
      },
    },
    required: ['steps'],
  },
};

async function fixStep(req, res) {
  const {
    step,
    surroundingActions = [],
    originalPrompt,
    hint,
  } = req.body ?? {};
  if (!step || typeof step !== 'object' || typeof step.action !== 'string') {
    return res.status(400).json({ error: 'step must be an object with an "action" field' });
  }
  if (!Array.isArray(surroundingActions)) {
    return res.status(400).json({ error: 'surroundingActions must be an array' });
  }

  const contextBlock = [
    originalPrompt ? `Original user prompt that produced this recording: ${originalPrompt}` : null,
    `Surrounding actions in the same direction (the step under repair is excluded):\n${JSON.stringify(surroundingActions, null, 2)}`,
    `Step to repair:\n${JSON.stringify(step, null, 2)}`,
    hint ? `User hint: ${hint}` : null,
  ].filter(Boolean).join('\n\n');

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: FIX_PREAMBLE,
      tools: [FIX_TOOL],
      tool_choice: { type: 'tool', name: 'fix_step' },
      messages: [{ role: 'user', content: contextBlock }],
    });
    const toolUse = message.content.find((b) => b.type === 'tool_use');
    const steps = Array.isArray(toolUse?.input?.steps) ? toolUse.input.steps : [];
    if (!steps.length) {
      return res.status(500).json({ error: 'model returned no replacement steps' });
    }
    res.json({ steps });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

function register(app) {
  app.post('/api/steps/fix', fixStep);
}

module.exports = { register };
