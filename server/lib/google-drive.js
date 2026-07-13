// @ts-check

/**
 * Google Drive client — thin wrapper around the official `googleapis` SDK.
 *
 * Phase 1 tracer: OAuth 2.0 per-user sign-in, resumable upload of a recording's
 * WebM to a folder, then flip the file to "anyone with link can view" and hand
 * back its webViewLink.
 *
 * Auth model mirrors the existing `.env` Anthropic key: single local user,
 * tokens cached server-side in `.gdrive-token.json` (gitignored). We request
 * the lowest-privilege scope that lets us write our own files — `drive.file`.
 */

const fs = require('fs');
const { google } = require('googleapis');
const { GDRIVE_TOKEN_FILE } = require('../config');

// Lowest privilege that lets the app create/read/manage files it owns. Do not
// broaden — the Phase 2 folder picker uses the Google Picker API precisely so
// this can stay the ceiling.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Destination folder the app creates and owns. Under drive.file the app can only
// see/write folders it created itself, so a hand-made Drive folder is invisible
// to us — we create our own instead. Overridable via env for naming preference.
const UPLOAD_FOLDER_NAME = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'WP Director Uploads';

/**
 * Build an OAuth2 client from env config. Throws if the app isn't configured
 * so routes can surface a clear 500 rather than a cryptic SDK error.
 *
 * @returns {import('google-auth-library').OAuth2Client}
 */
function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Google Drive is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env.',
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** @returns {Record<string, any> | null} */
function readToken() {
  try {
    return JSON.parse(fs.readFileSync(GDRIVE_TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {Record<string, any>} tokens */
function writeToken(tokens) {
  fs.writeFileSync(GDRIVE_TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

/**
 * Load the cached token and return a ready-to-use OAuth2 client, or `null` if
 * the user hasn't signed in yet. Persists refreshed tokens automatically.
 *
 * @returns {import('google-auth-library').OAuth2Client | null}
 */
function getAuthClient() {
  const tokens = readToken();
  if (!tokens) return null;

  const client = createOAuthClient();
  client.setCredentials(tokens);
  // The SDK refreshes the access token from the refresh token as needed; persist
  // whatever it hands back so the cache stays current across restarts.
  client.on('tokens', (fresh) => {
    writeToken({ ...tokens, ...fresh });
  });
  return client;
}

/** @returns {boolean} */
function isAuthed() {
  const tokens = readToken();
  return Boolean(tokens && tokens.refresh_token);
}

/**
 * Consent URL for the sign-in flow. `access_type: 'offline'` + `prompt: 'consent'`
 * ensures we get a refresh token so uploads survive server restarts.
 *
 * @returns {string}
 */
function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

/**
 * Exchange an OAuth authorization code for tokens and persist them.
 *
 * @param {string} code
 * @returns {Promise<void>}
 */
async function exchangeCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  writeToken(tokens);
}

/**
 * Find the app-owned upload folder by name, creating it if absent. Under the
 * drive.file scope, files.list only returns files this app created, so this
 * reliably finds our own folder and never collides with the user's other Drive
 * folders of the same name.
 *
 * @param {import('googleapis').drive_v3.Drive} drive
 * @returns {Promise<string>} folder id
 */
async function getOrCreateUploadFolder(drive) {
  const escapedName = UPLOAD_FOLDER_NAME.replace(/'/g, "\\'");
  const existing = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
    pageSize: 1,
  });
  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await drive.files.create({
    requestBody: { name: UPLOAD_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  if (!created.data.id) throw new Error('Could not create the Drive upload folder.');
  return created.data.id;
}

/**
 * Resumable upload of a local file, then make it public (anyone with the link
 * can view) and return its share link. If no folderId is given, uploads to the
 * app-owned upload folder (created on first use).
 *
 * @param {{ filePath: string, name: string, mimeType: string, folderId?: string }} opts
 * @returns {Promise<{ id: string, webViewLink: string }>}
 */
async function uploadFile({ filePath, name, mimeType, folderId }) {
  const auth = getAuthClient();
  if (!auth) throw new Error('Not signed in to Google Drive.');

  const drive = google.drive({ version: 'v3', auth });

  const parentId = folderId || await getOrCreateUploadFolder(drive);
  const requestBody = { name, parents: [parentId] };

  const created = await drive.files.create({
    requestBody,
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id, webViewLink',
  });

  const id = created.data.id;
  if (!id) throw new Error('Drive upload did not return a file id.');

  // "anyone / reader" == public link, view-only.
  await drive.permissions.create({
    fileId: id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  const webViewLink = created.data.webViewLink;
  if (!webViewLink) throw new Error('Drive upload succeeded but returned no shareable link.');

  return { id, webViewLink };
}

module.exports = {
  getAuthClient,
  isAuthed,
  getAuthUrl,
  exchangeCode,
  uploadFile,
};
