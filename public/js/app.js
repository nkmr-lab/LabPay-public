// App entry: wires router, loads views, manages global chrome (balance pill, unread badge, logout).
// v490 #88 起動速度改善: 50+ の view モジュールを eager import していたのを
//   route 時の dynamic import() に変更。初回起動で必要なのは shell + login と
//   home のみ。これら 2 つだけ eager、他はタップ時に初回ロード + キャッシュ。

import { route, start, navigate, escapeHtml } from './router.js';
import { get, post } from './api.js';

// ホットパス 2 つ (起動直後必ず通る) は eager。
import { renderLogin } from './views/login.js';
import { renderHome } from './views/home.js';
import { preloadSounds } from './sounds.js';
import { installGlobalAudioUnlock } from './audio_unlock.js';
import { bootSettingsSync } from './settings_sync.js';

// 遅延ロードヘルパー: route 時に初回だけ import する。 import() が返す
//   Promise はブラウザがキャッシュするので、同じページを 2 回目開くと
//   即時解決。
function lazy(loader, name) {
  return (ctx) => loader().then(m => m[name](ctx));
}

// ---------- Toast ----------
export function toast(message, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}
window.toast = toast;

// ---------- Global state ----------
export const state = {
  me: null,
  balance: null,
  unread: 0,
  inLab: false,   // server-enforced lab-Wi-Fi gate; mirrored here so the UI can grey out 購入 buttons
  hasMac: true,   // false → show "Mac 登録してね" onboarding banner on home
  hasGroups: false, // 自分が入ってるグループが 1 つ以上あるか (タブの「グループ」表示制御)
};

// v498 #108 起動高速化: /api/auth/me の結果を localStorage にキャッシュして、起動時の
//   白画面を縮める。ここに前回のレスポンスを優しくスナップショットしておき、 boot 時に
//   即座に hydrate → chrome を出す → 裏で再検証 (SWR 風)。
const ME_CACHE_KEY = 'labpay-me-cache';
function readMeCache() {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || !j.user) return null;
    return j;
  } catch { return null; }
}
function writeMeCache(data) {
  try {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify({
      user: data.user, balance: data.balance,
      in_lab: !!data.in_lab, has_registered_mac: !!data.has_registered_mac,
    }));
  } catch {}
}
function clearMeCache() {
  try { localStorage.removeItem(ME_CACHE_KEY); } catch {}
}

export async function refreshMe() {
  try {
    const data = await get('/api/auth/me');
    state.me = data.user;
    state.balance = data.balance;
    state.inLab = !!data.in_lab;
    state.hasMac = !!data.has_registered_mac;
    writeMeCache(data);
    renderChrome();
    // タブの「グループ」表示判定。失敗・遅延しても他の処理を止めないよう
    // fire-and-forget。結果が遅れて来てもタブが追加で出るだけなので無害。
    refreshHasGroups();
    // 効果音の解決済み設定を 1 回だけ pull。失敗しても他に影響しないよう fire-and-forget。
    preloadSounds();
    // v448 ページ上のどこかで最初に起きた pointerdown / touchstart / keydown
    // 1 回で共有 AudioContext + HTMLAudio を unlock。以降 setInterval からの
    // タイマーベル / 効果音が iOS Safari でも通る。
    installGlobalAudioUnlock();
    // v456 設定をサーバから引いて localStorage に反映 (デバイス間同期)。
    // 直後に localStorage を読み込む view があるので await。失敗しても黙殺
    // (オフラインや未ログインのフォールバックがきく)。
    await bootSettingsSync();
    return data;
  } catch (e) {
    // v559 #217 ネットワーク障害 (= ステータスコードが取れない / 0) と認証失敗 (401/403) を区別:
    //   - 認証失敗: clearMeCache + 未ログインへ
    //   - ネットエラー: キャッシュ温存 (オフラインでも閲覧継続)
    const isAuthError = e?.status === 401 || e?.status === 403;
    if (isAuthError) {
      state.me = null;
      clearMeCache();
      renderChrome();
      return null;
    }
    // オフライン: キャッシュをそのまま使い続ける
    console.warn('[refreshMe] network error, keeping cache', e);
    return state.me;
  }
}

// 自分が入ってるグループの有無を /api/groups で確認してタブ可視を更新。
// home / groups の各 view で再度叩かれるが、タブ判定だけは bootstrap で
// 走らないと初回ページが home 以外の時タブが出ないので app.js でも呼ぶ。
export async function refreshHasGroups() {
  try {
    const d = await get('/api/groups');
    state.hasGroups = Array.isArray(d.items) && d.items.length > 0;
    renderChrome();
  } catch (_) { /* 取れなければ前回値を保持 */ }
}

// 直近に見た最大 notification id。 polling で新着検知に使う。
// undefined の間 (= 初回ロード前) は新着 toast を出さない (=スタート時の溜まりを
// 全部 toast に出してしまわないようにする)。
let lastSeenNotifId;
let lastUnread = 0;

