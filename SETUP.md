# Setup

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **pnpm** — [pnpm.io/installation](https://pnpm.io/installation) (or enable via `corepack enable`)
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
pnpm install
```

**3. Install Playwright browsers**

Only Chromium is needed:

```bash
pnpm exec playwright install chromium
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

The key is only used by the natural language UI (`pnpm start`). If you only want to run pre-written scripts, you can skip this step.

## Running

**Start the natural language UI:**

```bash
pnpm start
```

Opens the server at `http://localhost:3000`. WP Playground starts automatically the first time you hit **Record**.

**Run all saved scripts:**

```bash
pnpm record
```

**Run a single script by name:**

```bash
pnpm record:action -- "my script name"
```

The name is matched with Playwright's `--grep` flag against the script's `name` field.

**View the last trace:**

```bash
pnpm show-trace
```

Opens the Playwright trace viewer for interactive step-by-step replay.

## Configuration

### WordPress instance

The WordPress instance is configured via `blueprints/blueprint.json`. You can change the site name, pre-install plugins or themes, and run arbitrary PHP setup steps. See the [WP Playground blueprint schema](https://playground.wordpress.net/blueprint-schema.json) for all available options.

The UI's **Blueprint** panel lets you edit and preview blueprint changes without touching the file directly. Customized blueprints are saved to `blueprints/blueprint.generated.json` (gitignored).

### Ports

Defaults are set in `server/config.js`:

| Variable | Default | Purpose |
|---|---|---|
| `PREVIEW_PLAYGROUND_PORT` | 9400 | Sandbox instance for blueprint preview |
| `RECORDING_PLAYGROUND_PORT_MIN` | 9406 | First port in the server-mode recording pool |
| `RECORDING_PLAYGROUND_PORT_MAX` | 9410 | Last port in the server-mode recording pool |
| `PORT` | 3000 | Express UI server (overridable via `PORT` env var) |

### Recording settings

Playwright configuration lives in `playwright.config.js`:

- **Video** — captured at 1920×1080, saved to `output/`
- **Slow motion** — 500 ms between actions for readable recordings
- **Timeout** — 120 seconds per test
- **Workers** — 1 (recordings run sequentially)
- **Trace** — always on; replay with `pnpm show-trace`

## Troubleshooting

**WP Playground won't start**
- Make sure the relevant Playground port is not already in use: `lsof -i :9406-9410`
- Restart the recording process and retry

**"Connection refused" or blank browser**
- Playground binds to `127.0.0.1`, not `localhost`. If you're testing manually, make sure to use the IP address and the configured recording-pool port.

**Natural language UI returns an error**
- Verify `ANTHROPIC_API_KEY` is set in `.env` and the server was (re)started after editing the file.
