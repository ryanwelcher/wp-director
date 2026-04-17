// @ts-check
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PID_FILE = path.join(__dirname, '.wp-playground.pid');

module.exports = async function globalSetup() {
  // Skip if a server is already running (local reuse)
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
    try {
      process.kill(pid, 0); // check if process is alive
      console.log(`\n[WP Playground] Reusing existing server (pid ${pid})\n`);
      return;
    } catch {
      fs.unlinkSync(PID_FILE); // stale PID, clean up
    }
  }

  console.log('\n[WP Playground] Starting server...\n');

  const server = spawn(
    'npx',
    ['@wp-playground/cli', 'server', '--port=9400', '--login', '--blueprint=./blueprint.json'],
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
  console.log(`\n[WP Playground] Ready at http://127.0.0.1:9400 (pid ${server.pid})\n`);
};
