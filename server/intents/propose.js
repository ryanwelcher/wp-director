// @ts-check

/**
 * AI-assisted intent proposer.
 *
 * Given the user's original natural-language prompt and the resulting
 * directions (typically produced by the free-form "try anyway" fallback),
 * ask Claude to draft a complete intent JSON: id, description, examples,
 * slots, and an action template with `{{slot}}` placeholders in place of
 * literal values that originated from the prompt.
 *
 * The proposal is a *starting point* — the UI shows it in an editable form
 * so the user can rename, tweak descriptions, add/remove examples, or
 * change which values are slotified before saving via POST /api/intents.
 *
 * Slotification is intentionally conservative: when in doubt, the prompt
 * tells the model to leave a value literal. False slots are far more
 * dangerous than false literals — a wrong slot definition produces broken
 * actions on every future use; a missing slot just means the user edits
 * the proposal before saving.
 */

const { client } = require('../claude');
const { getCatalog } = require('./loader');

const MODEL = 'claude-sonnet-4-6';

const PROPOSE_PREAMBLE = `You are helping a WordPress recording tool author a new "intent" — a reusable, parameterized recipe that turns a natural-language request into a canonical sequence of actions.

The user just typed a free-form prompt and the system produced a working action sequence. Your job is to draft an intent JSON that, once saved, would let any future user produce the same action sequence by typing similar phrasings.

## Intent JSON shape

\`\`\`json
{
  "id": "kebab-case-id",
  "description": "One sentence explaining what this intent does.",
  "examples": ["3 to 6 natural phrasings that should map to this intent"],
  "slots": [
    { "name": "slotName", "type": "string|boolean|number|enum", "optional": true, "default": ..., "values": [...] }
  ],
  "label": "Short label shown in the editor, may contain {{slot}} placeholders",
  "actions": [ /* the action template — literal values, or "{{slot}}" placeholders */ ]
}
\`\`\`

## Rules

- **id**: lowercase kebab-case ([a-z0-9-]+), short and descriptive. Avoid colliding with the existing catalog (listed below).
- **description**: one sentence, declarative.
- **examples**: 3–6 natural phrasings. Include the user's original prompt as the first example. The rest should be plausible variations a different user might type.
- **slots**: declare slots ONLY for values that obviously vary between phrasings — plugin slugs, block types, titles, counts, booleans toggled by the phrasing. When in doubt, leave a value literal. False slots produce broken recipes; false literals just mean the user edits the proposal before saving.
- **slot types**: \`string\` (free text), \`boolean\` (true/false), \`number\`, \`enum\` (fixed set of allowed values; include a \`values\` array).
- **optional/default**: mark a slot \`optional: true\` when the action template can include a fallback via \`default\` or via a \`when\` conditional. Booleans extracted from phrasing (e.g. "and activate it") are typically \`optional: true, default: false\`.
- **label**: short imperative phrase. May reference slots with \`{{slot}}\` (e.g. "Install the {{slug}} plugin").
- **actions**: clone the provided actions verbatim, BUT replace any literal value that came from the user's prompt with a \`{{slot}}\` placeholder matching a declared slot. Values that did NOT come from the prompt (selectors, action types, fixed strings) must stay literal. Use a single \`when: "{{slotName}}"\` field on an action to make it conditional on a truthy slot value.

Do not invent new action types. Do not change selectors. The provided actions are correct; your job is to parameterize, not redesign.`;

const PROPOSE_TOOL = {
  name: 'propose_intent',
  description: 'Return a draft intent JSON for the user to review and edit before saving.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'kebab-case-id, unique against the catalog' },
      description: { type: 'string', description: 'One-sentence description.' },
      examples: {
        type: 'array',
        items: { type: 'string' },
        description: '3–6 natural phrasings; first entry MUST be the user\'s original prompt.',
      },
      slots: {
        type: 'array',
        description: 'Slot declarations. Empty array if the intent has no parameters.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['string', 'boolean', 'number', 'enum'] },
            optional: { type: 'boolean' },
            default: {},
            values: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'type'],
        },
      },
      label: { type: 'string', description: 'Editor label, may reference {{slot}} placeholders.' },
      actions: {
        type: 'array',
        description: 'Action template — copy the provided actions, replacing prompt-derived literal values with {{slot}} placeholders.',
        items: {
          type: 'object',
          properties: { action: { type: 'string' } },
          required: ['action'],
          additionalProperties: true,
        },
      },
    },
    required: ['id', 'description', 'examples', 'slots', 'label', 'actions'],
  },
};

/**
 * Render the existing catalog as a list of `{id} — description` lines so
 * the model can avoid id collisions and notice when its proposal overlaps
 * with an existing intent semantically.
 *
 * @returns {string}
 */
function renderExistingIds() {
  const catalog = getCatalog();
  if (!catalog.length) return '(catalog is empty)';
  return catalog.map((intent) => `- ${intent.id} — ${intent.description}`).join('\n');
}

/**
 * Flatten the directions the user wants to promote into the linear action
 * sequence the intent file expects. Drops UI bookkeeping fields.
 *
 * @param {Array<{ label?: string, actions?: Array<Record<string, unknown>> }>} directions
 * @returns {Array<Record<string, unknown>>}
 */
function flattenActions(directions) {
  if (!Array.isArray(directions)) return [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const direction of directions) {
    const actions = Array.isArray(direction?.actions) ? direction.actions : [];
    for (const action of actions) {
      if (action && typeof action === 'object') out.push(action);
    }
  }
  return out;
}

/**
 * Ask Claude to propose a complete intent JSON from the user's prompt and
 * the actions the free-form pipeline produced for them.
 *
 * @param {{ prompt: string, directions: Array<Record<string, unknown>> }} args
 * @returns {Promise<Record<string, unknown>>}
 */
async function propose({ prompt, directions }) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('propose(): prompt required');
  }
  const actions = flattenActions(directions);
  if (!actions.length) {
    throw new Error('propose(): directions must contain at least one action');
  }

  const system = `${PROPOSE_PREAMBLE}\n\n## Existing intent ids (avoid collisions)\n\n${renderExistingIds()}`;
  const userMessage = [
    'User prompt:',
    prompt,
    '',
    'Action sequence the free-form pipeline produced (this is correct — your job is to parameterize, not redesign):',
    JSON.stringify(actions, null, 2),
  ].join('\n');

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    tools: [PROPOSE_TOOL],
    tool_choice: { type: 'tool', name: 'propose_intent' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse || !toolUse.input) {
    throw new Error('propose(): model returned no tool call');
  }
  return /** @type {Record<string, unknown>} */ (toolUse.input);
}

module.exports = { propose };
