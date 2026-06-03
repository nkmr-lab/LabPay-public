// LabPay service worker.
// Goals:
//   * Make the app installable (PWA criterion).
//   * Network-first for static assets so deploys propagate without manual cache busting.
//   * NEVER cache /api/* — ledger consistency requires fresh reads.
//   * Offline fallback for the shell so the app at least loads when the network blips.

const CACHE_NAME = 'labpay-shell-v229';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API: ledger source of truth. Always go to network; never cache.
  if (url.pathname.startsWith('/api/')) return;

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