export async function refreshUnread() {
  if (!state.me) return;
  try {
    const d = await get('/api/notifications/unread_count');
    const newCount = d.unread || 0;
    // 増加分があれば直近の未読を取りに行って「新着通知トースト」を出す。
    // 初回ロード時 (lastSeenNotifId 未定) は「これ以降の追加分だけ」を toast 対象にしたいので
    // 高水位を立てるだけで toast は鳴らさない。
    if (lastSeenNotifId !== undefined && newCount > lastUnread) {
      try {
        const data = await get('/api/notifications', { unread: 1, limit: 20 });
        const fresh = (data.items || []).filter(n => Number(n.id) > Number(lastSeenNotifId));
        if (fresh.length) {
          showNotificationToasts(fresh);
          lastSeenNotifId = Math.max(...fresh.map(n => Number(n.id)), Number(lastSeenNotifId));
        }
      } catch (_) {}
    } else if (lastSeenNotifId === undefined) {
      // 初回: 既存の最大 id を baseline に。
      try {
        const data = await get('/api/notifications', { limit: 1 });
        const top = (data.items || [])[0];
        lastSeenNotifId = top ? Number(top.id) : 0;
      } catch (_) { lastSeenNotifId = 0; }
    }
    lastUnread = newCount;
    state.unread = newCount;
    renderChrome();
    if (state.unread === 0) tryAppOpenReward();
  } catch (_) {}
}

// 新着通知 1 〜 N 件を「アプリ内トースト」 + (許可があれば) 「OS 通知」で見せる。
// 行数が多い時はまとめて 1 つの toast にする。
function showNotificationToasts(items) {
  // OS 通知 (許可済みの時だけ)。
  // タップで該当ページに飛ばす。 service worker 経由しない「ページが開いてる時の通知」なので
  // タブがアクティブだと OS の通知センターに残らない端末もあるが、トースト感は出る。
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    for (const n of items.slice(0, 3)) {
      try {
        const n2 = new Notification('LabPay', {
          body: String(n.body || '').slice(0, 200),
          tag: 'labpay-notif-' + n.id,        // 同 tag は上書き
          icon: '/img/favicon-32.png',
        });
        n2.onclick = () => {
          window.focus();
          if (location.hash !== '#/notifications') {
            window.location.hash = '#/notifications';
          }
          n2.close();
        };
      } catch (_) {}
    }
  }
  // アプリ内トースト (画面下にスライドイン)。
  if (items.length === 1) {
    toast('🔔 ' + String(items[0].body).slice(0, 80), 4500);
  } else {
    toast(`🔔 新着通知 ${items.length} 件`, 4500);
  }
}

// 通知許可をリクエスト (settings から手動呼び出し)。
export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') {
    toast('このブラウザは通知に対応していません');
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') {
    toast('ブラウザ設定で「ブロック」になっています。ブラウザ設定から許可してください', 5000);
    return 'denied';
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    toast('🔔 通知を有効にしました');
    try { new Notification('LabPay', { body: '通知が届くようになりました!', icon: '/img/favicon-32.png' }); } catch (_) {}
  } else {
    toast('通知は許可されませんでした');
  }
  return result;
}

