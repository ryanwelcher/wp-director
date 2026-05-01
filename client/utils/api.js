function parseJSON(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function responseErrorMessage(res) {
  const text = await res.text();
  const data = parseJSON(text);
  const fallback = `Request failed (${res.status})`;

  return data?.error || data?.message || (text.trim() && !text.trim().startsWith('<') ? text.trim() : fallback);
}

export async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = parseJSON(text);

  if (!res.ok) {
    const fallback = `Request failed (${res.status})`;
    throw new Error(data?.error || data?.message || (text.trim() && !text.trim().startsWith('<') ? text.trim() : fallback));
  }

  if (text && data === null) {
    throw new Error('Invalid JSON response');
  }

  return data;
}

export function postJSON(url, body, options = {}) {
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: JSON.stringify(body),
  });
}
