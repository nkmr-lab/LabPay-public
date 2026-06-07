// App entry: wires router, loads views, manages global chrome (balance pill, unread badge, logout).
// v490 #88 起動 速度 改善: 50+ の view モジュール を eager import して いた の を
//   route 時 の dynamic import() に 変更。 初回 起動 で 必要 な のは shell + login と
//   home のみ。 これら 2 つ だけ eager、 他 は タップ 時 に 初回 ロード + キャッシュ。

import { route, start, navigate, escapeHtml } from './router.js';
import { get, post } from './api.js';

// ホット パス 2 つ (起動 直後 必ず 通る) は eager。
import { renderLogin } from './views/login.js';
import { renderHome } from './views/home.js';
import { preloadSounds } from './sounds.js';
import { installGlobalAudioUnlock } from './audio_unlock.js';
import { bootSettingsSync } from './settings_sync.js';

// 遅延 ロード ヘルパー: route 時 に 初回 だけ import する。 import() が 返す
//   Promise は ブラウザ が キャッシュ する ので、 同じ ページ を 2 回目 開く と
//   即時 解決。
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
  hasGroups: false, // 自分が入ってるグループが 1 つ以上あるか (タブの 「グループ」 表示制御)
};

export async function refreshMe() {
  try {
    const data = await get('/api/auth/me');
    state.me = data.user;
    state.balance = data.balance;
    state.inLab = !!data.in_lab;
    state.hasMac = !!data.has_registered_mac;
    renderChrome();
    // タブの 「グループ」 表示判定。 失敗・遅延しても他の処理を止めないよう
    // fire-and-forget。 結果が遅れて来てもタブが追加で出るだけなので無害。
    refreshHasGroups();
    // 効果音の解決済み 設定を 1 回だけ pull。 失敗しても他に影響しないよう fire-and-forget。
    preloadSounds();
    // v448 ページ上の どこか で 最初に 起きた pointerdown / touchstart / keydown
    // 1 回 で 共有 AudioContext + HTMLAudio を unlock。 以降 setInterval から の
    // タイマーベル / 効果音 が iOS Safari でも 通る。
    installGlobalAudioUnlock();
    // v456 設定 を サーバ から 引いて localStorage に 反映 (デバイス間 同期)。
    // 直後 に localStorage を 読み込む view が ある ので await。 失敗 しても 黙殺
    // (オフライン や 未ログイン の フォールバック が きく)。
    await bootSettingsSync();
    return data;
  } catch (e) {
    state.me = null;
    renderChrome();
    return null;
  }
}

// 自分が入ってるグループの有無を /api/groups で確認してタブ可視を更新。
// home / groups の各 view で再度叩かれるが、 タブ判定だけは bootstrap で
// 走らないと初回ページが home 以外の時 タブが出ないので app.js でも呼ぶ。
export async function refreshHasGroups() {
  try {
    const d = await get('/api/groups');
    state.hasGroups = Array.isArray(d.items) && d.items.length > 0;
    renderChrome();
  } catch (_) { /* 取れなければ前回値を保持 */ }
}

// 直近に見た最大 notification id。 polling で 新着検知に使う。
// undefined の間 (= 初回ロード前) は 新着 toast を出さない (=スタート時の溜まりを
// 全部 toast に出してしまわないようにする)。
let lastSeenNotifId;
let lastUnread = 0;

