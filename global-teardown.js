// @ts-check
/**
 * Playwright globalTeardown hook — runs once after all tests finish.
 *
 * SIGTERMs all known WP Playground processes (both recording slots and the
 * preview sandbox) by reading their PID files, then removes the files.
 *
 * Only applies to CLI-launched test runs. When the Express server spawns
 * Playwright, playground-pool.js owns the Playground lifecycle and sets
 * WP_DIRECTOR_SERVER=1 — in that case this hook returns immediately so it
 * does not kill warm pool slots.
 */
const fs = require('fs');
const {
  RECORDING_1_PID_FILE,
  RECORDING_2_PID_FILE,
  PREVIEW_PID_FILE,
} = require('./src/config');

const PID_FILES = [RECORDING_1_PID_FILE, RECORDING_2_PID_FILE, PREVIEW_PID_FILE];

/**
 * SIGTERM the process identified by `pidFile` (if the file exists and the
 * process is alive), then delete the file.
 *
 * @param {string} pidFile
 */
function killFromPidFile(pidFile) {
  if (!fs.existsSync(pidFile)) return;
  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
  try {
    process.kill(pid);
    console.log(`\n[WP Playground] Server stopped (pid ${pid})\n`);
  } catch {
    // already dead
  }
  fs.unlinkSync(pidFile);
}

/** @returns {Promise<void>} */
module.exports = async function globalTeardown() {
  // When Playwright is spawned by the Express server, playground-pool.js owns
  // the Playground lifecycle. Tearing it down here would kill warm pool slots.
  if (process.env.WP_DIRECTOR_SERVER === '1') return;

  for (const pidFile of PID_FILES) {
    killFromPidFile(pidFile);
  }
};
