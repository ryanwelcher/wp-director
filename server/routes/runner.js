// @ts-check

/**
 * Test-runner endpoints.
 *
 *   POST /api/run        → play a single disposable run, stream logs over SSE
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
 *   4. Stream stdout/stderr and live browser frames back to the client as
 *      SSE events.
 *   5. Call pool.release() so the used slot is rebooted in the background,
 *      ready for the run after next.
 *
 * ## SSE event contract
 *
 *   { type: 'stdout',     text: string }          — log line from Playwright
 *   { type: 'stderr',     text: string }          — error line
 *   { type: 'screencast', data: string }          — base64 JPEG frame from the live browser
 *   { type: 'videoReady', name: string, videoUrl: string, createdAt: string }
 *                                            — latest disposable video is ready to replay
 *   { type: 'done',       code: number, video?: object }  — terminal event; client closes
 */

const fs = require('fs');
const path = require('path');
const {
  STEPS_DIR,
  OUTPUT_DIR,
  PLAYWRIGHT_OUTPUT_DIR,
  DISPOSABLE_OUTPUT_DIR,
  DEFAULT_BLUEPRINT,
  GENERATED_BLUEPRINT,
} = require('../config');
const pool = require('../playground-server');
const { normalizeVideoSize, screencastSizeForVideoSize, sizeKey } = require('../video-size');
const { timestamp, timestampedDirname, uniqueDir } = require('../output-paths');
const { nameToFilename, normalizeRecordingSettings, scriptForRun } = require('./scripts');
const { runSteps } = require('../../recordings/run-steps');

let currentRun = null;

function runStoppedError() {
  const err = new Error('Run stopped');
  err.code = 'RUN_STOPPED';
  return err;
}

function throwIfRunStopped(signal) {
  if (signal?.aborted) throw runStoppedError();
}

function stopRunControl(run) {
  if (!run) return false;
  if (run.stopRequested) return true;

  run.stopRequested = true;
  if (!run.controller.signal.aborted) run.controller.abort();

  const page = run.page;
  if (page && !page.isClosed?.()) {
    page.close().catch(() => {});
  } else if (run.context) {
    run.context.close().catch(() => {});
  }

  return true;
}

function createRunControl(clientSignal) {
  const run = {
    browser: null,
    context: null,
    page: null,
    controller: new AbortController(),
    stopRequested: false,
  };

  if (clientSignal?.aborted) {
    run.stopRequested = true;
    run.controller.abort();
  } else {
    clientSignal?.addEventListener('abort', () => {
      stopRunControl(run);
    }, { once: true });
  }

  currentRun = run;
  return run;
}

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
 * Track whether the run response was aborted before the server could start
 * streaming. `req.close` is not reliable here because it can fire after the
 * POST body has simply been consumed; use request aborts and premature
 * response closes instead.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {{ isAborted: () => boolean, signal: AbortSignal }}
 */
