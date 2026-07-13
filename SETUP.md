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

**5. (Optional) Configure Google Drive upload**

Only needed if you want the **Upload to Drive** button on recordings. Skip otherwise.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project.
2. **Enable the Google Drive API**: APIs & Services → Library → search "Google Drive API" → Enable.
3. **Configure the OAuth consent screen** (External is fine for a personal tool); add your own Google account as a Test user so you can sign in while the app is unverified.
4. **Create an OAuth client ID**: APIs & Services → Credentials → Create Credentials → OAuth client ID → **Web application**. Under *Authorized redirect URIs* add exactly:

   ```
   http://127.0.0.1:3000/api/drive/oauth/callback
   ```

   Copy the generated **Client ID** and **Client secret**.
5. Add the three values to `.env`:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://127.0.0.1:3000/api/drive/oauth/callback
   ```

You don't need to pick a destination folder. Because the app uses the narrow `drive.file` scope, it can only write into folders **it** created, so on first upload it creates and reuses a folder named **WP Director Uploads** in your Drive. Rename it by setting `GOOGLE_DRIVE_FOLDER_NAME` in `.env`.

The first time you click **Upload to Drive**, a tab opens to sign in and grant access; after that the token is cached in `.gdrive-token.json` (gitignored) and reused across restarts. The `drive.file` scope means the app can see and manage only the files it creates — never the rest of your Drive. Uploaded files are made **public (anyone with the link can view)**, so don't upload sensitive recordings.

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
- **Trace** — always on; replay with `npm run show-trace`

## Troubleshooting

**WP Playground won't start**
- Make sure the relevant Playground port is not already in use: `lsof -i :9406-9410`
- Restart the recording process and retry

**"Connection refused" or blank browser**
- Playground binds to `127.0.0.1`, not `localhost`. If you're testing manually, make sure to use the IP address and the configured recording-pool port.

**Natural language UI returns an error**
- Verify `ANTHROPIC_API_KEY` is set in `.env` and the server was (re)started after editing the file.
