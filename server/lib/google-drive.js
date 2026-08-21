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
const { PassThrough } = require('stream');
const { google } = require('googleapis');
const { GDRIVE_TOKEN_FILE } = require('../config');

// Upload retry policy (Phase 4). Retry transient failures (5xx / 429 / network
// drops) a handful of times with exponential backoff. googleapis/gaxios can't
// replay a consumed stream body across retries, so we own the loop and hand it
// a fresh read stream each attempt.
const MAX_UPLOAD_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8000;

// Lowest privilege that lets the app create/read/manage files it owns. Do not
// broaden the Drive scope — the Phase 2 folder picker uses the Google Picker API
// precisely so `drive.file` can stay the ceiling. `userinfo.email` is a separate,
// identity-only scope (Phase 5) so we can label the signed-in account in the UI;
// it grants no Drive access.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

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
  let tokens = readToken();
  if (!tokens) return null;

  const client = createOAuthClient();
  client.setCredentials(tokens);
  // The SDK refreshes the access token from the refresh token as needed; persist
  // whatever it hands back so the cache stays current across restarts.
  client.on('tokens', (fresh) => {
    tokens = { ...tokens, ...fresh };
    writeToken(tokens);
  });
  return client;
}

/**
 * Authed `drive_v3.Drive` client for the signed-in user, or `null` if not
 * signed in. Wraps the repeated getAuthClient() + google.drive() construction.
 *
 * @returns {import('googleapis').drive_v3.Drive | null}
 */
function getDriveClient() {
  const auth = getAuthClient();
  return auth ? google.drive({ version: 'v3', auth }) : null;
}

// Video files this app uploads are named `<dirname>.<ext>` (webm or mp4).
// `driveVideoFileName` and `dirnameFromDriveVideoName` are inverses — keep the
// naming convention in one place so the upload route (which writes the name) and
// the uploads listing (which parses it back to a dirname) can't drift apart.
const VIDEO_UPLOAD_EXTENSIONS = ['webm', 'mp4'];
const DRIVE_VIDEO_NAME_RE = new RegExp(`\\.(${VIDEO_UPLOAD_EXTENSIONS.join('|')})$`, 'i');

/** @param {string} dirname @param {string} ext */
function driveVideoFileName(dirname, ext) {
  return `${dirname}.${ext}`;
}

/**
 * Inverse of driveVideoFileName: recover the recording dirname from an uploaded
 * Drive file's name, or `null` if the name isn't one of ours.
 *
 * @param {string} name
 * @returns {string | null}
 */
function dirnameFromDriveVideoName(name) {
  return DRIVE_VIDEO_NAME_RE.test(name) ? name.replace(DRIVE_VIDEO_NAME_RE, '') : null;
}

/**
 * Whether the OAuth env vars are present, so the UI can decide whether to offer
 * a sign-in button at all (vs. opening a tab that would just 500).
 *
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI,
  );
}

/** @returns {boolean} */
function isAuthed() {
  const tokens = readToken();
  return Boolean(tokens && tokens.refresh_token);
}

/**
 * Return a fresh OAuth access token for the signed-in user, or `null` if not
 * signed in. The SDK refreshes it from the cached refresh token when expired.
 *
 * Phase 2: the client-side Google Picker needs this short-lived access token to
 * browse the user's Drive. We hand out only the access token (never the refresh
 * token) and rely on its short TTL — see the token-exposure note in the plan.
 *
 * @returns {Promise<string | null>}
 */
async function getAccessToken() {
  const client = getAuthClient();
  if (!client) return null;
  const { token } = await client.getAccessToken();
  return token || null;
}

/**
 * Consent URL for the sign-in flow. `access_type: 'offline'` + `prompt: 'consent'`
 * ensures we get a refresh token so uploads survive server restarts.
 *
 * `state` is an anti-CSRF nonce the caller generates, stores, and re-checks on
 * the callback, so a forged callback can't graft an attacker's auth code onto
 * this session.
 *
 * @param {string} [state]
 * @returns {string}
 */
function getAuthUrl(state) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    ...(state ? { state } : {}),
  });
}

/**
 * Fetch the signed-in user's email via the OpenID userinfo endpoint. Requires
 * the `userinfo.email` scope. Returns `null` if unavailable (e.g. an older token
 * granted before that scope was added).
 *
 * @param {import('google-auth-library').OAuth2Client} client
 * @returns {Promise<string | null>}
 */
async function fetchUserEmail(client) {
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    return data.email || null;
  } catch {
    return null;
  }
}

/**
 * Exchange an OAuth authorization code for tokens and persist them. Also caches
 * the account email alongside the tokens (Phase 5) so status checks can label the
 * signed-in account without a Google round-trip on every request.
 *
 * @param {string} code
 * @returns {Promise<void>}
 */
async function exchangeCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const email = await fetchUserEmail(client);
  writeToken(email ? { ...tokens, email } : tokens);
}

/**
 * The signed-in Google account email, read from the cached token (no network).
 * `null` if not signed in, or if the token predates the `userinfo.email` scope.
 *
 * @returns {string | null}
 */
function getAccountEmail() {
  const tokens = readToken();
  return tokens?.email || null;
}

/**
 * Sign out: revoke the token with Google, then delete the cached token file so
 * the next upload starts a fresh consent flow. Revocation is best-effort — we
 * still delete the local token even if the network call fails, so the app's
 * signed-in state is always cleared.
 *
 * @returns {Promise<void>}
 */
