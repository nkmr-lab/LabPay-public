// v619 自作ゲーム kind 管理 (admin)。 DB から 登録された kind を 編集 + 新規登録 + 無効化。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast, state } from '../app.js';

export async function renderAdminCustomGames() {
  if (state.me?.role !== 'admin') {
    document.getElementById('app').innerHTML = `<div class="card"><div class="hint">管理者のみ</div></div>`;
    return;
  }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/admin" class="hint">← 管理</a>
      <h2 style="margin:6px 0">🎮 自作ゲーム kind 管理</h2>
      <p class="hint" style="font-size:13px">
        custom_game_kinds テーブル の 内容を 編集。 ここで 新規 kind を 登録すると、
        対応する JS ファイル (デフォルト <code>/js/views/{kind}.js</code>) が あれば
        すぐに /api/custom-games/list に出現します。 詳細は <a href="https://github.com/nkmr-lab/LabPay/blob/main/docs/CUSTOM_GAMES.md" target="_blank">docs/CUSTOM_GAMES.md</a>。
      </p>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">＋ 新規 kind 登録</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
        <label><div class="bold" style="font-size:13px">kind (URL slug)</div>
          <input id="acg-kind" maxlength="40" placeholder="例: dotsboxes" style="width:100%"></label>
        <label><div class="bold" style="font-size:13px">icon (絵文字)</div>
          <input id="acg-icon" maxlength="20" placeholder="例: 🔲" style="width:100%"></label>
        <label><div class="bold" style="font-size:13px">表示名</div>
          <input id="acg-name" maxlength="80" placeholder="例: 🔲 ドット&ボックス" style="width:100%"></label>
        <label><div class="bold" style="font-size:13px">フィー (pt)</div>
          <input id="acg-fee" type="number" min="0" max="100" value="1" style="width:100%"></label>
      </div>
      <label style="display:block; margin-top:8px"><div class="bold" style="font-size:13px">説明</div>
        <textarea id="acg-desc" rows="2" maxlength="500" style="width:100%; box-sizing:border-box"></textarea></label>
      <label style="display:block; margin-top:8px"><div class="bold" style="font-size:13px">JS module URL (任意、 デフォルト /js/views/{kind}.js)</div>
        <input id="acg-jsurl" maxlength="200" placeholder="/js/views/dotsboxes.js" style="width:100%"></label>
      <div style="margin-top:8px">
        <button id="acg-create" class="btn primary">登録</button>
      </div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">登録済 kind 一覧</h3>
      <div id="acg-list"><div class="hint">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('acg-create').addEventListener('click', async () => {
    const kind = document.getElementById('acg-kind').value.trim();
    const name = document.getElementById('acg-name').value.trim();
    const desc = document.getElementById('acg-desc').value.trim();
    const icon = document.getElementById('acg-icon').value.trim();
    const fee  = parseInt(document.getElementById('acg-fee').value, 10);
    const jsUrl = document.getElementById('acg-jsurl').value.trim();
    if (!kind || !name || !desc || !icon) { toast('kind / 表示名 / 説明 / icon は必須'); return; }
    try {
      const body = { kind, display_name: name, description: desc, icon, fee };
      if (jsUrl) body.js_module_url = jsUrl;
      await post('/api/custom-games/kinds', body);
      toast('登録しました');
      renderAdminCustomGames();
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
  await loadKinds();
}

async function loadKinds() {
  const root = document.getElementById('acg-list');
  try {
    const d = await get('/api/custom-games/kinds');
    const items = d.items || [];
    if (!items.length) { root.innerHTML = '<div class="hint">まだ登録なし</div>'; return; }
    root.innerHTML = items.map(k => `
      <div class="list-item" style="display:flex; flex-direction:column; gap:6px; align-items:stretch; padding:10px 0; border-top:1px solid var(--line)">
        <div style="display:flex; align-items:center; gap:8px">
          <span style="font-size:24px">${escapeHtml(k.icon || '')}</span>
          <span class="bold">${escapeHtml(k.display_name)}</span>
          <code style="font-size:11px; opacity:0.6">${escapeHtml(k.kind)}</code>
          ${k.is_active ? '<span class="tag ok">有効</span>' : '<span class="tag muted">無効</span>'}
          <span class="hint-sm">${k.fee}pt</span>
          <span style="flex:1"></span>
          <button class="btn acg-toggle" data-kind="${escapeHtml(k.kind)}" data-active="${k.is_active ? 1 : 0}" style="font-size:11px; padding:2px 8px">${k.is_active ? '無効化' : '有効化'}</button>
        </div>
        <div class="hint-sm" style="font-size:12px">${escapeHtml(k.description)}</div>
        <div class="hint-sm" style="font-size:11px">module: <code>${escapeHtml(k.js_module_url)}</code>${k.created_by_name ? ` ・ 登録者: ${escapeHtml(k.created_by_name)}` : ''}</div>
      </div>
    `).join('');
    root.querySelectorAll('.acg-toggle').forEach(b => {
      b.addEventListener('click', async () => {
        const kind = b.dataset.kind;
        const active = b.dataset.active === '1';
        try {
          if (active) await del(`/api/custom-games/kinds/${encodeURIComponent(kind)}`);
          else        await patch(`/api/custom-games/kinds/${encodeURIComponent(kind)}`, { is_active: true });
          toast(active ? '無効化しました' : '有効化しました');
          loadKinds();
        } catch (e) { toast('失敗: ' + (e?.message || e)); }
      });
    });
  } catch (e) { root.innerHTML = `<div class="hint">読み込み失敗: ${escapeHtml(e?.message || e)}</div>`; }
}
