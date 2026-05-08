// @ts-check

/**
 * Blueprint read + preview endpoints.
 *
 *   GET  /api/default-blueprint   → always reads the checked-in blueprint.json
 *                                   (the "Reset to default" target in the UI)
 *   GET  /api/current-blueprint   → reads blueprint.generated.json if present,
 *                                   else falls back to blueprint.json. This is
 *                                   what the UI loads on startup so that a
 *                                   previously-customized blueprint survives
 *                                   page reloads.
 *   POST /api/preview-blueprint   → spins up a throwaway Playground on port
 *                                   9400 with the posted blueprint and returns
 *                                   its URL. Used by "Test in Playground".
 *
 * Why two GET endpoints? The UI needs both the current (what to display) AND
 * the true default (what to revert to). Without /api/default-blueprint there'd
 * be no way to restore the checked-in baseline after editing.
 */

const fs = require('fs');
const {
  DEFAULT_BLUEPRINT,
  GENERATED_BLUEPRINT,
  PREVIEW_BLUEPRINT,
  PREVIEW_PLAYGROUND_PORT,
} = require('../config');
const { killPreviewPlayground, startPreviewPlayground } = require('../playground');
const pool = require('../playground-server');

function register(app) {
  app.get('/api/default-blueprint', (req, res) => {
    try {
      const bp = JSON.parse(fs.readFileSync(DEFAULT_BLUEPRINT, 'utf8'));
      res.json({ blueprint: bp });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/current-blueprint', (req, res) => {
    try {
      const src = fs.existsSync(GENERATED_BLUEPRINT) ? GENERATED_BLUEPRINT : DEFAULT_BLUEPRINT;
      const bp = JSON.parse(fs.readFileSync(src, 'utf8'));
      res.json({ blueprint: bp });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/save-blueprint', (req, res) => {
    const { blueprint } = req.body;
    if (!blueprint) return res.status(400).json({ error: 'blueprint required' });

    try {
      fs.writeFileSync(GENERATED_BLUEPRINT, JSON.stringify(blueprint, null, 2));
      pool.resetPool(GENERATED_BLUEPRINT);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reset-blueprint', (req, res) => {
    try {
      const defaultContent = fs.readFileSync(DEFAULT_BLUEPRINT, 'utf8');
      fs.writeFileSync(GENERATED_BLUEPRINT, defaultContent);
      pool.resetPool(GENERATED_BLUEPRINT);
      res.json({ blueprint: JSON.parse(defaultContent) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/pool-status', (req, res) => {
    res.json(pool.getStatus());
  });

  // SSE stream of pool status. Sends the current snapshot on connect, then
  // one event per state transition. Replaces the 3 s poll so the UI sees
  // pool changes within ~100 ms instead of up to 3 s late.
  app.get('/api/pool-status/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const send = (status) => {
      res.write(`data: ${JSON.stringify(status)}\n\n`);
    };

    send(pool.getStatus());
    pool.events.on('change', send);

    const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      pool.events.off('change', send);
    });
  });

  app.post('/api/preview-blueprint', async (req, res) => {
    const { blueprint } = req.body;
    if (!blueprint) return res.status(400).json({ error: 'blueprint required' });

    try {
      // Always kill-then-start so consecutive previews reflect the latest edit
      // rather than reusing whatever was running from the previous "Test" click.
      killPreviewPlayground();
      fs.writeFileSync(PREVIEW_BLUEPRINT, JSON.stringify(blueprint, null, 2));
      await startPreviewPlayground(PREVIEW_BLUEPRINT);
      const landingPage = blueprint.landingPage || '/';
      res.json({ url: `http://localhost:${PREVIEW_PLAYGROUND_PORT}${landingPage}` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { register };
