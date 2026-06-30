// /#/todos — 個人 TODO リスト。自分用のやることメモ。サーバ保存で端末間共有。
// v482 #72 締切 (due_at) サポート + ホームカードで直近締切をハイライト。

import { get, post, patch, del } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

export async function renderTodos() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📝 自分の TODO</h2>
    </div>
    <div class="card">
      <div class="row" style="gap:6px; align-items:flex-start; flex-wrap:wrap">
        <input type="text" id="td-input" maxlength="1000" placeholder="新しい TODO" style="flex:1; min-width:140px">
        <input type="datetime-local" id="td-due" title="締切 (任意)" style="font-size:13px">
        <button id="td-add" class="primary">＋ 追加</button>
      </div>
    </div>
    <div id="td-list-open" class="list"></div>
    <details class="card" id="td-done-card" hidden>
      <summary style="cursor:pointer; font-weight:700">✓ 完了したもの (<span id="td-done-count">0</span>)</summary>
      <div id="td-list-done" class="list" style="margin-top:8px"></div>
    </details>
  `;
  const input = document.getElementById('td-input');
  const due   = document.getElementById('td-due');
  document.getElementById('td-add').addEventListener('click', () => addTodo(input.value, due.value));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) {
      ev.preventDefault();
      addTodo(input.value, due.value);
    }
  });
  await reload();
}

async function addTodo(text, due) {
  const body = (text || '').trim();
  if (!body) return;
  const payload = { body };
  if (due) payload.due_at = due;
  try {
    await post('/api/todos', payload);
    document.getElementById('td-input').value = '';
    document.getElementById('td-due').value = '';
    await reload();
  } catch (e) { toast('失敗: ' + e.message); }
}

function fmtDue(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const sameDay = now.toDateString() === dt.toDateString();
  const time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  if (sameDay) return `今日 ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (tomorrow.toDateString() === dt.toDateString()) return `明日 ${time}`;
  return `${dt.getMonth()+1}/${dt.getDate()} ${time}`;
}

function dueColor(s) {
  if (!s) return '';
  const ms = new Date(String(s).replace(' ', 'T')) - new Date();
  if (ms < 0) return '#c62828';                // 過ぎた
  if (ms < 3600_000) return '#c62828';         // 1 時間以内
  if (ms < 24 * 3600_000) return '#e65100';    // 1 日以内
  return '#6b6b6b';
}

async function reload() {
  try {
    const d = await get('/api/todos');
    const items = d.items || [];
    const open = items.filter(t => !t.done);
    const done = items.filter(t =>  t.done);
    document.getElementById('td-list-open').innerHTML = open.length
      ? open.map(rowHtml).join('')
      : '<div class="empty">未完了の TODO はありません 🎉</div>';
    document.getElementById('td-list-done').innerHTML = done.map(rowHtml).join('');
    const dc = document.getElementById('td-done-card');
    if (dc) {
      dc.hidden = done.length === 0;
      document.getElementById('td-done-count').textContent = done.length;
    }
    bindRows();
  } catch (e) { toast('読み込み失敗: ' + e.message); }
}

function rowHtml(t) {
  const isDone = !!t.done;
  const dueLabel = t.due_at && !isDone
    ? `<span style="color:${dueColor(t.due_at)}; font-weight:600">⏰ ${escapeHtml(fmtDue(t.due_at))}</span> · `
    : '';
  // v483 #75 url / 相手 / 詳細を表示。
  const urlLine = t.url
    ? `<div class="meta" style="font-size:12px"><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" style="color:var(--primary)">🔗 ${escapeHtml(t.url.length > 60 ? t.url.slice(0, 60) + '…' : t.url)}</a></div>`
    : '';
  const partner = t.partner_name || t.partner_label;
  const partnerLine = partner
    ? `<div class="meta" style="font-size:12px">👤 ${escapeHtml(partner)}</div>`
    : '';
  const notesLine = t.notes
    ? `<div class="meta" style="font-size:12px; white-space:pre-wrap; margin-top:2px">📝 ${escapeHtml(t.notes.length > 200 ? t.notes.slice(0, 200) + '…' : t.notes)}</div>`
    : '';
  return `
    <div class="list-item" data-td-id="${t.id}" style="align-items:flex-start; gap:8px">
      <input type="checkbox" data-td-check ${isDone ? 'checked' : ''}
             style="flex:none; margin-top:4px; width:18px; height:18px; cursor:pointer">
      <div class="grow" style="min-width:0">
        <div data-td-body class="${isDone ? 'muted' : 'bold'}" style="white-space:pre-wrap; ${isDone ? 'text-decoration:line-through' : ''}">${escapeHtml(t.body)}</div>
        ${urlLine}${partnerLine}${notesLine}
        <div class="meta" style="font-size:11px">${dueLabel}${escapeHtml(t.created_at || '')}${t.done_at ? ' · 完了 ' + escapeHtml(t.done_at) : ''}</div>
      </div>
      <button data-td-detail class="btn" style="flex:none; font-size:11px; padding:2px 6px" title="詳細 (URL / 相手 / メモ)">📋</button>
      <button data-td-due class="btn" style="flex:none; font-size:11px; padding:2px 6px" title="締切設定">⏰</button>
      <button data-td-edit class="btn" style="flex:none; font-size:11px; padding:2px 6px">✏</button>
      <button data-td-del class="btn danger" style="flex:none; font-size:11px; padding:2px 6px">×</button>
    </div>`;
}

