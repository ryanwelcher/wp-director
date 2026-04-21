// @ts-check

/**
 * Test-runner endpoints.
 *
 *   POST /api/run        → save + run a single recording, stream logs over SSE
 *   POST /api/run/batch  → run multiple saved recordings, stream logs over SSE
 *
 * Both endpoints:
 *   1. (Optional) restart WP Playground with a custom blueprint if one is
 *      posted. The server kills the existing Playground, writes the blueprint
 *      to `blueprint.generated.json`, and starts a new instance with it. When
 *      Playwright's global-setup.js runs next, it sees the already-running
 *      Playground via the PID file and reuses it.
 *   2. Spawn `npx playwright test recordings/steps-runner.spec.js --grep …`
 *      where the grep pattern isolates the script(s) to run from everything
 *      else in the scripts/ directory.
 *   3. Pipe stdout/stderr back to the client as SSE events.
 *   4. After Playwright exits 0, run the ffmpeg post-process step to produce
 *      an MP4 (and scale if the user picked a non-1080p size).
 *
 * ## SSE event contract
 *
 *   { type: 'stdout', text: string }  — log line from Playground/Playwright/ffmpeg
 *   { type: 'stderr', text: string }  — error line
 *   { type: 'done',   code: number, file?: string }  — terminal event; client closes
 *
 * The client (public/app.js) treats anything non-`done` as log output.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  ROOT,
  STEPS_DIR,
  GENERATED_BLUEPRINT,
} = require('../config');
const { killPlayground, startMainPlayground } = require('../playground');
const { processVideo } = require('../video');
const { nameToFilename } = require('./scripts');

/** @type {import('child_process').ChildProcess|null} */
let currentProc = null;

/**
 * Set the three headers required to keep an SSE stream open.
 *
 * @param {import('express').Response} res
 */
function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

/**
 * Build a function that writes a JSON event to the SSE stream.
 *
 * @param {import('express').Response} res
 * @returns {(data: any) => void}
 */
function sseSender(res) {
  return (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * If the request included a `blueprint`, write it to
 * `blueprint.generated.json`, kill any existing Playground, and start a new
 * one loaded with the new blueprint. Streams status back via `send`.
 *
 * On failure, emits a `done` event with code 1 and closes the response. The
 * caller should check the return value and abort if false.
 *
 * @param {any}  blueprint  The blueprint object (or falsy to skip).
 * @param {(data: any) => void} send
 * @param {import('express').Response} res
 * @returns {Promise<boolean>}  true if OK to continue, false if we aborted.
 */
async function maybeRestartPlayground(blueprint, send, res) {
  if (!blueprint) return true;
  try {
    send({ type: 'stdout', text: '[Blueprint] Restarting WP Playground with custom blueprint…\n' });
    fs.writeFileSync(GENERATED_BLUEPRINT, JSON.stringify(blueprint, null, 2));
    killPlayground();
    await startMainPlayground(GENERATED_BLUEPRINT, send);
    send({ type: 'stdout', text: '[Blueprint] WP Playground ready.\n' });
    return true;
  } catch (err) {
    send({ type: 'stderr', text: `[Blueprint] Failed to start WP Playground: ${err.message}\n` });
    send({ type: 'done', code: 1 });
    res.end();
    return false;
  }
}

/**
 * Spawn Playwright for a given grep pattern and pipe its output into the SSE
 * stream. After Playwright exits 0, run the video post-process step.
 *
 * @param {Object} opts
 * @param {string} opts.grepPattern         Regex pattern passed to `playwright --grep`.
 * @param {any}    opts.videoSize           Target size for ffmpeg scaling.
 * @param {(data: any) => void} opts.send   SSE writer.
 * @param {import('express').Response} opts.res
 * @param {Object} [opts.doneExtra]         Extra fields merged into the final `done` event.
 */
function runPlaywright({ grepPattern, videoSize, send, res, doneExtra = {}, preview = false }) {
  const env = { ...process.env };
  if (preview) env.WP_DIRECTOR_PREVIEW = '1';

  const proc = spawn(
    'npx', ['playwright', 'test', 'recordings/steps-runner.spec.js', '--grep', grepPattern],
    { cwd: ROOT, env }
  );

  currentProc = proc;

  proc.stdout.on('data', (d) => send({ type: 'stdout', text: d.toString() }));
  proc.stderr.on('data', (d) => send({ type: 'stderr', text: d.toString() }));
  proc.on('close', async (code, signal) => {
    currentProc = null;
    if (signal) {
      send({ type: 'done', code: 1, stopped: true });
    } else {
      if (code === 0 && !preview) await processVideo(videoSize, send);
      send({ type: 'done', code, ...doneExtra });
    }
    res.end();
  });
}

function register(app) {
  app.post('/api/stop', (req, res) => {
    if (currentProc) {
      currentProc.kill('SIGTERM');
      res.json({ ok: true });
    } else {
      res.json({ ok: false, reason: 'no process running' });
    }
  });

  // Single-recording run: write the posted steps to a file, then grep for
  // exactly this recording by its `name`.
  app.post('/api/run', async (req, res) => {
    const { name = `recording-${Date.now()}`, steps = [], blueprint = null, videoSize = null, preview = false } = req.body;
    if (!steps.length) return res.status(400).json({ error: 'no steps provided' });

    if (!fs.existsSync(STEPS_DIR)) fs.mkdirSync(STEPS_DIR);
    const filename = nameToFilename(name);
    const filePath = path.join(STEPS_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify({ name, steps }, null, 2));

    sseHeaders(res);
    const send = sseSender(res);

    if (!(await maybeRestartPlayground(blueprint, send, res))) return;

    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    runPlaywright({
      grepPattern: `${escapedName}$`,
      videoSize,
      send,
      res,
      doneExtra: preview ? {} : { file: filePath },
      preview,
    });
  });

  // Batch run: take an array of saved recording names, escape for regex, join
  // as alternation so Playwright matches any of them.
  app.post('/api/run/batch', async (req, res) => {
    const { names = [], blueprint = null, videoSize = null } = req.body;
    if (!names.length) return res.status(400).json({ error: 'no scripts selected' });

    sseHeaders(res);
    const send = sseSender(res);

    if (!(await maybeRestartPlayground(blueprint, send, res))) return;

    const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const grepPattern = `(${escaped.join('|')})`;

    runPlaywright({ grepPattern, videoSize, send, res });
  });
}

module.exports = { register };
