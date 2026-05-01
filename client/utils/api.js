export async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
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
