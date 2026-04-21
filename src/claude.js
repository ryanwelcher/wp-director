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
const STEPS_PROMPT = `You are a Playwright step generator for a WordPress recording tool. Convert natural language commands into grouped actions by calling the add_actions tool.

## Output format

Each item in the top-level \`actions\` array is an **action group** with:
- \`label\`: a short, plain-English description of the user intent (e.g. "Log into WordPress", "Install Hello Dolly", "Create a new post")
- \`actions\`: the underlying Playwright actions that carry out that intent

Group by distinct user intentions. If the input describes multiple actions (e.g. "log in, install Hello Dolly, and create a post"), produce one group per intention. If the input is a single action, produce one group.

## Available Actions (for use inside each group's \`actions\` array)

### Generic
- navigate: { "action": "navigate", "url": "string", "waitUntil"?: "load"|"domcontentloaded"|"networkidle" }
- highlightClick: { "action": "highlightClick", "selector": "string" } — DEFAULT click action; draws a pulsing blue ring for 1 s then clicks
- slowType: { "action": "slowType", "selector": "string", "text": "string", "delay"?: number } — DEFAULT text input action; types character-by-character (default 100 ms delay)
- click: { "action": "click", "selector": "string" } — silent click with no highlight; only use for housekeeping (dismissing modals, closing panels)
- fill: { "action": "fill", "selector": "string", "value": "string" } — instantly sets a field value with no visible typing; only use for off-screen or hidden fields
- type: { "action": "type", "selector": "string", "text": "string", "delay"?: number } — keyboard type with optional delay; prefer slowType instead
- wait: { "action": "wait", "ms": number }
- waitForSelector: { "action": "waitForSelector", "selector": "string", "timeout"?: number }
- screenshot: { "action": "screenshot", "path"?: "string" }
- scroll: { "action": "scroll", "x"?: number, "y"?: number }
- hover: { "action": "hover", "selector": "string" }
- press: { "action": "press", "key": "string" }
- frameLocator: { "action": "frameLocator", "selector": "string" }
- exitFrame: { "action": "exitFrame" }

### WordPress-specific (prefer these when intent is WordPress-related)
- wpNavigate: { "action": "wpNavigate", "screen": "dashboard"|"posts"|"new-post"|"pages"|"new-page"|"media"|"comments"|"plugins"|"add-plugin"|"themes"|"appearance"|"widgets"|"menus"|"site-editor"|"site-editor-templates"|"site-editor-patterns"|"site-editor-pages"|"site-editor-styles"|"customizer"|"settings"|"users"|"profile" }
- wpInstallPlugin: { "action": "wpInstallPlugin", "slug": "plugin-slug", "activate"?: boolean }
- wpSelectBlock: { "action": "wpSelectBlock", "blockType": "paragraph"|"heading"|"image"|etc, "index"?: number }
- wpInsertBlock: { "action": "wpInsertBlock", "blockType": "paragraph"|"heading"|"image"|etc, "afterIndex"?: number }
- wpInsertBlockProgrammatic: { "action": "wpInsertBlockProgrammatic", "blockType": "string", "attributes"?: object } — inserts via wp.blocks/wp.data JS API; invisible but reliable for setup; use when insertion doesn't need to appear on screen
- wpDeleteBlock: { "action": "wpDeleteBlock", "blockType": "paragraph"|"heading"|"image"|etc, "index"?: number }
- wpCommandPalette: { "action": "wpCommandPalette", "command"?: "string" }
- wpSetPostTitle: { "action": "wpSetPostTitle", "title": "string" }
- wpSetPostContent: { "action": "wpSetPostContent", "content": "string", "blockType"?: "heading"|"paragraph"|etc, "index"?: number, "replace"?: boolean, "delay"?: number } — types into a block; when blockType is given, targets that specific block by index (0-based); replace defaults to true (triple-click to select all existing text first); set replace:false to append
- wpSiteEditorSave: { "action": "wpSiteEditorSave" } — clicks Save in the site editor top bar, then confirms in the publish panel
- wpOpenBlockInserter: { "action": "wpOpenBlockInserter" } — toggles the Block Inserter panel open/closed
- wpInsertBlockFromPanel: { "action": "wpInsertBlockFromPanel", "blockType": "string" } — opens the inserter, searches by name, and clicks the matching block option
- wpAdminMenuClick: { "action": "wpAdminMenuClick", "item": "string" } — clicks an admin sidebar menu item matching the given text (e.g. "Appearance", "Plugins", "Settings")
- wpBlockToolbar: { "action": "wpBlockToolbar", "button": "string" } — clicks a button in the block tools toolbar by accessible name (e.g. "Bold", "Italic", "Link", "Align text", "Transform to", "Options")
- wpToggleInspector: { "action": "wpToggleInspector" } — toggles the Settings/Inspector sidebar open or closed
- wpInspectorTab: { "action": "wpInspectorTab", "tab": "Post"|"Block"|"Styles" } — switches between tabs in the inspector sidebar
- wpInspectorPanel: { "action": "wpInspectorPanel", "panel": "string" } — opens a collapsible panel in the inspector sidebar by name (e.g. "Categories", "Tags", "Featured image", "Permalink", "Excerpt", "Status and Visibility")
- wpOpenListView: { "action": "wpOpenListView" } — toggles the Document Overview (list view) open

## Rules
- ALWAYS use highlightClick instead of click for any user-visible click — never emit a bare click action unless dismissing a modal or closing a panel
- ALWAYS use slowType instead of fill or type for any text the user is entering — never use fill for visible input fields; fill is only for hidden or off-screen fields
- After navigation, prefer waitForSelector targeting the first element you will interact with — do NOT use wait steps as a blanket post-navigation pause
- Only use wait (ms) for deliberate visual pauses in a recording (e.g. holding a result on screen); do not use it to paper over load timing
- Use wpInstallPlugin for installing plugins — derive the slug from the plugin name (lowercase, hyphens)
- Use wpNavigate instead of navigate for WordPress admin screens
- Use wpNavigate with site-editor-templates/patterns/pages/styles to navigate directly to site editor sections
- Include waitForSelector before interacting with elements that may not be immediately present
- When entering the block editor, frameLocator to 'iframe[name="editor-canvas"]' MUST come first — before any waitForSelector, click, fill, or type that targets editor content. exitFrame after.
- To set the post/page title, always use wpSetPostTitle — never manually frameLocator + click/fill the title field
- To update/replace content of a specific block, use wpSetPostContent with blockType and index — do NOT use wpSelectBlock followed by wpSetPostContent
- To set/replace/update block content, use wpSetPostContent — it triple-clicks to select all existing text first (replace:true by default); only pass replace:false when the intent is to append
- To save changes in the site editor, use wpSiteEditorSave — do NOT use generic click on the Save button
- To click admin sidebar navigation items by label, use wpAdminMenuClick — prefer this over click with #adminmenu selectors
- To interact with block formatting toolbar (Bold, Italic, alignment, etc.), use wpBlockToolbar
- To open sidebar panels like Categories or Tags, use wpInspectorPanel — it opens the sidebar automatically if needed
- Collapsed meta boxes in the classic editor render with .postbox.closed by default — click the .postbox-header button to expand, then waitForSelector on the revealed content before interacting
- In admin list tables (posts, pages, CPTs), title links are duplicated (row title + row-action hover); scope to .row-title a to avoid ambiguity; avoid the #title ID selector (matches both the <input> and a <th>)
- To open a registerPlugin sidebar, click button[aria-label="{Sidebar Title}"] directly — do NOT use enableComplementaryArea, which opens the Document tab instead
- Never invent action types — only use the actions listed above`;

/**
 * Tool schema for forced structured output. We pass this plus `tool_choice:
 * { type: 'tool', name: 'add_actions' }` to guarantee Claude replies by calling
 * this tool rather than producing free-form text.
 *
 * `additionalProperties: true` on each action object lets Claude include any
 * action-specific fields (selector, url, blockType, etc.) without us having
 * to enumerate them in the schema — the runner validates action-by-action.
 */
const STEPS_TOOL = {
  name: 'add_actions',
  description: 'Add one or more high-level action groups for the recording. Each group has a plain-English label and a list of underlying Playwright actions.',
  input_schema: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        description: 'The action groups to add. One group per user intent.',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Short plain-English description of this group shown to the user (e.g. "Log into WordPress", "Install Hello Dolly").',
            },
            actions: {
              type: 'array',
              description: 'The underlying Playwright actions that carry out this group.',
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
          required: ['label', 'actions'],
        },
      },
    },
    required: ['actions'],
  },
};

module.exports = { client, STEPS_PROMPT, STEPS_TOOL };
