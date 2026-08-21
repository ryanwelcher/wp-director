// @ts-check

/**
 * Google Drive upload — OAuth sign-in + upload a recording, return a public link.
 *
 *   GET  /api/drive/status         → { authed, configured, email: string | null }
 *   GET  /api/drive/token          → { accessToken, apiKey, appId } for the Picker
 *   GET  /api/drive/oauth/start    → 302 to Google consent screen
 *   GET  /api/drive/oauth/callback → exchanges code, caches token, closes tab
 *   POST /api/drive/signout        → revokes + clears the cached token
 *   POST /api/drive/upload         (body: { dirname, folderId?, format? }) → SSE progress stream whose final `done` event includes { webViewLink }
 *
 * Phase 2: the client-side Google Picker lets the user pick any existing Drive
 * folder as the destination; the picked folderId is passed to upload. When no
 * folder is picked, uploads fall back to a folder the app creates and owns
 * (drive.file can't write into folders it didn't create).
 */

const crypto = require('crypto');
const fs = require('fs');
const { findVideoFile, transcodeToTempMp4 } = require('../video');
const { parseRecordingDirname, isSafeRecordingDirname } = require('./recordings');
const drive = require('../lib/google-drive');

// Anti-CSRF nonce for the OAuth round-trip. Generated at /oauth/start, verified
// at /oauth/callback. Single-slot is fine for a single-user local tool: the most
// recent sign-in attempt is the one that can complete.
let pendingOAuthState = null;

// Hostnames we accept in the Host header. The server binds to loopback, but a
// DNS-rebinding attack can point an attacker-controlled domain at 127.0.0.1 so a
// malicious page becomes "same-origin" and can read responses (e.g. the Google
// access token from /token). Rejecting unexpected Host values defeats that: the
// rebound request still carries the attacker's domain in Host.
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Extract the hostname (no port) from a Host header, or null if unparseable. */
function hostnameOf(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Guards all /api/drive routes against DNS-rebinding by requiring a loopback
// Host. Applied to the whole Drive surface, not just /token, since /status leaks
// the account email and the POST routes act on the user's Drive.
function driveHostGuard(req, res, next) {
  const hostname = hostnameOf(req.headers.host);
  const remote = req.socket?.remoteAddress;
  const isLoopbackRemote = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!isLoopbackRemote || !hostname || !ALLOWED_HOSTS.has(hostname)) {
    return res.status(403).json({ error: 'Forbidden host.' });
  }
  next();
}

// Recordings currently mid-upload, keyed by dirname. Enforces one in-flight
// upload per recording (Phase 6): a second POST for the same dirname is rejected
// with 409 rather than racing to create a duplicate Drive file. Cleared in the
// upload handler's finally, so a finished/cancelled/failed upload frees the slot.
const uploadsInFlight = new Set();

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
  app.use('/api/drive', driveHostGuard);

  app.get('/api/drive/status', (req, res) => {
    const authed = drive.isAuthed();
    res.json({
      authed,
      configured: drive.isConfigured(),
      email: authed ? drive.getAccountEmail() : null,
    });
  });

  // Phase 5: revoke the token with Google and delete the local cache. Idempotent
  // — signing out when already signed out just returns ok.
  app.post('/api/drive/signout', async (req, res) => {
    try {
      await drive.signOut();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Sign-out failed.' });
    }
  });

  // Which recordings already have an upload in the signed-in account's Drive,
  // as a { dirname: webViewLink } map. Queried live (drive.file scope only
  // returns this app's own files for the current account), so it self-heals when
  // a file is deleted and is inherently scoped to the signed-in account. The UI
  // uses it to show an existing link instead of the upload button.
  app.get('/api/drive/uploads', async (req, res) => {
    if (!drive.isAuthed()) return res.json({ uploads: {} });
    try {
      const files = await drive.listUploadedVideos();
      const uploads = {};
      // Uploaded files are named `<dirname>.webm` / `<dirname>.mp4`. The list is
      // most-recent-first, so the first entry seen for a dirname (its latest
      // upload) wins.
      for (const { name, webViewLink } of files) {
        const dirname = drive.dirnameFromDriveVideoName(name);
        if (dirname && isSafeRecordingDirname(dirname) && !(dirname in uploads)) {
          uploads[dirname] = webViewLink;
        }
      }
      res.json({ uploads });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Could not list Drive uploads.' });
    }
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
      pendingOAuthState = crypto.randomBytes(32).toString('hex');
      res.redirect(drive.getAuthUrl(pendingOAuthState));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/drive/oauth/callback', async (req, res) => {
    const code = req.query.code;
    if (typeof code !== 'string' || !code) {
      return res.status(400).send('<p>Missing authorization code.</p>');
    }
    // Verify the anti-CSRF nonce before spending the code. Consume it either way
    // so a nonce can't be replayed.
    const state = req.query.state;
    const expected = pendingOAuthState;
    pendingOAuthState = null;
    if (!expected || state !== expected) {
      return res.status(400).set('Content-Type', 'text/html').send(
        '<p>Sign-in failed: invalid or expired state. Please start again from WP Director.</p>',
      );
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

    // One in-flight upload per recording. Reject a concurrent POST for the same
    // dirname before opening the SSE stream, so we never create duplicate Drive
    // files or race two transcodes over the same recording.
    if (uploadsInFlight.has(dirname)) {
      return res.status(409).json({ error: 'An upload for this recording is already in progress.' });
    }
    uploadsInFlight.add(dirname);

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
      let name = drive.driveVideoFileName(dirname, found.ext);
      let mimeType = found.mime;
      if (uploadFormat === 'mp4') {
        send({ type: 'transcoding' });
        tempMp4 = await transcodeToTempMp4(found.file, { signal: controller.signal });
        filePath = tempMp4;
        name = drive.driveVideoFileName(dirname, 'mp4');
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
      uploadsInFlight.delete(dirname);
      if (tempMp4) fs.rm(tempMp4, { force: true }, () => {});
      if (!res.writableEnded) res.end();
    }
  });
}

module.exports = { register };
