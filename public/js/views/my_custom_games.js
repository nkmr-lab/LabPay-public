// v620 自作ゲーム の ユーザ向け 管理画面。 各ユーザが /#/my-games で
//   - 自分の kind を 新規登録 / 編集 / 無効化
//   - JS module を ファイルアップロード で DB に格納 (サーバの 書き込み権限不要)
//   - 場代 (provider_share_pct) で 提供者 (= 自分) に pot の 一部が 入る
//   admin は 全 kind を 編集可能 (admin_custom_games.js と 同等の権限)。

import { get, post, patch, del } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast, state } from '../app.js';

const MAX_JS_KB = 500;

export async function renderMyCustomGames() {
  const me = state.me;
  if (!me) {
    document.getElementById('app').innerHTML =
      `<div class="card"><div class="hint">ログインが必要です</div></div>`;
    return;
  }
  const isAdmin = me.role === 'admin';
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/settings" class="hint">← 設定</a>
      <h2 style="margin:6px 0">🎮 自作ゲーム 登録</h2>
      <p class="hint" style="font-size:13px">
        自分で 書いた ゲーム を LabPay に 追加できます。 JS ファイル を アップロード して DB に格納、
        参加者の 「場代」 は 提供者 (自分) に 入ります。 詳細は
        <a href="https://github.com/nkmr-lab/LabPay/blob/main/docs/CUSTOM_GAMES.md" target="_blank">docs/CUSTOM_GAMES.md</a>。
      </p>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">＋ 新規 kind 登録</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
        <label><div class="bold" style="font-size:13px">kind (URL slug)</div>
          <input id="mcg-kind" maxlength="40" placeholder="例: dotsboxes" style="width:100%"></label>
        <label><div class="bold" style="font-size:13px">icon (絵文字)</div>
          <input id="mcg-icon" maxlength="20" placeholder="例: 🔲" style="width:100%"></label>
        <label><div class="bold" style="font-size:13px">表示名</div>
          <input id="mcg-name" maxlength="80" placeholder="例: 🔲 ドット&ボックス" style="width:100%"></label>
        <label><div class="bold" style="font-size:13px">プレイフィー (pt)</div>
          <input id="mcg-fee" type="number" min="0" max="100" value="1" style="width:100%"></label>
        <label><div class="bold" style="font-size:13px">場代 (%) — 提供者 (自分) が pot から 受け取る</div>
          <input id="mcg-share" type="number" min="0" max="50" value="0" style="width:100%"></label>
        <span></span>
      </div>
      <label style="display:block; margin-top:8px"><div class="bold" style="font-size:13px">説明</div>
        <textarea id="mcg-desc" rows="2" maxlength="500" style="width:100%; box-sizing:border-box"></textarea></label>
      <label style="display:block; margin-top:8px"><div class="bold" style="font-size:13px">JS ファイル (アップロード、 最大 ${MAX_JS_KB}KB)</div>
        <input id="mcg-jsfile" type="file" accept=".js,.mjs,text/javascript" style="width:100%"></label>
      <div class="hint-sm" style="font-size:12px; margin-top:4px">
        ※ ファイルを 選ばない場合、 既定の URL <code>/api/custom-games/kinds/{kind}/script.js</code> を 使います
        (= 後で アップロード)。
      </div>
      <div style="margin-top:8px">
        <button id="mcg-create" class="btn primary">登録</button>
      </div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">登録済 kind 一覧 ${isAdmin ? '(admin: 全件)' : '(自分のもの)'}</h3>
      <div id="mcg-list"><div class="hint">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('mcg-create').addEventListener('click', () => createKind(isAdmin));
  await loadKinds(me.id, isAdmin);
}

async function readJsFile(input) {
  const f = input.files?.[0];
  if (!f) return null;
  if (f.size > MAX_JS_KB * 1024) throw new Error(`JS ファイルは ${MAX_JS_KB}KB まで`);
  return await f.text();
}

async function createKind(isAdmin) {
  const kind = document.getElementById('mcg-kind').value.trim();
  const name = document.getElementById('mcg-name').value.trim();
  const desc = document.getElementById('mcg-desc').value.trim();
  const icon = document.getElementById('mcg-icon').value.trim();
  const fee  = parseInt(document.getElementById('mcg-fee').value, 10);
  const share = parseInt(document.getElementById('mcg-share').value, 10);
  if (!kind || !name || !desc || !icon) { toast('kind / 表示名 / 説明 / icon は必須'); return; }
  let jsSource = null;
  try { jsSource = await readJsFile(document.getElementById('mcg-jsfile')); }
  catch (e) { toast(e.message); return; }
  try {
    const body = { kind, display_name: name, description: desc, icon, fee, provider_share_pct: share };
    if (jsSource !== null) body.js_source = jsSource;
    await post('/api/custom-games/kinds', body);
    toast('登録しました');
    renderMyCustomGames();
  } catch (e) { toast('失敗: ' + (e?.message || e)); }
}

