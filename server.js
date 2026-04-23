// @ts-check

/**
 * WP Director — Express bootstrap.
 *
 * Thin entry point. The real work lives in `src/`:
 *
 *   src/config.js       — paths, ports, constants
 *   src/claude.js       — Anthropic client + STEPS_PROMPT + STEPS_TOOL
 *   src/playground.js   — WP Playground process lifecycle
 *   src/video.js        — ffmpeg conversion + video discovery
 *   src/routes/*.js     — one file per API area; each exports register(app)
 *
 * This file loads environment variables, configures Express, mounts each
 * route module, and starts listening. Adding a new API area means dropping
 * a new `src/routes/<area>.js` and adding one line below.
 */

require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { PUBLIC_DIR, DEFAULT_SERVER_PORT, DEFAULT_BLUEPRINT, GENERATED_BLUEPRINT } = require('./src/config');

const app = express();

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Route modules — each registers its own handlers on `app`.
require('./src/routes/translate').register(app);
require('./src/routes/blueprint').register(app);
require('./src/routes/scripts').register(app);
require('./src/routes/directions').register(app);
require('./src/routes/runner').register(app);
require('./src/routes/recordings').register(app);
require('./src/routes/screencast').register(app);

const PORT = process.env.PORT || DEFAULT_SERVER_PORT;
app.listen(PORT, () => {
  console.log(`WP Director at http://localhost:${PORT}`);

  // Pre-warm both Playground slots so the first recording starts immediately
  // without waiting for a cold boot.
  const blueprintPath = fs.existsSync(GENERATED_BLUEPRINT) ? GENERATED_BLUEPRINT : DEFAULT_BLUEPRINT;
  require('./src/playground-pool').init(blueprintPath).catch((err) => {
    console.error('[Pool] Failed to initialise:', err.message);
  });
});
