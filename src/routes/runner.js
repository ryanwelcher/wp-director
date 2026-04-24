// @ts-check

/**
 * Test-runner endpoints.
 *
 *   POST /api/run        → save + run a single recording, stream logs over SSE
 *   POST /api/run/batch  → run multiple saved recordings, stream logs over SSE
 *
 * Both endpoints:
 *   1. Determine the active blueprint path (from the posted blueprint object
 *      or from the last-saved generated blueprint / default).
 *   2. Call pool.acquire() to get a warm Playground port immediately — no wait
 *      on the common path where the blueprint has not changed. On blueprint
 *      change the acquire() call boots a slot synchronously (same latency as
 *      before the pool existed).
 *   3. Spawn `npx playwright test recordings/actions-runner.spec.js --grep …`
 *      with WP_DIRECTOR_PLAYGROUND_PORT set so playwright.config.js connects
 *      to the correct slot, and WP_DIRECTOR_SERVER=1 so global-teardown.js
 *      does not kill the pool-owned process.
 *   4. Pipe stdout/stderr back to the client as SSE events.
 *   5. After Playwright exits 0, run the ffmpeg post-process step to produce
 *      an MP4 (and scale if the user picked a non-1080p size).
 *   6. Call pool.release() so the used slot is rebooted in the background,
 *      ready for the run after next.
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
  OUTPUT_DIR,
  DEFAULT_BLUEPRINT,
  GENERATED_BLUEPRINT,
} = require('../config');
const pool = require('../playground-server');
const { processVideo } = require('../video');
const { nameToFilename } = require('./scripts');
const { runSteps } = require('../../recordings/run-steps');

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
 * Resolve the blueprint file path for a run request.
 * If a blueprint object was posted, write it to GENERATED_BLUEPRINT and
 * return that path. Otherwise return the last-generated blueprint (if it
 * exists) or the checked-in default.
 *
 * @param {any} blueprint  The posted blueprint object, or null/undefined.
 * @returns {string}
 */
function resolveBlueprintPath(blueprint) {
  if (blueprint) {
    fs.writeFileSync(GENERATED_BLUEPRINT, JSON.stringify(blueprint, null, 2));
    return GENERATED_BLUEPRINT;
  }
  return fs.existsSync(GENERATED_BLUEPRINT) ? GENERATED_BLUEPRINT : DEFAULT_BLUEPRINT;
}

/**
 * Spawn Playwright for a given grep pattern and pipe its output into the SSE
 * stream. After Playwright exits 0, run the video post-process step.
 *
 * @param {Object} opts
 * @param {string} opts.grepPattern         Regex pattern passed to `playwright --grep`.
 * @param {number} opts.port                Playground port (from pool.acquire).
 * @param {string} opts.blueprintPath       Blueprint path (passed to pool.release on close).
 * @param {any}    opts.videoSize           Target size for ffmpeg scaling.
 * @param {(data: any) => void} opts.send   SSE writer.
 * @param {import('express').Response} opts.res
 * @param {Object} [opts.doneExtra]         Extra fields merged into the final `done` event.
 * @param {boolean} [opts.preview]
 */
function runPlaywright({ grepPattern, port, blueprintPath, videoSize, send, res, doneExtra = {}, preview = false }) {
  const env = {
    ...process.env,
    WP_DIRECTOR_SERVER: '1',
    WP_DIRECTOR_PLAYGROUND_PORT: String(port),
  };
  if (preview) env.WP_DIRECTOR_PREVIEW = '1';

  const proc = spawn(
    'npx', ['playwright', 'test', 'recordings/actions-runner.spec.js', '--grep', grepPattern],
    { cwd: ROOT, env }
  );

  currentProc = proc;

  proc.stdout.on('data', (d) => send({ type: 'stdout', text: d.toString() }));
  proc.stderr.on('data', (d) => send({ type: 'stderr', text: d.toString() }));
  proc.on('close', async (code, signal) => {
    currentProc = null;
    // Reboot the used slot in the background regardless of outcome.
    pool.release(port, blueprintPath);
    if (signal) {
      send({ type: 'done', code: 1, stopped: true });
    } else {
      if (code === 0 && !preview) await processVideo(videoSize, send);
      send({ type: 'done', code, ...doneExtra });
    }
    res.end();
  });
}

