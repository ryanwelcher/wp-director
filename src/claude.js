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
const STEPS_PROMPT = `You are a Playwright step generator for a WordPress recording tool. Convert natural language commands into grouped directions by calling the add_directions tool.

## Output format

Each item in the top-level \`directions\` array is a **direction** with:
- \`label\`: a short, plain-English description of the user intent (e.g. "Log into WordPress", "Install Hello Dolly", "Create a new post")
- \`actions\`: the underlying Playwright actions that carry out that intent

Group by distinct user intentions. If the input describes multiple directions (e.g. "log in, install Hello Dolly, and create a post"), produce one direction per intention. If the input is a single direction, produce one direction.

## Available Actions (for use inside each direction's \`actions\` array)

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

### WordPress Admin URLs

Use \`navigate\` for all WordPress admin screens. \`baseURL\` is pre-configured so relative paths work.
Always use \`"waitUntil": "domcontentloaded"\` for WordPress admin navigation.

| Screen | URL path |
|---|---|
| Dashboard | /wp-admin/ |
| Posts list | /wp-admin/edit.php |
| New post | /wp-admin/post-new.php |
| Pages list | /wp-admin/edit.php?post_type=page |
| New page | /wp-admin/post-new.php?post_type=page |
| Media | /wp-admin/upload.php |
| Comments | /wp-admin/edit-comments.php |
| Plugins | /wp-admin/plugins.php |
| Add plugin | /wp-admin/plugin-install.php |
| Themes | /wp-admin/themes.php |
| Widgets | /wp-admin/widgets.php |
| Menus | /wp-admin/nav-menus.php |
| Site editor | /wp-admin/site-editor.php |
| Site editor → templates | /wp-admin/site-editor.php?path=/wp_template |
| Site editor → patterns | /wp-admin/site-editor.php?path=/patterns |
| Site editor → pages | /wp-admin/site-editor.php?path=/page |
| Site editor → styles | /wp-admin/site-editor.php?path=/wp_global_styles |
| Customizer | /wp-admin/customize.php |
| Settings | /wp-admin/options-general.php |
| Users | /wp-admin/users.php |
| Profile | /wp-admin/profile.php |

After navigating to new-post or new-page, always emit \`tryClick\` with selector \`.components-modal__header button[aria-label="Close"]\` to dismiss the welcome dialog if it appears.

### WordPress Common Selectors

**Admin sidebar navigation** — to click a menu item by label:
  Use \`highlightClick\` with selector \`#adminmenu a:has-text("<Label>")\`
  After clicking (which triggers navigation), emit \`waitForSelector\` on a landmark element of the destination page.

**Block toolbar buttons** (Bold, Italic, Link, Align text, etc.):
  Use \`highlightClick\` with selector \`[role="toolbar"][aria-label="Block tools"] button[aria-label="<ButtonName>"]\`

**Settings/Inspector sidebar toggle**:
  Use \`highlightClick\` with selector \`button[aria-label="Settings"]\`

**Inspector sidebar tabs** (Post, Block, Styles):
  Use \`highlightClick\` with selector \`[role="tab"]:has-text("<TabName>")\` — tabs use visible text, NOT aria-label

**Document Overview (list view)**:
  Use \`highlightClick\` with selector \`button[aria-label="Document Overview"]\`

**Block Inserter toggle**:
  Use \`highlightClick\` with selector \`button[aria-label="Block Inserter, Add block"]\`

**Inspector sidebar — general pattern**:

  All sidebar controls live inside \`[aria-label="Editor settings"]\`. Always scope selectors to this region.

  **Opening a panel's options (⋮) menu** — use \`wpOpenOptionsMenu\` (NOT \`highlightClick\`):
  \`{ "action": "wpOpenOptionsMenu", "selector": "button[aria-label=\"<Panel> options\"]" }\`
  Examples: \`button[aria-label="Color options"]\`, \`button[aria-label="Typography options"]\`, \`button[aria-label="Dimensions options"]\`
  \`wpOpenOptionsMenu\` checks whether the menu is already open and skips the click if it is, preventing the toggle-close problem that occurs when a prior direction left the menu open.

  **Enabling a hidden control via the options menu** — formula: \`[role="menuitemcheckbox"][aria-label="Show <Control name>"]\`
  Most panels use the "Show" prefix. The Color options menu only has \`"Show Link"\` as a toggleable checkbox — Text and Background color controls are always visible and cannot be hidden via the options menu.

  **Resetting all controls in a panel** — every panel's options menu has a "Reset all" action: \`[role="menuitem"]:has-text("Reset all")\`. This is a \`menuitem\` (not \`menuitemcheckbox\`) — it is a one-shot action, not a toggle. Use \`:has-text()\` not \`[aria-label]\` because the accessible name comes from visible text content, not an aria-label attribute.

  **Enabling multiple controls in the same panel** — the options menu stays open after clicking a \`menuitemcheckbox\` item. When enabling more than one control in the same panel: open the options button ONCE, then click each checkbox in sequence. Do NOT click the options button again between items. Group all of them into a single direction — never split enabling controls from the same panel across multiple directions.


  **Color options menu — exact item names** (use these verbatim):
  - Link color: \`"Show Link"\` (menuitemcheckbox)
  - There are NO "Text" or "Background" menuitemcheckbox items — those labels belong to the color picker buttons inside the panel itself, not the options menu.

  **Border options menu — exact item names** (use these verbatim):
  - Border: \`"Show Border"\`
  - Radius: \`"Show Radius"\` (NOT "Show Border radius" or "Show Border Radius")

  **Dimensions options menu — exact item names** (use these verbatim):
  - Padding: \`"Show Padding"\`
  - Margin: \`"Show Margin"\`

  **Typography options menu — exact item names** (use these verbatim):
  - Size: always visible, cannot be toggled
  - Font family: \`"Show Font"\` (when hidden) — when already enabled the label becomes \`"Hide and reset Font"\`
  - Appearance: \`"Show Appearance"\`
  - Line height: \`"Show Line height"\`
  - Letter spacing: \`"Show Letter spacing"\`
  - Decoration: \`"Show Decoration"\` (NOT "Text decoration")
  - Orientation: \`"Show Orientation"\` (NOT "Text transform")
  - Letter case: \`"Show Letter case"\` (NOT "Text transform")
  - Drop cap: \`"Show Drop cap"\`

  **Interacting with a control** — scope to the sidebar and use the control's accessible name:
  - Buttons: \`[aria-label="Editor settings"] button[aria-label="<Name>"]\`
  - Buttons identified by visible text: \`[aria-label="Editor settings"] button:has-text("<Text>")\`
  - Radio options (e.g. font size): \`[aria-label="Editor settings"] [role="radio"][aria-label="<Full name>"]\`
  - Text inputs: \`[aria-label="Editor settings"] [role="textbox"][aria-label="<Name>"]\`
  - Color swatches: \`[role="option"][aria-label="<Color name>"]\`

  **Panel-specific notes**:
  - Font size radios display abbreviations (S/M/L/XL/XXL) but their aria-labels are the full names — always use the full name (e.g. \`"Large"\`, not \`"L"\`)
  - Font family is a combobox whose accessible name comes from a label element (not aria-label), so \`[aria-label="Font"]\` will NOT match. Use \`[aria-label="Editor settings"] [role="combobox"]\` to open it, then select a font with \`[role="option"]:has-text("<Font name>")\` (e.g. \`[role="option"]:has-text("Fira Code")\`) — font options use text content, NOT aria-label
  - Text and Background color pickers are buttons with visible text only; use \`button:has-text("Text")\` and \`button:has-text("Background")\` scoped to \`[aria-label="Editor settings"]\`
  - Custom color picker: \`button[aria-label="Custom color picker"]\`
  - Hex color input: \`[role="textbox"][aria-label="Hex color"]\`

**Command palette**:
  Emit \`press\` key \`"Meta+k"\`, then \`waitForSelector\` selector \`[role="combobox"]\`, then \`slowType\` on \`[role="combobox"]\`, then \`press\` key \`"Enter"\`.

### WordPress-specific (prefer these when intent is WordPress-related)
- tryClick: { "action": "tryClick", "selector": "string", "timeout"?: number } — clicks an element only if it appears within timeout; silently skips if absent. Use for optional UI like welcome dialogs.
- wpOpenOptionsMenu: { "action": "wpOpenOptionsMenu", "selector": "button[aria-label=\"<Panel> options\"]" } — opens a sidebar panel's options (⋮) menu; skips the click if the menu is already open. ALWAYS use this instead of highlightClick when opening an options menu.
- wpInstallPlugin: { "action": "wpInstallPlugin", "slug": "plugin-slug", "activate"?: boolean }
- wpInstallTheme: { "action": "wpInstallTheme", "slug": "theme-slug", "name"?: "Display Name", "activate"?: boolean }
- wpSelectBlock: { "action": "wpSelectBlock", "blockType": "paragraph"|"heading"|"image"|etc, "index"?: number }
- wpInsertBlock: { "action": "wpInsertBlock", "blockType": "paragraph"|"heading"|"image"|etc, "afterIndex"?: number } — use when user says "type", "insert", "add", "write", or implies a visible on-screen action; types the slash command so it appears in the recording
- wpInsertBlockProgrammatic: { "action": "wpInsertBlockProgrammatic", "blockType": "string", "attributes"?: object } — use when user says "programmatically", "silently", "in the background", "set up", or "pre-populate"; inserts via JS API with no visible UI interaction
- wpDeleteBlock: { "action": "wpDeleteBlock", "blockType": "paragraph"|"heading"|"image"|etc, "index"?: number }
- wpSetPostTitle: { "action": "wpSetPostTitle", "title": "string" }
- wpSetPostContent: { "action": "wpSetPostContent", "content": "string", "blockType"?: "heading"|"paragraph"|etc, "index"?: number, "replace"?: boolean, "delay"?: number } — types into a block; when blockType is given, targets that specific block by index (0-based); replace defaults to true (triple-click to select all existing text first); set replace:false to append
- wpSiteEditorSave: { "action": "wpSiteEditorSave" } — clicks Save in the site editor top bar, then confirms in the publish panel
- wpInsertBlockFromPanel: { "action": "wpInsertBlockFromPanel", "blockType": "string" } — opens the inserter, searches by name, and clicks the matching block option
- wpInspectorPanel: { "action": "wpInspectorPanel", "panel": "string" } — opens a collapsible panel in the inspector sidebar by name (e.g. "Categories", "Tags", "Featured image", "Permalink", "Excerpt", "Status and Visibility"); opens the sidebar automatically if needed

## Rules
- ALWAYS use highlightClick instead of click for any user-visible click — never emit a bare click action unless dismissing a modal or closing a panel
- ALWAYS use slowType instead of fill or type for any text the user is entering — never use fill for visible input fields; fill is only for hidden or off-screen fields
- After navigation, prefer waitForSelector targeting the first element you will interact with — do NOT use wait steps as a blanket post-navigation pause
- Only use wait (ms) for deliberate visual pauses in a recording (e.g. holding a result on screen); do not use it to paper over load timing
- Use wpInstallPlugin for installing plugins — derive the slug from the plugin name (lowercase, hyphens)
- Use wpInstallTheme for installing themes — derive the slug from the theme name (lowercase, hyphens); pass name only when the display name differs from the title-cased slug
- For WordPress admin navigation, use navigate with the URL path from the WordPress Admin URLs table; always set waitUntil: "domcontentloaded"
- After navigating to new-post or new-page, emit tryClick with selector .components-modal__header button[aria-label="Close"] to dismiss the welcome dialog
- Include waitForSelector before interacting with elements that may not be immediately present
- When entering the block editor, frameLocator to 'iframe[name="editor-canvas"]' MUST come first — before any waitForSelector, click, fill, or type that targets editor content. exitFrame after.
- To insert a block, choose based on user intent: use wpInsertBlock (slash-command UI) when the user says "type", "insert", "add", "write", or implies a visible on-screen action; use wpInsertBlockProgrammatic when the user says "programmatically", "silently", "in the background", "set up", or "pre-populate" — invisible, no UI interaction shown in the recording
- To set the post/page title, always use wpSetPostTitle — never manually frameLocator + click/fill the title field
- To update/replace content of a specific block, use wpSetPostContent with blockType and index — do NOT use wpSelectBlock followed by wpSetPostContent
- To set/replace/update block content, use wpSetPostContent — it triple-clicks to select all existing text first (replace:true by default); only pass replace:false when the intent is to append
- To save changes in the site editor, use wpSiteEditorSave — do NOT use generic click on the Save button
- To click admin sidebar items by label, use highlightClick with selector #adminmenu a:has-text("<Label>"); follow with waitForSelector on a landmark element of the destination page
- To interact with block formatting toolbar (Bold, Italic, alignment, etc.), use highlightClick with selector [role="toolbar"][aria-label="Block tools"] button[aria-label="<ButtonName>"]
- To open sidebar panels like Categories or Tags, use wpInspectorPanel — it opens the sidebar automatically if needed
- Collapsed meta boxes in the classic editor render with .postbox.closed by default — click the .postbox-header button to expand, then waitForSelector on the revealed content before interacting
- In admin list tables (posts, pages, CPTs), title links are duplicated (row title + row-action hover); scope to .row-title a to avoid ambiguity; avoid the #title ID selector (matches both the <input> and a <th>)
- To open a registerPlugin sidebar, click button[aria-label="{Sidebar Title}"] directly — do NOT use enableComplementaryArea, which opens the Document tab instead
- For all inspector sidebar controls (Color, Typography, Dimensions, Spacing, Border, Layout, etc.), always scope selectors to \`[aria-label="Editor settings"]\` and follow the general pattern in the Inspector sidebar section above — do NOT guess CSS class names or data attributes
- Assume all sidebar controls are already visible — do NOT open a panel's options (⋮) menu as a precaution; only open it when the recording explicitly needs to enable a control that is hidden by default
- To open any panel's options (⋮) menu, ALWAYS use wpOpenOptionsMenu — never use highlightClick on an options button; highlightClick is a toggle and will close the menu if it is already open
- When enabling multiple controls from the same panel's options menu, open the options button ONCE and click all menuitemcheckbox items in sequence — never click the options button again between items (it toggles the menu closed); group all of them in one direction
- Never invent action types — only use the actions listed above
- Each direction should contain ONLY the actions required to accomplish its stated intent — do NOT add setup steps (opening the sidebar, selecting a block, switching tabs, etc.) that a prior direction may have already handled. Assume the UI is in the state the prior directions left it in. For example, if the user just selected a block, the sidebar is already open on the Block tab — do not emit steps to open Settings or click the Block tab again`;

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
  name: 'add_directions',
  description: 'Add one or more directions for the recording. Each direction has a plain-English label and a list of underlying Playwright actions.',
  input_schema: {
    type: 'object',
    properties: {
      directions: {
        type: 'array',
        description: 'The directions to add. One direction per user intent.',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Short plain-English description of this direction shown to the user (e.g. "Log into WordPress", "Install Hello Dolly").',
            },
            actions: {
              type: 'array',
              description: 'The underlying Playwright actions that carry out this direction.',
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
    required: ['directions'],
  },
};

module.exports = { client, STEPS_PROMPT, STEPS_TOOL };
