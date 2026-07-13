// @ts-check

/**
 * Google Drive upload — OAuth sign-in + upload a recording, return a public link.
 *
 *   GET  /api/drive/status         → { authed: boolean }
 *   GET  /api/drive/token          → { accessToken, apiKey, appId } for the Picker
 *   GET  /api/drive/oauth/start    → 302 to Google consent screen
 *   GET  /api/drive/oauth/callback → exchanges code, caches token, closes tab
 *   POST /api/drive/upload         → { dirname, folderId? } → { webViewLink }
 *
 * Phase 2: the client-side Google Picker lets the user pick any existing Drive
 * folder as the destination; the picked folderId is passed to upload. When no
 * folder is picked, uploads fall back to a folder the app creates and owns
 * (drive.file can't write into folders it didn't create).
 */

const fs = require('fs');
const { findVideoFile, transcodeToTempMp4 } = require('../video');
const { parseRecordingDirname } = require('./recordings');
const drive = require('../lib/google-drive');

// Filesystem-safe identifier only — rejects traversal before we touch disk.
// Mirrors isSafeRecordingDirname in routes/recordings.js (exported there in a
// later phase; kept local to avoid coupling the tracer to that refactor).
function isSafeRecordingDirname(dirname) {
  return typeof dirname === 'string' && /^[a-z0-9-]+$/i.test(dirname);
}

// Drive file/folder IDs are opaque URL-safe base64-ish strings. Validate before
// handing a client-supplied id to the Drive API as an upload parent.
function isValidDriveFolderId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{10,}$/.test(id);
}

// Human-readable Drive `description`: the recording's step-definition name plus
// when it was recorded, so uploaded files are findable later (Phase 3).
function buildDescription(dirname) {
  const { name, createdAt } = parseRecordingDirname(dirname);
  const when = createdAt ? new Date(createdAt).toLocaleString() : null;
  return when ? `${name} — recorded ${when}` : name;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function register(app) {
  app.get('/api/drive/status', (req, res) => {
    res.json({ authed: drive.isAuthed() });
  });

  // Hands the client-side Google Picker what it needs to browse the user's
  // Drive: a short-lived access token plus the browser API key and app id. Only
  // the access token is sensitive; it's never persisted client-side (see plan).
  app.get('/api/drive/token', async (req, res) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    const appId = process.env.GOOGLE_APP_ID;
    if (!apiKey || !appId) {
      return res.status(500).json({
        error: 'Folder picker is not configured. Set GOOGLE_API_KEY and GOOGLE_APP_ID in .env.',
      });
    }
    try {
      const accessToken = await drive.getAccessToken();
      if (!accessToken) {
        return res.status(400).json({ error: 'Not signed in to Google Drive.' });
      }
      res.json({ accessToken, apiKey, appId });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Could not obtain access token.' });
    }
  });

  app.get('/api/drive/oauth/start', (req, res) => {
    try {
      res.redirect(drive.getAuthUrl());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/drive/oauth/callback', async (req, res) => {
    const code = req.query.code;
    if (typeof code !== 'string' || !code) {
      return res.status(400).send('<p>Missing authorization code.</p>');
    }
    try {
      await drive.exchangeCode(code);
      res.set('Content-Type', 'text/html').send(
        '<p>You are signed in to Google Drive. You can close this tab and return to WP Director.</p>',
      );
    } catch (err) {
      res.status(500).set('Content-Type', 'text/html').send(
        `<p>Sign-in failed: ${escapeHtml(err.message)}</p>`,
      );
    }
  });

  // Streams the upload as Server-Sent Events (Phase 4) so the UI can show byte
  // progress, a transcode/retry phase, and a Cancel button. Validation errors
  // are returned as plain JSON *before* switching the response to SSE; once the
  // stream is open we only emit `data:` events.
  app.post('/api/drive/upload', async (req, res) => {
    const { dirname, folderId, format } = req.body || {};
    if (!isSafeRecordingDirname(dirname)) {
      return res.status(400).json({ error: 'Invalid recording name.' });
    }
    if (folderId !== undefined && !isValidDriveFolderId(folderId)) {
      return res.status(400).json({ error: 'Invalid folder id.' });
    }
    // Default to the raw WebM (fast, no transcode). MP4 is the "compatible" path.
    const uploadFormat = format === undefined ? 'webm' : format;
    if (uploadFormat !== 'webm' && uploadFormat !== 'mp4') {
      return res.status(400).json({ error: 'Invalid format.' });
    }
    if (!drive.isAuthed()) {
      return res.status(400).json({ error: 'Not signed in to Google Drive.' });
    }

    const found = findVideoFile(dirname);
    if (!found) return res.status(404).json({ error: 'Recording not found.' });

    // Switch to SSE for the long-running upload.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data) => {
      if (res.destroyed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Cancel the in-flight upload when the client disconnects (Cancel button
    // aborts its fetch, closing this response). Drive's session is left to GC.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    // For MP4 we transcode the canonical WebM to a temp file first (Drive's
    // resumable upload wants a seekable file); delete it once we're done.
    let tempMp4 = null;
    // Throttle progress: emit only when the percentage advances by >=1% (plus
    // the final byte), so a fast upload doesn't flood the stream.
    let lastPct = 0;
    try {
      let filePath = found.file;
      let name = `${dirname}.${found.ext}`;
      let mimeType = found.mime;
      if (uploadFormat === 'mp4') {
        send({ type: 'transcoding' });
        tempMp4 = await transcodeToTempMp4(found.file);
        filePath = tempMp4;
        name = `${dirname}.mp4`;
        mimeType = 'video/mp4';
      }

      // With a Picker-selected folderId, uploads land there. Without one, they
      // fall back to the app-owned folder, created on first use. (drive.file
      // can't write into hand-made folders it didn't create.)
      const { webViewLink } = await drive.uploadFile({
        filePath,
        name,
        mimeType,
        folderId,
        description: buildDescription(dirname),
        signal: controller.signal,
        onProgress: (p) => {
          if (p.retrying) {
            lastPct = 0;
            send({ type: 'retrying', attempt: p.attempt });
            return;
          }
          const pct = p.totalBytes ? p.bytesUploaded / p.totalBytes : 0;
          const atEnd = p.totalBytes > 0 && p.bytesUploaded >= p.totalBytes;
          if (!atEnd && pct - lastPct < 0.01) return;
          lastPct = pct;
          send({ type: 'progress', bytesUploaded: p.bytesUploaded, totalBytes: p.totalBytes });
        },
      });
      send({ type: 'done', webViewLink });
    } catch (err) {
      if (drive.isAbortError(err) || controller.signal.aborted) {
        send({ type: 'error', cancelled: true, error: 'Upload cancelled.' });
      } else {
        send({ type: 'error', error: err.message || 'Upload failed.' });
      }
    } finally {
      if (tempMp4) fs.rm(tempMp4, { force: true }, () => {});
      if (!res.writableEnded) res.end();
    }
  });
}

module.exports = { register };
