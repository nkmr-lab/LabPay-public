// /#/presence — 「今ラボにいる人」 専用の単独ページ (タブから直で開ける版)。
// v493 #95 タブで独立に表示できるようにしたい、 という要望対応。 ホームの
// presence カードと同じ見せ方を、 ページ全幅でゆったり表示する。

import { get } from '../api.js';
import { escapeHtml } from '../router.js';
import { state } from '../app.js';
import { applyPresenceMode, renderRoom } from './home.js';

let presenceTimer = null;

export async function renderPresencePage() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <div class="row center" style="gap:8px; align-items:center; flex-wrap:wrap">
        <h2 style="margin:0">今ラボにいる人</h2>
        <span style="flex:1"></span>
        <label style="display:inline-flex; align-items:center; gap:6px; font-size:13px" class="muted">
          名前を表示
          <span class="switch">
            <input type="checkbox" id="presence-names-toggle">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <div id="presence" style="margin-top:10px"><div class="muted">読み込み中…</div></div>
      <div style="text-align:right; margin-top:8px">
        <a href="#/activity" class="hint">ラボ滞在・活動マップ →</a>
      </div>
    </div>
  `;
  const toggle = document.getElementById('presence-names-toggle');
  const SHOW_NAMES_KEY = 'labpay-presence-show-names';
  const showNames = localStorage.getItem(SHOW_NAMES_KEY) !== '0';
  toggle.checked = showNames;
  applyPresenceMode(showNames);
  toggle.addEventListener('change', () => {
    localStorage.setItem(SHOW_NAMES_KEY, toggle.checked ? '1' : '0');
    applyPresenceMode(toggle.checked);
  });
  await fetchAndRender();
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(() => {
    if (!document.hidden && document.getElementById('presence')) fetchAndRender();
    else if (!document.getElementById('presence')) { clearInterval(presenceTimer); presenceTimer = null; }
  }, 60_000);
}

async function fetchAndRender() {
  const root = document.getElementById('presence');
  if (!root) return;
  if (!state.hasMac) {
    root.innerHTML = `
      <a href="#/settings" style="display:block; text-decoration:none; color:inherit;
              background:#fff8e6; border:1px solid #f5d089; border-radius:10px;
              padding:12px 14px">
        <div class="bold" style="color:#b54708; margin-bottom:6px">📱 スマホの MAC アドレスを登録すると、ここに表示されるようになります</div>
        <div class="muted" style="font-size:11px; margin-top:8px">タップで設定へ →</div>
      </a>`;
    return;
  }
  try {
    const pres = await get('/api/presence');
    if (!pres.rooms.length) {
      root.innerHTML = `<div class="empty">部屋が登録されていません</div>`;
    } else {
      const win = Number(pres.window_minutes) || 3;
      root.innerHTML = pres.rooms.map(r => renderRoom(r, win)).join('');
    }
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
