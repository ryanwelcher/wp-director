// @ts-check

/**
 * WP Playground process lifecycle — start and stop the local Playground
 * servers used for recording (ports 9400/9401) and preview (port 9410).
 *
 * ## PID coordination with Playwright
 *
 * There are two paths that can start Playground:
 *   1. This server, when a recording run needs a (possibly custom) blueprint.
 *   2. Playwright's `global-setup.js`, when a recording is launched from the
 *      CLI with no server involvement.
 *
 * Server mode keeps 2 playground processes alive until it is killed.
 * This is done for performance reasons so that a freshly restarted
 * instance is always available for a new recording or preview.
 * CLI mode runs its own separate playground process until it finishes.
 *
 * ## Gotchas
 *
 * - `--login` is passed to the CLI regardless of blueprint contents so the
 *   admin session is pre-authenticated for recordings.
 * - Killing Playground deletes the PID file; startPlayground writes it only
 *   *after* "Ready!" is observed, so the window where a stale PID could be
 *   read by a concurrent global-setup is minimized.
 * - The CLI binds to `127.0.0.1`, not `localhost`. Anything connecting must
 *   use the literal IP (the Playwright config does).
 */

const fs = require('fs');
const { spawn } = require('child_process');
const {
  ROOT,
  PREVIEW_PID_FILE,
  PREVIEW_PLAYGROUND_PORT,
  PLAYGROUND_READY_TIMEOUT_MS,
} = require('./config');

/**
 * @typedef {Object} SseEvent
 * @property {'stdout'|'stderr'} type
 * @property {string} text
 */

/**
 * SIGTERM whatever process the PID file points at, then delete the file.
 * No-op if the file doesn't exist or the process is already dead.
 *
 * @param {string} pidFile  Path to the PID file for the target instance.
 */
function killPid(pidFile) {
  if (!fs.existsSync(pidFile)) return;
  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
  try { process.kill(pid, 'SIGTERM'); } catch {}
  fs.unlinkSync(pidFile);
}

/**
 * Spawn a `@wp-playground/cli server` process on the given port, waiting for
 * "Ready!" on stdout before resolving. On resolution, the child's PID is
 * written to `pidFile` so global-setup can reuse it.
 *
 * Stdout/stderr are optionally streamed to the caller via `onData` — used by
 * SSE route handlers to forward Playground logs to the UI.
 *
 * @param {Object} opts
 * @param {number} opts.port                                 Port to bind.
 * @param {string} opts.blueprintPath                        Absolute path to the blueprint JSON to load.
 * @param {string} opts.pidFile                              Where to write the child PID once Ready.
 * @param {((event: SseEvent) => void) | null} [opts.onData] Optional callback for log forwarding.
 * @returns {Promise<void>}
 */
function startPlayground({ port, blueprintPath, pidFile, onData = null }) {
  return new Promise((resolve, reject) => {
    const server = spawn(
      'npx',
      ['@wp-playground/cli', 'server', `--port=${port}`, '--login', `--blueprint=${blueprintPath}`],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT }
    );

    const timeout = setTimeout(
      () => reject(new Error(`WP Playground did not start within ${PLAYGROUND_READY_TIMEOUT_MS / 1000}s`)),
      PLAYGROUND_READY_TIMEOUT_MS
    );

    server.stdout.on('data', (data) => {
      const text = data.toString();
      onData?.({ type: 'stdout', text: `[WP Playground] ${text}` });
      if (text.includes('Ready!')) {
        clearTimeout(timeout);
        fs.writeFileSync(pidFile, server.pid.toString());
        resolve();
      }
    });

    server.stderr.on('data', (data) => {
      onData?.({ type: 'stderr', text: `[WP Playground] ${data}` });
    });

    server.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

/**
 * Stop the preview Playground (port 9410), if running.
 */
function killPreviewPlayground() {
  killPid(PREVIEW_PID_FILE);
}

/**
 * Start the preview Playground on port 9410 (the "Test in Playground"
 * sandbox). Intentionally does NOT stream logs — preview is a throwaway
 * instance opened in a new tab; its output isn't surfaced in the UI.
 *
 * @param {string} blueprintPath  Absolute blueprint path.
 * @returns {Promise<void>}
 */
function startPreviewPlayground(blueprintPath) {
  return startPlayground({
    port: PREVIEW_PLAYGROUND_PORT,
    blueprintPath,
    pidFile: PREVIEW_PID_FILE,
  });
}

module.exports = {
  killPreviewPlayground,
  startPreviewPlayground,
  killPid,
  startPlayground,
};
