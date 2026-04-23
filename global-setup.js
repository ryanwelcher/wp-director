// @ts-check
/**
 * Playwright globalSetup hook — runs once before the test suite starts.
 *
 * Server path (WP_DIRECTOR_SERVER=1): playground-pool.js has already booted
 * both recording slots. Nothing to do here.
 *
 * CLI path (npm run record): scans the CLI port range (9450-9499) for the
 * first available port, boots a non-detached Playground instance on it, and
 * stores the child process in cli-playground-state.js so global-teardown can
 * kill it. Setting process.env.WP_DIRECTOR_PLAYGROUND_PORT here propagates to
 * Playwright worker processes (which are forked after globalSetup) so they
 * pick up the correct baseURL from playwright.config.js.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const {
  CLI_PLAYGROUND_PORT_MIN,
  CLI_PLAYGROUND_PORT_MAX,
  GENERATED_BLUEPRINT,
  DEFAULT_BLUEPRINT,
} = require('./src/config');
const cliState = require('./src/cli-playground-state');

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2_000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
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

/** @returns {Promise<void>} */
module.exports = async function globalSetup() {
  // Server path: playground-pool.js already manages the instances.
  if (process.env.WP_DIRECTOR_SERVER === '1') return;

  const port = await findAvailablePort(CLI_PLAYGROUND_PORT_MIN, CLI_PLAYGROUND_PORT_MAX);
  const blueprintPath = fs.existsSync(GENERATED_BLUEPRINT) ? GENERATED_BLUEPRINT : DEFAULT_BLUEPRINT;

  // Propagate to worker processes so playwright.config.js uses the right baseURL.
  process.env.WP_DIRECTOR_PLAYGROUND_PORT = String(port);

  console.log(`\n[WP Playground] Starting CLI instance on port ${port}...\n`);

  // Spawn without detached/unref so the process is tied to this Playwright run.
  const server = spawn(
    'npx',
    ['@wp-playground/cli', 'server', `--port=${port}`, '--login', `--blueprint=${blueprintPath}`],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  cliState.set(server);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('WP Playground did not start within 120s')),
      120_000
    );

    server.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(`[WP Playground] ${text}`);
      if (text.includes('Ready!')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    server.stderr.on('data', (data) => {
      process.stderr.write(`[WP Playground] ${data}`);
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log(`\n[WP Playground] Ready at http://127.0.0.1:${port} (pid ${server.pid})\n`);
};
