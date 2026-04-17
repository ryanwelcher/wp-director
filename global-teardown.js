// @ts-check
const fs = require('fs');
const path = require('path');

const PID_FILE = path.join(__dirname, '.wp-playground.pid');

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