function clientAbortedTracker(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };

  req.on('aborted', abort);
  res.on('close', () => {
    if (!res.writableEnded) abort();
  });

  return {
    isAborted: () => controller.signal.aborted || res.destroyed,
    signal: controller.signal,
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

function clearDirectoryContents(dir) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function cleanupDisposablePlaywrightFiles() {
  try {
    clearDirectoryContents(PLAYWRIGHT_OUTPUT_DIR);
  } catch (err) {
    console.warn(`Could not clean disposable output: ${err.message}`);
  }
}

/**
 * Launch a Chromium browser via the Playwright Node.js API and run each
 * script definition in order, streaming screencast frames and log output
 * back to the caller via `send`. Each script writes Playwright's captured WebM
 * to the directory chosen by `outputDirForScript`.
 *
 * @param {Object} opts
 * @param {object[]} opts.scripts                   Step-definition objects to run, in order.
 * @param {number}   opts.port                      Playground port (from pool.acquire).
 * @param {string}   opts.blueprintPath             Path to the active blueprint file.
 * @param {any}      opts.videoSize                 Target browser viewport/video size.
 * @param {(data: any) => void} opts.send           SSE writer.
 * @param {(script: object) => string} [opts.outputDirForScript] Chooses the output directory for a script video.
 * @param {(video: { script: object, videoDir: string, videoPath: string, createdAt: string }) => object | void} [opts.onVideoReady]
 * @param {() => void} [opts.onInstanceUsed]         Called once the Playground instance is actually touched.
 * @param {ReturnType<typeof createRunControl>} [opts.run]
 * @returns {Promise<void>}
 */
async function runPlaywrightApi({ scripts, port, blueprintPath, videoSize, send, outputDirForScript = null, onVideoReady = null, onInstanceUsed = null, run = null }) {
  // IMPORTANT: When running multiple scripts, we are running all of them on the same Playground instance - this may or may not be desired.
  // If we want actions to be executed on the same Playground instance this is fine, but if we want a fresh Playground instance for each script, we need to acquire and release one for each script.
  const { chromium } = require('playwright');
  const signal = run?.controller.signal;
  const wasStopped = () => Boolean(run?.stopRequested || signal?.aborted);

  throwIfRunStopped(signal);

  const recordingSize = normalizeVideoSize(videoSize);
  const screencastSize = screencastSizeForVideoSize(recordingSize);
  send({ type: 'stdout', text: `[Playwright] Video size: ${sizeKey(recordingSize)}\n` });

  /** @type {import('playwright').BrowserContextOptions} */
  const contextOpts = {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: recordingSize,
    screen: recordingSize,
  };
  contextOpts.recordVideo = { dir: PLAYWRIGHT_OUTPUT_DIR, size: recordingSize };

  let browser = null;
  let context = null;
  let latestVideo = null;
  let instanceUsed = false;
  const markInstanceUsed = () => {
    if (instanceUsed) return;
    instanceUsed = true;
    onInstanceUsed?.();
  };

  let code = 0;
  // Tracks which direction (and which script, if multiple) was active when a
  // step failed. Carried back to the client via a `step-error` SSE event so
  // the UI can mark exactly that direction for AI-assisted repair.
  let activeDirectionIndex = null;
  let activeScriptName = null;
  try {
    browser = await chromium.launch({
      headless: true,
      slowMo: 500,
      args: [`--window-size=${recordingSize.width},${recordingSize.height}`],
    });
    if (run) run.browser = browser;
    throwIfRunStopped(signal);

    context = await browser.newContext(contextOpts);
    if (run) run.context = context;
    const activeContext = context;
    context.on('close', () => {
      if (run?.context === activeContext) run.context = null;
    });
    throwIfRunStopped(signal);

    for (const def of scripts) {
      throwIfRunStopped(signal);
      activeScriptName = def.name;
      activeDirectionIndex = null;
      send({ type: 'stdout', text: `[Playwright] Running: ${def.name}\n` });

      const page = await context.newPage();
      if (run) run.page = page;
      page.on('close', () => {
        if (run?.page === page) run.page = null;
      });
      throwIfRunStopped(signal);

      const outputSlug = nameToFilename(def.name).replace(/\.json$/i, '');
      const outputStamp = timestamp();
      const videoDir = outputDirForScript
        ? outputDirForScript(def)
        : uniqueDir(path.join(OUTPUT_DIR, timestampedDirname(outputSlug, outputStamp)));
      const recordedVideoPath = path.join(videoDir, 'video.webm');
      fs.mkdirSync(videoDir, { recursive: true });

      // Load the site before starting the screencast so the video does not start with a blank screen.
      // Use the blueprint's landingPage if specified; otherwise fall back to the WP admin dashboard.
      const blueprintJson = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
      const landingPage = blueprintJson.landingPage || '/wp-admin/';
      markInstanceUsed();
      await page.goto(landingPage);
      throwIfRunStopped(signal);

      await page.screencast.start({
        onFrame: ({ data }) => send({ type: 'screencast', data: data.toString('base64') }),
        quality: 80,
        size: screencastSize,
      });
      throwIfRunStopped(signal);

      await runSteps(page, def, null, (index, total) => {
        activeDirectionIndex = index;
        send({ type: 'step-progress', index, total });
      });
      activeDirectionIndex = null;
      throwIfRunStopped(signal);

      await page.screencast.stop();

      const video = page.video();
      await page.close();
      if (run?.page === page) run.page = null;
      let savedVideo = false;
      if (video && recordedVideoPath) {
        await video.saveAs(recordedVideoPath);
        savedVideo = true;
      }
      if (savedVideo && code === 0) {
        const createdAt = new Date().toISOString();
        const readyVideo = onVideoReady?.({ script: def, videoDir, videoPath: recordedVideoPath, createdAt });
        if (readyVideo) latestVideo = readyVideo;
      }
    }

    await context.close();
    context = null;
  } catch (err) {
    if (signal?.aborted || err.code === 'RUN_STOPPED') {
      if (run) run.stopRequested = true;
    } else {
      // If runSteps threw while a direction was active, attribute the
      // failure so the UI can render a Fix button on the right row.
      // Other failures (browser/context lifecycle, navigation) don't carry
      // a meaningful direction index — we omit the event for those.
      if (activeDirectionIndex != null) {
        send({
          type: 'step-error',
          index: activeDirectionIndex,
          script: activeScriptName,
          message: err.message,
        });
      }
      send({ type: 'stderr', text: `[Playwright] ${err.message}\n` });
      code = 1;
    }
  }

  if (context) {
    try {
      if (run?.context === context) run.context = null;
      await context.close();
    } catch (err) {
      if (!wasStopped()) {
        send({ type: 'stderr', text: `[Playwright] ${err.message}\n` });
        code = 1;
      }
    }
  }

  if (browser) {
    try {
      if (typeof browser.isConnected !== 'function' || browser.isConnected()) {
        await browser.close();
      }
    } catch (err) {
      if (!wasStopped()) {
        send({ type: 'stderr', text: `[Playwright] ${err.message}\n` });
        code = 1;
      }
    }
    if (run?.browser === browser) run.browser = null;
  }

  send({ type: 'done', code, ...(latestVideo ? { video: latestVideo } : {}), ...(wasStopped() ? { stopped: true } : {}) });
}

function register(app) {
  app.post('/api/stop', (req, res) => {
    if (stopRunControl(currentRun)) {
      res.json({ ok: true });
    } else {
      res.json({ ok: false, reason: 'no process running' });
    }
  });

  // Single Play run: execute posted steps and keep only the latest disposable WebM.
  app.post('/api/run', async (req, res) => {
    const {
      name = `recording-${Date.now()}`,
      actions = [],
      blueprint = null,
      videoSize = null,
      endPause,
      stepPause,
      typingDelay,
      startFrom,
    } = req.body;
    if (!actions.length) return res.status(400).json({ error: 'no actions provided' });

    try { fs.rmSync(DISPOSABLE_OUTPUT_DIR, { recursive: true, force: true }); } catch {}

    const recordingSettings = normalizeRecordingSettings({ endPause, stepPause, typingDelay, videoSize });
    const scriptData = {
      name,
      actions,
      blueprint,
      recordingSettings,
    };

    sseHeaders(res);
    const send = sseSender(res);
    const clientAbort = clientAbortedTracker(req, res);

    const blueprintPath = resolveBlueprintPath(blueprint);

    let port;
    let instanceUsed = false;
    try {
      port = await pool.acquire(blueprintPath, send, { signal: clientAbort.signal });
      send({ type: 'playground-acquired', port });
    } catch (err) {
      if (err.code === 'POOL_ACQUIRE_CANCELLED' || clientAbort.isAborted()) return;
      send({ type: 'stderr', text: `[Playground] Failed to acquire instance: ${err.message}\n` });
      send({ type: 'done', code: 1 });
      return;
    }

    if (clientAbort.isAborted() || res.writableEnded) {
      pool.release(port, { used: false });
      if (!res.destroyed && !res.writableEnded) res.end();
      return;
    }

    const runDef = scriptForRun(scriptData);
    if (startFrom != null && startFrom > 0) runDef.startFrom = startFrom;

    const run = createRunControl(clientAbort.signal);
    try {
      await runPlaywrightApi({
        scripts: [runDef],
        port,
        blueprintPath,
        videoSize,
        send,
        outputDirForScript: () => path.join(DISPOSABLE_OUTPUT_DIR, 'latest'),
        onVideoReady: ({ script, videoDir, createdAt }) => {
          const video = {
            name: script.name,
            createdAt,
            videoUrl: '/api/previews/latest/video',
          };
          fs.writeFileSync(path.join(videoDir, 'video.json'), JSON.stringify({ name: video.name, createdAt }, null, 2));
          send({ type: 'videoReady', ...video });
          return video;
        },
        onInstanceUsed: () => { instanceUsed = true; },
        run,
      });
    } catch (err) {
      if (err.code === 'RUN_STOPPED' || run.controller.signal.aborted) {
        send({ type: 'done', code: 1, stopped: true });
      } else {
        send({ type: 'stderr', text: `[Runner] ${err.message}\n` });
        send({ type: 'done', code: 1, ...(run.stopRequested ? { stopped: true } : {}) });
      }
    } finally {
      if (currentRun === run) currentRun = null;
      pool.release(port, { used: instanceUsed });
      cleanupDisposablePlaywrightFiles();
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  });

  // Batch run: load all saved step files, filter to the requested names, run in order.
  app.post('/api/run/batch', async (req, res) => {
    const { names = [], blueprint = null, videoSize = null, endPause, stepPause, typingDelay } = req.body;
    if (!names.length) return res.status(400).json({ error: 'no scripts selected' });

    sseHeaders(res);
    const send = sseSender(res);
    const clientAbort = clientAbortedTracker(req, res);

    const blueprintPath = resolveBlueprintPath(blueprint);

    let port;
    let instanceUsed = false;
    try {
      port = await pool.acquire(blueprintPath, send, { signal: clientAbort.signal });
      send({ type: 'playground-acquired', port });
    } catch (err) {
      if (err.code === 'POOL_ACQUIRE_CANCELLED' || clientAbort.isAborted()) return;
      send({ type: 'stderr', text: `[Playground] Failed to start: ${err.message}\n` });
      send({ type: 'done', code: 1 });
      return;
    }

    if (clientAbort.isAborted() || res.writableEnded) {
      pool.release(port, { used: false });
      if (!res.destroyed && !res.writableEnded) res.end();
      return;
    }

    const nameSet = new Set(names);
    const scripts = fs.readdirSync(STEPS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(STEPS_DIR, f), 'utf8')))
      .filter(def => nameSet.has(def.name))
      .map((def) => scriptForRun(def, { endPause, stepPause, typingDelay, videoSize }));
    const batchVideoSize = videoSize ?? scripts[0]?.videoSize;

    const run = createRunControl(clientAbort.signal);
    try {
      await runPlaywrightApi({
        scripts,
        port,
        blueprintPath,
        videoSize: batchVideoSize,
        send,
        onInstanceUsed: () => { instanceUsed = true; },
        run,
      });
    } catch (err) {
      if (err.code === 'RUN_STOPPED' || run.controller.signal.aborted) {
        send({ type: 'done', code: 1, stopped: true });
      } else {
        send({ type: 'stderr', text: `[Runner] ${err.message}\n` });
        send({ type: 'done', code: 1, ...(run.stopRequested ? { stopped: true } : {}) });
      }
    } finally {
      if (currentRun === run) currentRun = null;
      pool.release(port, { used: instanceUsed });
      cleanupDisposablePlaywrightFiles();
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  });
}

module.exports = { register };
