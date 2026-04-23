// @ts-check
/**
 * Playwright globalSetup hook — runs once before the test suite starts.
 *
 * Server path (WP_DIRECTOR_SERVER=1): playground-pool.js has already booted
 * both recording slots and written their PID files. Nothing to do here.
 *
 * CLI path (npm run record):
 *   - If recording instances are already running (e.g. server.js is active),
 *     reuse them and update PID files so teardown can clean up.
 *   - If not running, delegate to playground-pool.init() which boots both
 *     recording slots fresh and writes PID files.
 */
const fs = require('fs');
const net = require('net');
const {
  RECORDING_PLAYGROUND_1_PORT,
  GENERATED_BLUEPRINT,
  DEFAULT_BLUEPRINT,
} = require('./src/config');
const pool = require('./src/playground-pool');

/**
 * Check whether something is listening on `port` by attempting a TCP connect.
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


/** @returns {Promise<void>} */
module.exports = async function globalSetup() {
  // Server path: playground-pool.js already manages the instances.
  if (process.env.WP_DIRECTOR_SERVER === '1') return;

  const blueprintPath = fs.existsSync(GENERATED_BLUEPRINT) ? GENERATED_BLUEPRINT : DEFAULT_BLUEPRINT;

  // If the primary recording slot is already up (e.g. server.js is running),
  // reuse the existing instances. The server owns their PID files, so don't
  // touch them here.
  if (await isPortInUse(RECORDING_PLAYGROUND_1_PORT)) {
    console.log('\n[WP Playground] Reusing existing recording instances\n');
    return;
  }

  // No instances running — boot both recording slots fresh via the pool.
  await pool.init(blueprintPath);
};
