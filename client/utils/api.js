function parseJSON(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseMessage(res, text, data) {
  const fallback = `Request failed (${res.status})`;
  const trimmed = text.trim();

  return data?.error || data?.message || (trimmed && !trimmed.startsWith('<') ? trimmed : fallback);
}

export async function responseErrorMessage(res) {
  const text = await res.text();
  const data = parseJSON(text);

  return responseMessage(res, text, data);
}

function apiRequest(url, options = {}) {
  return fetch(url, options);
}

async function readJSONResponse(res) {
  const text = await res.text();
  const data = parseJSON(text);

  if (!res.ok) {
    throw new Error(responseMessage(res, text, data));
  }

  if (text && data === null) {
    throw new Error('Invalid JSON response');
  }

  return data;
}

async function requestJSON(url, options = {}) {
  return readJSONResponse(await apiRequest(url, options));
}

function postOptions(body, options = {}) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: JSON.stringify(body),
  };
}

export const queryKeys = {
  blueprint: {
    default: ['blueprint', 'default'],
    current: ['blueprint', 'current'],
  },
  directions: {
    all: ['directions'],
    detail: (filename) => ['directions', filename],
  },
  recordings: ['recordings'],
  scripts: ['scripts'],
};

export const api = {
  async getDefaultBlueprint({ signal } = {}) {
    const data = await requestJSON('/api/default-blueprint', { signal });
    return data?.blueprint ?? null;
  },

  async getCurrentBlueprint({ signal } = {}) {
    const data = await requestJSON('/api/current-blueprint', { signal });
    return data?.blueprint ?? null;
  },

  async listScripts({ signal } = {}) {
    const data = await requestJSON('/api/scripts', { signal });
    return data?.scripts ?? [];
  },

  async saveScript({ name, directions, endPause }) {
    return requestJSON('/api/scripts/save', postOptions({ name, directions, endPause }));
  },

  async deleteScript(filename) {
    return requestJSON(`/api/scripts/${filename}`, { method: 'DELETE' });
  },

  async listDirections({ signal } = {}) {
    const data = await requestJSON('/api/directions', { signal });
    return data?.directions ?? [];
  },

  async getDirection(filename, { signal } = {}) {
    return requestJSON(`/api/directions/${filename}`, { signal });
  },

  async saveDirection({ name, actions }) {
    return requestJSON('/api/directions/save', postOptions({ name, actions }));
  },

  async deleteDirection(filename) {
    return requestJSON(`/api/directions/${filename}`, { method: 'DELETE' });
  },

  async listRecordings({ signal } = {}) {
    const data = await requestJSON('/api/recordings', { signal });
    return data?.recordings ?? [];
  },

  async saveBlueprint(blueprint) {
    return requestJSON('/api/save-blueprint', postOptions({ blueprint }));
  },

  async previewBlueprint(blueprint) {
    return requestJSON('/api/preview-blueprint', postOptions({ blueprint }));
  },

  async translateCommand({ command, history }) {
    return requestJSON('/api/translate', postOptions({ command, history }));
  },

  startRun(endpoint, body, signal) {
    return apiRequest(endpoint, postOptions(body, { signal }));
  },

  async stopRun() {
    return requestJSON('/api/stop', postOptions({}));
  },
};
