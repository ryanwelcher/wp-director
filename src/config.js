// @ts-check

/**
 * Shared paths, ports, and constants.
 *
 * All paths are absolute and computed relative to the project root (one level
 * up from src/). Modules should import from here rather than recomputing paths,
 * so there's a single source of truth for filesystem layout.
 *
 * Two PID files coordinate WP Playground lifecycles between this server and
 * Playwright's global-setup.js:
 *   - .wp-playground.pid            — main recording Playground (port 9400)
 *   - .wp-playground-preview.pid    — "Test in Playground" sandbox (port 9401)
 *
 * global-setup.js reads PID_FILE and reuses the running Playground if alive,
 * which is how a UI-triggered run survives being re-entered by Playwright.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,

  // Directories
  PUBLIC_DIR: path.join(ROOT, 'public'),
  STEPS_DIR:  path.join(ROOT, 'scripts'),
  OUTPUT_DIR: path.join(ROOT, 'output'),

  // PID files (coordinated with global-setup.js / global-teardown.js)
  PID_FILE:         path.join(ROOT, '.wp-playground.pid'),
  PREVIEW_PID_FILE: path.join(ROOT, '.wp-playground-preview.pid'),

  // Blueprint files
  DEFAULT_BLUEPRINT:   path.join(ROOT, 'blueprints', 'blueprint.json'),           // checked-in default
  GENERATED_BLUEPRINT: path.join(ROOT, 'blueprints', 'blueprint.generated.json'), // last UI-customized (gitignored)
  PREVIEW_BLUEPRINT:   path.join(ROOT, 'blueprints', 'blueprint.preview.json'),   // for port-9401 sandbox (gitignored)

  // Ports
  PLAYGROUND_PORT:         9400, // main WP (Playwright baseURL in playwright.config.js)
  PREVIEW_PLAYGROUND_PORT: 9401, // "Test in Playground" sandbox
  CHROME_DEBUG_PORT:       9222, // Chrome remote-debugging (launched by playwright.config.js)
  DEFAULT_SERVER_PORT:     3000, // Express UI port (overridable via PORT env var)

  // Playground-ready timeout
  PLAYGROUND_READY_TIMEOUT_MS: 120_000,
};
