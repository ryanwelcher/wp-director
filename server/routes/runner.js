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
 *   3. Launch a Chromium browser via the Playwright Node.js API, create a
 *      browser context pointed at the acquired Playground port, and execute
 *      each script's step definitions in order.
 *   4. Stream stdout/stderr and live screencast frames back to the client as
 *      SSE events.
 *   5. After all scripts finish, run the ffmpeg post-process step to produce
 *      an MP4 (and scale if the user picked a non-1080p size).
 *   6. Call pool.release() so the used slot is rebooted in the background,
 *      ready for the run after next.
 *
 * ## SSE event contract
 *
 *   { type: 'stdout',     text: string }          — log line from Playwright/ffmpeg
 *   { type: 'stderr',     text: string }          — error line
 *   { type: 'screencast', data: string }          — base64 JPEG frame for live preview
 *   { type: 'screencastVideo', uri: string }      — public URI for the saved screencast video
 *   { type: 'done',       code: number, file?: string }  — terminal event; client closes
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  STEPS_DIR,
  OUTPUT_DIR,
  PLAYWRIGHT_OUTPUT_DIR,
  PREVIEW_OUTPUT_DIR,
  SCREENCASTS_DIR,
  DEFAULT_BLUEPRINT,
  GENERATED_BLUEPRINT,
} = require('../config');
const pool = require('../playground-server');
const { processVideo } = require('../video');
const { timestamp, timestampedDirname, uniqueDir } = require('../output-paths');
const { nameToFilename } = require('./scripts');
const { runSteps } = require('../../recordings/run-steps');

