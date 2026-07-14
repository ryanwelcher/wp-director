/**
 * Google Picker loader + folder chooser.
 *
 * Phase 2: rather than list the user's Drive server-side (which would need the
 * broader `drive.readonly` scope), we run the Google Picker client-side. The
 * user browses their Drive and picks a folder, and the server sends that chosen
 * folder id with the later upload request. The Picker needs a short-lived OAuth
 * access token, which the server hands out via `GET /api/drive/token`.
 */

const GAPI_SRC = 'https://apis.google.com/js/api.js';

let gapiScriptPromise = null;
let pickerLoadPromise = null;

/** Inject the gapi loader script once; resolve when `window.gapi` exists. */
function loadGapiScript() {
  if (gapiScriptPromise) return gapiScriptPromise;
  gapiScriptPromise = new Promise((resolve, reject) => {
    if (window.gapi) return resolve(window.gapi);
    const script = document.createElement('script');
    script.src = GAPI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.gapi);
    script.onerror = () => {
      gapiScriptPromise = null;
      reject(new Error('Could not load the Google Picker script.'));
    };
    document.head.appendChild(script);
  });
  return gapiScriptPromise;
}

/** Load the `picker` gapi module once. */
async function loadPicker() {
  if (pickerLoadPromise) return pickerLoadPromise;
  const gapi = await loadGapiScript();
  pickerLoadPromise = new Promise((resolve, reject) => {
    gapi.load('picker', {
      callback: () => resolve(window.google.picker),
      onerror: () => {
        pickerLoadPromise = null;
        reject(new Error('Could not initialize the Google Picker.'));
      },
    });
  });
  return pickerLoadPromise;
}

/**
 * Open the Google Picker filtered to Drive folders and resolve with the chosen
 * folder, or `null` if the user cancels.
 *
 * @param {{ accessToken: string, apiKey: string, appId: string }} opts
 * @returns {Promise<{ id: string, name: string } | null>}
 */
export async function pickDriveFolder(opts) {
  const { accessToken, apiKey, appId } = opts;
  const picker = await loadPicker();

  return new Promise((resolve, reject) => {
    try {
      const view = new picker.DocsView(picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder');

      const instance = new picker.PickerBuilder()
        .setAppId(appId)
        .setDeveloperKey(apiKey)
        .setOAuthToken(accessToken)
        .addView(view)
        .setTitle('Choose a Drive folder for this recording')
        .setCallback((data) => {
          const action = data[picker.Response.ACTION];
          if (action === picker.Action.PICKED) {
            const doc = data[picker.Response.DOCUMENTS]?.[0];
            resolve(doc ? { id: doc[picker.Document.ID], name: doc[picker.Document.NAME] } : null);
          } else if (action === picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();

      instance.setVisible(true);
    } catch (err) {
      reject(err);
    }
  });
}
