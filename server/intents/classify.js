// @ts-check

/**
 * Intent classifier.
 *
 * Sends the user's natural-language text to Claude with the rendered intent
 * catalog and forces a structured tool call. The model's job is narrow:
 * pick intent ids and fill slot values. It never invents action JSON — that
 * comes from the on-disk intent files via server/intents/expand.js.
 *
 * The system prompt is composed at call time from the loaded catalog so new
 * intents become classifiable as soon as they land in `intents/` and the
 * server reloads.
 */

const { client } = require('../claude');
const { getCatalog, getIntent } = require('./loader');

const MODEL = 'claude-sonnet-4-6';

const CLASSIFY_PREAMBLE = `You are an intent classifier for a WordPress recording tool. Your job is to read the user's request and choose one or more intents from a fixed catalog, filling in slot values from the prompt.

You do NOT invent actions. You do NOT write JSON beyond the intent ids and slot values requested by the tool. The server will turn each (id, slots) pair into a canonical action sequence.

## Rules

- Use ONLY intent ids from the catalog below. If nothing in the catalog covers the request, return an empty \`intents\` array and put the original user text in \`unmatched\`.
- Returning \`unmatched\` is the correct, expected outcome for prompts that don't fit the catalog. Do NOT stretch to fit. If the prompt is gibberish, nonsensical, or contains no WordPress / admin concept at all (e.g. "bongo bongo", "zip zap", "invent an infinite energy source", "make my site look nice"), return an empty \`intents\` array and put the original text in \`unmatched\`. Never default to a generic navigation intent when the request doesn't actually name a destination.
- When two intents could plausibly cover a request, prefer the more specific one. For example "add a new post" / "create a new post" → \`open-new-post\` (not \`navigate-admin\` with section "Add Post"); "add a new page" → \`open-new-page\`. Per-intent descriptions call out these preferences — follow them.
- Infer obvious structural slots from natural phrasing — for example, "install and activate Jetpack" should emit two intents in order (\`install-plugin\` then \`activate-plugin\`). Do NOT invent body content for content/text slots; leave them out and the server will fill in placeholders.
- For composite requests ("install Jetpack and create a post"), emit one entry per user intention, in order.
- For explicit repetition ("five paragraphs"), emit the same intent N times rather than inventing a \`count\` slot.
- Slot values must match the declared type — booleans as \`true\`/\`false\`, numbers as numbers, enum values exactly as listed.

## Phrasing → slot hints for insert-block / select-block / delete-block

- \`blockType\` is the block's slug in kebab-case, with no \`core/\` prefix. Examples: "paragraph", "heading", "image", "list", "quote", "code", "cover", "gallery", "video", "audio", "columns", "group", "button", "buttons", "spacer", "separator", "table", "pullquote", "verse", "html", "embed", "media-text", "social-links". Convert spoken names: "the cover block" → "cover"; "a media and text block" → "media-text"; "a pull quote" → "pullquote".
- "silently", "programmatically", "in the background", "behind the scenes", "pre-populate", "set up" → \`mode: "programmatic"\`. Otherwise omit \`mode\` (default is "typed").
- "random text" / "with random text" → \`randomLength: "medium"\` and leave \`content\` empty.
- "short random text" / "a little random text" → \`randomLength: "short"\`.
- "long random text" / "a lot of random text" / "a long paragraph of random text" → \`randomLength: "long"\`.
- "at the beginning" / "at the start" / "at the top" / "as the first block" → \`position: "start"\`.
- "at the end" / "at the bottom" / "as the last block" → omit \`position\` (default is "end").
- "after the first paragraph" → \`afterBlockType: "paragraph"\`, \`afterBlockIndex: 0\`. "after the second heading" → \`afterBlockType: "heading"\`, \`afterBlockIndex: 1\`. Indexes are zero-based.
- Never set both \`content\` and \`randomLength\` — if the user gave literal text, use \`content\` and omit \`randomLength\`.

## Phrasing → slot hints for move-block

- "move the X up" / "move the X down" → \`direction: "up"\` or "down"\`.
- "two spots" / "two places" / "by two" / "down 2" → \`count: 2\`. Default count is 1, so omit \`count\` for plain "move up"/"move down".
- "move the second paragraph up" → \`blockType: "paragraph"\`, \`index: 1\`, \`direction: "up"\`.

## Phrasing → slot hints for format-text

- "bold" / "make it bold" / "unbold" → \`format: "Bold"\`.
- "italic" / "italicize" / "make it italic" → \`format: "Italic"\`.
- "strikethrough" / "strike through" / "cross out" → \`format: "Strikethrough"\`.
- "inline code" / "code format" / "format as code" → \`format: "Inline code"\`.
- Slot values are Title Case to match Gutenberg's aria-labels exactly. Capitalize accordingly.
- format-text is a toggle — same intent for "bold it" and "unbold it"; the editor decides direction based on current state.
- Do NOT use format-text for adding links or inline images — those need dedicated flows we don't have yet.

## Catalog`;

