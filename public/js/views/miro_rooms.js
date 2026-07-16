// v1100 /#/miro — Miro 的な共同ポストイット空間の部屋一覧 + 新規作成。
//   カード = 部屋、タップで /#/miro/rooms/{id} キャンバスへ。
//   ラボ全員が全部屋見える + 誰でも部屋を作れる。

import { get, post } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { toast } from '../app.js';

export async function renderMiroRooms() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🗒 Miro (ポストイット空間)</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px; line-height:1.6">
        グループで自由にポストイットを配置できる共有ボード。ドラッグで動かす / つまんでリサイズ / 色や表裏を変える / 🎨 で AI 画像生成もできる。
        部屋はラボ全員が見え、誰でも編集可。
      </p>
    </div>

    <div class="card">
      <details>
        <summary style="cursor:pointer; font-weight:600">➕ 新しい部屋を作る</summary>
        <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px">
          <label class="field">
            <span class="lbl">タイトル (必須)</span>
            <input type="text" id="mroom-title" maxlength="200" placeholder="例: 卒論のアイデア出し">
          </label>
          <label class="field">
            <span class="lbl">説明 (任意)</span>
            <textarea id="mroom-desc" rows="2" maxlength="2000" placeholder="どんなボードか一言"></textarea>
          </label>
          <label class="field">
            <span class="lbl">背景色</span>
            <input type="color" id="mroom-bg" value="#FAFAFA" style="width:80px; height:36px; padding:2px">
          </label>
          <div class="row" style="gap:6px; justify-content:flex-end">
            <button class="btn primary" id="mroom-create">作成</button>
          </div>
        </div>
      </details>
    </div>

    <div class="card">
      <div class="bold" style="margin-bottom:6px">部屋一覧</div>
      <div id="mroom-list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('mroom-create').addEventListener('click', createRoom);
  await loadList();
}

async function loadList() {
  const root = document.getElementById('mroom-list');
  try {
    const d = await get('/api/miro/rooms');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="muted">まだ部屋がないよ。上から作ってみよう。</div>';
      return;
    }
    root.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px">
        ${items.map(r => cardHtml(r)).join('')}
      </div>
    `;
    root.querySelectorAll('[data-open]').forEach(el => {
      el.addEventListener('click', () => navigate('/miro/rooms/' + el.dataset.open));
    });
  } catch (e) {
    root.innerHTML = `<div class="muted" style="color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function cardHtml(r) {
  const bg = r.bg_color || '#FAFAFA';
  const desc = r.description ? `<div style="font-size:12px; color:#4b5563; margin-top:4px">${escapeHtml(r.description)}</div>` : '';
  return `
    <div class="btn" data-open="${r.id}" style="cursor:pointer; text-align:left; padding:12px; background:${bg}; border:1px solid #e5e7eb; border-radius:10px; min-height:96px; display:flex; flex-direction:column; gap:4px">
      <div style="font-weight:700; font-size:15px">${escapeHtml(r.title)}</div>
      ${desc}
      <div style="margin-top:auto; display:flex; align-items:center; gap:6px; font-size:11px; color:#6b7280">
        ${avatarHtml(r.creator_name, r.creator_avatar, 'xs')}
        <span>${escapeHtml(r.creator_name || '')}</span>
        <span style="margin-left:auto">🗒 ${r.note_count} 枚</span>
      </div>
    </div>
  `;
}

async function createRoom() {
  const title = document.getElementById('mroom-title').value.trim();
  const desc  = document.getElementById('mroom-desc').value.trim();
  const bg    = document.getElementById('mroom-bg').value;
  if (!title) { toast('タイトルを入れてね'); return; }
  try {
    const r = await post('/api/miro/rooms', { title, description: desc, bg_color: bg });
    toast('部屋を作ったよ');
    navigate('/miro/rooms/' + r.id);
  } catch (e) {
    toast('作成失敗: ' + e.message);
  }
}
