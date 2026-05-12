// @ts-check

/**
 * Shared paths, ports, and constants.
 *
 * All paths are absolute and computed relative to the project root (one level
 * up from server/). Modules should import from here rather than recomputing paths,
 * so there's a single source of truth for filesystem layout.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,

  // Directories
  STEPS_DIR:               path.join(ROOT, 'scripts'),
  OUTPUT_DIR:              path.join(ROOT, 'output'),
  PLAYWRIGHT_OUTPUT_DIR:   path.join(ROOT, 'output', '.playwright'),
  PREVIEW_OUTPUT_DIR:      path.join(ROOT, 'output', '.previews'),
  DIRECTIONS_DIR:          path.join(ROOT, 'directions'),
  BUILTIN_DIRECTIONS_DIR:  path.join(__dirname, 'directions'),

  // Blueprint files
  DEFAULT_BLUEPRINT:   path.join(ROOT, 'blueprints', 'blueprint.json'),           // checked-in default
  GENERATED_BLUEPRINT: path.join(ROOT, 'blueprints', 'blueprint.generated.json'), // last UI-customized (gitignored)
  PREVIEW_BLUEPRINT:   path.join(ROOT, 'blueprints', 'blueprint.preview.json'),   // for port-9400 sandbox (gitignored)

  // Ports
  DEFAULT_SERVER_PORT:           3000, // Express UI port (overridable via PORT env var)
  PREVIEW_PLAYGROUND_PORT:       9400, // "Test in Playground" sandbox
  RECORDING_PLAYGROUND_PORT_MIN: 9406, // Server-mode recording pool starts here
  RECORDING_PLAYGROUND_PORT_MAX: 9410, // Server-mode recording pool grows up to here
  CLI_PLAYGROUND_PORT_MIN:       9450, // CLI recording instances use this range (never conflicts with server)
  CLI_PLAYGROUND_PORT_MAX:       9499,

  // Playground-ready timeout
  PLAYGROUND_READY_TIMEOUT_MS: 120_000,

  // Filename validation — safe on-disk names for scripts and directions
  SAFE_FILENAME_RE: /^[a-z0-9-]+\.json$/i,
};
