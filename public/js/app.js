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
import { renderInvitations } from './views/invitations.js';

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
};

export async function refreshMe() {
  try {
    const data = await get('/api/auth/me');
    state.me = data.user;
    state.balance = data.balance;
    state.inLab = !!data.in_lab;
    renderChrome();
    return data;
  } catch (e) {
    state.me = null;
    renderChrome();
    return null;
  }
}

export async function refreshUnread() {
  if (!state.me) return;
  try {
    const d = await get('/api/notifications/unread_count');
    state.unread = d.unread || 0;
    renderChrome();
  } catch (_) {}
}

function renderChrome() {
  const top = document.getElementById('topbar');
  const tabs = document.getElementById('tabs');
  const adminLink = document.getElementById('admin-link');
  const badge = document.getElementById('unread-badge');

  if (!state.me) {
    top.hidden = true;
    tabs.hidden = true;
    return;
  }
  top.hidden = false;
  tabs.hidden = false;
  if (state.me.role === 'admin') adminLink.hidden = false; else adminLink.hidden = true;
  if (state.unread > 0) {
    badge.hidden = false;
    badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
  } else {
    badge.hidden = true;
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

// ---------- Boot ----------
(async function boot() {
  await refreshMe();
  if (!state.me && location.hash !== '#/login') {
    navigate('#/login');
  } else if (state.me && location.hash === '#/login') {
    navigate('#/');
  }
  start();
  // Periodic unread refresh
  if (state.me) {
    refreshUnread();
    setInterval(() => refreshUnread(), 30000);
  }
  // Install banner: iOS Safari doesn't fire beforeinstallprompt, so we may need to show it
  // proactively. For Android Chrome the event might fire before login completed; if so we
  // already cached it in deferredInstallPrompt — show now that the user is in.
  maybeShowInstallBanner();
})();
