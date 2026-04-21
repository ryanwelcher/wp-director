// @ts-check

/**
 * Anthropic Claude client + prompt/tool definitions for step translation.
 *
 * The translate endpoint uses Claude's tool-use mechanism (not free-form text)
 * to force a structured JSON response: Claude MUST call `add_steps` with an
 * array of step objects, so the server can trust the shape of what comes back.
 *
 * STEPS_PROMPT is the system prompt; it enumerates every action the runner
 * understands. If you add a new action to `recordings/steps-runner.spec.js`,
 * also add it here (with expected params) so the model knows about it.
 *
 * Environment: ANTHROPIC_API_KEY must be set in `.env` (loaded by dotenv in
 * server.js). The SDK picks it up from process.env automatically.
 */

const Anthropic = require('@anthropic-ai/sdk');

/** Shared Anthropic client instance. */
const client = new Anthropic.default();

/**
 * System prompt for step translation. Enumerates the full action vocabulary
 * plus rules about when to use which action (e.g. prefer `wpSetPostTitle`
 * over manually frameLocator-ing the title field).
 */
const STEPS_PROMPT = `You are a Playwright step generator for a WordPress recording tool. Convert natural language commands into grouped steps by calling the add_steps tool.

## Output format

Each item in the top-level \`steps\` array is a **step group** with:
- \`label\`: a short, plain-English description of the user intent (e.g. "Log into WordPress", "Install Hello Dolly", "Create a new post")
- \`steps\`: the underlying Playwright actions that carry out that intent

Group by distinct user intentions. If the input describes multiple actions (e.g. "log in, install Hello Dolly, and create a post"), produce one group per intention. If the input is a single action, produce one group.

## Available Actions (for use inside each group's \`steps\` array)

### Generic
- navigate: { "action": "navigate", "url": "string", "waitUntil"?: "load"|"domcontentloaded"|"networkidle" }
- click: { "action": "click", "selector": "string" }
- fill: { "action": "fill", "selector": "string", "value": "string" }
- type: { "action": "type", "selector": "string", "text": "string", "delay"?: number }
- wait: { "action": "wait", "ms": number }
- waitForSelector: { "action": "waitForSelector", "selector": "string", "timeout"?: number }
- screenshot: { "action": "screenshot", "path"?: "string" }
- scroll: { "action": "scroll", "x"?: number, "y"?: number }
- hover: { "action": "hover", "selector": "string" }
- press: { "action": "press", "key": "string" }
- frameLocator: { "action": "frameLocator", "selector": "string" }
- exitFrame: { "action": "exitFrame" }

### WordPress-specific (prefer these when intent is WordPress-related)
- wpNavigate: { "action": "wpNavigate", "screen": "dashboard"|"posts"|"new-post"|"pages"|"new-page"|"media"|"comments"|"plugins"|"add-plugin"|"themes"|"appearance"|"widgets"|"menus"|"site-editor"|"customizer"|"settings"|"users"|"profile" }
- wpInstallPlugin: { "action": "wpInstallPlugin", "slug": "plugin-slug", "activate"?: boolean }
- wpSelectBlock: { "action": "wpSelectBlock", "blockType": "paragraph"|"heading"|"image"|etc, "index"?: number }
- wpInsertBlock: { "action": "wpInsertBlock", "blockType": "paragraph"|"heading"|"image"|etc, "afterIndex"?: number }
- wpDeleteBlock: { "action": "wpDeleteBlock", "blockType": "paragraph"|"heading"|"image"|etc, "index"?: number }
- wpCommandPalette: { "action": "wpCommandPalette", "command"?: "string" }
- wpSetPostTitle: { "action": "wpSetPostTitle", "title": "string" }
- wpSetPostContent: { "action": "wpSetPostContent", "content": "string", "blockType"?: "heading"|"paragraph"|etc, "index"?: number, "replace"?: boolean, "delay"?: number } — types into a block; when blockType is given, targets that specific block by index (0-based); replace defaults to true (triple-click to select all existing text first); set replace:false to append

## Rules
- Always include wait steps (400-800ms) after navigation or significant UI interactions
- Use wpInstallPlugin for installing plugins — derive the slug from the plugin name (lowercase, hyphens)
- Use wpNavigate instead of navigate for WordPress admin screens
- Include waitForSelector before interacting with elements that may not be immediately present
- When entering the block editor, frameLocator to 'iframe[name="editor-canvas"]' MUST come first — before any waitForSelector, click, fill, or type that targets editor content. exitFrame after.
- To set the post/page title, always use wpSetPostTitle — never manually frameLocator + click/fill the title field
- To update/replace content of a specific block, use wpSetPostContent with blockType and index — do NOT use wpSelectBlock followed by wpSetPostContent
- To set/replace/update block content, use wpSetPostContent — it triple-clicks to select all existing text first (replace:true by default); only pass replace:false when the intent is to append
- Never invent action types — only use the actions listed above`;

/**
 * Tool schema for forced structured output. We pass this plus `tool_choice:
 * { type: 'tool', name: 'add_steps' }` to guarantee Claude replies by calling
 * this tool rather than producing free-form text.
 *
 * `additionalProperties: true` on each step object lets Claude include any
 * action-specific fields (selector, url, blockType, etc.) without us having
 * to enumerate them in the schema — the runner validates action-by-action.
 */
const STEPS_TOOL = {
  name: 'add_steps',
  description: 'Add one or more high-level steps for the recording. Each step has a plain-English label and a list of underlying Playwright actions.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: 'The step groups to add. One group per user intent.',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Short plain-English description of this step shown to the user (e.g. "Log into WordPress", "Install Hello Dolly").',
            },
            steps: {
              type: 'array',
              description: 'The underlying Playwright actions that carry out this step.',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string', description: 'The action type.' },
                },
                required: ['action'],
                additionalProperties: true,
              },
            },
          },
          required: ['label', 'steps'],
        },
      },
    },
    required: ['steps'],
  },
};

module.exports = { client, STEPS_PROMPT, STEPS_TOOL };