function bindRows() {
  document.querySelectorAll('[data-td-id]').forEach(row => {
    const id = row.dataset.tdId;
    row.querySelector('[data-td-check]')?.addEventListener('change', async (ev) => {
      try { await patch(`/api/todos/${id}`, { done: ev.target.checked }); await reload(); }
      catch (e) { toast('失敗: ' + e.message); }
    });
    row.querySelector('[data-td-del]')?.addEventListener('click', async () => {
      if (!confirm('この TODO を削除しますか?')) return;
      try { await del(`/api/todos/${id}`); await reload(); }
      catch (e) { toast('失敗: ' + e.message); }
    });
    row.querySelector('[data-td-due]')?.addEventListener('click', async () => {
      // 簡易: prompt で YYYY-MM-DD HH:MM、空 = クリア。
      const v = prompt('締切を YYYY-MM-DD HH:MM で入力 (空でクリア):');
      if (v == null) return;
      try {
        await patch(`/api/todos/${id}`, { due_at: v.trim() || null });
        await reload();
      } catch (e) { toast('失敗: ' + e.message); }
    });
    row.querySelector('[data-td-edit]')?.addEventListener('click', () => {
      const bodyEl = row.querySelector('[data-td-body]');
      const cur = bodyEl.textContent;
      const v = prompt('TODO を編集:', cur);
      if (v == null) return;
      const nv = v.trim();
      if (!nv) return;
      patch(`/api/todos/${id}`, { body: nv })
        .then(reload)
        .catch(e => toast('失敗: ' + e.message));
    });
    row.querySelector('[data-td-detail]')?.addEventListener('click', () => openDetailPanel(id));
  });
}

// v483 #75 詳細編集パネル (url / 相手 / 詳細 / 締切)。行の下に差し込む。
let openDetailFor = null;
async function openDetailPanel(id) {
  // 既に同じ ID で開いてたら閉じるトグル
  document.querySelectorAll('[data-td-detail-panel]').forEach(p => p.remove());
  if (openDetailFor === id) { openDetailFor = null; return; }
  openDetailFor = id;
  // 現在値を取得 (再 GET より row dataset 使う方がラクだがここはシンプルに再取得)
  let cur = {};
  try {
    const d = await get('/api/todos');
    cur = (d.items || []).find(x => Number(x.id) === Number(id)) || {};
  } catch (_) {}
  const row = document.querySelector(`[data-td-id="${id}"]`);
  if (!row) return;
  // ラボメンバー一覧 (相手選択用)
  let users = [];
  try { const r = await get('/api/users'); users = (r.items || r || []).filter(u => u.display_name); } catch (_) {}
  const opts = ['<option value="">- ラボメンバーから選ぶ -</option>',
    ...users.map(u => `<option value="${u.id}" ${Number(cur.partner_user_id) === Number(u.id) ? 'selected' : ''}>${escapeHtml(u.display_name)}</option>`)].join('');
  const dueLocal = cur.due_at ? String(cur.due_at).replace(' ', 'T').slice(0,16) : '';
  const panel = document.createElement('div');
  panel.dataset.tdDetailPanel = id;
  panel.className = 'list-item';
  panel.style.cssText = 'flex-direction:column; align-items:stretch; gap:8px; background:#f7f5fa; padding:10px; border-radius:6px';
  panel.innerHTML = `
    <label class="field"><span class="lbl">🔗 URL</span>
      <input type="url" data-d-url maxlength="500" placeholder="https://…" value="${escapeHtml(cur.url || '')}">
    </label>
    <label class="field"><span class="lbl">👤 相手 (ラボメンバー)</span>
      <select data-d-partner>${opts}</select>
    </label>
    <label class="field"><span class="lbl">👤 相手 (ラボ外 / 自由入力)</span>
      <input type="text" data-d-partner-label maxlength="120" placeholder="例: 田中先生、 〇〇社 ○○ 様" value="${escapeHtml(cur.partner_label || '')}">
    </label>
    <label class="field"><span class="lbl">⏰ 締切</span>
      <input type="datetime-local" data-d-due value="${escapeHtml(dueLocal)}">
    </label>
    <label class="field"><span class="lbl">📝 詳細 / メモ</span>
      <textarea data-d-notes maxlength="5000" rows="4" placeholder="補足、メモ、リンク詳細等">${escapeHtml(cur.notes || '')}</textarea>
    </label>
    <div class="row" style="gap:6px; justify-content:flex-end">
      <button data-d-cancel class="btn">閉じる</button>
      <button data-d-save class="primary">保存</button>
    </div>`;
  row.after(panel);
  panel.querySelector('[data-d-cancel]').addEventListener('click', () => { panel.remove(); openDetailFor = null; });
  panel.querySelector('[data-d-save]').addEventListener('click', async () => {
    const payload = {
      url:             panel.querySelector('[data-d-url]').value.trim(),
      partner_user_id: panel.querySelector('[data-d-partner]').value || null,
      partner_label:   panel.querySelector('[data-d-partner-label]').value.trim(),
      due_at:          panel.querySelector('[data-d-due]').value || null,
      notes:           panel.querySelector('[data-d-notes]').value,
    };
    try {
      await patch(`/api/todos/${id}`, payload);
      openDetailFor = null;
      await reload();
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
