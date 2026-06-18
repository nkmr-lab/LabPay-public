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

  // iOS Safari (and the PWA wrapper) occasionally returns a TypeError
  // 'Load Failed' / 'Failed to fetch' on the FIRST request after the page has
  // been suspended (sleep, tab swap). A bare retry usually succeeds and the
  // user-visible behavior is much smoother than a toast asking them to tap
  // again. We retry once, only on transport-level failures — HTTP errors
  // (4xx/5xx) still bubble unchanged so legitimate problems aren't masked.
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload,
      credentials: 'same-origin', cache: 'no-store' });
  } catch (e) {
    const transient = e && (e.name === 'TypeError' || /load failed|failed to fetch|network/i.test(e.message || ''));
    if (!transient) throw e;
    await new Promise(r => setTimeout(r, 250));
    res = await fetch(url, { method, headers, body: payload,
      credentials: 'same-origin', cache: 'no-store' });
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }

  if (res.status === 401) {
    // Avoid bouncing during the OAuth completion redirect.
    // v679 #259 公開 タイマー は 認証 不要 で 表示 する ので 401 で login に 飛ばさ ない
    if (location.hash !== '#/login' && !location.hash.startsWith('#/public-timer/')) {
      location.hash = '#/login';
    }
  }
  if (!res.ok) {
    const err = (data && data.error) || { code: 'http_' + res.status, message: res.statusText };
    const e = new Error(err.message || 'request failed');
    e.code = err.code; e.status = res.status; e.details = err.details || null;
    throw e;
  }
  return data;
}

// v598 SW の SWR コンテンツ キャッシュ (labpay-content-vN) を path prefix で
//   一括 invalidate するヘルパ。 SW を bump して キャッシュ名が変わっても
//   labpay-content-* を全部なめるので 自動追従する。
//   呼び出し例: invalidateContentCache('/api/posts') — 投稿 直後/新着検知 直後 に。
export async function invalidateContentCache(pathPrefix) {
  if (!('caches' in window)) return;
  try {
    const names = await caches.keys();
    const targets = names.filter(n => n.startsWith('labpay-content-'));
    await Promise.all(targets.map(async (n) => {
      const cache = await caches.open(n);
      const keys = await cache.keys();
      await Promise.all(keys
        .filter(req => new URL(req.url).pathname.startsWith(pathPrefix))
        .map(req => cache.delete(req)));
    }));
  } catch (_) {}
}

// Convenience helpers
export const get   = (p, q)    => api('GET',    p, { query: q });
export const post  = (p, body, opts) => api('POST',   p, { body, ...opts });
export const patch = (p, body) => api('PATCH',  p, { body });
export const put   = (p, body) => api('PUT',    p, { body });
export const del   = (p, q)    => api('DELETE', p, { query: q });
