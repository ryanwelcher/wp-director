# Setup

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **npm** — included with Node.js
- **An Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com/) (required for the natural language UI; not needed to run recordings directly)
- **ffmpeg** — only required if you want to convert or re-encode recorded videos. The `ffmpeg-static` npm package bundles a copy, so a system install is optional.

## Installation

**1. Clone the repository**

```bash
git clone <repo-url>
cd playwright-recorder
```

**2. Install Node dependencies**

```bash
npm install
```

**3. Install Playwright browsers**

Only Chromium is needed:

```bash
npx playwright install chromium
```

**4. Configure your API key**

Copy the example environment file and fill in your key:

```bash
cp .env.example .env
```

Open `.env` and set:

```
ANTHROPIC_API_KEY=your-anthropic-api-key-here
```

The key is only used by the natural language UI (`npm start`). If you only want to run pre-written scripts, you can skip this step.

## Running

**Start the natural language UI:**

```bash
npm start
```

Opens the server at `http://localhost:3000`. WP Playground starts automatically the first time you hit **Record**.

**Run all saved scripts:**

```bash
npm run record
```

**Run a single script by name:**

```bash
npm run record:action -- "my script name"
```

The name is matched with Playwright's `--grep` flag against the script's `name` field.

**View the last trace:**

```bash
npm run show-trace
```

Opens the Playwright trace viewer for interactive step-by-step replay.

## Configuration

### WordPress instance

The WordPress instance is configured via `blueprints/blueprint.json`. You can change the site name, pre-install plugins or themes, and run arbitrary PHP setup steps. See the [WP Playground blueprint schema](https://playground.wordpress.net/blueprint-schema.json) for all available options.

The UI's **Blueprint** panel lets you edit and preview blueprint changes without touching the file directly. Customized blueprints are saved to `blueprints/blueprint.generated.json` (gitignored).

### Ports

Defaults are set in `src/config.js`:

| Variable | Default | Purpose |
|---|---|---|
| `PLAYGROUND_PORT` | 9400 | Main WP instance used for recordings |
| `PREVIEW_PLAYGROUND_PORT` | 9401 | Sandbox instance for blueprint preview |
| `CHROME_DEBUG_PORT` | 9222 | Chrome remote debugging (live preview) |
| `PORT` | 3000 | Express UI server (overridable via `PORT` env var) |

### Recording settings

Playwright configuration lives in `playwright.config.js`:

- **Video** — captured at 1920×1080, saved to `output/`
- **Slow motion** — 500 ms between actions for readable recordings
- **Timeout** — 120 seconds per test
- **Workers** — 1 (recordings run sequentially)
- **Trace** — always on; replay with `npm run show-trace`

## Troubleshooting

**WP Playground won't start**
- Make sure the relevant Playground port is not already in use: `lsof -i :9400`
- Restart the recording process and retry

**"Connection refused" or blank browser**
- Playground binds to `127.0.0.1`, not `localhost`. The config already uses `127.0.0.1:9400`, but if you're testing manually make sure to use the IP address.

**Live preview not showing**
- Chrome must be launched with `--remote-debugging-port=9222`, which `playwright.config.js` already sets. If another Chrome instance is already using that port, close it and retry.

**Natural language UI returns an error**
- Verify `ANTHROPIC_API_KEY` is set in `.env` and the server was (re)started after editing the file.