// 「今日のアプリ起動ボーナス」すでに試した日を localStorage に持っておく。
// awarded / already_today を貰えた日はこれ以上 ping しない。 unread_pending /
// fetch エラーは未着なので残しておいて、次の refreshUnread でまた試す。
const REWARD_CACHE_KEY = 'labpay-app-open-reward-date';
function todayJST() {
  // サーバ側は date('Y-m-d') (= JST。 PHP の default_timezone)。ブラウザは
  // ユーザ環境依存だが、日本国内利用なので Asia/Tokyo に揃える。
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
async function tryAppOpenReward() {
  const today = todayJST();
  if (localStorage.getItem(REWARD_CACHE_KEY) === today) return;
  try {
    const r = await post('/api/me/app-open-reward', {});
    if (r.awarded) {
      toast(`🎁 アプリ起動ボーナス +${r.points}pt`);
      localStorage.setItem(REWARD_CACHE_KEY, today);
    } else if (r.reason === 'already_today' || r.reason === 'disabled') {
      // 既に貰った / 機能無効。今日はもう ping しない。
      localStorage.setItem(REWARD_CACHE_KEY, today);
    }
    // unread_pending やネットワークエラーは cache しない (次の機会に再試行)。
  } catch (_) {}
}

function renderChrome() {
  const top = document.getElementById('topbar');
  const tabs = document.getElementById('tabs');
  const adminLink = document.getElementById('admin-link');
  const feedbackAdminLink = document.getElementById('feedback-admin-link');
  const badge = document.getElementById('unread-badge');

  if (!state.me) {
    top.hidden = true;
    tabs.hidden = true;
    return;
  }
  top.hidden = false;
  tabs.hidden = false;
  const isAdmin = state.me.role === 'admin';
  adminLink.hidden = !isAdmin;
  if (feedbackAdminLink) feedbackAdminLink.hidden = !isAdmin;
  // v445 → v464: admin のトップバーは「通知 / 設定 / 管理 / FB | 機能要望 / バグ報告」。
  // FB (= 報告・要望、 admin 専用受信箱) と機能要望 / バグ報告 (投稿入口) を
  // セパレータで分ける。機能要望 / バグ報告は admin にも表示 (Claude への指示
  // チャネルとして使うため)。
  // v517 #146 「要望」「報告」を統合して「📝 フィードバック」 1 つに
  const fbLink = document.getElementById('feedback-link');
  const sep    = document.getElementById('topbar-sep');
  if (fbLink) fbLink.hidden = false;
  if (sep)    sep.hidden    = !isAdmin;
  if (state.unread > 0) {
    badge.hidden = false;
    badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
  } else {
    badge.hidden = true;
  }
  const groupsTab = document.getElementById('tab-groups');
  if (groupsTab) groupsTab.hidden = !state.hasGroups;
  applyTabLayout();
}

// ────────────── タブのカスタマイズ ──────────────────────────────────
// 表示するタブと並び順を localStorage に保存。設定の「タブのカスタマイズ」で編集。
// nav#tabs 内の <a data-tab-id="..."> を保存 order に従って並べ替え + hidden 適用。
// v497 #103 タブ整理:
//   - 「購入」を「売買」にrename (販売との合算入口的位置づけ)
//   - 「食べある記」 (places) をタブとして追加
//   - DEFAULT_HIDDEN_TABS: 販売 / 競売 / ラボにいる人を初期非表示
//     (販売・競売は能動操作型なのでメニュー深掘りで足りる、「ラボにいる人」は
//      ホームに常設するため重複を避ける)。ユーザが localStorage で明示設定済み
//      なら尊重。
// v514 #131 タブの表示順 (ユーザ要望): ホーム / グループ (ある時) / らぼったー /
//   購入 / 販売 / 依頼 / 競売 / アプリ / 実績。食べある記・ラボにいる人はタブから外し
//   #/apps からアクセスする形に。全員デフォルトに戻すため、 layout key を v2 に上げる。
export const TAB_DEFS = [
  { id: 'home',         title: 'ホーム' },
  { id: 'groups',       title: 'グループ',           note: '(自分が入ってる時のみ)' },
  { id: 'sns',          title: 'らぼったー (SNS)' },
  { id: 'buy',          title: '購入' },
  { id: 'sell',         title: '販売' },
  { id: 'requests',     title: '依頼 (タスク + 募集 + 投票)' },
  { id: 'auctions',     title: '競売 (オークション)' },
  { id: 'research',     title: '研究' },
  { id: 'lab-mgmt',     title: '運営' },
  { id: 'games',        title: '娯楽' },
  { id: 'apps',         title: 'アプリ' },
  { id: 'achievements', title: '実績' },
];
export const DEFAULT_HIDDEN_TABS = []; // v514 デフォルトでは全部表示 (タブ自体を少数厳選)
const TAB_LAYOUT_KEY = 'labpay-tab-layout-v2';
export function readTabLayout() {
  try {
    const raw = localStorage.getItem(TAB_LAYOUT_KEY);
    // v497 #103 ユーザがまだ何も設定していない場合は DEFAULT_HIDDEN_TABS を初期値に。
    //   既に保存している人はその内容を尊重 (再上書きしない)。
    if (raw === null) return { order: [], hidden: [...DEFAULT_HIDDEN_TABS] };
    const j = JSON.parse(raw || '{}');
    return {
      order:  Array.isArray(j.order)  ? j.order  : [],
      hidden: Array.isArray(j.hidden) ? j.hidden : [...DEFAULT_HIDDEN_TABS],
    };
  } catch { return { order: [], hidden: [...DEFAULT_HIDDEN_TABS] }; }
}
export function writeTabLayout(layout) {
  try {
    localStorage.setItem(TAB_LAYOUT_KEY, JSON.stringify({
      order:  Array.isArray(layout.order)  ? layout.order  : [],
      hidden: Array.isArray(layout.hidden) ? layout.hidden : [],
    }));
  } catch {}
}
export function applyTabLayout() {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  const layout = readTabLayout();
  const links = Array.from(nav.querySelectorAll(':scope > [data-tab-id]'));
  const linkMap = new Map(links.map(l => [l.dataset.tabId, l]));
  const knownIds = links.map(l => l.dataset.tabId);
  const canonical = TAB_DEFS.map(t => t.id).filter(id => knownIds.includes(id));
  // 完全な orderedKnown を構築
  const orderedKnown = [];
  for (const id of layout.order) {
    if (knownIds.includes(id) && !orderedKnown.includes(id)) orderedKnown.push(id);
  }
  // layout.order に無い新規 ID を canonical で補完
  for (const id of canonical) {
    if (orderedKnown.includes(id)) continue;
    const ci = canonical.indexOf(id);
    let insertAfter = -1;
    for (let j = ci - 1; j >= 0; j--) {
      const pos = orderedKnown.indexOf(canonical[j]);
      if (pos >= 0) { insertAfter = pos; break; }
    }
    orderedKnown.splice(insertAfter + 1, 0, id);
  }
  // v642 一旦全部 detach してから順番に append。単純な appendChild の連発だと
  //   ブラウザの再 layout が一部反映されない報告があったため確実に DOM を再構築。
  for (const link of links) { if (link.parentNode === nav) nav.removeChild(link); }
  for (const id of orderedKnown) {
    const el = linkMap.get(id);
    if (el) nav.appendChild(el);
  }
  // hidden 適用
  for (const link of links) {
    link.classList.toggle('tab-user-hidden', layout.hidden.includes(link.dataset.tabId));
  }
}

// (Logout button moved to settings page)

// ---------- PWA install prompt ----------
let deferredInstallPrompt = null;
const INSTALL_DISMISS_KEY = 'labpay_install_dismissed';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
}
function isIOSSafari() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const inSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
  return iOS && inSafari;
}
function dismissedPersistent() {
  // Persistent across sessions: once user closes the banner (or installs), don't show again.
  try { if (localStorage.getItem(INSTALL_DISMISS_KEY)) return true; } catch (_) {}
  // Cookie fallback (Safari private mode etc. where localStorage is unwritable)
  return document.cookie.split(';').some(c => c.trim().startsWith(INSTALL_DISMISS_KEY + '='));
}
function markDismissedPersistent() {
  try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (_) {}
  // Set a long-lived cookie as a fallback. SameSite=Lax + Secure (HTTPS only).
  const exp = new Date(Date.now() + 365 * 86400 * 1000).toUTCString();
  document.cookie = `${INSTALL_DISMISS_KEY}=1; expires=${exp}; path=/; SameSite=Lax; Secure`;
}
function maybeShowInstallBanner() {
  if (isStandalone()) {
    // Currently launched as installed app → remember this for browser visits later too
    markDismissedPersistent();
    return;
  }
  if (dismissedPersistent()) return;
  if (!state.me) return; // don't pester before login
  if (!deferredInstallPrompt && !isIOSSafari()) return;
  const banner = document.getElementById('install-banner');
  const btn = document.getElementById('install-btn');
  const text = banner.querySelector('.install-text');
  if (deferredInstallPrompt) {
    text.textContent = 'アプリとしてホーム画面に追加できます';
    btn.textContent = '追加する';
  } else {
    text.textContent = 'ホーム画面に追加: Safari の共有 → ホーム画面に追加';
    btn.textContent = '方法を表示';
  }
  banner.hidden = false;
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  maybeShowInstallBanner();
});
window.addEventListener('appinstalled', () => {
  // Android Chrome fires this on successful install — never bother the user again.
  deferredInstallPrompt = null;
  markDismissedPersistent();
  document.getElementById('install-banner').hidden = true;
});
document.getElementById('install-btn').addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (_) {}
    deferredInstallPrompt = null;
    document.getElementById('install-banner').hidden = true;
    // appinstalled will fire and persist dismissal, but be defensive in case it doesn't
    markDismissedPersistent();
  } else if (isIOSSafari()) {
    alert('画面下の共有ボタン (□↑) をタップ → 「ホーム画面に追加」を選んでください');
  }
});
document.getElementById('install-close').addEventListener('click', (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  markDismissedPersistent();
  document.getElementById('install-banner').hidden = true;
  toast('次回から非表示にしました');
});