async function loadKinds(myUid, isAdmin) {
  const root = document.getElementById('mcg-list');
  try {
    const d = await get('/api/custom-games/kinds');
    const all = d.items || [];
    const items = isAdmin ? all : all.filter(k => k.created_by_user_id === myUid);
    if (!items.length) { root.innerHTML = '<div class="hint">まだ登録なし</div>'; return; }
    root.innerHTML = items.map(k => `
      <div style="display:flex; flex-direction:column; gap:6px; padding:10px 0; border-top:1px solid var(--line)">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
          <span style="font-size:24px">${escapeHtml(k.icon || '')}</span>
          <span class="bold">${escapeHtml(k.display_name)}</span>
          <code style="font-size:11px; opacity:0.6">${escapeHtml(k.kind)}</code>
          ${k.is_active ? '<span class="tag ok">有効</span>' : '<span class="tag muted">無効</span>'}
          <span class="hint-sm">${k.fee}pt</span>
          ${k.provider_share_pct > 0 ? `<span class="hint-sm">場代 ${k.provider_share_pct}%</span>` : ''}
          <span style="flex:1"></span>
          <a href="#/cg/${encodeURIComponent(k.kind)}" class="btn" style="font-size:11px; padding:2px 8px">遊ぶ</a>
          <button class="btn mcg-upload" data-kind="${escapeHtml(k.kind)}" style="font-size:11px; padding:2px 8px">JS 更新</button>
          <button class="btn mcg-share" data-kind="${escapeHtml(k.kind)}" data-share="${k.provider_share_pct}" style="font-size:11px; padding:2px 8px">場代変更</button>
          <button class="btn mcg-toggle" data-kind="${escapeHtml(k.kind)}" data-active="${k.is_active ? 1 : 0}" style="font-size:11px; padding:2px 8px">${k.is_active ? '無効化' : '有効化'}</button>
        </div>
        <div class="hint-sm" style="font-size:12px">${escapeHtml(k.description)}</div>
        <div class="hint-sm" style="font-size:11px">
          module: <code>${escapeHtml(k.js_module_url)}</code>
          ${k.has_js_source ? '・<span class="tag ok">DB 格納</span>' : '・<span class="tag muted">未アップロード</span>'}
          ${k.created_by_name ? ` ・ 登録者: ${escapeHtml(k.created_by_name)}` : ''}
        </div>
      </div>
    `).join('');
    root.querySelectorAll('.mcg-toggle').forEach(b => {
      b.addEventListener('click', async () => {
        const kind = b.dataset.kind;
        const active = b.dataset.active === '1';
        try {
          if (active) await del(`/api/custom-games/kinds/${encodeURIComponent(kind)}`);
          else        await patch(`/api/custom-games/kinds/${encodeURIComponent(kind)}`, { is_active: true });
          toast(active ? '無効化しました' : '有効化しました');
          loadKinds(myUid, isAdmin);
        } catch (e) { toast('失敗: ' + (e?.message || e)); }
      });
    });
    root.querySelectorAll('.mcg-upload').forEach(b => {
      b.addEventListener('click', async () => {
        const kind = b.dataset.kind;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.js,.mjs,text/javascript';
        input.addEventListener('change', async () => {
          try {
            const src = await readJsFile(input);
            if (src === null) return;
            await patch(`/api/custom-games/kinds/${encodeURIComponent(kind)}`, { js_source: src });
            toast('JS を更新しました');
            loadKinds(myUid, isAdmin);
          } catch (e) { toast('失敗: ' + (e?.message || e)); }
        });
        input.click();
      });
    });
    root.querySelectorAll('.mcg-share').forEach(b => {
      b.addEventListener('click', async () => {
        const kind = b.dataset.kind;
        const cur = parseInt(b.dataset.share, 10) || 0;
        const v = prompt('場代 (%) - 0〜50。 提供者 (自分) が pot から 受け取る 割合。', String(cur));
        if (v === null) return;
        const share = parseInt(v, 10);
        if (Number.isNaN(share) || share < 0 || share > 50) { toast('0〜50 の数値で'); return; }
        try {
          await patch(`/api/custom-games/kinds/${encodeURIComponent(kind)}`, { provider_share_pct: share });
          toast('場代を更新しました');
          loadKinds(myUid, isAdmin);
        } catch (e) { toast('失敗: ' + (e?.message || e)); }
      });
    });
  } catch (e) { root.innerHTML = `<div class="hint">読み込み失敗: ${escapeHtml(e?.message || e)}</div>`; }
}
