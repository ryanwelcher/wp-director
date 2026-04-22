// @ts-check
/**
 * Playwright globalTeardown hook — runs once after all tests finish.
 *
 * SIGTERMs the WP Playground process whose PID was recorded by
 * `global-setup.js` and removes the PID file. Only applies to CLI-launched
 * test runs; when the Express server starts Playground, it owns the lifecycle
 * and teardown is handled by `playground.js` instead.
 */
const fs = require('fs');
const path = require('path');

const PID_FILE = path.join(__dirname, '.wp-playground.pid');

/** @returns {Promise<void>} */
module.exports = async function globalTeardown() {
  if (!fs.existsSync(PID_FILE)) return;

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
  try {
    process.kill(pid);
    console.log(`\n[WP Playground] Server stopped (pid ${pid})\n`);
  } catch {
    // already dead
  }

  fs.unlinkSync(PID_FILE);
};
