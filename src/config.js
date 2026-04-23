// @ts-check

/**
 * Shared paths, ports, and constants.
 *
 * All paths are absolute and computed relative to the project root (one level
 * up from src/). Modules should import from here rather than recomputing paths,
 * so there's a single source of truth for filesystem layout.
 *
 * Three PID files coordinate WP Playground lifecycles between this server and
 * Playwright's global-setup.js:
 *   - .wp-playground-recording-1.pid  — pool slot 1 (port 9400)
 *   - .wp-playground-recording-2.pid  — pool slot 2 (port 9401)
 *   - .wp-playground-preview.pid      — "Test in Playground" sandbox (port 9410)
 *
 * global-setup.js reads RECORDING_1_PID_FILE (slot 1) and reuses the running Playground
 * if alive, which is how a UI-triggered run survives being re-entered by Playwright.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,

  // Directories
  PUBLIC_DIR:              path.join(ROOT, 'public'),
  STEPS_DIR:               path.join(ROOT, 'scripts'),
  OUTPUT_DIR:              path.join(ROOT, 'output'),
  DIRECTIONS_DIR:          path.join(ROOT, 'directions'),
  BUILTIN_DIRECTIONS_DIR:  path.join(__dirname, 'directions'),

  // PID files (coordinated with global-setup.js / global-teardown.js)
  RECORDING_1_PID_FILE: path.join(ROOT, '.wp-playground-recording-1.pid'),
  RECORDING_2_PID_FILE: path.join(ROOT, '.wp-playground-recording-2.pid'),
  PREVIEW_PID_FILE:     path.join(ROOT, '.wp-playground-preview.pid'),

  // Blueprint files
  DEFAULT_BLUEPRINT:   path.join(ROOT, 'blueprints', 'blueprint.json'),           // checked-in default
  GENERATED_BLUEPRINT: path.join(ROOT, 'blueprints', 'blueprint.generated.json'), // last UI-customized (gitignored)
  PREVIEW_BLUEPRINT:   path.join(ROOT, 'blueprints', 'blueprint.preview.json'),   // for port-9410 sandbox (gitignored)

  // Ports
  RECORDING_PLAYGROUND_1_PORT: 9400, // Recording pool slot 1
  RECORDING_PLAYGROUND_2_PORT: 9401, // Recording pool slot 2
  PREVIEW_PLAYGROUND_PORT:     9410, // "Test in Playground" sandbox
  CHROME_DEBUG_PORT:           9222, // Chrome remote-debugging (launched by playwright.config.js)
  DEFAULT_SERVER_PORT:         3000, // Express UI port (overridable via PORT env var)

  // Playground-ready timeout
  PLAYGROUND_READY_TIMEOUT_MS: 120_000,

  // Filename validation — safe on-disk names for scripts and directions
  SAFE_FILENAME_RE: /^[a-z0-9-]+\.json$/i,
};