/**
 * Same behaviour as runPlaywright() but drives the browser via the Playwright
 * Node.js API instead of spawning a child `npx playwright test` process.
 *
 * @param {Object} opts
 * @param {string} opts.grepPattern         Regex pattern matching the recording name(s) to run.
 * @param {number} opts.port                Playground port (from pool.acquire).
 * @param {string} opts.blueprintPath       Blueprint path (passed to pool.release on close).
 * @param {any}    opts.videoSize           Target size for ffmpeg scaling.
 * @param {(data: any) => void} opts.send   SSE writer.
 * @param {Object} [opts.doneExtra]         Extra fields merged into the return value.
 * @param {boolean} [opts.preview]
 * @returns {Promise<{code: number, [key: string]: any}>}
 */
async function runPlaywrightApi({ scriptData, port, blueprintPath, videoSize, send, doneExtra = {}, preview = false }) {
  const { chromium } = require('playwright');

  const browser = await chromium.launch({
    headless: true,
    slowMo: 500,
    args: ['--remote-debugging-port=9222'],
  });

  let code = 0;
  try {
    for (const def of [scriptData]) {
      send({ type: 'stdout', text: `[Playwright] Running: ${def.name}\n` });

      /** @type {import('playwright').BrowserContextOptions} */
      const contextOpts = {
        baseURL: `http://127.0.0.1:${port}`,
        viewport: { width: 1920, height: 1080 },
      };
      if (!preview) {
        contextOpts.recordVideo = { dir: OUTPUT_DIR, size: { width: 1920, height: 1080 } };
      }

      const context = await browser.newContext(contextOpts);
      const page = await context.newPage();

      await page.screencast.start({
        onFrame: ({ data }) => send( { type: 'screencast', data: data.toString('base64') } ),
        quality: 80,
        size: { width: 1280, height: 800 },
      });

      await runSteps(page, def);

      await page.screencast.stop();

      if (!preview) {
        const videoDir = path.join(OUTPUT_DIR, def.name);
        fs.mkdirSync(videoDir, { recursive: true });
        const video = page.video();
        await page.close();
        if (video) await video.saveAs(path.join(videoDir, 'video.webm'));
      } else {
        await page.close();
      }

      await context.close();
    }
  } catch (err) {
    send({ type: 'stderr', text: `[Playwright] ${err.message}\n` });
    code = 1;
  }

  await browser.close();
  pool.release(port, blueprintPath);

  if (code === 0 && !preview) await processVideo(videoSize, send);
  send({ type: 'done', code, ...doneExtra });
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
    const { name = `recording-${Date.now()}`, actions = [], blueprint = null, videoSize = null, preview = false, endPause } = req.body;
    if (!actions.length) return res.status(400).json({ error: 'no actions provided' });

    if (!fs.existsSync(STEPS_DIR)) fs.mkdirSync(STEPS_DIR);
    const filename = nameToFilename(name);
    const filePath = path.join(STEPS_DIR, filename);
    const scriptData = { name, actions };
    if (endPause != null) scriptData.endPause = endPause;
    fs.writeFileSync(filePath, JSON.stringify(scriptData, null, 2));

    sseHeaders(res);
    const send = sseSender(res);

    const blueprintPath = resolveBlueprintPath(blueprint);

    let port;
    try {
      port = await pool.acquire( blueprintPath, send );
    } catch (err) {
      send({ type: 'stderr', text: `[Playground] Failed to acquire instance: ${err.message}\n` });
      send({ type: 'done', code: 1 });
      res.end();
      return;
    }

    // @todo fix this to support multiple scripts by name for run/batch
    return await runPlaywrightApi({
      scriptData,
      port,
      blueprintPath,
      videoSize,
      send,
      doneExtra: preview ? {} : { file: filePath },
      preview,
    });

    // @todo cleanup
    /*const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    runPlaywright({
      grepPattern: `${escapedName}$`,
      port,
      blueprintPath,
      videoSize,
      send,
      res,
      doneExtra: preview ? {} : { file: filePath },
      preview,
    });*/
  });

  // Batch run: take an array of saved recording names, escape for regex, join
  // as alternation so Playwright matches any of them.
  app.post('/api/run/batch', async (req, res) => {
    const { names = [], blueprint = null, videoSize = null } = req.body;
    if (!names.length) return res.status(400).json({ error: 'no scripts selected' });

    sseHeaders(res);
    const send = sseSender(res);

    const blueprintPath = resolveBlueprintPath(blueprint);

    let port;
    try {
      port = await pool.acquire(blueprintPath, send);
    } catch (err) {
      send({ type: 'stderr', text: `[Playground] Failed to start: ${err.message}\n` });
      send({ type: 'done', code: 1 });
      res.end();
      return;
    }

    const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const grepPattern = `(${escaped.join('|')})`;

    runPlaywright({ grepPattern, port, blueprintPath, videoSize, send, res });
  });
}

module.exports = { register };
