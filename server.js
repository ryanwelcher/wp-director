// @ts-check

/**
 * WP Director — Express bootstrap.
 *
 * Thin entry point. The real work lives in `server/`:
 *
 *   server/config.js       — paths, ports, constants
 *   server/claude.js       — Anthropic client + STEPS_PROMPT + STEPS_TOOL
 *   server/playground.js   — WP Playground process lifecycle
 *   server/video.js        — ffmpeg conversion + video discovery
 *   server/routes/*.js     — one file per API area; each exports register(app)
 *
 * This file loads environment variables, configures Express, mounts each
 * route module, and starts listening. Adding a new API area means dropping
 * a new `server/routes/<area>.js` and adding one line below.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  DEFAULT_SERVER_PORT,
  DEFAULT_BLUEPRINT,
  GENERATED_BLUEPRINT,
} = require('./server/config');

const app = express();
const previewLoadingPage = path.join(__dirname, 'server/public/preview-loading.html');

app.use(express.json());
app.get('/preview-loading.html', (req, res) => res.sendFile(previewLoadingPage));

// Route modules — each registers its own handlers on `app`.
require('./server/routes/translate').register(app);
require('./server/routes/blueprint').register(app);
require('./server/routes/scripts').register(app);
require('./server/routes/directions').register(app);
require('./server/routes/runner').register(app);
require('./server/routes/recordings').register(app);
require('./server/routes/previews').register(app);
require('./server/routes/plugins').register(app);
require('./server/routes/themes').register(app);

const PORT = process.env.PORT || DEFAULT_SERVER_PORT;

async function mountFrontend() {
  const distDir = path.join(__dirname, 'dist/public');
  const distIndex = path.join(distDir, 'index.html');

  if (process.env.NODE_ENV === 'production') {
    if (!fs.existsSync(distIndex)) {
      throw new Error('Production frontend build not found. Run `npm run build` before starting with NODE_ENV=production.');
    }

    app.use(express.static(distDir));
    app.get('*', (req, res) => res.sendFile(distIndex));
    return;
  }

  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(__dirname, 'vite.config.js'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

async function start() {
  await mountFrontend();

  app.listen(PORT, () => {
    console.log(`WP Director at http://localhost:${PORT}`);

    // Pre-warm both Playground slots so the first recording starts immediately
    // without waiting for a cold boot.
    const blueprintPath = fs.existsSync(GENERATED_BLUEPRINT) ? GENERATED_BLUEPRINT : DEFAULT_BLUEPRINT;
    require('./server/playground-server').init(blueprintPath).catch((err) => {
      console.error('[Playground Pool] Failed to initialise:', err.message);
    });
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
