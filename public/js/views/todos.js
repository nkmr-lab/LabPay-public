// /#/todos — 個人 TODO リスト。 自分用の やる こと メモ。 サーバ保存 で 端末間 共有。

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
      </p>
    </div>
    <div class="card">
      <div class="row" style="gap:6px">
        <input type="text" id="td-input" maxlength="1000" placeholder="新しい TODO" style="flex:1">
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
  document.getElementById('td-add').addEventListener('click', () => addTodo(input.value));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) {
      ev.preventDefault();
      addTodo(input.value);
    }
  });
  await reload();
}

async function addTodo(text) {
  const body = (text || '').trim();
  if (!body) return;
  try {
    await post('/api/todos', { body });
    document.getElementById('td-input').value = '';
    await reload();
  } catch (e) { toast('失敗: ' + e.message); }
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
  return `
    <div class="list-item" data-td-id="${t.id}" style="align-items:flex-start; gap:8px">
      <input type="checkbox" data-td-check ${isDone ? 'checked' : ''}
             style="flex:none; margin-top:4px; width:18px; height:18px; cursor:pointer">
      <div class="grow" style="min-width:0">
        <div data-td-body class="${isDone ? 'muted' : 'bold'}" style="white-space:pre-wrap; ${isDone ? 'text-decoration:line-through' : ''}">${escapeHtml(t.body)}</div>
        <div class="meta" style="font-size:11px">${escapeHtml(t.created_at || '')}${t.done_at ? ' · 完了 ' + escapeHtml(t.done_at) : ''}</div>
      </div>
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
