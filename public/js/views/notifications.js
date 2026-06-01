import { get, patch } from '../api.js';
import { escapeHtml } from '../router.js';
import { refreshUnread, toast } from '../app.js';

export async function renderNotifications() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2>通知</h2>
      <div class="row" style="justify-content:flex-end">
        <button id="mark-all">すべて既読にする</button>
      </div>
    </div>
    <div id="list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  document.getElementById('mark-all').addEventListener('click', async () => {
    try { await patch('/api/notifications/read_all', {}); }
    catch (e) { toast('失敗: ' + e.message); return; }
    await refreshUnread();
    await renderNotifications();
  });
  await load();
}

async function load() {
  try {
    const data = await get('/api/notifications', { limit: 100 });
    const root = document.getElementById('list');
    if (!data.items.length) {
      root.innerHTML = `<div class="empty">通知はありません</div>`;
      return;
    }
    root.innerHTML = data.items.map(row).join('');
    root.querySelectorAll('[data-read]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await patch('/api/notifications/' + btn.dataset.read + '/read', {}); }
        catch (e) { toast('失敗: ' + e.message); return; }
        await refreshUnread();
        await load();
      });
    });
  } catch (e) {
    document.getElementById('list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

const TYPE_LABELS = {
  sale:              '販売',
  sold_out:          '在庫切れ',
  transfer_received: '送金受領',
  task_claimed:      'タスク引受',
  task_reported:     'タスク完了報告',
  task_approved:     'タスク承認',
  task_cancelled:    'タスク取消',
  task_expired:      'タスク期限切れ',
  admin_notice:      'お知らせ',
};
function row(n) {
  const unread = !n.read_at;
  const lbl = TYPE_LABELS[n.type] || n.type;
  return `
    <div class="list-item" style="${unread ? 'border-left:4px solid var(--primary)' : ''}">
      <div>
        <div class="bold">${escapeHtml(n.body)}</div>
        <div class="meta">${escapeHtml(lbl)} · ${escapeHtml(n.created_at)}</div>
      </div>
      <div>${unread ? `<button data-read="${n.id}">既読</button>` : '<span class="tag muted">既読</span>'}</div>
    </div>`;
}
