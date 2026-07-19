// v1100 /#/miro — Miro 的な共同ポストイット空間の部屋一覧 + 新規作成。
//   v1110 部屋のスコープ (全員 / グループ / 自分専用) を選べるように。

import { get, post } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { toast } from '../app.js';

let MY_GROUPS = [];

export async function renderMiroRooms() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🗒 Board (ポストイット空間)</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px; line-height:1.6">
        グループで自由にポストイットを配置できる共有ボード。ドラッグで動かす / つまんでリサイズ / 色や表裏を変える / 🎨 で AI 画像生成もできる。
        部屋は「ラボ全員 / グループ / 自分専用」から選んで作れる。
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
          <div class="field">
            <span class="lbl">公開範囲</span>
            <div style="display:flex; flex-direction:column; gap:6px">
              <label style="display:flex; align-items:center; gap:6px; cursor:pointer">
                <input type="radio" name="mroom-vis" value="lab" checked>
                <span>🌏 ラボ全員 (誰でも見えて編集できる)</span>
              </label>
              <label style="display:flex; align-items:center; gap:6px; cursor:pointer">
                <input type="radio" name="mroom-vis" value="group">
                <span>👥 特定グループのメンバーだけ</span>
              </label>
              <div id="mroom-group-wrap" style="margin-left:22px; display:none">
                <select id="mroom-group"><option value="">読み込み中…</option></select>
              </div>
              <label style="display:flex; align-items:center; gap:6px; cursor:pointer">
                <input type="radio" name="mroom-vis" value="private">
                <span>🔒 自分専用 (自分だけが見える)</span>
              </label>
            </div>
          </div>
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
  document.querySelectorAll('input[name="mroom-vis"]').forEach(el => {
    el.addEventListener('change', () => {
      document.getElementById('mroom-group-wrap').style.display = (el.value === 'group' && el.checked) ? 'block' : (document.querySelector('input[name="mroom-vis"]:checked').value === 'group' ? 'block' : 'none');
    });
  });
  await Promise.all([loadList(), loadGroups()]);
}

async function loadGroups() {
  try {
    const d = await get('/api/groups');
    MY_GROUPS = d.items || [];
    const sel = document.getElementById('mroom-group');
    if (!sel) return;
    if (!MY_GROUPS.length) {
      sel.innerHTML = '<option value="">(あなたが所属するグループはありません)</option>';
      sel.disabled = true;
    } else {
      sel.innerHTML = MY_GROUPS.map(g => `<option value="${g.id}">${escapeHtml(g.title)}</option>`).join('');
      sel.disabled = false;
    }
  } catch (_) {}
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
      el.addEventListener('click', () => navigate('/board/rooms/' +el.dataset.open));
    });
  } catch (e) {
    root.innerHTML = `<div class="muted" style="color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function scopeBadge(r) {
  const v = r.visibility || 'lab';
  if (v === 'private') return `<span style="font-size:10px; background:#fee2e2; color:#b91c1c; padding:2px 6px; border-radius:4px; font-weight:600">🔒 自分専用</span>`;
  if (v === 'group')   return `<span style="font-size:10px; background:#e0e7ff; color:#4338ca; padding:2px 6px; border-radius:4px; font-weight:600">👥 ${escapeHtml(r.group_title || 'group')}</span>`;
  return `<span style="font-size:10px; background:#d1fae5; color:#065f46; padding:2px 6px; border-radius:4px; font-weight:600">🌏 全員</span>`;
}

function cardHtml(r) {
  const bg = r.bg_color || '#FAFAFA';
  const desc = r.description ? `<div style="font-size:12px; color:#4b5563; margin-top:4px">${escapeHtml(r.description)}</div>` : '';
  return `
    <div class="btn" data-open="${r.id}" style="cursor:pointer; text-align:left; padding:12px; background:${bg}; border:1px solid #e5e7eb; border-radius:10px; min-height:96px; display:flex; flex-direction:column; gap:4px">
      <div style="display:flex; align-items:center; gap:6px">
        <div style="font-weight:700; font-size:15px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(r.title)}</div>
        ${scopeBadge(r)}
      </div>
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
  const vis   = document.querySelector('input[name="mroom-vis"]:checked')?.value || 'lab';
  const gid   = vis === 'group' ? parseInt(document.getElementById('mroom-group').value, 10) : null;
  if (!title) { toast('タイトルを入れてね'); return; }
  if (vis === 'group' && (!gid || isNaN(gid))) { toast('グループを選んでね'); return; }
  try {
    const body = { title, description: desc, bg_color: bg, visibility: vis };
    if (vis === 'group') body.owner_group_id = gid;
    const r = await post('/api/miro/rooms', body);
    toast('部屋を作ったよ');
    navigate('/board/rooms/' +r.id);
  } catch (e) {
    toast('作成失敗: ' + e.message);
  }
}
