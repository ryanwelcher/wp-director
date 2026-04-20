// @ts-check

/**
 * GET /api/screencast — live browser preview via Chrome DevTools Protocol.
 *
 * While Playwright is driving Chrome, the browser exposes a DevTools endpoint
 * on port 9222 (launched via `--remote-debugging-port=9222` in
 * playwright.config.js). This route:
 *
 *   1. Polls http://localhost:9222/json until a page target appears (up to 30s
 *      — the browser isn't up yet at the moment the user clicks Record, so we
 *      can't fail fast).
 *   2. Opens a WebSocket to the page's `webSocketDebuggerUrl`.
 *   3. Sends `Page.startScreencast` to start a stream of JPEG frames.
 *   4. Forwards each frame to the browser as an SSE event `{ type: 'frame', data: <base64> }`.
 *   5. ACKs each frame back to Chrome via `Page.screencastFrameAck` to keep
 *      the stream flowing (Chrome pauses the stream until ACKed).
 *
 * Cleanup: when the SSE client closes (user leaves page, run finishes), we
 * close the DevTools socket so Chrome stops producing frames.
 */

const WebSocket = require('ws');
const { CHROME_DEBUG_PORT } = require('../config');

/**
 * Poll the Chrome DevTools endpoint until a page target's WebSocket URL is
 * available. Chrome may not have launched yet when the request arrives.
 *
 * @param {number} [attempts]   How many times to try (500ms apart).
 * @returns {Promise<string | null>}
 */
async function waitForDebuggerUrl(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`http://localhost:${CHROME_DEBUG_PORT}/json`);
      const targets = await r.json();
      const target = targets.find((t) => t.type === 'page');
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch {
      // Chrome not up yet; ignore and retry.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function register(app) {
  app.get('/api/screencast', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const wsUrl = await waitForDebuggerUrl();
    if (!wsUrl) {
      send({ type: 'error', message: 'Chrome remote debugging not available' });
      return res.end();
    }

    const ws = new WebSocket(wsUrl);
    let msgId = 0;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: ++msgId,
        method: 'Page.startScreencast',
        // Cap the stream size to keep per-frame payloads small; the UI is ~800px wide anyway.
        params: { format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 800 },
      }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'Page.screencastFrame') {
        send({ type: 'frame', data: msg.params.data });
        // Chrome suspends the stream until each frame is ACKed.
        ws.send(JSON.stringify({
          id: ++msgId,
          method: 'Page.screencastFrameAck',
          params: { sessionId: msg.params.sessionId },
        }));
      }
    });

    ws.on('error', () => {
      // Swallow — the client may have closed, or Chrome exited between reads.
    });

    req.on('close', () => ws.close());
  });
}

module.exports = { register };
