# WP Director

Quickly records demo and support videos for WordPress sites using Playwright + WordPress Playground CLI. Includes a natural language UI for generating step definitions without writing JSON by hand.

## Running

```bash
npm start                # start the natural language UI at http://localhost:3000
npm run record           # run all recordings
npm run record:steps     # run all JSON step definition files from steps/
npm run record:step -- "name"  # run a single step definition by name (grep match)
```

## Natural language UI (`server.js` + `public/`)

A local Express server that lets you build step definitions by typing plain English commands. Each command is sent to the Claude API, which translates it into one or more JSON steps using the existing action vocabulary. Steps accumulate in a live editor with inline-editable fields. You can toggle between the human-readable step list and the raw JSON view at any time.

### Server endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/` | Serves the UI |
| `POST` | `/api/translate` | Translates a natural language command to JSON steps via Claude (`claude-sonnet-4-6`) |
| `POST` | `/api/run` | Writes steps to `steps/<name>.json`, runs that test via `--grep`, streams stdout/stderr as SSE |
| `POST` | `/api/run/batch` | Runs multiple saved scripts (by name) via a combined `--grep` pattern, streams SSE; optionally restarts Playground with a custom blueprint first |
| `GET` | `/api/scripts` | Lists all saved step files from `steps/` |
| `POST` | `/api/scripts/save` | Saves current steps to `steps/<name>.json` |
| `DELETE` | `/api/scripts/:filename` | Deletes a saved step file |
| `GET` | `/api/default-blueprint` | Returns the contents of `blueprint.json` |
| `GET` | `/api/current-blueprint` | Returns `blueprint.generated.json` if it exists, else `blueprint.json` (last-used blueprint for UI startup) |
| `POST` | `/api/preview-blueprint` | Starts a second Playground instance (port 9400) with the given blueprint; returns the preview URL |

### Live preview

The Live Preview panel streams the running browser directly using the Playwright JS API. We then send the JPEG frames that Playwright provides to the UI over SSE.

**API key:** set `ANTHROPIC_API_KEY` in `.env` (gitignored). The server loads it via `dotenv`.

**Run isolation:** the UI's Run button uses `--grep <name>` so only the generated recording runs, not other files in `steps/`.

## Architecture

- `global-setup.js` — starts the CLI-mode `@wp-playground/cli server`, waits for "Ready!" in stdout
- `global-teardown.js` — kills the in-memory child process for CLI mode
- `blueprint.json` — pre-configures the WP instance (plugins, theme, sample content)
- `blueprint.generated.json` / `blueprint.preview.json` — runtime-generated files, gitignored
- `recordings/` — test specs; output lands in `output/`

## Critical gotchas

**Do NOT use `webServer` config for Playground.** WP Playground returns 302 on all routes, so Playwright's URL polling never resolves. Use `globalSetup`/`globalTeardown` with a directly managed child process instead.

**Use `127.0.0.1`, not `localhost`.** Playground binds to `127.0.0.1` on the configured port. `localhost` does not reliably resolve to the same address and will cause connection failures.

**Gutenberg editor canvas is inside an iframe.** Since WP 6.x, the block editor canvas renders in `iframe[name="editor-canvas"]`. Always use `page.frameLocator('iframe[name="editor-canvas"]')` to interact with blocks, the title field, etc. Regular `page.locator()` will silently time out.

**Dismiss the welcome modal before interacting with the editor.** On first load, `.edit-post-welcome-guide` covers the canvas. Wait for it, click the Close button, then proceed.

**Use `waitUntil: 'domcontentloaded'` for block editor navigation.** `networkidle` causes "Target page closed" errors because the editor registers service workers that keep network activity alive indefinitely.

**Blueprint field names.** Use `pluginData`/`themeData` (not `pluginZipFile`/`themeZipFile`). The `activate` property on `installPlugin` is invalid — use a separate `activatePlugin` step.

**PHP paths in blueprint `runPHP`.** Use `/wordpress/wp-load.php` (absolute), not `wordpress/wp-load.php` (relative).

## JSON step definitions

Step definitions live in `steps/*.json`. Each file is one recording:

```json
{
  "name": "my-recording",
  "steps": [
    { "action": "wpNavigate", "screen": "new-post" },
    { "action": "wpInsertBlock", "blockType": "heading" },
    { "action": "wpDeleteBlock", "blockType": "heading", "index": 0 }
  ]
}
```

`recordings/steps-runner.spec.js` reads all `*.json` files at runtime and generates one `test()` per file.

**Generic actions:** `navigate`, `click`, `highlightClick`, `fill`, `type`, `slowType`, `wait`, `waitForSelector`, `screenshot`, `scroll`, `hover`, `press`, `frameLocator`, `exitFrame`

