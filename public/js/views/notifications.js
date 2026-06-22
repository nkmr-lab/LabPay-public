import { get, patch } from '../api.js';
import { escapeHtml } from '../router.js';
import { refreshUnread, toast, state } from '../app.js';

// v512 ユーザ報告: 「通知のロードが重い。 全件ロードしてる」 → 20 件ずつカーソル
//   ベース pagination に変更。 サーバ側 /api/notifications は ?before_id= の
//   カーソルと has_more フラグを返す (= 1 ページずつ append)。
const PAGE_SIZE = 10; // v514 #133 デフォルト 10 件に変更
let loadedItems = [];
let hasMore = false;

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
    <div id="more-wrap" style="text-align:center; padding:12px 0" hidden>
      <button id="more-btn" class="btn">▼ さらに読み込み</button>
    </div>
  `;
  document.getElementById('mark-all').addEventListener('click', async () => {
    // v525 #178 表示先行 (= UI 即時更新) + DB 更新は裏で。 全件 re-fetch しない。
    const now = new Date().toISOString();
    for (const it of loadedItems) { if (!it.read_at) it.read_at = now; }
    paint();
    try { await patch('/api/notifications/read_all', {}); await refreshUnread(); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('more-btn').addEventListener('click', () => loadMore());
  loadedItems = [];
  hasMore = false;
  await loadFirst();
}

async function loadFirst() {
  try {
    const data = await get('/api/notifications', { limit: PAGE_SIZE });
    loadedItems = data.items || [];
    hasMore = !!data.has_more;
    paint();
  } catch (e) {
    const root = document.getElementById('list');
    if (root) root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function loadMore() {
  if (!loadedItems.length) return;
  const beforeId = loadedItems[loadedItems.length - 1].id;
  const btn = document.getElementById('more-btn');
  if (btn) { btn.disabled = true; btn.textContent = '読み込み中…'; }
  try {
    const data = await get('/api/notifications', { limit: PAGE_SIZE, before_id: beforeId });
    loadedItems = loadedItems.concat(data.items || []);
    hasMore = !!data.has_more;
    paint();
  } catch (e) {
    toast('失敗: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▼ さらに読み込み'; }
  }
}

function paint() {
  const root = document.getElementById('list');
  const more = document.getElementById('more-wrap');
  if (!root) return;
  if (!loadedItems.length) {
    root.innerHTML = `<div class="empty">通知はありません</div>`;
    if (more) more.hidden = true;
    return;
  }
  root.innerHTML = loadedItems.map(row).join('');
  if (more) more.hidden = !hasMore;
  // 既読ボタン
  root.querySelectorAll('[data-read]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { await patch('/api/notifications/' + btn.dataset.read + '/read', {}); }
      catch (e) { toast('失敗: ' + e.message); return; }
      await refreshUnread();
      // v512 該当だけ ローカル更新して再描画 (全件 reload しない)
      const id = Number(btn.dataset.read);
      const it = loadedItems.find(x => Number(x.id) === id);
      if (it) it.read_at = new Date().toISOString();
      paint();
    });
  });
  // 未読に戻す
  root.querySelectorAll('[data-unread]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { await patch('/api/notifications/' + btn.dataset.unread + '/unread', {}); }
      catch (e) { toast('失敗: ' + e.message); return; }
      await refreshUnread();
      const id = Number(btn.dataset.unread);
      const it = loadedItems.find(x => Number(x.id) === id);
      if (it) it.read_at = null;
      paint();
    });
  });
  // 行 (<a>) タップ時: 未読なら裏で既読化してから遷移
  root.querySelectorAll('[data-jump]').forEach(a => {
    a.addEventListener('click', () => {
      patch('/api/notifications/' + a.dataset.jump + '/read', {})
        .then(() => refreshUnread())
        .catch(() => { /* ignore */ });
    });
  });
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
    case 'meetup':         return n.ref_id ? '#/meetups/' + n.ref_id : '#/meetups';
    case 'auction':        return n.ref_id ? '#/auctions/' + n.ref_id : '#/auctions';
    case 'random_groups':  return '#/random-groups';
    case 'ordering':       return n.ref_id ? '#/orderings/' + n.ref_id : '#/orderings';
    case 'shiritori':      return n.ref_id ? '#/shiritori/' + n.ref_id : '#/shiritori';
    case 'tierlist':       return n.ref_id ? '#/tierlists/' + n.ref_id : '#/tierlists';
    case 'paper_review':   return '#/paper-review';
    // v756 #373 paper_translate: ref_id は row id だが、 URL は share_token なので
    //   body に 含まれて いる「/#/paper-translate/r/TOKEN」 を 抽出 して 使う。
    case 'paper_translate': {
      const m = (n.body || '').match(/#\/paper-translate\/r\/[a-f0-9]+/);
      return m ? m[0] : '#/paper-translate';
    }
    case 'mahjong':        return n.ref_id ? '#/mahjong/' + n.ref_id : '#/mahjong';
    case 'ito':            return n.ref_id ? '#/ito/' + n.ref_id : '#/ito';
    case 'jinrou':         return n.ref_id ? '#/jinrou/' + n.ref_id : '#/jinrou';
    case 'post':           return n.ref_id ? '#/sns/' + n.ref_id : '#/sns'; // v657 SNS 反応 / メンション
    case 'prediction':     return n.ref_id ? '#/predictions/' + n.ref_id : '#/predictions';
    case 'score_pred':     return n.ref_id ? '#/score-predictions/' + n.ref_id : '#/score-predictions';
    case 'drafts':         return n.ref_id ? '#/drafts/' + n.ref_id : '#/drafts';
    case 'wishlist':       return '#/wishlist';
    case 'purchase':       return '#/history';
    case 'scrapbox':       return '#/history';
    case 'feedback':       return state.me?.role === 'admin' ? '#/feedback-admin' : '#/settings';
    default: return null;
  }
}

function row(n) {
  const unread = !n.read_at;
  const lbl = TYPE_LABELS[n.type] || n.type;
  const url = refUrl(n);
  const baseStyle = unread
    ? 'display:block; text-decoration:none; color:inherit; border-left:6px solid #ffb300; background:#fffaeb;'
    : 'display:block; text-decoration:none; color:inherit; opacity:0.85;';
  const tag = url ? 'a' : 'div';
  const href = url ? `href="${url}" data-jump="${n.id}"` : '';
  const unreadBadge = unread
    ? `<span style="display:inline-block; background:#ffb300; color:#fff; font-weight:700; font-size:11px; padding:1px 6px; border-radius:8px; margin-right:6px">●未読</span>`
    : '';
  // v566 #219 長い URL / 長文で 横に広がる / 文字が大きい問題を修正:
  //   - 本文は overflow-wrap: anywhere + word-break: break-word で 必ず折り返す
  //   - bold の継承 font-size を明示的に 14px に抑える
  //   - 既読ボタンも統一サイズに
  return `
    <${tag} class="list-item" style="${baseStyle}" ${href}>
      <div style="flex:1; min-width:0">
        <div style="font-size:14px; font-weight:700; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word">${unreadBadge}${escapeHtml(n.body)}</div>
        <div class="meta" style="font-size:11px">${escapeHtml(lbl)} · ${escapeHtml(n.created_at)}</div>
      </div>
      <div style="flex:none">${unread
        ? `<button data-read="${n.id}" class="btn" style="font-size:11px; padding:2px 6px">既読</button>`
        : `<button data-unread="${n.id}" class="btn" style="font-size:11px; padding:2px 6px; color:var(--muted)">未読に戻す</button>`}</div>
    </${tag}>`;
}
