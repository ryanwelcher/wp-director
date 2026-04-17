# playwright-recorder

Records video walkthroughs of WordPress sites using Playwright + WordPress Playground CLI. Includes a natural language UI for generating step definitions without writing JSON by hand.

## Running

```bash
npm start                # start the natural language UI at http://localhost:3000
npm run record:wp        # WP admin + frontend recordings
npm run record:external  # external site example (playwright.dev)
npm run record           # all recordings
npm run record:steps     # run all JSON step definition files from steps/
npm run record:step -- "name"  # run a single step definition by name (grep match)
```

## Natural language UI (`server.js` + `public/`)

A local Express server that lets you build step definitions by typing plain English commands. Each command is sent to the Claude API, which translates it into one or more JSON steps using the existing action vocabulary. Steps accumulate in a live editor — you can directly edit the JSON to adjust values before running.

- `server.js` — Express server with three endpoints:
  - `GET /` — serves the UI
  - `POST /api/translate` — translates a natural language command to JSON steps via Claude (`claude-sonnet-4-6`)
  - `POST /api/run` — writes the accumulated steps to `steps/<name>.json`, runs only that test via `--grep`, streams output as SSE
- `public/index.html` / `public/app.js` / `public/style.css` — single-page UI

**API key:** set `ANTHROPIC_API_KEY` in `.env` (gitignored). The server loads it via `dotenv`.

**Run isolation:** the UI's Run button uses `--grep <name>` so only the generated recording runs, not other files in `steps/`.

## Architecture

- `global-setup.js` — spawns `@wp-playground/cli server`, waits for "Ready!" in stdout, writes PID to `.wp-playground.pid`
- `global-teardown.js` — kills the PID from `.wp-playground.pid`
- `blueprint.json` — pre-configures the WP instance (plugins, theme, sample content)
- `recordings/` — test specs; output lands in `output/`

## Critical gotchas

**Do NOT use `webServer` config for Playground.** WP Playground returns 302 on all routes, so Playwright's URL polling never resolves. Use `globalSetup`/`globalTeardown` with a PID file instead.

**Use `127.0.0.1`, not `localhost`.** Playground binds to `127.0.0.1:9400`. `localhost` does not reliably resolve to the same address and will cause connection failures.

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

**Generic actions:** `navigate`, `click`, `fill`, `type`, `wait`, `waitForSelector`, `screenshot`, `scroll`, `hover`, `press`, `frameLocator`, `exitFrame`

**WordPress shortcut actions:**

| Action | Key params | Notes |
|---|---|---|
| `wpNavigate` | `screen`, `waitUntil?` | Friendly names: `dashboard`, `posts`, `new-post`, `pages`, `plugins`, `themes`, `site-editor`, `settings`, etc. Falls back to `/wp-admin/{screen}` |
| `wpInstallPlugin` | `slug`, `activate?` | Navigates the plugin installer UI, searches by slug, installs, optionally activates |
| `wpSelectBlock` | `blockType`, `index?` | Clicks block by `data-type` inside the editor iframe. Short names (`paragraph`) auto-prefixed with `core/` |
| `wpInsertBlock` | `blockType` | Always appends at the end — clicks the last block, presses Enter to create new block, uses slash command to insert |
| `wpDeleteBlock` | `blockType`, `index?` | Selects block, presses Escape to enter block-selection mode, then Backspace to remove |
| `wpCommandPalette` | `command?` | Opens with `Meta+K`; if `command` is given, types it and presses Enter |
| `wpSetPostTitle` | `title` | Waits for and fills the post/page title inside the editor iframe — handles frame context internally |
| `wpSetPostContent` | `content`, `blockType?`, `index?`, `delay?` | Sets content in a block using `fill()`. When `blockType`/`index` are given, targets that block directly (0-based index); otherwise targets the last non-title block. Always replaces existing content. |

**`wpInsertBlock` gotcha.** Do NOT click `.block-list-appender button` to insert — that opens the block inserter panel and keyboard focus stays there. Instead, click the last `[data-block]` element, press End + Enter to create a new empty block, then type `/{blockName}` for the slash inserter. Wait ~1000ms before pressing Enter to give the slash inserter popover time to appear.

**`wpDeleteBlock` gotcha.** Clicking a text block puts the cursor in text-editing mode. Press Escape first to enter block-selection mode, then Backspace to delete.

## Long-term goal

Turn this into a standalone distributable application. The natural language UI (`npm start`) is the first step toward that — the eventual goal is a self-contained tool that doesn't require manual Playwright/Node setup.
