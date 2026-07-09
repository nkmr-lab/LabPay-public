// LabPay service worker.
// Goals:
//   * Make the app installable (PWA criterion).
//   * v506: shell (HTML/CSS/JS) は stale-while-revalidate に変更。前回のキャッシュを即座に
//     返してから裏で更新版を取りに行く。これでスマホ起動時のロゴ出現が「キャッシュから
//     即」になり、体感が劇的に短縮。 deploy で CACHE_NAME を bump すれば古い shell は
//     activate 時に破棄され、次回アクセスで新版が降りてくる。
//   * NEVER cache /api/* (api content cache 対象を除く) — ledger consistency。
//   * Offline fallback for the shell so the app at least loads when the network blips.

const CACHE_NAME = 'labpay-shell-v954';
// アップロード画像 (固定 URL = ファイル名ハッシュ) は cache-first に
// 別キャッシュで永続化。シェルを更新しても画像は落ちない。
const IMG_CACHE_NAME = 'labpay-images-v1';
// グループ / 食べある記 / SNS / 重要連絡 / Scrapbox の GET を stale-while-revalidate
// 別キャッシュで保持。オフラインや通信遅延時でも直前の内容を即表示、
// 裏で新鮮版を取得。 ledger 系 (送金 / 残高) は含めない。
// v534 #189 古い stale な /api/groups* キャッシュが renderer を壊している可能性があるので
//   コンテンツキャッシュを v3 に bump (activate で v2 が削除される → 次回 fetch が全部
//   ネット直行)。
const CONTENT_CACHE_NAME = 'labpay-content-v3';

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
  '/js/cg_ui.js',
  '/js/version_history.js',
  '/js/print_helpers.js',   // v933 印刷/PDF 出力 の 共通ヘルパ
  '/js/lightbox.js',
  '/js/ui_ai_stars.js',
  '/js/views/login.js',
  '/js/views/home.js',
  '/manifest.webmanifest',
];

function isSwrContentPath(pathname) {
  if (!pathname.startsWith('/api/')) return false;
  // posts/latest_id はポーリング用軽量 endpoint なので必ずネット行く (キャッシュ
  // 不要だし、古い id を返すと更新検出が遅れる)。
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
    // シェルの古いキャッシュは削除、画像 / コンテンツキャッシュは保持。
    await Promise.all(keys
      .filter(k => k !== CACHE_NAME && k !== IMG_CACHE_NAME && k !== CONTENT_CACHE_NAME)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// v506 shell ファイル (HTML/CSS/JS) を stale-while-revalidate で返す共通処理。
//   1) キャッシュにあれば即返す (体感ほぼゼロ)
//   2) 並行してネットワークから新版を取り直し、成功なら次回用に保存
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

// v517 #147 #148 #149 #150 mutation (POST/PATCH/DELETE) の成功後に、関連リソースの
//   SWR キャッシュを一括破棄。これによりクライアント側で個別に invalidate を呼ばず
//   とも、「投稿 → 一覧で反映されない」「フィード追加 → 反映されない」「らぼったー
//   削除 → 残ってる」などのリロード必要問題を SW レベルで根治する。
//   破棄ロジック: mutation のパス第一セグメント (e.g. /api/posts/123/likes → 'posts')
//   をプレフィックスにして CONTENT_CACHE の同プレフィックスエントリ全削除。
async function invalidateContentByPrefix(prefix) {
  try {
    const cache = await caches.open(CONTENT_CACHE_NAME);
    const keys = await cache.keys();
    await Promise.all(keys
      .filter(req => new URL(req.url).pathname.startsWith(prefix))
      .map(req => cache.delete(req)));
  } catch (_) {}
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // v517 mutation API 成功後にキャッシュ破棄。 GET 以外の /api/* リクエストを
  //   ハイジャックして、サーバ応答が 2xx なら同じトップセグメントの SWR キャッシュ
  //   をパージする。 ledger 系 (送金 / 残高) は SWR 対象外なので影響なし。
  if (req.method !== 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith((async () => {
      const resp = await fetch(req);
      if (resp && resp.ok) {
        const m = url.pathname.match(/^\/api\/([^/]+)/);
        if (m) {
          await invalidateContentByPrefix('/api/' + m[1]);
        }
        // v883 #456 rotate-image エンドポイント (places/posts) の POST が成功したら
        //   IMG_CACHE 全消しで /uploads/ 配下の古いキャッシュを切り落とす。
        //   個別 URL 特定するより全消しの方が確実、画像は次回 fetch でまた埋まる。
        if (url.pathname.includes('/rotate-image')) {
          try { await caches.delete(IMG_CACHE_NAME); } catch (_) {}
        }
      }
      return resp;
    })());
    return;
  }
  if (req.method !== 'GET') return;

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

  // /uploads/ 配下の画像は cache-first (ファイル名がハッシュで一意なので不変)。
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
  //   旧コードは network-first だったので、モバイル網で毎回数秒の往復待ちが発生していた。
  //   SWR にすることで前回のキャッシュから即返り、裏で新版を取り直す。デプロイ時に
  //   CACHE_NAME を bump → 旧 shell が activate で破棄 → 次回アクセスで新版が降りる。
  if (url.origin === self.location.origin) {
    event.respondWith(swrShell(req));
  }
});
