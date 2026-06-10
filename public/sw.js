// LabPay service worker.
// Goals:
//   * Make the app installable (PWA criterion).
//   * v506: shell (HTML/CSS/JS) は stale-while-revalidate に変更。 前回のキャッシュを即座に
//     返してから裏で更新版を取りに行く。 これでスマホ起動時のロゴ出現が「キャッシュから
//     即」 になり、 体感が劇的に短縮。 deploy で CACHE_NAME を bump すれば古い shell は
//     activate 時に破棄され、 次回アクセスで新版が降りてくる。
//   * NEVER cache /api/* (api content cache 対象を除く) — ledger consistency。
//   * Offline fallback for the shell so the app at least loads when the network blips.

const CACHE_NAME = 'labpay-shell-v506';
// アップロード 画像 (固定 URL = ファイル名 ハッシュ) は cache-first に
// 別キャッシュ で 永続化。 シェル を 更新 しても 画像 は 落ち ない。
const IMG_CACHE_NAME = 'labpay-images-v1';
// グループ / 食べある記 / SNS / 重要連絡 / Scrapbox の GET を stale-while-revalidate
// 別キャッシュ で 保持。 オフライン や 通信 遅延 時 でも 直前 の 内容 を 即 表示、
// 裏で 新鮮版 を 取得。 ledger 系 (送金 / 残高) は 含めない。
const CONTENT_CACHE_NAME = 'labpay-content-v2';

// v506 #131 install 時にこれだけは確実に precache (起動の最重要パス)。
//   足りない場合は実行時に追加でキャッシュされる (shell SWR で網羅)。
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/router.js',
  '/js/api.js',
  '/js/upload.js',
  '/js/labels.js',
  '/js/format.js',
  '/js/sounds.js',
  '/js/audio_unlock.js',
  '/js/settings_sync.js',
  '/js/views/login.js',
  '/js/views/home.js',
  '/manifest.webmanifest',
];

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
  // v506 起動直後の白画面を最小化するため shell を precache。
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // 失敗しても install 自体は通す (404 等でこけても skipWaiting する)
      await Promise.allSettled(PRECACHE_URLS.map(u => cache.add(u).catch(() => null)));
    } catch (_) {}
    self.skipWaiting();
  })());
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

// v506 shell ファイル (HTML/CSS/JS) を stale-while-revalidate で返す共通処理。
//   1) キャッシュにあれば即返す (体感ほぼゼロ)
//   2) 並行してネットワークから新版を取り直し、 成功なら次回用に保存
//   3) キャッシュも無ければネットワーク待ち
async function swrShell(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const network = fetch(req).then(resp => {
    if (resp && resp.status === 200) {
      // 同一オリジン GET なら cache.put OK。 opaque はキャッシュしない。
      cache.put(req, resp.clone()).catch(() => {});
    }
    return resp;
  }).catch(() => null);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  // ナビゲーションなら最低限 / を返す
  if (req.mode === 'navigate') {
    const indexCached = await cache.match('/');
    if (indexCached) return indexCached;
  }
  throw new Error('offline');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API: SWR 対象ものだけキャッシュ。 ledger 系は毎回ネット。
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

  // /uploads/ 配下 の 画像 は cache-first (ファイル名がハッシュで一意なので不変)。
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

  // v506 シェル (HTML / CSS / JS / 静的ファイル) は stale-while-revalidate。
  //   旧コードは network-first だったので、 モバイル網で毎回 数秒の往復待ちが発生していた。
  //   SWR にすることで前回のキャッシュから即返り、 裏で新版を取り直す。 デプロイ時に
  //   CACHE_NAME を bump → 旧 shell が activate で破棄 → 次回アクセスで新版が降りる。
  if (url.origin === self.location.origin) {
    event.respondWith(swrShell(req));
  }
});