/** @type {import('child_process').ChildProcess|null} */
let currentProc = null;
let currentBrowser = null;

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
  let closed = false;
  res.on('close', () => { closed = true; });

  return (data) => {
    if (closed || res.destroyed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
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
 * Launch a Chromium browser via the Playwright Node.js API and run each
 * script definition in order, streaming screencast frames and log output
 * back to the caller via `send`. Optionally records a WebM video per script
 * and post-processes it to MP4.
 *
 * @param {Object} opts
 * @param {object[]} opts.scripts                   Step-definition objects to run, in order.
 * @param {number}   opts.port                      Playground port (from pool.acquire).
 * @param {string}   opts.blueprintPath             Path to the active blueprint file.
 * @param {any}      opts.videoSize                 Target size for ffmpeg scaling.
 * @param {(data: any) => void} opts.send           SSE writer.
 * @param {Object}   [opts.doneExtra]               Extra fields merged into the `done` event.
 * @param {boolean}  [opts.preview]                 Skip ffmpeg conversion when true.
 * @returns {Promise<void>}
 */
async function runPlaywrightApi({ scripts, port, blueprintPath, videoSize, send, doneExtra = {}, preview = false }) {
  // IMPORTANT: When running multiple scripts, we are running all of them on the same Playground instance - this may or may not be desired.
  // If we want actions to be executed on the same Playground instance this is fine, but if we want a fresh Playground instance for each script, we need to acquire and release one for each script.
  const { chromium } = require('playwright');

  const browser = await chromium.launch({
    headless: true,
    slowMo: 500,
  });

  currentBrowser = browser;

  /** @type {import('playwright').BrowserContextOptions} */
  const contextOpts = {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: PLAYWRIGHT_OUTPUT_DIR, size: { width: 1920, height: 1080 } },
  };

  const context = await browser.newContext(contextOpts);
  let latestPreviewVideoPath = null;
  let latestPreviewVideoFilename = null;

  let code = 0;
  try {
    for (const def of scripts) {
      send({ type: 'stdout', text: `[Playwright] Running: ${def.name}\n` });

      const page = await context.newPage();
      const outputSlug = nameToFilename(def.name).replace(/\.json$/i, '');
      const outputStamp = timestamp();
      const outputDirname = timestampedDirname(outputSlug, outputStamp);
      const videoRoot = preview ? PREVIEW_OUTPUT_DIR : OUTPUT_DIR;
      const videoDir = uniqueDir(path.join(videoRoot, outputDirname));
      const recordedVideoPath = path.join(videoDir, 'video.webm');
      fs.mkdirSync(videoDir, { recursive: true });
      if (preview) fs.writeFileSync(path.join(videoDir, '.wp-director-preview'), '');
      latestPreviewVideoPath = recordedVideoPath;
      latestPreviewVideoFilename = `${path.basename(videoDir)}.webm`;

      // Load the site before starting the screencast so the video does not start with a blank screen.
      // Use the blueprint's landingPage if specified; otherwise fall back to the WP admin dashboard.
      const blueprintJson = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
      const landingPage = blueprintJson.landingPage || '/wp-admin/';
      await page.goto(landingPage);

      await page.screencast.start({
        onFrame: ({ data }) => send({ type: 'screencast', data: data.toString('base64') }),
        quality: 80,
        size: { width: 1280, height: 720 },
      });
      await runSteps(page, def, null, (index, total) => {
        send({ type: 'step-progress', index, total });
      });
      await page.screencast.stop();

      const video = page.video();
      await page.close();
      if (video) await video.saveAs(recordedVideoPath);
      if (!preview && code === 0) await processVideo(recordedVideoPath, videoSize, send);
    }

    await context.close();
  } catch (err) {
    send({ type: 'stderr', text: `[Playwright] ${err.message}\n` });
    code = 1;
  }

  await browser.close();
  currentBrowser = null;

  if (latestPreviewVideoPath && latestPreviewVideoFilename && fs.existsSync(latestPreviewVideoPath)) {
    const publicPath = path.join(SCREENCASTS_DIR, latestPreviewVideoFilename);
    fs.mkdirSync(SCREENCASTS_DIR, { recursive: true });
    fs.copyFileSync(latestPreviewVideoPath, publicPath);
    send({ type: 'screencastVideo', uri: `/screencasts/${latestPreviewVideoFilename}` });
  }

  send({ type: 'done', code, ...doneExtra });
}

function register(app) {
  app.post('/api/stop', (req, res) => {
    if (currentProc) {
      currentProc.kill('SIGTERM');
      res.json({ ok: true });
    } else if (currentBrowser) {
      currentBrowser.close();
      res.json({ ok: true });
    } else {
      res.json({ ok: false, reason: 'no process running' });
    }
  });

  // Single-recording run: write the posted steps to a file and run them directly.
  app.post('/api/run', async (req, res) => {
    const {
      name = `recording-${Date.now()}`,
      actions = [],
      blueprint = null,
      videoSize = null,
      preview = false,
      endPause,
      stepPause,
      typingDelay,
      startFrom,
    } = req.body;
    if (!actions.length) return res.status(400).json({ error: 'no actions provided' });

    if (!fs.existsSync(STEPS_DIR)) fs.mkdirSync(STEPS_DIR);
    const filename = nameToFilename(name);
    const filePath = path.join(STEPS_DIR, filename);
    const scriptData = { name, actions };
    if (endPause != null) scriptData.endPause = endPause;
    if (stepPause != null) scriptData.stepPause = stepPause;
    if (typingDelay != null) scriptData.typingDelay = typingDelay;
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
      return;
    }

    const runDef = { ...scriptData };
    if (startFrom != null && startFrom > 0) runDef.startFrom = startFrom;

    await runPlaywrightApi({
      scripts: [runDef],
      port,
      blueprintPath,
      videoSize,
      send,
      doneExtra: preview ? {} : { file: filePath },
      preview,
    });

    pool.release(port, blueprintPath);
    if (!res.destroyed && !res.writableEnded) res.end();
  });

  // Batch run: load all saved step files, filter to the requested names, run in order.
  app.post('/api/run/batch', async (req, res) => {
    const { names = [], blueprint = null, videoSize = null, endPause, stepPause, typingDelay } = req.body;
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
      return;
    }

    const nameSet = new Set(names);
    const scripts = fs.readdirSync(STEPS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(STEPS_DIR, f), 'utf8')))
      .filter(def => nameSet.has(def.name))
      .map((def) => ({
        ...def,
        ...(endPause != null ? { endPause } : {}),
        ...(stepPause != null ? { stepPause } : {}),
        ...(typingDelay != null ? { typingDelay } : {}),
      }));

    await runPlaywrightApi({ scripts, port, blueprintPath, videoSize, send });

    pool.release(port, blueprintPath);
    if (!res.destroyed && !res.writableEnded) res.end();
  });
}

module.exports = { register };
