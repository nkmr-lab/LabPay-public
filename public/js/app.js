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
import { renderApps } from './views/apps.js';
import { renderWari } from './views/wari.js';
import { renderNomikai, renderNomikaiNew, renderNomikaiDetail } from './views/nomikai.js';
import { renderGroups, renderGroupDetail } from './views/groups.js';
import { renderScrapboxFeed } from './views/scrapbox_feed.js';
import { renderRandomGroups } from './views/random_groups.js';
import { renderMoneyRequests, renderMoneyRequestDetail } from './views/money_requests.js';
import { renderFeedbackAdmin } from './views/feedback_admin.js';

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

export async function refreshUnread() {
  if (!state.me) return;
  try {
    const d = await get('/api/notifications/unread_count');
    state.unread = d.unread || 0;
    renderChrome();
    // 未読 0 になった瞬間にアプリ起動ボーナスを試す (1 日 1 回・サーバ側で冪等)。
    if (state.unread === 0) tryAppOpenReward();
  } catch (_) {}
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
  if (state.me.role === 'admin') {
    adminLink.hidden = false;
    if (feedbackAdminLink) feedbackAdminLink.hidden = false;
  } else {
    adminLink.hidden = true;
    if (feedbackAdminLink) feedbackAdminLink.hidden = true;
  }
  if (state.unread > 0) {
    badge.hidden = false;
    badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
  } else {
    badge.hidden = true;
  }
  const groupsTab = document.getElementById('tab-groups');
  if (groupsTab) groupsTab.hidden = !state.hasGroups;
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
route('/feedback-admin', renderFeedbackAdmin);
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
route('/apps',           renderApps);
route('/wari',           renderWari);
route('/nomikai',        renderNomikai);
route('/nomikai/new',    renderNomikaiNew);
route('/nomikai/:id',    renderNomikaiDetail);
route('/groups',         renderGroups);
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