| Action | Key params | Notes |
|---|---|---|
| `highlightClick` | `selector` | Draws a pulsing blue ring around the element for 1 s before clicking. Use for user-visible actions in recordings. |
| `slowType` | `selector`, `text`, `delay?` | Scrolls into view, clicks, then types character-by-character via `pressSequentially`. Default 100 ms per keystroke. |

**WordPress shortcut actions:**

| Action | Key params | Notes |
|---|---|---|
| `wpNavigate` | `screen`, `waitUntil?` | Friendly names: `dashboard`, `posts`, `new-post`, `pages`, `plugins`, `themes`, `site-editor`, `site-editor-templates`, `site-editor-patterns`, `site-editor-pages`, `site-editor-styles`, `settings`, etc. Falls back to `/wp-admin/{screen}` |
| `wpInstallPlugin` | `slug`, `activate?` | Navigates the plugin installer UI, searches by slug, installs, optionally activates |
| `wpSelectBlock` | `blockType`, `index?` | Clicks block by `data-type` inside the editor iframe. Short names (`paragraph`) auto-prefixed with `core/` |
| `wpInsertBlock` | `blockType` | Clicks the "Add default block" appender inside the canvas, then inserts via slash command. Autocomplete resolves on `page`, not the iframe. |
| `wpInsertBlockProgrammatic` | `blockType`, `attributes?` | Inserts via `wp.blocks.createBlock` + `wp.data.dispatch`. Invisible but reliable; use for setup steps that don't need to appear on screen. Short names auto-prefixed with `core/`. |
| `wpDeleteBlock` | `blockType`, `index?` | Selects block, presses Escape to enter block-selection mode, then Backspace to remove |
| `wpCommandPalette` | `command?` | Opens with `Meta+K`; if `command` is given, types it and presses Enter |
| `wpSetPostTitle` | `title`, `programmatic?`, `delay?` | Slow-types the post/page title inside the editor iframe by default; set `programmatic: true` for instant silent fill. |
| `wpSetBlockContent` | `content`, `blockType?`, `index?`, `replace?`, `delay?` | Slow-types text into a block. Triple-clicks to replace existing content first (`replace` defaults to `true`); set `replace: false` to append. Targets block by `blockType`/`index` or the last non-title block if omitted. |
| `wpSiteEditorSave` | — | Clicks Save in the site editor top bar then confirms in the publish panel. |
| `wpOpenBlockInserter` | — | Toggles the Block Inserter panel open. |
| `wpInsertBlockFromPanel` | `blockType` | Opens the block inserter, searches by block name, and clicks the matching result. |
| `wpAdminMenuClick` | `item` | Clicks an admin sidebar menu item by exact label (e.g. `"Posts"`, `"Appearance"`, `"Settings"`). Uses `getByRole('link', { name: item, exact: true })` scoped to `#adminmenu` — works for built-in and custom plugin/theme items. |
| `wpBlockToolbar` | `button` | Clicks a button in the block tools toolbar by accessible name (e.g. `"Bold"`, `"Italic"`, `"Align text"`). |
| `wpToggleInspector` | — | Toggles the Settings/Inspector sidebar open or closed. |
| `wpInspectorTab` | `tab` | Switches the inspector sidebar tab: `"Post"`, `"Block"`, or `"Styles"`. |
| `wpInspectorPanel` | `panel` | Opens a collapsible panel in the inspector by name (e.g. `"Categories"`, `"Tags"`, `"Featured image"`). Opens the sidebar first if it is closed. |
| `wpOpenListView` | — | Toggles the Document Overview (block list view) open. |

**`wpInsertBlock` approach.** Uses `getByRole('button', { name: 'Add default block' })` inside the editor canvas, then the slash inserter. The autocomplete option appears on `page` (not inside the iframe) and is waited for before clicking.

**`wpDeleteBlock` gotcha.** Clicking a text block puts the cursor in text-editing mode. Press Escape first to enter block-selection mode, then Backspace to delete.

**Do not use `wait` steps to paper over load timing.** Use `waitForSelector` before any action targeting an element that may not be immediately present. `wait` (ms) is for deliberate visual pauses only.

**Collapsed meta boxes.** Classic editor meta boxes render with `.postbox.closed` by default. Click the `.postbox-header` toggle button to expand, then `waitForSelector` on the revealed content before interacting.

**Admin list table selectors.** Post/page/CPT list tables have two links per row with the same text (row title + row-action hover link). Scope to `.row-title a` to target the title reliably. Avoid `#title` — it matches both the title `<input>` and a `<th>`.

**Plugin sidebar opening.** `enableComplementaryArea()` opens the Document tab, not plugin sidebars. Find and click `button[aria-label="{Sidebar Title}"]` directly. Read the plugin's `registerPlugin()` call to find the exact sidebar title string.

## Long-term goal

Turn this into a standalone distributable application. The natural language UI (`npm start`) is the first step toward that — the eventual goal is a self-contained tool that doesn't require manual Playwright/Node setup.
