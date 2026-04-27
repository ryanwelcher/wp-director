// @ts-check

/**
 * WP Playground process lifecycle — start and stop the local Playground
 * servers used for recording (ports 9400/9401) and preview (port 9410).
 *
 * Server mode keeps 2 playground processes alive until it is killed. This is
 * done for performance reasons so that a freshly restarted instance is always
 * available for a new recording or preview. CLI mode runs its own separate
 * playground process until it finishes.
 *
 * ## Gotchas
 *
 * - `--login` is passed to the CLI regardless of blueprint contents so the
 *   admin session is pre-authenticated for recordings.
 * - The CLI binds to `127.0.0.1`, not `localhost`. Anything connecting must
 *   use the literal IP (the Playwright config does).
 */

const { spawn } = require('child_process');
const {
  ROOT,
  PREVIEW_PLAYGROUND_PORT,
  PLAYGROUND_READY_TIMEOUT_MS,
} = require('./config');

/** @type {import('child_process').ChildProcess | null} */
let previewProc = null;

/**
 * @typedef {Object} SseEvent
 * @property {'stdout'|'stderr'} type
 * @property {string} text
 */

/**
 * SIGTERM a child process if it is still running.
 *
 * @param {import('child_process').ChildProcess | null | undefined} proc
 */
function killProcess(proc) {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch {}
}

/**
 * Spawn a `@wp-playground/cli server` process on the given port, waiting for
 * "Ready!" on stdout before resolving.
 *
 * Stdout/stderr are optionally streamed to the caller via `onData` — used by
 * SSE route handlers to forward Playground logs to the UI.
 *
 * @param {Object} opts
 * @param {number} opts.port                                 Port to bind.
 * @param {string} opts.blueprintPath                        Absolute path to the blueprint JSON to load.
 * @param {((event: SseEvent) => void) | null} [opts.onData] Optional callback for log forwarding.
 * @returns {Promise<import('child_process').ChildProcess>}
 */
function startPlayground({ port, blueprintPath, onData = null }) {
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
        resolve(server);
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
  killProcess(previewProc);
  previewProc = null;
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
  }).then((proc) => {
    previewProc = proc;
    proc.on('close', () => {
      if (previewProc === proc) previewProc = null;
    });
  });
}

module.exports = {
  killPreviewPlayground,
  startPreviewPlayground,
  killProcess,
  startPlayground,
};
