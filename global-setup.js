// @ts-check
/**
 * Playwright globalSetup hook — runs once before the test suite starts.
 *
 * Starts a WP Playground server on port 9400. If a Playground is already
 * listening (e.g. started by the Express server via `playground.js`), this
 * hook reuses it by writing its PID to the PID file and returning early.
 * This is the main coordination point that lets `npm start` + `npm run record`
 * share the same Playground process.
 *
 * Three execution paths:
 *  1. Port is occupied and responding → reuse; write PID, return.
 *  2. Port is occupied but not responding → kill the orphan, then start fresh.
 *  3. Port is free → start fresh.
 *
 * Playground is spawned detached + unref'd so it outlives the Playwright
 * worker process (global-teardown.js kills it by PID when tests finish).
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const PID_FILE = path.join(__dirname, '.wp-playground-recording-1.pid');
const PORT = parseInt(process.env.WP_DIRECTOR_PLAYGROUND_PORT ?? '9400');

/**
 * Check whether something is listening on `port` by attempting a TCP connect.
 * The 2s timeout prevents hanging if a port accepts connections but never
 * sends a response (e.g. a crashed process holding the socket).
 *
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
 * Return the PID of the process listening on `port`, or null if none.
 * Uses `lsof` — macOS/Linux only.
 *
 * @param {number} port
 * @returns {number|null}
 */
function getPidOnPort(port) {
  try {
    const out = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
    return out ? parseInt(out.split('\n')[0]) : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<void>} */
module.exports = async function globalSetup() {
  if (await isPortInUse(PORT)) {
    const pid = getPidOnPort(PORT);
    if (pid) fs.writeFileSync(PID_FILE, pid.toString());
    console.log(`\n[WP Playground] Reusing existing server (pid ${pid ?? 'unknown'})\n`);
    return;
  }

  // Kill any orphaned process holding the port but not responding
  const orphan = getPidOnPort(PORT);
  if (orphan) {
    try { process.kill(orphan); } catch {}
    console.log(`\n[WP Playground] Killed orphaned process (pid ${orphan})\n`);
  }

  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);

  console.log('\n[WP Playground] Starting server...\n');

  const blueprintPath = fs.existsSync(path.join(__dirname, 'blueprints', 'blueprint.generated.json'))
    ? './blueprints/blueprint.generated.json'
    : './blueprints/blueprint.json';

  const server = spawn(
    'npx',
    ['@wp-playground/cli', 'server', `--port=${PORT}`, '--login', `--blueprint=${blueprintPath}`],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true }
  );

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

  fs.writeFileSync(PID_FILE, server.pid.toString());
  server.unref();
  console.log(`\n[WP Playground] Ready at http://127.0.0.1:${PORT} (pid ${server.pid})\n`);
};
