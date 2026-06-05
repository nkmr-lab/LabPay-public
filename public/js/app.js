// App entry: wires router, loads views, manages global chrome (balance pill, unread badge, logout).

import { route, start, navigate, escapeHtml } from './router.js';
import { get, post } from './api.js';

import { renderLogin } from './views/login.js';
import { renderHome } from './views/home.js';
import { renderBuy } from './views/buy.js';
import { renderSell } from './views/sell.js';
import { renderHistory } from './views/history.js';
import { renderNotifications } from './views/notifications.js';
import { renderAdmin } from './views/admin.js';
import { renderProduct } from './views/product.js';
import { renderSettings } from './views/settings.js';
import { renderAchievements } from './views/achievements.js';
import { renderTasks, renderTaskDetail } from './views/tasks.js';
import { renderTransfer } from './views/transfer.js';
import { renderNetwork } from './views/network.js';
import { renderActivity } from './views/activity.js';
import { renderWishlist } from './views/wishlist.js';
import { renderInvitations, renderInvitationDetail } from './views/invitations.js';
import { renderRoulette, renderRouletteResult } from './views/roulette.js';
import { renderTextRoulette } from './views/text_roulette.js';
import { renderPolls, renderPollNew, renderPollDetail, renderPollEdit } from './views/polls.js';
import { renderRollCalls, renderRollCallNew, renderRollCallDetail } from './views/rollcalls.js';
import { renderTimers, renderTimerNew, renderTimerDetail } from './views/timers.js';
import { renderNotices, renderNoticeForm } from './views/notices.js';
import { renderMeetups, renderMeetupNew, renderMeetupDetail } from './views/meetups.js';
import { renderAdminSounds } from './views/admin_sounds.js';
import { renderAuctions, renderAuctionNew, renderAuctionDetail } from './views/auctions.js';
import { renderPlaylists, renderPlaylistNew, renderPlaylistDetail, renderPlaylistEdit } from './views/playlists.js';
import { renderStopwatches, renderStopwatchNew, renderStopwatchDetail } from './views/stopwatches.js';
import { renderTranslate } from './views/translate.js';
import { renderExercise } from './views/exercise.js';
import { renderUserProfile } from './views/profile.js';
import { preloadSounds } from './sounds.js';
import { renderApps } from './views/apps.js';
import { renderContacts } from './views/contacts.js';
import { renderRequestsHub } from './views/requests_hub.js';
import { renderWari } from './views/wari.js';
import { renderNomikai, renderNomikaiNew, renderNomikaiDetail } from './views/nomikai.js';
import { renderGroups, renderGroupDetail } from './views/groups.js';
import { renderGroupMap } from './views/group_map.js';
import { renderScrapboxFeed } from './views/scrapbox_feed.js';
import { renderRandomGroups } from './views/random_groups.js';
import { renderMoneyRequests, renderMoneyRequestDetail } from './views/money_requests.js';
import { renderFeedbackAdmin } from './views/feedback_admin.js';
import { renderFeatureRequest, renderBugReport } from './views/feedback_user.js';

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
  // admin は 報告・要望 ページを直接読めるので、 個別の 機能要望 / バグ報告
  // メニューは出さない。 ついでにセパレータも隠す (一般ユーザ向けの区切り)。
  const fReq  = document.getElementById('feature-request-link');
  const bugRep = document.getElementById('bug-report-link');
  const sep   = document.getElementById('topbar-sep');
  if (fReq)  fReq.hidden  = isAdmin;
  if (bugRep) bugRep.hidden = isAdmin;
  if (sep)   sep.hidden   = isAdmin;
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
route('/login',          renderLogin);
route('',                renderHome);          // #/
route('/buy',            renderBuy);
route('/sell',           renderSell);
route('/history',        renderHistory);
route('/notifications',  renderNotifications);
route('/admin',          renderAdmin);
route('/feedback-admin',  renderFeedbackAdmin);
route('/feature-request', renderFeatureRequest);
route('/bug-report',      renderBugReport);
route('/settings',       renderSettings);
route('/achievements',   renderAchievements);
route('/tasks',          renderTasks);
route('/tasks/:id',      renderTaskDetail);
route('/send',           renderTransfer);
route('/product/:jan',   renderProduct);
route('/network',        renderNetwork);
route('/activity',       renderActivity);
route('/wishlist',       renderWishlist);
route('/invitations',    renderInvitations);
route('/invitations/:id', renderInvitationDetail);
route('/roulette',       renderRoulette);
route('/roulette/:id',   renderRouletteResult);
route('/text-roulette',  renderTextRoulette);
route('/polls',          renderPolls);
route('/polls/new',      renderPollNew);
route('/polls/:id/edit', renderPollEdit);
route('/polls/:id',      renderPollDetail);
route('/rollcalls',      renderRollCalls);
route('/rollcalls/new',  renderRollCallNew);
route('/rollcalls/:id',  renderRollCallDetail);
route('/timers',         renderTimers);
route('/timers/new',     renderTimerNew);
route('/timers/:id',     renderTimerDetail);
route('/notices',        renderNotices);
route('/notices/new',    renderNoticeForm);
route('/notices/:id/edit', renderNoticeForm);
route('/meetups',         renderMeetups);
route('/meetups/new',     renderMeetupNew);
route('/meetups/:id',     renderMeetupDetail);
route('/admin/sounds',    renderAdminSounds);
route('/auctions',        renderAuctions);
route('/auctions/new',    renderAuctionNew);
route('/auctions/:id',    renderAuctionDetail);
route('/playlists',         renderPlaylists);
route('/playlists/new',     renderPlaylistNew);
route('/playlists/:id',     renderPlaylistDetail);
route('/playlists/:id/edit', renderPlaylistEdit);
route('/stopwatches',       renderStopwatches);
route('/stopwatches/new',   renderStopwatchNew);
route('/stopwatches/:id',   renderStopwatchDetail);
route('/translate',         renderTranslate);
route('/exercise',        renderExercise);
route('/users/:id',       renderUserProfile);
route('/apps',           renderApps);
route('/contacts',       renderContacts);
route('/requests-hub',   renderRequestsHub);
route('/wari',           renderWari);
route('/nomikai',        renderNomikai);
route('/nomikai/new',    renderNomikaiNew);
route('/nomikai/:id',    renderNomikaiDetail);
route('/groups',         renderGroups);
route('/groups/:id/map', renderGroupMap);
route('/groups/:id',     renderGroupDetail);
route('/scrapbox',       renderScrapboxFeed);
route('/random-groups',  renderRandomGroups);
route('/requests',       renderMoneyRequests);
route('/requests/:id',   renderMoneyRequestDetail);

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
