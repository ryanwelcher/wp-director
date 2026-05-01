// @ts-check

/**
 * CLI-mode WP Playground lifecycle.
 *
 * Handles everything needed when Playwright is run directly from the command
 * line (i.e. NOT through the server). Responsibilities:
 *
 *   - Find the first available port in the CLI range (9450–9499).
 *   - Spawn a non-detached Playground instance tied to this process.
 *   - Wait for "Ready!" before resolving so tests don't start too early.
 *   - Store the child process in memory so teardown can kill it cleanly.
 *
 * The in-memory state (previously `cli-playground-state.js`) lives here so
 * both start() and kill() share the same process reference without any file
 * I/O or module indirection.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const {
  ROOT,
  CLI_PLAYGROUND_PORT_MIN,
  CLI_PLAYGROUND_PORT_MAX,
  GENERATED_BLUEPRINT,
  DEFAULT_BLUEPRINT,
  PLAYGROUND_READY_TIMEOUT_MS,
} = require('./config');

/** @type {import('child_process').ChildProcess | null} */
let proc = null;

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2_000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error',   () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * @param {number} min
 * @param {number} max
 * @returns {Promise<number>}
 */
async function findAvailablePort(min, max) {
  for (let port = min; port <= max; port++) {
    if (!await isPortInUse(port)) return port;
  }
  throw new Error(`No available CLI Playground port in range ${min}–${max}`);
}

/**
 * Find a free CLI port, spawn a Playground instance on it, wait for "Ready!",
 * and set `process.env.WP_DIRECTOR_PLAYGROUND_PORT` so Playwright workers pick
 * up the correct baseURL from `playwright.config.js`.
 *
 * @returns {Promise<void>}
 */
async function start() {
  const port = await findAvailablePort(CLI_PLAYGROUND_PORT_MIN, CLI_PLAYGROUND_PORT_MAX);
  const blueprintPath = fs.existsSync(GENERATED_BLUEPRINT) ? GENERATED_BLUEPRINT : DEFAULT_BLUEPRINT;

  // Propagate to worker processes so playwright.config.js uses the right baseURL.
  process.env.WP_DIRECTOR_PLAYGROUND_PORT = String(port);

  console.log(`\n[WP Playground] Starting CLI instance on port ${port}...\n`);

  proc = spawn(
    'npx',
    ['@wp-playground/cli', 'server', `--port=${port}`, '--login', `--blueprint=${blueprintPath}`],
    { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT }
  );

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`WP Playground did not start within ${PLAYGROUND_READY_TIMEOUT_MS / 1000}s`)),
      PLAYGROUND_READY_TIMEOUT_MS
    );

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(`[WP Playground] ${text}`);
      if (text.includes('Ready!')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.stderr.on('data', (data) => {
      process.stderr.write(`[WP Playground] ${data}`);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log(`\n[WP Playground] Ready at http://127.0.0.1:${port} (pid ${proc.pid})\n`);
}

/**
 * Kill the CLI Playground instance started by `start()`, if any.
 */
function kill() {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch {}
  proc = null;
}

module.exports = { start, kill };
