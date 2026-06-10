// /#/translate — 画像 (メニュー / 看板 / 説明文 など) を 和訳。
// 写真 を 撮る or 選ぶ → /api/uploads で アップ → /api/ai/translate_image → 結果表示。
// v426 翻訳 ログ: 自分専用 (group_id NULL) or グループ 共有 を 選んで 保存 → 履歴 下部に表示。

import { get, post, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';
import { uploadImage } from '../upload.js';

function fmtTime(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  if (isNaN(dt)) return s;
  const m = dt.getMonth() + 1, d = dt.getDate();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${m}/${d} ${hh}:${mm}`;
}

export async function renderTranslate({ query } = {}) {
  const app = document.getElementById('app');
  const presetGroupId = Number(query?.group_id || 0) || null;
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🌐 画像 和訳</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">写真 (8MB まで)</span>
        <input type="file" id="tr-file" accept="image/*">
        <input type="hidden" id="tr-url" value="">
        <img id="tr-prev" alt="" hidden style="max-width:240px; max-height:240px; margin-top:6px; border-radius:8px; object-fit:contain; display:none; background:#f6f6f9">
        <span id="tr-up-st" class="hint-sm"></span>
      </label>
      <label class="field"><span class="lbl">補足 (任意): どんな 内容か メモ すると 精度が 上がります</span>
        <input type="text" id="tr-hint" maxlength="500" placeholder="例: 中華料理 メニュー / ベトナム の 駅 表示 / 公園の 注意書き">
      </label>
      <label class="field"><span class="lbl">保存先</span>
        <select id="tr-group" style="max-width:280px">
          <option value="">自分のみ (非公開)</option>
        </select>
        <span class="hint-sm">グループ を 選ぶと そのメンバー 全員 が この 翻訳結果 を 閲覧 できます。</span>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="tr-go" class="primary" disabled>🌐 和訳する</button>
      </div>
    </div>
    <div class="card" id="tr-out-card" hidden>
      <h3 style="margin:0 0 6px">和訳結果 <button id="tr-copy" class="btn" style="padding:2px 10px; font-size:12px; margin-left:6px">📋 コピー</button></h3>
      <div id="tr-out" style="white-space:pre-wrap; line-height:1.6; font-size:14px"></div>
    </div>

    <div class="card">
      <div class="row center">
        <h3 class="row-title">📚 翻訳ログ</h3>
        <select id="tr-flt" style="max-width:200px">
          <option value="all">すべて (自分 + 参加 グループ)</option>
          <option value="mine">自分のみ</option>
        </select>
      </div>
      <div id="tr-hist" class="list" style="margin-top:6px"><div class="muted">読み込み中…</div></div>
    </div>
  `;

  // グループ select 埋め込み
  try {
    const d = await get('/api/groups');
    const sel = document.getElementById('tr-group');
    const fltSel = document.getElementById('tr-flt');
    for (const g of (d.items || [])) {
      const o = document.createElement('option');
      o.value = String(g.id);
      o.textContent = '👥 ' + g.title;
      sel.appendChild(o);
      const f = document.createElement('option');
      f.value = 'g:' + g.id;
      f.textContent = '👥 ' + g.title + ' のみ';
      fltSel.appendChild(f);
    }
    if (presetGroupId) sel.value = String(presetGroupId);
  } catch (_) { /* swallow */ }

  document.getElementById('tr-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const st = document.getElementById('tr-up-st');
    st.textContent = 'アップロード中…';
    try {
      const data = await uploadImage(f);
      document.getElementById('tr-url').value = data.url;
      const prev = document.getElementById('tr-prev');
      prev.src = data.url; prev.hidden = false; prev.style.display = 'block';
      st.textContent = '✓ アップロード 完了';
      document.getElementById('tr-go').disabled = false;
    } catch (e) {
      st.textContent = '失敗: ' + e.message;
    }
  });

  document.getElementById('tr-go').addEventListener('click', async () => {
    const url = document.getElementById('tr-url').value;
    const hint = document.getElementById('tr-hint').value.trim() || null;
    const groupVal = document.getElementById('tr-group').value;
    const group_id = groupVal ? Number(groupVal) : null;
    if (!url) { toast('先に 写真を 選んでください'); return; }
    const btn = document.getElementById('tr-go');
    const outCard = document.getElementById('tr-out-card');
    const outEl = document.getElementById('tr-out');
    btn.disabled = true; btn.textContent = '🌐 翻訳中…';
    outCard.hidden = false;
    outEl.textContent = '画像を 解析中… (5-20 秒)';
    try {
      const r = await post('/api/ai/translate_image', { image_url: url, hint, group_id });
      outEl.textContent = r.text || '(空の応答)';
      await loadHistory();
    } catch (e) {
      outEl.innerHTML = `<span class="muted">失敗: ${escapeHtml(e.message)}</span>`;
    } finally {
      btn.disabled = false; btn.textContent = '🌐 和訳する';
    }
  });

  document.getElementById('tr-copy').addEventListener('click', async () => {
    const txt = document.getElementById('tr-out').textContent || '';
    try { await navigator.clipboard.writeText(txt); toast('コピーしました'); }
    catch (_) { toast('コピー 失敗'); }
  });

  document.getElementById('tr-flt').addEventListener('change', () => loadHistory());
  await loadHistory();
}

