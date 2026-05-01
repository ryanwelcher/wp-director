# WP Director

Quickly record demo and support videos for WordPress sites using [Playwright](https://playwright.dev/) and [WordPress Playground CLI](https://www.npmjs.com/package/@wp-playground/cli). Includes a natural language UI for composing step definitions without writing JSON by hand.

## What it does

WP Director spins up a disposable WordPress instance via WP Playground, drives it with Playwright, and captures the result as a video. A local web UI (powered by the Claude API) lets you describe what you want to record in plain English — it translates your instructions into JSON step definitions that Playwright then executes.

**Key features:**

- **Natural language recording** — type a plain-English command ("insert a heading block") and the UI converts it to executable steps via Claude
- **Live browser preview** — watch the browser in real time as steps are built, streamed over the Chrome DevTools Protocol
- **Built-in WordPress actions** — a rich vocabulary of `wpNavigate`, `wpInsertBlock`, `wpSetPostTitle`, and more shortcut actions that handle Gutenberg's iframe canvas, welcome modals, and editor quirks automatically
- **Reusable directions** — save groups of steps (directions) and compose them into full scripts
- **Blueprint support** — configure your WordPress instance (plugins, themes, site options) via a JSON blueprint before recording
- **No persistent state** — each recording run uses a fresh or reusable Playground instance; nothing is stored remotely

## Setup

See [SETUP.md](SETUP.md) for full prerequisites and installation instructions.

**Quick start:**

```bash
# 1. Install dependencies
npm install
npx playwright install chromium

# 2. Add your Anthropic API key
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=<your key>

# 3. Start the UI
npm start
# Open http://localhost:3000
```

## Usage

### Natural language UI

```bash
npm start
```

Opens the UI at `http://localhost:3000`. Type plain-English commands in the direction bar to build up a script, then click **Record** to run it. The browser preview updates live as steps execute.

### Running recordings directly

```bash
npm run record               # run all scripts in scripts/
npm run record:action -- "name"  # run a single script by name (grep match)
```

Recorded videos and screenshots land in `output/`. Use `npm run show-trace` to inspect a run interactively with the Playwright trace viewer.

## How it works

1. `global-setup.js` starts a non-detached `@wp-playground/cli server` on an available CLI port and waits for it to become ready
2. `recordings/actions-runner.spec.js` reads all `*.json` files from `scripts/` and registers one Playwright test per file
3. Each test interprets the action list — generic Playwright actions plus WordPress-specific shortcuts — to drive the browser
4. Playwright captures video (1920×1080), screenshots, and a trace zip per run
5. `global-teardown.js` kills the in-memory Playground child process when the run finishes

## Project structure

```
├── server.js                 # Express server entry point (UI + API)
├── playwright.config.js      # Playwright configuration
├── global-setup.js           # Spawns WP Playground before tests
├── global-teardown.js        # Kills WP Playground after tests
├── blueprints/
│   └── blueprint.json        # Default WP instance configuration
├── recordings/
│   └── actions-runner.spec.js  # Dynamic test harness
├── scripts/                  # Your saved recording scripts (gitignored)
├── directions/               # Your saved direction snippets (gitignored)
├── server/
│   ├── config.js             # Ports and paths
│   ├── claude.js             # Anthropic SDK client + prompt definitions
│   ├── playground.js         # Playground lifecycle helpers
│   ├── video.js              # ffmpeg video conversion
│   ├── directions/           # Built-in direction templates
│   └── routes/               # Express API route handlers
├── client/                   # React UI components and client helpers
├── public/                   # Frontend UI (HTML, JS, CSS)
└── output/                   # Test artifacts — videos, screenshots, traces
```

## Requirements

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/) (for the natural language UI)
- Chromium (installed via `npx playwright install chromium`)
