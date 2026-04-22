// @ts-check
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const PID_FILE = path.join(__dirname, '.wp-playground.pid');
const PORT = 9400;

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

function getPidOnPort(port) {
  try {
    const out = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
    return out ? parseInt(out.split('\n')[0]) : null;
  } catch {
    return null;
  }
}

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
