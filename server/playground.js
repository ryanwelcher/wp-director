// @ts-check

/**
 * WP Playground process lifecycle — start and stop the local Playground
 * servers used for recording (ports 9406-9410) and preview (port 9400).
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

const path = require('path');
const { spawn } = require('child_process');
const {
  ROOT,
  PREVIEW_PLAYGROUND_PORT,
  PLAYGROUND_READY_TIMEOUT_MS,
} = require('./config');

// How long to wait after SIGTERM before escalating to SIGKILL.
const KILL_GRACE_MS = 5_000;

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
 * Send SIGTERM, wait up to KILL_GRACE_MS, then escalate to SIGKILL if needed.
 * Resolves when the process has fully exited.
 *
 * @param {import('child_process').ChildProcess | null | undefined} proc
 * @returns {Promise<void>}
 */
async function killAndWait(proc) {
  if (!proc) return;
  if (proc.exitCode !== null) return;

  return new Promise((resolve) => {
    proc.once('close', resolve);
    try { proc.kill('SIGTERM'); } catch { resolve(); return; }

    const escalate = setTimeout(() => {
      console.warn('[Playground] SIGTERM grace period expired — sending SIGKILL');
      try { proc.kill('SIGKILL'); } catch {}
    }, KILL_GRACE_MS);

    proc.once('close', () => clearTimeout(escalate));
  });
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

    let settled = false;

    function settle(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.removeListener('close', onEarlyClose);
      fn(value);
    }

    const timeout = setTimeout(
      () => settle(reject, new Error(`WP Playground did not start within ${PLAYGROUND_READY_TIMEOUT_MS / 1000}s`)),
      PLAYGROUND_READY_TIMEOUT_MS
    );

    // Accumulate output so onEarlyClose and the stdout handler can both read them.
    let stdoutBuf = '';
    let stderrBuf = '';

    // Fail fast if the process exits before signaling ready.
    function onEarlyClose(code) {
      const out = stdoutBuf.trim();
      const err = stderrBuf.trim();
      const detail = [out, err].filter(Boolean).join('\n');
      settle(reject, new Error(`WP Playground exited prematurely (code ${code}) before signaling ready${detail ? `\n${detail}` : ''}`));
    }

    server.once('close', onEarlyClose);

    server.stdout.on('data', (data) => {
      const chunk = data.toString();
      onData?.({ type: 'stdout', text: `[WP Playground] ${chunk}` });
      stdoutBuf += chunk;
      if (!settled && stdoutBuf.includes('Ready!')) {
        settle(resolve, server);
      }
    });

    // Accumulate stderr so it can be included in early-exit error messages.
    server.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderrBuf += chunk;
      onData?.({ type: 'stderr', text: `[WP Playground] ${chunk}` });
    });

    server.on('error', (err) => settle(reject, err));
  });
}

/**
 * Stop the preview Playground (port 9400), if running.
 */
function killPreviewPlayground() {
  killProcess(previewProc);
  previewProc = null;
}

/**
 * Start the preview Playground on port 9400 (the "Test in Playground"
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
  killAndWait,
  startPlayground,
};
