// LabPay service worker.
// Goals:
//   * Make the app installable (PWA criterion).
//   * Network-first for static assets so deploys propagate without manual cache busting.
//   * NEVER cache /api/* — ledger consistency requires fresh reads.
//   * Offline fallback for the shell so the app at least loads when the network blips.

const CACHE_NAME = 'labpay-shell-v495';
// v465 アップロード 画像 (固定 URL = ファイル名 ハッシュ) は cache-first に
// 別キャッシュ で 永続化。 シェル を 更新 しても 画像 は 落ち ない。
const IMG_CACHE_NAME = 'labpay-images-v1';
// v479 グループ / 食べある記 / SNS / 重要連絡 / Scrapbox の GET を stale-while-revalidate
// 別キャッシュ で 保持。 オフライン や 通信 遅延 時 でも 直前 の 内容 を 即 表示、
// 裏で 新鮮版 を 取得。 ledger 系 (送金 / 残高) は 含めない。
// v480 /api/me / /api/users も オフライン 表示 用 に SWR。 グループ 一覧 を
//   出す のに ログイン ユーザ 情報 と メンバー 名 が 要る ため。
const CONTENT_CACHE_NAME = 'labpay-content-v1';
function isSwrContentPath(pathname) {
  if (!pathname.startsWith('/api/')) return false;
  // posts/latest_id は ポーリング 用 軽量 endpoint なので 必ず ネット 行く (キャッシュ
  // 不要 だし、 古い id を 返すと 更新検出 が 遅れる)。
  if (pathname === '/api/posts/latest_id') return false;
  return (
    pathname === '/api/groups'  || pathname.startsWith('/api/groups/') ||
    pathname === '/api/places'  || pathname.startsWith('/api/places/') ||
    pathname === '/api/posts'   || pathname.startsWith('/api/posts/')  ||
    pathname === '/api/notices' || pathname.startsWith('/api/notices/')||
    pathname === '/api/scrapbox'|| pathname.startsWith('/api/scrapbox/')||
    pathname === '/api/me'      ||
    pathname === '/api/users'
  );
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // シェル の 古い キャッシュ は 削除、 画像 / コンテンツ キャッシュ は 保持。
    await Promise.all(keys
      .filter(k => k !== CACHE_NAME && k !== IMG_CACHE_NAME && k !== CONTENT_CACHE_NAME)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // v479 オフライン 用 SWR — グループ / 食べある記 / SNS / 重要連絡 / Scrapbox の
  // GET だけ stale-while-revalidate。 ledger 系 (送金 / 残高 / 購入 履歴) は 含めず、
  // また 認証 関連 や 個人 状態 も 触らない。
  if (url.pathname.startsWith('/api/') && isSwrContentPath(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CONTENT_CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then(resp => {
          if (resp && resp.status === 200) cache.put(req, resp.clone());
          return resp;
        })
        .catch(e => null);
      if (cached) {
        // 裏 で 取得 (新鮮版は 次回 表示 で 使う)。
        network.catch(() => {});
        return cached;
      }
      const fresh = await network;
      if (fresh) return fresh;
      throw new Error('offline');
    })());
    return;
  }
  // API (それ以外): ledger source of truth. Always go to network; never cache.
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