// ---------- Routes ----------
// 起動ホットパス: ログイン / ホームは eager-import 済み。残りの view は
//   lazy() で初回アクセス時だけロード。 module はブラウザがキャッシュする
//   ので 2 回目以降は即時。
route('/login',          renderLogin);
route('',                renderHome);          // #/
route('/buy',            lazy(() => import('./views/buy.js'), 'renderBuy'));
route('/sell',           lazy(() => import('./views/sell.js'), 'renderSell'));
route('/history',        lazy(() => import('./views/history.js'), 'renderHistory'));
route('/notifications',  lazy(() => import('./views/notifications.js'), 'renderNotifications'));
route('/admin',          lazy(() => import('./views/admin.js'), 'renderAdmin'));
route('/feedback-admin',  lazy(() => import('./views/feedback_admin.js'), 'renderFeedbackAdmin'));
route('/feature-request', lazy(() => import('./views/feedback_user.js'), 'renderFeatureRequest')); // v517 旧経路互換
route('/bug-report',      lazy(() => import('./views/feedback_user.js'), 'renderBugReport'));      // v517 旧経路互換
route('/feedback',        lazy(() => import('./views/feedback_user.js'), 'renderFeedbackForm'));    // v517 #146 新統合
route('/settings',       lazy(() => import('./views/settings.js'), 'renderSettings'));
route('/achievements',   lazy(() => import('./views/achievements.js'), 'renderAchievements'));
route('/tasks',          lazy(() => import('./views/tasks.js'), 'renderTasks'));
route('/tasks/:id',      lazy(() => import('./views/tasks.js'), 'renderTaskDetail'));
route('/send',           lazy(() => import('./views/transfer.js'), 'renderTransfer'));
route('/product/:jan',   lazy(() => import('./views/product.js'), 'renderProduct'));
route('/network',        lazy(() => import('./views/network.js'), 'renderNetwork'));
route('/activity',       lazy(() => import('./views/activity.js'), 'renderActivity'));
route('/wishlist',       lazy(() => import('./views/wishlist.js'), 'renderWishlist'));
route('/invitations',    lazy(() => import('./views/invitations.js'), 'renderInvitations'));
route('/invitations/:id', lazy(() => import('./views/invitations.js'), 'renderInvitationDetail'));
route('/roulette',       lazy(() => import('./views/roulette.js'), 'renderRoulette'));
route('/roulette/:id',   lazy(() => import('./views/roulette.js'), 'renderRouletteResult'));
route('/text-roulette',  lazy(() => import('./views/text_roulette.js'), 'renderTextRoulette'));
route('/polls',          lazy(() => import('./views/polls.js'), 'renderPolls'));
route('/polls/new',      lazy(() => import('./views/polls.js'), 'renderPollNew'));
route('/polls/:id/edit', lazy(() => import('./views/polls.js'), 'renderPollEdit'));
route('/polls/:id',      lazy(() => import('./views/polls.js'), 'renderPollDetail'));
route('/rollcalls',      lazy(() => import('./views/rollcalls.js'), 'renderRollCalls'));
route('/rollcalls/new',  lazy(() => import('./views/rollcalls.js'), 'renderRollCallNew'));
route('/rollcalls/:id',  lazy(() => import('./views/rollcalls.js'), 'renderRollCallDetail'));
route('/timers',         lazy(() => import('./views/timers.js'), 'renderTimers'));
route('/timers/new',     lazy(() => import('./views/timers.js'), 'renderTimerNew'));
route('/timers/:id',     lazy(() => import('./views/timers.js'), 'renderTimerDetail'));
route('/public-timer/:id', lazy(() => import('./views/public_timer.js'), 'renderPublicTimer'));
route('/notices',        lazy(() => import('./views/notices.js'), 'renderNotices'));
route('/notices/new',    lazy(() => import('./views/notices.js'), 'renderNoticeForm'));
route('/notices/:id/edit', lazy(() => import('./views/notices.js'), 'renderNoticeForm'));
route('/meetups',         lazy(() => import('./views/meetups.js'), 'renderMeetups'));
route('/meetups/new',     lazy(() => import('./views/meetups.js'), 'renderMeetupNew'));
route('/meetups/:id',     lazy(() => import('./views/meetups.js'), 'renderMeetupDetail'));
route('/places',          lazy(() => import('./views/places.js'), 'renderPlaces'));
route('/places/new',      lazy(() => import('./views/places.js'), 'renderPlaceNew'));
route('/places/map',      lazy(() => import('./views/places.js'), 'renderPlacesMap'));
route('/places/:id',      lazy(() => import('./views/places.js'), 'renderPlaceDetail'));
// v925 文献管理 (Zotero-like、 ラボ 共有)
route('/refs',            lazy(() => import('./views/refs.js'), 'renderRefs'));
route('/refs/new',        lazy(() => import('./views/refs.js'), 'renderRefsNew'));
// v927 bookmarklet 生成 ページ (/:id より 先 に 登録、 順序 注意)
route('/refs/bookmarklet', lazy(() => import('./views/refs.js'), 'renderRefsBookmarklet'));
// v930 参考文献 リスト 生成 ページ
route('/refs/bibliography', lazy(() => import('./views/refs.js'), 'renderRefsBibliography'));
route('/refs/:id',        lazy(() => import('./views/refs.js'), 'renderRefsDetail'));
route('/sns',             lazy(() => import('./views/posts.js'), 'renderPosts'));
// v530 #181 /sns/map は /sns/:id より先に登録 ("map" を id 扱いされないように)
route('/sns/map',         lazy(() => import('./views/posts_map.js'), 'renderPostsMap'));
route('/sns/:id',         lazy(() => import('./views/posts.js'), 'renderPostDetail'));
route('/presence',        lazy(() => import('./views/presence.js'), 'renderPresencePage'));
route('/todos',           lazy(() => import('./views/todos.js'), 'renderTodos'));
route('/admin/sounds',    lazy(() => import('./views/admin_sounds.js'), 'renderAdminSounds'));
route('/admin/custom-games', lazy(() => import('./views/admin_custom_games.js'), 'renderAdminCustomGames'));
// v620 自作ゲームのユーザ管理 UI + 汎用ディスパッチャ
route('/my-games',           lazy(() => import('./views/my_custom_games.js'), 'renderMyCustomGames'));
// v634 ⚾ ドラフト
route('/drafts',             lazy(() => import('./views/drafts.js'), 'renderDrafts'));
route('/drafts/new',         lazy(() => import('./views/drafts.js'), 'renderDraftNew'));
route('/drafts/:id',         lazy(() => import('./views/drafts.js'), 'renderDraftDetail'));
// v635 📝 フリップクイズ
route('/quizzes',            lazy(() => import('./views/quizzes.js'), 'renderQuizzes'));
route('/quizzes/new',        lazy(() => import('./views/quizzes.js'), 'renderQuizNew'));
route('/quizzes/:id',        lazy(() => import('./views/quizzes.js'), 'renderQuizDetail'));
route('/cg/:kind/:id',       lazy(() => import('./views/customgame.js'), 'renderCustomGameDetail'));
route('/cg/:kind',           lazy(() => import('./views/customgame.js'), 'renderCustomGameList'));
route('/auctions',        lazy(() => import('./views/auctions.js'), 'renderAuctions'));
route('/auctions/new',    lazy(() => import('./views/auctions.js'), 'renderAuctionNew'));
route('/auctions/:id',    lazy(() => import('./views/auctions.js'), 'renderAuctionDetail'));
route('/playlists',         lazy(() => import('./views/playlists.js'), 'renderPlaylists'));
route('/playlists/new',     lazy(() => import('./views/playlists.js'), 'renderPlaylistNew'));
route('/playlists/:id',     lazy(() => import('./views/playlists.js'), 'renderPlaylistDetail'));
route('/playlists/:id/edit', lazy(() => import('./views/playlists.js'), 'renderPlaylistEdit'));
route('/stopwatches',       lazy(() => import('./views/stopwatches.js'), 'renderStopwatches'));
route('/stopwatches/new',   lazy(() => import('./views/stopwatches.js'), 'renderStopwatchNew'));
route('/stopwatches/:id',   lazy(() => import('./views/stopwatches.js'), 'renderStopwatchDetail'));
route('/translate',         lazy(() => import('./views/translate.js'), 'renderTranslate'));
route('/help',              lazy(() => import('./views/help.js'), 'renderHelp'));
route('/chat',              lazy(() => import('./views/chat.js'), 'renderChat'));
route('/exercise',        lazy(() => import('./views/exercise.js'), 'renderExercise'));
route('/users/:id',       lazy(() => import('./views/profile.js'), 'renderUserProfile'));
route('/apps',           lazy(() => import('./views/apps.js'), 'renderApps'));
// v609 #234 タブ単位のカテゴリ絞り込み
route('/research',       (ctx) => import('./views/apps.js').then(m => m.renderApps({ ...ctx, cat: 'research' })));
route('/lab-mgmt',       (ctx) => import('./views/apps.js').then(m => m.renderApps({ ...ctx, cat: 'lab-mgmt' })));
route('/contacts',       lazy(() => import('./views/contacts.js'), 'renderContacts'));
route('/requests-hub',   lazy(() => import('./views/requests_hub.js'), 'renderRequestsHub'));
route('/wari',           lazy(() => import('./views/wari.js'), 'renderWari'));
route('/nomikai',        lazy(() => import('./views/nomikai.js'), 'renderNomikai'));
route('/nomikai/new',    lazy(() => import('./views/nomikai.js'), 'renderNomikaiNew'));
route('/nomikai/:id',    lazy(() => import('./views/nomikai.js'), 'renderNomikaiDetail'));
route('/groups',         lazy(() => import('./views/groups.js'), 'renderGroups'));
route('/groups/join/:token', lazy(() => import('./views/groups.js'), 'renderGroupJoin'));
route('/groups/:id/map', lazy(() => import('./views/group_map.js'), 'renderGroupMap'));
route('/groups/:id',     lazy(() => import('./views/groups.js'), 'renderGroupDetail'));
route('/scrapbox',       lazy(() => import('./views/scrapbox_feed.js'), 'renderScrapboxFeed'));
route('/random-groups',  lazy(() => import('./views/random_groups.js'), 'renderRandomGroups'));
// v523 #160 順番決め (発表順 / 当番など)
route('/orderings',       lazy(() => import('./views/orderings.js'), 'renderOrderings'));
route('/orderings/new',   lazy(() => import('./views/orderings.js'), 'renderOrderingNew'));
route('/orderings/:id',   lazy(() => import('./views/orderings.js'), 'renderOrderingDetail'));
// v531 #163 行った国 / 都道府県制覇マップ
route('/regions',         lazy(() => import('./views/regions.js'), 'renderRegions'));
// v860 #445 制覇リスト (ユーザ自由リスト + チェック)
route('/conquest',         lazy(() => import('./views/conquest.js'), 'renderConquest'));
route('/conquest/new',     lazy(() => import('./views/conquest.js'), 'renderConquestNew'));
route('/conquest/:id',     lazy(() => import('./views/conquest.js'), 'renderConquestDetail'));
// v870 #452 Habit Tracker (個人 / 公開習慣の日毎 ✓ 入力)
route('/habits',           lazy(() => import('./views/habits.js'), 'renderHabits'));
route('/habits/new',       lazy(() => import('./views/habits.js'), 'renderHabitsNew'));
route('/habits/:id',       lazy(() => import('./views/habits.js'), 'renderHabitDetail'));
// v872 #454 早押しクイズ (リアル現場で出題者 + 参加者で早押しボタン)
route('/buzzer',           lazy(() => import('./views/buzzer.js'), 'renderBuzzerList'));
route('/buzzer/new',       lazy(() => import('./views/buzzer.js'), 'renderBuzzerNew'));
route('/buzzer/:id',       lazy(() => import('./views/buzzer.js'), 'renderBuzzerDetail'));
// v886 Overleaf プロジェクト追跡 (教員 admin 限定、学生の論文執筆状況を可視化)
route('/overleaf',         lazy(() => import('./views/overleaf.js'), 'renderOverleafList'));
route('/overleaf/admin',   lazy(() => import('./views/overleaf.js'), 'renderOverleafAdmin'));
route('/overleaf/:id',     lazy(() => import('./views/overleaf.js'), 'renderOverleafDetail'));
// v532 #161 体重 / BMI 記録
route('/health',          lazy(() => import('./views/health.js'), 'renderHealth'));
// v533 #162 筋トレ記録 + 仲間
route('/workouts/friends', lazy(() => import('./views/workouts.js'), 'renderWorkoutsFriends'));
route('/workouts',         lazy(() => import('./views/workouts.js'), 'renderWorkouts'));
// v538 #169 散歩に行きたくなるアプリ
route('/walk',             lazy(() => import('./views/walk.js'), 'renderWalk'));
// v540 #171 絵しりとり (Phase 1)
route('/shiritori',         lazy(() => import('./views/shiritori.js'), 'renderShiritori'));
route('/shiritori/new',     lazy(() => import('./views/shiritori.js'), 'renderShiritoriNew'));
route('/shiritori/:id',     lazy(() => import('./views/shiritori.js'), 'renderShiritoriDetail'));
// v549 #210 ティア表
route('/tierlists/new',     lazy(() => import('./views/tierlists.js'), 'renderTierlistNew'));
route('/tierlists/:id',     lazy(() => import('./views/tierlists.js'), 'renderTierlistDetail'));
route('/tierlists',         lazy(() => import('./views/tierlists.js'), 'renderTierlists'));
// v550 #206 論文査読
// v552 #211 #212 共有 URL ベース閲覧
route('/paper-review/r/:token', lazy(() => import('./views/paper_review.js'), 'renderPaperReviewShared'));
route('/paper-review',      lazy(() => import('./views/paper_review.js'), 'renderPaperReview'));
// v748 #359 #360 #361 論文要約 (= paper_translate handler をそのまま使う)
// v757 #375 slug を paper-summary に改名 (和訳ない論文もあるため)、旧 paper-translate も互換。
route('/paper-summary/r/:token',   lazy(() => import('./views/paper_translate.js'), 'renderPaperTranslateShared'));
route('/paper-summary',            lazy(() => import('./views/paper_translate.js'), 'renderPaperTranslate'));
route('/paper-translate/r/:token', lazy(() => import('./views/paper_translate.js'), 'renderPaperTranslateShared'));
route('/paper-translate',          lazy(() => import('./views/paper_translate.js'), 'renderPaperTranslate'));
// v781 #376 Deep Research (ChatGPT 風多段 Web 調査)
route('/deep-research/r/:token',   lazy(() => import('./views/deep_research.js'), 'renderDeepResearchShared'));
route('/deep-research',            lazy(() => import('./views/deep_research.js'), 'renderDeepResearch'));
// v788 #386 #387 #388 論文全訳 (要約でなくフル翻訳、章ごと + back-translation)
route('/paper-translate-full/r/:token', lazy(() => import('./views/paper_translate_full.js'), 'renderPaperTranslateFullShared'));
route('/paper-translate-full',          lazy(() => import('./views/paper_translate_full.js'), 'renderPaperTranslateFull'));
// v809 論文要約 + 全訳の合算新着一覧 (ホーム widget の「すべて →」リンク先)
route('/papers-recent',                 lazy(() => import('./views/papers_recent.js'), 'renderPapersRecent'));
// v804 名言登録 / 管理
route('/quotes',                        lazy(() => import('./views/quotes.js'), 'renderQuotes'));
// v583 #225 レジュメ原稿チェック (paper-review 軽量版、 5pt)
route('/resume-check/:id',  lazy(() => import('./views/resume_check.js'), 'renderResumeCheckDetail'));
route('/resume-check',      lazy(() => import('./views/resume_check.js'), 'renderResumeCheck'));
// v613 文字数・単語数リライター
route('/rewriter/:id',      lazy(() => import('./views/rewriter.js'), 'renderRewriterDetail'));
route('/rewriter',          lazy(() => import('./views/rewriter.js'), 'renderRewriter'));
// v586 フライト応援 (オフライン)
route('/flight',            lazy(() => import('./views/flight.js'), 'renderFlight'));
// v587 地雷オセロ
route('/othello/:id',       lazy(() => import('./views/othello.js'), 'renderOthelloDetail'));
route('/othello',           lazy(() => import('./views/othello.js'), 'renderOthello'));
// v588 ビンゴ
route('/bingo',             lazy(() => import('./views/bingo.js'), 'renderBingo'));
// v740 #288 BingoFit (衣類着回しビンゴ)
route('/bingofit',          lazy(() => import('./views/bingofit_closet.js'), 'renderBingofitCloset'));
route('/bingofit/closet',   lazy(() => import('./views/bingofit_closet.js'), 'renderBingofitCloset'));
route('/bingofit/board',    lazy(() => import('./views/bingofit_board.js'),  'renderBingofitBoard'));
route('/bingofit/history',  lazy(() => import('./views/bingofit_board.js'),  'renderBingofitHistory'));
// v589 散歩モード (Wake Lock + GPS 軌跡)
route('/walk-mode',         lazy(() => import('./views/walk_mode.js'), 'renderWalkMode'));
route('/walk/sessions',     lazy(() => import('./views/walk_mode.js'), 'renderWalkSessions'));
route('/walk/session/:id',  lazy(() => import('./views/walk_mode.js'), 'renderWalkSessionDetail'));
// v590 大富豪
route('/daifugo/:id',       lazy(() => import('./views/daifugo.js'), 'renderDaifugoDetail'));
route('/daifugo',           lazy(() => import('./views/daifugo.js'), 'renderDaifugo'));
// v609 #235 勝敗予測
route('/score-predictions/new',  lazy(() => import('./views/score_predictions.js'), 'renderScorePredictionNew'));
route('/score-predictions/:id',  lazy(() => import('./views/score_predictions.js'), 'renderScorePredictionDetail'));
route('/score-predictions',      lazy(() => import('./views/score_predictions.js'), 'renderScorePredictions'));
// v617 #236 マルバツ (自作ゲームフレームワークサンプル)
route('/tictactoe/:id',     lazy(() => import('./views/tictactoe.js'), 'renderTicTacToeDetail'));
route('/tictactoe',         lazy(() => import('./views/tictactoe.js'), 'renderTicTacToe'));
// v568 #223 ito アプリ
route('/ito',               lazy(() => import('./views/ito.js'), 'renderIto'));
route('/ito/new',           lazy(() => import('./views/ito.js'), 'renderItoNew'));
route('/ito/:id',           lazy(() => import('./views/ito.js'), 'renderItoDetail'));
// v570 #223 人狼 Phase 1
route('/jinrou',            lazy(() => import('./views/jinrou.js'), 'renderJinrou'));
route('/jinrou/new',        lazy(() => import('./views/jinrou.js'), 'renderJinrouNew'));
route('/jinrou/:id',        lazy(() => import('./views/jinrou.js'), 'renderJinrouDetail'));
// v571 ゲームハブ (タブから)
route('/games',             lazy(() => import('./views/games.js'), 'renderGames'));
// v576 優勝予想
route('/predictions',         lazy(() => import('./views/predictions.js'), 'renderPredictions'));
route('/predictions/new',     lazy(() => import('./views/predictions.js'), 'renderPredictionNew'));
route('/predictions/:id',     lazy(() => import('./views/predictions.js'), 'renderPredictionDetail'));
// v553 #209 麻雀 Phase 1 (lazy import で普段は未読み込み、 Phase 2 で重くなる予定)
route('/mahjong/new',       lazy(() => import('./views/mahjong.js'), 'renderMahjongNew'));
// v556 シミュレータ (内部検証用)
route('/mahjong/sim',       lazy(() => import('./views/mahjong_sim.js'), 'renderMahjongSim'));
route('/mahjong/:id',       lazy(() => import('./views/mahjong.js'), 'renderMahjongDetail'));
route('/mahjong',           lazy(() => import('./views/mahjong.js'), 'renderMahjong'));
route('/requests',       lazy(() => import('./views/money_requests.js'), 'renderMoneyRequests'));
route('/requests/:id',   lazy(() => import('./views/money_requests.js'), 'renderMoneyRequestDetail'));
route('/bait',           lazy(() => import('./views/bait.js'), 'renderBait'));
route('/bait/new',       lazy(() => import('./views/bait.js'), 'renderBaitNew'));
route('/bait/:id',       lazy(() => import('./views/bait.js'), 'renderBaitDetail'));
route('/widgets',        lazy(() => import('./views/widgets.js'), 'renderWidgets'));
route('/widgets/new',    lazy(() => import('./views/widgets.js'), 'renderWidgetNew'));
route('/widgets/:id/edit', lazy(() => import('./views/widgets.js'), 'renderWidgetEdit'));
route('/cg2',            lazy(() => import('./views/cg2.js'), 'renderCg2'));
route('/cg2/:slug',      lazy(() => import('./views/cg2.js'), 'renderCg2Kind'));
route('/cg2/:slug/:id',  lazy(() => import('./views/cg2.js'), 'renderCg2Game'));
route('/chat-rooms',          lazy(() => import('./views/chat_rooms.js'), 'renderChatRooms'));
route('/chat-rooms/:roomKey', lazy(() => import('./views/chat_rooms.js'), 'renderChatRoom'));
route('/fortune',             lazy(() => import('./views/fortune.js'), 'renderFortune'));
route('/research-notes',      lazy(() => import('./views/research_notes.js'), 'renderResearchNotes')); // v821 Cosense 連携
route('/zemi-videos',         lazy(() => import('./views/zemi_videos.js'), 'renderZemiVideos'));    // v843 #426
route('/zemi-videos/:id',     lazy(() => import('./views/zemi_videos.js'), 'renderZemiVideoDetail'));
route('/me/purchases',        lazy(() => import('./views/my_purchases.js'), 'renderMyPurchases'));   // v847 #430
route('/conf-deadlines',          lazy(() => import('./views/conf_deadlines.js'), 'renderConfDeadlines'));
route('/conf-deadlines/new',      lazy(() => import('./views/conf_deadlines.js'), 'renderConfDeadlineForm'));
route('/conf-deadlines/:id',      lazy(() => import('./views/conf_deadlines.js'), 'renderConfDeadlineDetail'));
route('/conf-deadlines/:id/edit', lazy(() => import('./views/conf_deadlines.js'), 'renderConfDeadlineForm'));
route('/news',                    lazy(() => import('./views/news.js'), 'renderNews')); // v705 #297
route('/screen-shares',           lazy(() => import('./views/screen_shares.js'), 'renderScreenShares')); // v718 #314
route('/file-transfers',          lazy(() => import('./views/file_transfers.js'), 'renderFileTransfers')); // v733 #342