async function signOut() {
  const client = getAuthClient();
  if (client) {
    try {
      await client.revokeCredentials();
    } catch {
      /* already revoked / expired / offline — local delete below still clears us */
    }
  }
  try {
    fs.rmSync(GDRIVE_TOKEN_FILE, { force: true });
  } catch {
    /* nothing to remove */
  }
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
 * List the video files this app has uploaded, most-recent first. Under the
 * `drive.file` scope, `files.list` only returns files this app itself created
 * *for the currently signed-in account* — so the result is inherently scoped to
 * that account (sign in as someone else and you see none of these). Used to
 * detect whether a recording was already uploaded and surface its existing link
 * without any local bookkeeping. Returns `[]` when signed out.
 *
 * @returns {Promise<Array<{ name: string, webViewLink: string }>>}
 */
async function listUploadedVideos() {
  const drive = getDriveClient();
  if (!drive) return [];
  const res = await drive.files.list({
    q: "trashed=false and (mimeType='video/webm' or mimeType='video/mp4')",
    fields: 'files(name, webViewLink, modifiedTime)',
    orderBy: 'modifiedTime desc',
    spaces: 'drive',
    pageSize: 1000,
  });
  return (res.data.files || [])
    .filter((f) => f.name && f.webViewLink)
    .map((f) => ({ name: /** @type {string} */ (f.name), webViewLink: /** @type {string} */ (f.webViewLink) }));
}

/** An Error the caller can recognize as a user- or disconnect-driven cancellation. */
function abortError() {
  const err = new Error('Upload cancelled.');
  err.name = 'AbortError';
  return err;
}

/** @param {any} err */
function isAbortError(err) {
  return Boolean(err) && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
}

// Transient failures worth retrying: server-side 5xx, 429 rate limits, and
// low-level network drops. Client 4xx (bad request, auth) are terminal.
const RETRYABLE_NET_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'ECONNREFUSED', 'EPIPE', 'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE',
]);

/** @param {any} err */
function isRetryableUploadError(err) {
  if (!err) return false;
  const status = typeof err.status === 'number'
    ? err.status
    : (typeof err.response?.status === 'number' ? err.response.status : null);
  if (status !== null) return status === 429 || status >= 500;
  return typeof err.code === 'string' && RETRYABLE_NET_CODES.has(err.code);
}

/**
 * Sleep that rejects with an abort error if `signal` fires first, so a cancelled
 * upload doesn't sit idle in a backoff wait.
 *
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); reject(abortError()); };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Read stream that reports cumulative bytes read as they flow toward the upload.
 * We can't use gaxios's `onUploadProgress` (declared but never fired in gaxios
 * v7), so we count bytes on a PassThrough the SDK consumes as the request body.
 *
 * @param {string} filePath
 * @param {(bytesRead: number) => void} onBytes
 * @returns {import('stream').PassThrough}
 */
function countingStream(filePath, onBytes) {
  const source = fs.createReadStream(filePath);
  const pass = new PassThrough();
  let sent = 0;
  pass.on('data', (chunk) => { sent += chunk.length; onBytes(sent); });
  pass.on('close', () => source.destroy());
  source.on('error', (err) => pass.destroy(err));
  source.pipe(pass);
  return pass;
}

/**
 * Upload a local file, then make it public (anyone with the link can view) and
 * return its share link. If no folderId is given, uploads to the app-owned
 * upload folder (created on first use).
 *
 * Phase 4: reports byte progress via `onProgress`, is cancellable via `signal`,
 * and retries transient failures with exponential backoff.
 *
 * @param {{
 *   filePath: string,
 *   name: string,
 *   mimeType: string,
 *   folderId?: string,
 *   description?: string,
 *   signal?: AbortSignal,
 *   onProgress?: (p: { bytesUploaded: number, totalBytes: number, retrying?: boolean, attempt?: number }) => void,
 * }} opts
 * @returns {Promise<{ id: string, webViewLink: string }>}
 */
async function uploadFile({ filePath, name, mimeType, folderId, description, signal, onProgress }) {
  const drive = getDriveClient();
  if (!drive) throw new Error('Not signed in to Google Drive.');

  const parentId = folderId || await getOrCreateUploadFolder(drive);
  const requestBody = { name, parents: [parentId] };
  // Drive `description` metadata — makes the file findable later (Phase 3).
  if (description) requestBody.description = description;

  let totalBytes = 0;
  try { totalBytes = fs.statSync(filePath).size; } catch { /* size unknown — progress goes indeterminate */ }

  let created;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError();
    try {
      const body = countingStream(filePath, (bytesUploaded) => {
        onProgress?.({ bytesUploaded, totalBytes });
      });
      created = await drive.files.create(
        { requestBody, media: { mimeType, body }, fields: 'id, webViewLink' },
        { signal },
      );
      break;
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw abortError();
      const canRetry = attempt < MAX_UPLOAD_ATTEMPTS - 1 && isRetryableUploadError(err);
      if (!canRetry) throw err;
      const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
      onProgress?.({ bytesUploaded: 0, totalBytes, retrying: true, attempt: attempt + 1 });
      await delay(backoff, signal);
    }
  }

  const id = created.data.id;
  if (!id) throw new Error('Drive upload did not return a file id.');

  // "anyone / reader" == public link, view-only.
  await drive.permissions.create(
    { fileId: id, requestBody: { role: 'reader', type: 'anyone' } },
    { signal },
  );

  const webViewLink = created.data.webViewLink;
  if (!webViewLink) throw new Error('Drive upload succeeded but returned no shareable link.');

  return { id, webViewLink };
}

module.exports = {
  getAuthClient,
  isAuthed,
  isConfigured,
  getAccessToken,
  getAccountEmail,
  getAuthUrl,
  exchangeCode,
  signOut,
  uploadFile,
  listUploadedVideos,
  driveVideoFileName,
  dirnameFromDriveVideoName,
  isAbortError,
};
