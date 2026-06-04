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
    // 既読ボタン (行リンクの click を奪う)
    root.querySelectorAll('[data-read]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { await patch('/api/notifications/' + btn.dataset.read + '/read', {}); }
        catch (e) { toast('失敗: ' + e.message); return; }
        await refreshUnread();
        await load();
      });
    });
    // 「未読に戻す」 ボタン (既読のものから未読に戻すセーフネット)。
    root.querySelectorAll('[data-unread]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { await patch('/api/notifications/' + btn.dataset.unread + '/unread', {}); }
        catch (e) { toast('失敗: ' + e.message); return; }
        await refreshUnread();
        await load();
      });
    });
    // 行 (<a>) タップ時: 未読なら裏で既読化してから遷移を許可
    root.querySelectorAll('[data-jump]').forEach(a => {
      a.addEventListener('click', () => {
        // fire-and-forget: バッジ消すための裏処理。遷移は通常通り進む。
        patch('/api/notifications/' + a.dataset.jump + '/read', {})
          .then(() => refreshUnread())
          .catch(() => { /* ignore */ });
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
// Map (ref_type, ref_id) → the SPA URL the notification points at. Tapping
// the body wraps to a real link so users can jump straight to the relevant
// page from the bell.
function refUrl(n) {
  if (!n.ref_type) return null;
  switch (n.ref_type) {
    case 'task':           return n.ref_id ? '#/tasks/' + n.ref_id : '#/tasks';
    case 'roulette':       return n.ref_id ? '#/roulette/' + n.ref_id : '#/roulette';
    case 'invitation':     return n.ref_id ? '#/invitations/' + n.ref_id : '#/invitations';
    case 'group':          return n.ref_id ? '#/groups/' + n.ref_id : '#/groups';
    case 'money_request':  return n.ref_id ? '#/requests/' + n.ref_id : '#/requests';
    case 'nomikai':        return n.ref_id ? '#/nomikai/' + n.ref_id : '#/nomikai';
    case 'poll':           return n.ref_id ? '#/polls/' + n.ref_id : '#/polls';
    case 'rollcall':       return n.ref_id ? '#/rollcalls/' + n.ref_id : '#/rollcalls';
    case 'timer':          return n.ref_id ? '#/timers/' + n.ref_id : '#/timers';
    case 'random_groups':  return '#/random-groups';
    case 'wishlist':       return '#/wishlist';
    case 'purchase':       return '#/history';
    case 'scrapbox':       return '#/history';
    case 'feedback':       return '#/admin';
    default: return null;
  }
}

function row(n) {
  const unread = !n.read_at;
  const lbl = TYPE_LABELS[n.type] || n.type;
  const url = refUrl(n);
  // 未読は背景もろとも強く強調 (左バー 6px + soft 黄背景 + 左パディング):
  //   border-left を厚く / 背景色を変える / 「●未読」 バッジを出す
  const baseStyle = unread
    ? 'display:block; text-decoration:none; color:inherit; border-left:6px solid #ffb300; background:#fffaeb;'
    : 'display:block; text-decoration:none; color:inherit; opacity:0.85;';
  const tag = url ? 'a' : 'div';
  const href = url ? `href="${url}" data-jump="${n.id}"` : '';
  const unreadBadge = unread
    ? `<span style="display:inline-block; background:#ffb300; color:#fff; font-weight:700; font-size:11px; padding:1px 6px; border-radius:8px; margin-right:6px">●未読</span>`
    : '';
  return `
    <${tag} class="list-item" style="${baseStyle}" ${href}>
      <div style="flex:1; min-width:0">
        <div class="bold" style="white-space:pre-wrap">${unreadBadge}${escapeHtml(n.body)}</div>
        <div class="meta">${escapeHtml(lbl)} · ${escapeHtml(n.created_at)}</div>
      </div>
      <div>${unread
        ? `<button data-read="${n.id}">既読</button>`
        : `<button data-unread="${n.id}" class="btn" style="font-size:11px; padding:2px 6px; color:var(--muted)">未読に戻す</button>`}</div>
    </${tag}>`;
}
