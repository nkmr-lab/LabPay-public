// LabPay service worker.
// Goals:
//   * Make the app installable (PWA criterion).
//   * Network-first for static assets so deploys propagate without manual cache busting.
//   * NEVER cache /api/* — ledger consistency requires fresh reads.
//   * Offline fallback for the shell so the app at least loads when the network blips.

const CACHE_NAME = 'labpay-shell-v475';
// v465 アップロード 画像 (固定 URL = ファイル名 ハッシュ) は cache-first に
// 別キャッシュ で 永続化。 シェル を 更新 しても 画像 は 落ち ない。
const IMG_CACHE_NAME = 'labpay-images-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // シェル の 古い キャッシュ は 削除、 画像キャッシュ は 保持。
    await Promise.all(keys
      .filter(k => k !== CACHE_NAME && k !== IMG_CACHE_NAME)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API: ledger source of truth. Always go to network; never cache.
  if (url.pathname.startsWith('/api/')) return;

  // v465 /uploads/ 配下 の 画像 (SNS / places / 商品 / アバター 等) は cache-first。
  // ファイル名 が ハッシュ で 一意 なので 「stale をどうするか」 を 気にせず 永続化。
  if (url.origin === self.location.origin && url.pathname.startsWith('/uploads/')) {
    event.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          cache.put(req, resp.clone());
        }
        return resp;
      } catch (e) {
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // Same-origin assets: network-first, fall back to cache on failure.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const resp = await fetch(req);
        if (resp && resp.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, resp.clone());
        }
        return resp;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Last-ditch fallback: serve the shell for navigations so SPA routes work offline.
        if (req.mode === 'navigate') {
          const indexCached = await caches.match('/');
          if (indexCached) return indexCached;
        }
        throw e;
      }
    })());
  }
});