export async function refreshUnread() {
  if (!state.me) return;
  try {
    const d = await get('/api/notifications/unread_count');
    const newCount = d.unread || 0;
    // 増加分があれば 直近の未読を取りに行って 「新着通知トースト」 を出す。
    // 初回ロード時 (lastSeenNotifId 未定) は 「これ以降の追加分だけ」 を toast 対象にしたいので
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

// 新着通知 1 〜 N 件を 「アプリ内トースト」 + (許可があれば) 「OS 通知」 で見せる。
// 行数が多い時はまとめて 1 つの toast にする。
function showNotificationToasts(items) {
  // OS 通知 (許可済みの時だけ)。
  // タップで該当ページに飛ばす。 service worker 経由しない 「ページが開いてる時の通知」 なので
  // タブがアクティブだと OS の通知センターに残らない端末もあるが、 トースト感は出る。
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
    toast('ブラウザ設定で 「ブロック」 になっています。 ブラウザ設定から許可してください', 5000);
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

// 「今日のアプリ起動ボーナス」 すでに試した日を localStorage に持っておく。
// awarded / already_today を貰えた日はこれ以上 ping しない。 unread_pending /
// fetch エラーは未着なので残しておいて、 次の refreshUnread でまた試す。
const REWARD_CACHE_KEY = 'labpay-app-open-reward-date';
function todayJST() {
  // サーバ側は date('Y-m-d') (= JST。 PHP の default_timezone)。 ブラウザは
  // ユーザ環境依存だが、 日本国内利用なので Asia/Tokyo に揃える。
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
      // 既に貰った / 機能無効。 今日はもう ping しない。
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
  // v445 → v464: admin の トップバー は 「通知 / 設定 / 管理 / FB | 機能要望 / バグ報告」。
  // FB (= 報告・要望、 admin 専用 受信箱) と 機能要望 / バグ報告 (投稿 入口) を
  // セパレータで 分ける。 機能要望 / バグ報告 は admin にも 表示 (Claude への 指示
  // チャネル として 使う ため)。
  const fReq  = document.getElementById('feature-request-link');
  const bugRep = document.getElementById('bug-report-link');
  const sep   = document.getElementById('topbar-sep');
  if (fReq)  fReq.hidden  = false;
  if (bugRep) bugRep.hidden = false;
  if (sep)   sep.hidden   = !isAdmin;
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
// 表示するタブと並び順を localStorage に保存。 設定の 「タブのカスタマイズ」 で編集。
// nav#tabs 内の <a data-tab-id="..."> を 保存 order に従って並べ替え + hidden 適用。
export const TAB_DEFS = [
  { id: 'home',         title: 'ホーム' },
  { id: 'groups',       title: 'グループ',           note: '(自分が入ってる時のみ)' },
  { id: 'buy',          title: '購入' },
  { id: 'sell',         title: '販売' },
  { id: 'requests',     title: '依頼 (タスク + 募集 + 投票)' },
  { id: 'auctions',     title: '競売 (オークション)' },
  // v489 #86 らぼったー を タブ に 追加。
  { id: 'sns',          title: 'らぼったー (SNS)' },
  { id: 'apps',         title: 'アプリ' },
  { id: 'achievements', title: '実績' },
];
const TAB_LAYOUT_KEY = 'labpay-tab-layout';
export function readTabLayout() {
  try {
    const j = JSON.parse(localStorage.getItem(TAB_LAYOUT_KEY) || '{}');
    return {
      order:  Array.isArray(j.order)  ? j.order  : [],
      hidden: Array.isArray(j.hidden) ? j.hidden : [],
    };
  } catch { return { order: [], hidden: [] }; }
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
  const knownIds = links.map(l => l.dataset.tabId);
  // TAB_DEFS の正規順 (今 DOM に居る ID のみ抽出)
  const canonical = TAB_DEFS.map(t => t.id).filter(id => knownIds.includes(id));
  const orderedKnown = [];
  // 1) ユーザの保存 order を軸に並べる (= 過去のカスタマイズを尊重)。
  for (const id of layout.order) {
    if (knownIds.includes(id)) orderedKnown.push(id);
  }
  // 2) 保存 order に無い新規 ID を、 canonical で 「直前にあるはず」 の既知タブの
  //    直後に差し込む。 末尾に放り込まないことで、 新タブの想定位置を維持。
  const savedSet = new Set(orderedKnown);
  for (const id of canonical) {
    if (savedSet.has(id)) continue;
    const idx = canonical.indexOf(id);
    let insertAfter = -1;
    for (let j = idx - 1; j >= 0; j--) {
      const pos = orderedKnown.indexOf(canonical[j]);
      if (pos >= 0) { insertAfter = pos; break; }
    }
    orderedKnown.splice(insertAfter + 1, 0, id);
    savedSet.add(id);
  }
  for (const id of orderedKnown) {
    const el = links.find(l => l.dataset.tabId === id);
    if (el) nav.appendChild(el);
  }
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
// 起動 ホット パス: ログイン / ホーム は eager-import 済み。 残り の view は
//   lazy() で 初回 アクセス 時 だけ ロード。 module は ブラウザ が キャッシュ する
//   ので 2 回目 以降 は 即時。
route('/login',          renderLogin);
route('',                renderHome);          // #/
route('/buy',            lazy(() => import('./views/buy.js'), 'renderBuy'));
route('/sell',           lazy(() => import('./views/sell.js'), 'renderSell'));
route('/history',        lazy(() => import('./views/history.js'), 'renderHistory'));
route('/notifications',  lazy(() => import('./views/notifications.js'), 'renderNotifications'));
route('/admin',          lazy(() => import('./views/admin.js'), 'renderAdmin'));
route('/feedback-admin',  lazy(() => import('./views/feedback_admin.js'), 'renderFeedbackAdmin'));
route('/feature-request', lazy(() => import('./views/feedback_user.js'), 'renderFeatureRequest'));
route('/bug-report',      lazy(() => import('./views/feedback_user.js'), 'renderBugReport'));
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
route('/sns',             lazy(() => import('./views/posts.js'), 'renderPosts'));
route('/sns/:id',         lazy(() => import('./views/posts.js'), 'renderPostDetail'));
route('/todos',           lazy(() => import('./views/todos.js'), 'renderTodos'));
route('/admin/sounds',    lazy(() => import('./views/admin_sounds.js'), 'renderAdminSounds'));
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
route('/requests',       lazy(() => import('./views/money_requests.js'), 'renderMoneyRequests'));
route('/requests/:id',   lazy(() => import('./views/money_requests.js'), 'renderMoneyRequestDetail'));

// ---------- Boot ----------
(async function boot() {
  await refreshMe();
  if (!state.me && location.hash !== '#/login') {
    navigate('#/login');
  } else if (state.me && location.hash === '#/login') {
    navigate('#/');
  }
  start();
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