// ---------- Boot ----------
// v498 #108 起動高速化: 前回の /api/auth/me をキャッシュから即 hydrate して chrome と
//   ルートを並行で立ち上げる。サーバ再検証は裏で。失敗 (401など) すれば clearMeCache +
//   /#/login へ。オンライン時の体感が劇的に縮む。
(async function boot() {
  const cached = readMeCache();
  if (cached) {
    state.me = cached.user;
    state.balance = cached.balance;
    state.inLab = !!cached.in_lab;
    state.hasMac = !!cached.has_registered_mac;
    renderChrome();
    start();                          // ルート即時 dispatch
    refreshMe().then(() => {          // 裏で再検証
      // v676 #256 /public-timer は認証不要
      if (!state.me && location.hash !== '#/login' && !location.hash.startsWith('#/public-timer/')) navigate('#/login');
    });
  } else {
    await refreshMe();
    if (!state.me && location.hash !== '#/login' && !location.hash.startsWith('#/public-timer/')) {
      navigate('#/login');
    } else if (state.me && location.hash === '#/login') {
      navigate('#/');
    }
    start();
  }
  // Periodic unread refresh — 1 分間隔。タブが裏 (visibility hidden) の時は
  // スキップして、表に戻った瞬間に即 1 回叩く。これでスマホをロックしてた
  // 間にバッテリーを使わず、戻ってきた直後にバッジが正しく出る。
  if (state.me) {
    refreshUnread();
    setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshUnread();
    });
  }
  // Install banner: iOS Safari doesn't fire beforeinstallprompt, so we may need to show it
  // proactively. For Android Chrome the event might fire before login completed; if so we
  // already cached it in deferredInstallPrompt — show now that the user is in.
  maybeShowInstallBanner();
})();
