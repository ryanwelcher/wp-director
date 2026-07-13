// @ts-check

/**
 * Google Drive upload — OAuth sign-in + upload a recording, return a public link.
 *
 *   GET  /api/drive/status         → { authed: boolean }
 *   GET  /api/drive/oauth/start    → 302 to Google consent screen
 *   GET  /api/drive/oauth/callback → exchanges code, caches token, closes tab
 *   POST /api/drive/upload         → { dirname } → uploads WebM, { webViewLink }
 *
 * Phase 1 tracer: uploads go to a folder the app creates and owns, since the
 * drive.file scope can't write into folders it didn't create. A real folder
 * picker (Google Picker API) arrives in Phase 2.
 */

const { findVideoFile } = require('../video');
const drive = require('../lib/google-drive');

// Filesystem-safe identifier only — rejects traversal before we touch disk.
// Mirrors isSafeRecordingDirname in routes/recordings.js (exported there in a
// later phase; kept local to avoid coupling the tracer to that refactor).
function isSafeRecordingDirname(dirname) {
  return typeof dirname === 'string' && /^[a-z0-9-]+$/i.test(dirname);
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

  app.post('/api/drive/upload', async (req, res) => {
    const { dirname } = req.body || {};
    if (!isSafeRecordingDirname(dirname)) {
      return res.status(400).json({ error: 'Invalid recording name.' });
    }
    if (!drive.isAuthed()) {
      return res.status(400).json({ error: 'Not signed in to Google Drive.' });
    }

    const found = findVideoFile(dirname);
    if (!found) return res.status(404).json({ error: 'Recording not found.' });

    try {
      // No folderId → uploads to the app-owned folder, created on first use.
      // (drive.file can't write into hand-made folders it didn't create.)
      const { webViewLink } = await drive.uploadFile({
        filePath: found.file,
        name: `${dirname}.${found.ext}`,
        mimeType: found.mime,
      });
      res.json({ webViewLink });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Upload failed.' });
    }
  });
}

module.exports = { register };