async function loadHistory() {
  const root = document.getElementById('tr-hist');
  if (!root) return;
  const fltVal = document.getElementById('tr-flt')?.value || 'all';
  const params = {};
  if (fltVal === 'mine') params.mine = 1;
  else if (fltVal.startsWith('g:')) params.group_id = fltVal.slice(2);
  try {
    const d = await get('/api/ai/translations', params);
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = `<div class="empty">まだ 翻訳 ログは ありません</div>`;
      return;
    }
    root.innerHTML = items.map(t => {
      const snippet = (t.result_text || '').slice(0, 120) + (t.result_text.length > 120 ? '…' : '');
      const tag = t.group_id
        ? `<span class="tag" style="background:#e0f7f1; color:#0e7c63; font-size:10px">👥 ${escapeHtml(t.group_title || 'グループ')}</span>`
        : '<span class="tag muted" style="font-size:10px">🔒 自分のみ</span>';
      const rmBtn = t.is_mine
        ? `<button data-rm-tr="${t.id}" class="btn" style="padding:0 6px; font-size:11px; color:var(--muted)">×</button>`
        : '';
      return `
        <div class="list-item" data-tr-id="${t.id}" style="align-items:flex-start; gap:8px">
          <img src="${escapeHtml(t.image_url)}" alt="" style="width:60px; height:60px; object-fit:cover; border-radius:6px; flex-shrink:0; cursor:pointer" data-open-tr="${t.id}">
          <div class="grow" style="min-width:0; cursor:pointer" data-open-tr="${t.id}">
            <div class="bold" style="font-size:13px">${tag} <span class="muted" style="font-weight:400; font-size:11px">${fmtTime(t.created_at)} · ${escapeHtml(t.user_name || '')}</span></div>
            ${t.hint ? `<div class="meta" style="font-size:11px">💭 ${escapeHtml(t.hint)}</div>` : ''}
            <div class="meta" style="font-size:12px; white-space:pre-wrap; line-height:1.4; margin-top:2px" data-snippet="${t.id}">${escapeHtml(snippet)}</div>
            <div class="meta" style="font-size:12px; white-space:pre-wrap; line-height:1.6; margin-top:4px" data-full="${t.id}" hidden>${escapeHtml(t.result_text || '')}</div>
          </div>
          ${rmBtn}
        </div>`;
    }).join('');
    // wire
    root.querySelectorAll('[data-open-tr]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.openTr;
        const sn = root.querySelector(`[data-snippet="${id}"]`);
        const fu = root.querySelector(`[data-full="${id}"]`);
        if (sn && fu) {
          const isExpanded = !fu.hidden;
          sn.hidden = !isExpanded;
          fu.hidden = isExpanded;
        }
      });
    });
    root.querySelectorAll('[data-rm-tr]').forEach(b => {
      b.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('この 翻訳 ログを 削除しますか?')) return;
        try { await del('/api/ai/translations/' + b.dataset.rmTr); await loadHistory(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