/**
 * Render the loaded intent catalog as a concise text block the model can
 * read at classify time. Action sequences are deliberately omitted — the
 * model should not see or reason about them.
 *
 * @returns {string}
 */
function renderCatalog() {
  const intents = getCatalog();
  if (intents.length === 0) {
    return '(catalog is empty)';
  }
  return intents
    .map((intent) => {
      const examples = intent.examples.map((e) => `  - "${e}"`).join('\n');
      const slots = intent.slots.length
        ? intent.slots
            .map((slot) => {
              const parts = [slot.type];
              if (slot.optional) parts.push('optional');
              if (slot.default !== undefined) parts.push(`default ${JSON.stringify(slot.default)}`);
              if (slot.type === 'enum') parts.push(`one of ${JSON.stringify(slot.values)}`);
              return `  - ${slot.name} (${parts.join(', ')})`;
            })
            .join('\n')
        : '  (none)';
      return `### ${intent.id}\n${intent.description}\nExamples:\n${examples}\nSlots:\n${slots}`;
    })
    .join('\n\n');
}

/**
 * Tool schema for forced structured output. `slots` is left open
 * (additionalProperties true) because each intent defines its own slot
 * names; the server validates slot values against the intent's schema
 * during expansion.
 */
const CLASSIFY_TOOL = {
  name: 'classify_intents',
  description: 'Map the user\'s request to a sequence of catalog intents with slot values, plus an optional unmatched fragment for free-form fallback.',
  input_schema: {
    type: 'object',
    properties: {
      intents: {
        type: 'array',
        description: 'Catalog intents the user requested, in order. Empty if nothing fits.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Intent id from the catalog.' },
            slots: {
              type: 'object',
              description: 'Slot values extracted from the prompt. Omit slots that were not mentioned.',
              additionalProperties: true,
            },
          },
          required: ['id'],
        },
      },
      unmatched: {
        type: 'string',
        description: 'Original user text that did not match any catalog intent. Omit when intents covers the full request.',
      },
    },
    required: ['intents'],
  },
};

/**
 * @typedef {Object} ClassifyResult
 * @property {Array<{ id: string, slots: Record<string, unknown> }>} intents
 * @property {string} [unmatched]
 */

/**
 * @param {string} userText
 * @returns {Promise<ClassifyResult>}
 */
async function classify(userText) {
  if (!userText || typeof userText !== 'string') {
    throw new Error('classify(): userText must be a non-empty string');
  }
  const system = `${CLASSIFY_PREAMBLE}\n\n${renderCatalog()}\n`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: 'classify_intents' },
    messages: [{ role: 'user', content: userText }],
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  const input = /** @type {any} */ (toolUse?.input) || {};
  const raw = Array.isArray(input.intents) ? input.intents : [];

  // The model is told to use only catalog ids, but occasionally invents one.
  // Drop hallucinated ids and route to the unmatched fallback rather than
  // letting expand() throw a 500.
  /** @type {Array<{ id: string, slots: Record<string, unknown> }>} */
  const normalized = [];
  let droppedUnknown = false;
  for (const e of raw) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') continue;
    if (!getIntent(e.id)) {
      droppedUnknown = true;
      continue;
    }
    normalized.push({ id: e.id, slots: (e.slots && typeof e.slots === 'object') ? e.slots : {} });
  }

  /** @type {ClassifyResult} */
  const result = { intents: normalized };
  const modelUnmatched = typeof input.unmatched === 'string' ? input.unmatched.trim() : '';
  if (modelUnmatched) result.unmatched = modelUnmatched;
  else if (droppedUnknown) result.unmatched = userText;
  return result;
}

module.exports = { classify, renderCatalog, CLASSIFY_TOOL };
