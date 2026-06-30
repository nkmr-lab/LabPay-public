// /#/translate — 画像 (メニュー / 看板 / 説明文など) を和訳。
// 写真を撮る or 選ぶ → /api/uploads でアップ → /api/ai/translate_image → 結果表示。
// v426 翻訳ログ: 自分専用 (group_id NULL) or グループ共有を選んで保存 → 履歴下部に表示。

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
      <h2 style="margin:0">🌐 画像和訳</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">写真 (各 8MB まで、 複数選択可)</span>
        <input type="file" id="tr-file" accept="image/*" multiple>
        <div id="tr-thumbs" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px"></div>
        <span id="tr-up-st" class="hint-sm"></span>
      </label>
      <label class="field"><span class="lbl">補足 (任意): どんな内容かメモすると精度が上がります</span>
        <input type="text" id="tr-hint" maxlength="500" placeholder="例: 中華料理メニュー / ベトナムの駅表示 / 公園の注意書き">
      </label>
      <label class="field"><span class="lbl">保存先</span>
        <select id="tr-group" style="max-width:280px">
          <option value="">自分のみ (非公開)</option>
        </select>
        <span class="hint-sm">グループを選ぶとそのメンバー全員が翻訳結果を閲覧できます。</span>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="tr-go" class="primary" disabled>🌐 和訳する</button>
      </div>
    </div>
    <div id="tr-out-region"></div>

    <div class="card">
      <div class="row center">
        <h3 class="row-title">📚 翻訳ログ</h3>
        <select id="tr-flt" style="max-width:200px">
          <option value="all">すべて (自分 + 参加グループ)</option>
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

  // v567 #221 複数画像をアップロード保持
  const uploadedUrls = []; // {url, name}
  document.getElementById('tr-file').addEventListener('change', async (ev) => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    const st = document.getElementById('tr-up-st');
    const thumbs = document.getElementById('tr-thumbs');
    for (const f of files) {
      st.textContent = `アップロード中… (${uploadedUrls.length + 1}/${uploadedUrls.length + files.length})`;
      try {
        const data = await uploadImage(f);
        uploadedUrls.push({ url: data.url, name: f.name });
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative';
        wrap.innerHTML = `
          <img src="${escapeHtml(data.url)}" style="width:80px; height:80px; object-fit:cover; border-radius:6px; background:#f6f6f9">
          <button data-rm-url="${escapeHtml(data.url)}" style="position:absolute; top:-6px; right:-6px; width:20px; height:20px; border:none; background:#dc2626; color:#fff; border-radius:50%; cursor:pointer; font-size:12px; padding:0">×</button>`;
        wrap.querySelector('[data-rm-url]').addEventListener('click', () => {
          const u = wrap.querySelector('[data-rm-url]').dataset.rmUrl;
          const idx = uploadedUrls.findIndex(x => x.url === u);
          if (idx >= 0) uploadedUrls.splice(idx, 1);
          wrap.remove();
          updateGoBtn();
        });
        thumbs.appendChild(wrap);
      } catch (e) {
        st.textContent = '失敗: ' + e.message;
      }
    }
    st.textContent = `✓ ${uploadedUrls.length} 件アップロード完了`;
    updateGoBtn();
    ev.target.value = '';
  });
  function updateGoBtn() {
    const btn = document.getElementById('tr-go');
    btn.disabled = uploadedUrls.length === 0;
    btn.textContent = uploadedUrls.length > 1 ? `🌐 ${uploadedUrls.length} 件まとめて和訳` : '🌐 和訳する';
  }

  document.getElementById('tr-go').addEventListener('click', async () => {
    if (!uploadedUrls.length) { toast('先に写真を選んでください'); return; }
    const hint = document.getElementById('tr-hint').value.trim() || null;
    const groupVal = document.getElementById('tr-group').value;
    const group_id = groupVal ? Number(groupVal) : null;
    const btn = document.getElementById('tr-go');
    const outRegion = document.getElementById('tr-out-region');
    btn.disabled = true;
    outRegion.innerHTML = '';
    let done = 0;
    for (const item of uploadedUrls) {
      done++;
      btn.textContent = `🌐 翻訳中… (${done}/${uploadedUrls.length})`;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="row" style="gap:8px; align-items:flex-start">
          <img src="${escapeHtml(item.url)}" style="width:60px; height:60px; object-fit:cover; border-radius:6px; flex:none; background:#f6f6f9">
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:13px">${escapeHtml(item.name)}</div>
            <div class="meta" style="font-size:11px">⏳ 解析中…</div>
          </div>
        </div>
        <div class="tr-content" style="margin-top:8px"></div>`;
      outRegion.appendChild(card);
      const contentEl = card.querySelector('.tr-content');
      try {
        const r = await post('/api/ai/translate_image', { image_url: item.url, hint, group_id });
        contentEl.innerHTML = formatTranslationOutput(r.text || '');
        card.querySelector('.meta').innerHTML = '<span style="color:#15803d">✓ 完了</span>';
      } catch (e) {
        contentEl.innerHTML = `<div class="muted">失敗: ${escapeHtml(e.message)}</div>`;
        card.querySelector('.meta').innerHTML = '<span style="color:#dc2626">✗ 失敗</span>';
      }
    }
    await loadHistory();
    btn.disabled = false;
    btn.textContent = uploadedUrls.length > 1 ? `🌐 ${uploadedUrls.length} 件まとめて和訳` : '🌐 和訳する';
  });

// markdown 風出力を CSS スタイリング HTML に変換
function formatTranslationOutput(text) {
  if (!text) return '<div class="muted">(空の応答)</div>';
  // セキュリティ: 一度 escapeHtml した上で軽量 markdown を解釈
  let s = escapeHtml(text);
  // **bold** → <strong>
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--primary, #4a106d)">$1</strong>');
  // 行頭 「└ ...」 を補足説明スタイルに
  const lines = s.split('\n');
  let html = '<div style="font-family:system-ui, sans-serif; line-height:1.7; font-size:14px">';
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (!trimmed) { html += '<div style="height:6px"></div>'; continue; }
    if (trimmed.startsWith('└')) {
      const body = trimmed.replace(/^└\s*/, '');
      html += `<div style="margin-left:18px; padding:4px 10px; background:#f5f0fa; border-left:3px solid #b3a0e0; border-radius:0 6px 6px 0; font-size:13px; color:#444; margin-bottom:4px">${body}</div>`;
    } else if (/^#+\s/.test(trimmed)) {
      const body = trimmed.replace(/^#+\s*/, '');
      html += `<div style="font-size:16px; font-weight:700; color:var(--primary, #4a106d); margin-top:12px; padding-bottom:3px; border-bottom:2px solid #ede4f3">${body}</div>`;
    } else if (/^[-*]\s/.test(trimmed)) {
      const body = trimmed.replace(/^[-*]\s*/, '');
      html += `<div style="margin-left:14px; padding-left:8px; position:relative; margin-bottom:2px">• ${body}</div>`;
    } else {
      html += `<div style="margin-bottom:4px">${ln}</div>`;
    }
  }
  html += '</div>';
  return html;
}

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
      root.innerHTML = `<div class="empty">まだ翻訳ログはありません</div>`;
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
          <img src="${escapeHtml(t.image_thumb_url || t.image_url)}" alt="" loading="lazy" decoding="async" style="width:60px; height:60px; object-fit:cover; border-radius:6px; flex-shrink:0; cursor:pointer" data-open-tr="${t.id}">
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
        if (!confirm('この翻訳ログを削除しますか?')) return;
        try { await del('/api/ai/translations/' + b.dataset.rmTr); await loadHistory(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
