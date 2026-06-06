// /#/todos — 個人 TODO リスト。 自分用の やる こと メモ。 サーバ保存 で 端末間 共有。
// v482 #72 締切 (due_at) サポート + ホーム カード で 直近 締切 を ハイライト。

import { get, post, patch, del } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

export async function renderTodos() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📝 自分の TODO</h2>
      <p class="card-subtitle" style="margin:6px 0 0">
        やる こと を どんどん 登録 → 順に 処理。 サーバ に 保存 する ので 端末間 共有 される。
        締切 を 入れる と ホーム の 上 に 出ます。
      </p>
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
      <summary style="cursor:pointer; font-weight:700">✓ 完了 した もの (<span id="td-done-count">0</span>)</summary>
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
      : '<div class="empty">未完了 の TODO は ありません 🎉</div>';
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
  return `
    <div class="list-item" data-td-id="${t.id}" style="align-items:flex-start; gap:8px">
      <input type="checkbox" data-td-check ${isDone ? 'checked' : ''}
             style="flex:none; margin-top:4px; width:18px; height:18px; cursor:pointer">
      <div class="grow" style="min-width:0">
        <div data-td-body class="${isDone ? 'muted' : 'bold'}" style="white-space:pre-wrap; ${isDone ? 'text-decoration:line-through' : ''}">${escapeHtml(t.body)}</div>
        <div class="meta" style="font-size:11px">${dueLabel}${escapeHtml(t.created_at || '')}${t.done_at ? ' · 完了 ' + escapeHtml(t.done_at) : ''}</div>
      </div>
      <button data-td-due class="btn" style="flex:none; font-size:11px; padding:2px 6px" title="締切 設定">⏰</button>
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
      if (!confirm('この TODO を 削除しますか?')) return;
      try { await del(`/api/todos/${id}`); await reload(); }
      catch (e) { toast('失敗: ' + e.message); }
    });
    row.querySelector('[data-td-due]')?.addEventListener('click', async () => {
      // 簡易: prompt で YYYY-MM-DD HH:MM、 空 = クリア。
      const v = prompt('締切 を YYYY-MM-DD HH:MM で 入力 (空 で クリア):');
      if (v == null) return;
      try {
        await patch(`/api/todos/${id}`, { due_at: v.trim() || null });
        await reload();
      } catch (e) { toast('失敗: ' + e.message); }
    });
    row.querySelector('[data-td-edit]')?.addEventListener('click', () => {
      const bodyEl = row.querySelector('[data-td-body]');
      const cur = bodyEl.textContent;
      const v = prompt('TODO を 編集:', cur);
      if (v == null) return;
      const nv = v.trim();
      if (!nv) return;
      patch(`/api/todos/${id}`, { body: nv })
        .then(reload)
        .catch(e => toast('失敗: ' + e.message));
    });
  });
}
