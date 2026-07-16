// /#/tickets — チケット生成アプリ (v1122 MVP)
//   誰でも発行 → 対象者が pt 払って使う → 発行者に pt 入る。

import { get, post, patch } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { toast, state } from '../app.js';

export async function renderTickets() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🎫 チケット</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px; line-height:1.6">
        「◯◯します」「◯◯できる権利」を pt で売買できる社内マーケット。<br>
        誰でも発行 → 対象者が pt を払って使う → 発行者に pt 入る。<br>
        例: 「運転しますチケット 500pt」「席を選べるチケット 100pt」「罰ゲーム回避 300pt」等。
      </p>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button class="btn primary" data-tk-tab="list">🎫 全チケット</button>
        <button class="btn"         data-tk-tab="create">✏️ 発行</button>
        <button class="btn"         data-tk-tab="mine">🗂 発行 / 使用履歴</button>
      </div>
    </div>
    <div id="tk-root"><div class="muted">読み込み中…</div></div>
  `;
  document.querySelectorAll('[data-tk-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tkTab));
  });
  await switchTab('list');
}

async function switchTab(tab) {
  document.querySelectorAll('[data-tk-tab]').forEach(el => el.classList.toggle('primary', el.dataset.tkTab === tab));
  const root = document.getElementById('tk-root');
  root.innerHTML = '<div class="muted">読み込み中…</div>';
  if (tab === 'list')   return renderList(root);
  if (tab === 'create') return renderCreate(root);
  if (tab === 'mine')   return renderMine(root);
}

function ticketCard(t, opts = {}) {
  const thumb = t.image_url
    ? `<img src="${escapeHtml(t.image_url)}" style="width:60px; height:60px; object-fit:cover; border-radius:8px">`
    : `<div style="width:60px; height:60px; display:flex; align-items:center; justify-content:center; font-size:36px; background:#fef3c7; border-radius:8px">${escapeHtml(t.emoji || '🎫')}</div>`;
  const target = t.target_scope === 'grade' ? `👥 ${escapeHtml(t.target_grade || '')} 限定` : '👥 全員';
  const expires = t.expires_at ? `⏰ ~ ${escapeHtml(t.expires_at)}` : '⏰ 無期限';
  const statusBadge = t.status === 'active'
    ? `<span style="background:#dcfce7; color:#166534; padding:1px 6px; border-radius:6px; font-size:10px">active (残 ${t.remaining}/${t.max_uses})</span>`
    : t.status === 'sold_out'
      ? '<span style="background:#f3f4f6; color:#4b5563; padding:1px 6px; border-radius:6px; font-size:10px">売切</span>'
      : t.status === 'expired'
        ? '<span style="background:#fee2e2; color:#b91c1c; padding:1px 6px; border-radius:6px; font-size:10px">期限切</span>'
        : '<span style="background:#e5e7eb; color:#4b5563; padding:1px 6px; border-radius:6px; font-size:10px">停止</span>';
  return `
    <div class="card" style="padding:10px">
      <div class="row" style="gap:10px; align-items:flex-start">
        ${thumb}
        <div style="flex:1; min-width:0">
          <div class="row" style="gap:6px; align-items:center">
            <div style="font-weight:700; font-size:15px; flex:1">${escapeHtml(t.title)}</div>
            <div style="font-weight:800; color:#7c3aed; font-size:18px">${t.price}pt</div>
          </div>
          ${t.description ? `<div style="font-size:12px; color:#4b5563; margin-top:4px; white-space:pre-wrap">${escapeHtml(t.description)}</div>` : ''}
          ${t.usable_in ? `<div style="font-size:11px; color:#7c3aed; margin-top:3px">📌 ${escapeHtml(t.usable_in)}</div>` : ''}
          <div style="font-size:11px; color:#6b7280; margin-top:4px">
            ${avatarHtml(t.issuer_name, t.issuer_avatar, 'xs')} 発行: ${escapeHtml(t.issuer_name || '')} · ${target} · ${expires} · ${statusBadge}
          </div>
          <div class="row" style="gap:6px; margin-top:6px">
            ${t.can_use ? `<button class="btn primary" data-tk-use="${t.id}">🎫 使う (-${t.price}pt)</button>` : ''}
            ${t.is_mine && t.status === 'active' ? `<button class="btn" data-tk-revoke="${t.id}" style="color:#b91c1c">停止</button>` : ''}
            ${!t.applicable && t.target_scope === 'grade' ? `<span class="hint-sm" style="font-size:11px; color:#b91c1c">対象学年ではないので使えません</span>` : ''}
            ${t.is_mine ? `<span class="hint-sm" style="font-size:11px; color:#6b7280">自分発行 (自分では使えません)</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function renderList(root) {
  try {
    const d = await get('/api/tickets');
    if (!d.items.length) { root.innerHTML = '<div class="card muted">まだチケットが発行されていません。「✏️ 発行」から作ってみよう!</div>'; return; }
    root.innerHTML = `<div style="display:flex; flex-direction:column; gap:8px">${d.items.map(ticketCard).join('')}</div>`;
    wireCards(root);
  } catch (e) { root.innerHTML = `<div class="card muted" style="color:#b91c1c">${escapeHtml(e.message)}</div>`; }
}

async function renderMine(root) {
  try {
    const d = await get('/api/tickets/mine');
    root.innerHTML = `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">✏️ 私が発行 (${d.issued.length})</div>
        ${d.issued.length ? `<div style="display:flex; flex-direction:column; gap:8px">${d.issued.map(ticketCard).join('')}</div>` : '<div class="muted">まだ発行なし</div>'}
      </div>
      <div class="card">
        <div class="bold" style="margin-bottom:6px">🎫 使った履歴 (${d.used.length})</div>
        ${d.used.length ? d.used.map(u => `
          <div style="padding:6px 0; border-bottom:1px solid #f3f4f6; font-size:13px">
            🎫 <b>${escapeHtml(u.title)}</b> (${u.price}pt) → 発行: ${escapeHtml(u.issuer_name || '')}
            <div style="font-size:11px; color:#6b7280">${escapeHtml(u.used_at)} ${u.note ? '· メモ: ' + escapeHtml(u.note) : ''}</div>
          </div>
        `).join('') : '<div class="muted">まだ使ったことなし</div>'}
      </div>
    `;
    wireCards(root);
  } catch (e) { root.innerHTML = `<div class="card muted" style="color:#b91c1c">${escapeHtml(e.message)}</div>`; }
}

async function renderCreate(root) {
  root.innerHTML = `
    <div class="card">
      <div class="bold" style="margin-bottom:6px">✏️ 新しいチケットを発行</div>
      <p class="hint-sm" style="font-size:12px; color:#6b7280">対象者が pt を払って使う → あなたに pt 入る。 max_uses を超えると自動で売切。</p>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">🎫 タイトル (例: 運転しますチケット)</div>
        <input type="text" id="tk-title" maxlength="200" style="width:100%; padding:6px; box-sizing:border-box">
      </label>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">説明 (詳細内容、任意)</div>
        <textarea id="tk-desc" rows="2" maxlength="2000" style="width:100%; padding:6px; box-sizing:border-box"></textarea>
      </label>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">📌 使える状況 (例: 8/10 の飲み会、B3 のみ)</div>
        <input type="text" id="tk-usable" maxlength="400" style="width:100%; padding:6px; box-sizing:border-box">
      </label>
      <div class="row" style="gap:8px; flex-wrap:wrap; margin-bottom:8px">
        <label style="flex:1; min-width:100px">
          <div style="font-size:12px; color:#6b7280">💴 使う時の pt (5-2000)</div>
          <input type="number" id="tk-price" min="5" max="2000" value="100" style="width:100%; padding:6px; box-sizing:border-box">
        </label>
        <label style="flex:1; min-width:100px">
          <div style="font-size:12px; color:#6b7280">🎫 発行枚数 (1-100)</div>
          <input type="number" id="tk-max" min="1" max="100" value="1" style="width:100%; padding:6px; box-sizing:border-box">
        </label>
        <label style="flex:1; min-width:100px">
          <div style="font-size:12px; color:#6b7280">😀 絵文字</div>
          <input type="text" id="tk-emoji" maxlength="8" value="🎫" style="width:100%; padding:6px; box-sizing:border-box; font-size:20px; text-align:center">
        </label>
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">🎯 対象</div>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label style="display:inline-flex; gap:4px; align-items:center"><input type="radio" name="tk-scope" value="all" checked> 全員</label>
          <label style="display:inline-flex; gap:4px; align-items:center"><input type="radio" name="tk-scope" value="grade"> 学年限定:</label>
          <select id="tk-grade" disabled>
            <option value="B3">B3</option><option value="B4">B4</option><option value="M1">M1</option>
            <option value="M2">M2</option><option value="D">D</option>
          </select>
        </div>
      </div>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">⏰ 有効期限 (任意、空=無期限)</div>
        <input type="datetime-local" id="tk-exp" style="padding:6px">
      </label>
      <div class="row" style="justify-content:flex-end; margin-top:8px">
        <button class="btn primary" id="tk-create-btn">📮 発行</button>
      </div>
    </div>
  `;
  document.querySelectorAll('input[name="tk-scope"]').forEach(el => {
    el.addEventListener('change', () => {
      document.getElementById('tk-grade').disabled = document.querySelector('input[name="tk-scope"]:checked').value !== 'grade';
    });
  });
  document.getElementById('tk-create-btn').addEventListener('click', async () => {
    const body = {
      title: document.getElementById('tk-title').value.trim(),
      description: document.getElementById('tk-desc').value.trim(),
      usable_in: document.getElementById('tk-usable').value.trim(),
      price: parseInt(document.getElementById('tk-price').value, 10),
      max_uses: parseInt(document.getElementById('tk-max').value, 10),
      target_scope: document.querySelector('input[name="tk-scope"]:checked').value,
      emoji: document.getElementById('tk-emoji').value.trim(),
    };
    if (body.target_scope === 'grade') body.target_grade = document.getElementById('tk-grade').value;
    const exp = document.getElementById('tk-exp').value;
    if (exp) body.expires_at = exp.replace('T', ' ') + ':00';
    if (!body.title) { toast('タイトル必須'); return; }
    const btn = document.getElementById('tk-create-btn');
    btn.disabled = true; btn.textContent = '⌛ 発行中…';
    try {
      await post('/api/tickets', body);
      toast('発行しました');
      await switchTab('mine');
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '📮 発行'; }
  });
}

function wireCards(root) {
  root.querySelectorAll('[data-tk-use]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.tkUse;
      const note = prompt('使う時のメモ (任意、発行者に届きます):', '');
      if (note === null) return;
      el.disabled = true;
      try {
        await post(`/api/tickets/${id}/use`, { note });
        toast('チケットを使いました!');
        await switchTab(document.querySelector('[data-tk-tab].primary')?.dataset.tkTab || 'list');
      } catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
  root.querySelectorAll('[data-tk-revoke]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('チケットを停止 (取消) しますか?')) return;
      el.disabled = true;
      try { await post(`/api/tickets/${el.dataset.tkRevoke}/revoke`, {}); toast('停止しました'); await switchTab('mine'); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
}
