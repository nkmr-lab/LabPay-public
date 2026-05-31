// Thin fetch wrapper for the LabPay API.
// - Sends cookies (same-origin) for session auth
// - Adds X-Requested-With: labpay on mutating requests (CSRF)
// - Generates idempotency_key for known mutating bodies
// - On 401, hops to #/login

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  // Fallback (RFC4122-ish)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function api(method, path, { body, query, withIdempotency = false } = {}) {
  const url = new URL(path, location.origin);
  if (query) for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);

  const headers = { 'Accept': 'application/json' };
  let payload = undefined;
  if (body !== undefined && MUTATING.has(method)) {
    headers['Content-Type'] = 'application/json';
    headers['X-Requested-With'] = 'labpay';
    const b = withIdempotency
      ? { ...body, idempotency_key: body.idempotency_key || uuid() }
      : body;
    payload = JSON.stringify(b);
  } else if (MUTATING.has(method)) {
    headers['X-Requested-With'] = 'labpay';
  }

  const res = await fetch(url, {
    method, headers, body: payload,
    credentials: 'same-origin', cache: 'no-store',
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }

  if (res.status === 401) {
    // Avoid bouncing during the OAuth completion redirect.
    if (location.hash !== '#/login') location.hash = '#/login';
  }
  if (!res.ok) {
    const err = (data && data.error) || { code: 'http_' + res.status, message: res.statusText };
    const e = new Error(err.message || 'request failed');
    e.code = err.code; e.status = res.status; e.details = err.details || null;
    throw e;
  }
  return data;
}

// Convenience helpers
export const get   = (p, q)    => api('GET',    p, { query: q });
export const post  = (p, body, opts) => api('POST',   p, { body, ...opts });
export const patch = (p, body) => api('PATCH',  p, { body });
export const del   = (p, q)    => api('DELETE', p, { query: q });
