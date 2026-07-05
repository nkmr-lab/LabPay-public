// /#/kanban — Trello-like かんばん ボード (v934)。 ラボ共有、 全 members が 触れる。
//   3 view: renderKanban (ボード一覧) / renderKanbanBoard (カンバン D&D) / (card 詳細 は modal)

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const LABEL_COLORS = {
  gray: '#9ca3af', red: '#dc2626', orange: '#ea580c', yellow: '#ca8a04',
  green: '#15803d', blue: '#2563eb', purple: '#7b3fa0', pink: '#db2777',
};

// 簡易 Markdown → HTML (refs.js から 流用)。
function mdToHtml(src) {
  if (!src) return '';
  let s = escapeHtml(String(src));
  s = s.replace(/```(\w*)\n([\s\S]+?)\n```/g, (m, lang, code) => `<pre style="background:#f3f4f6; padding:8px; border-radius:4px; overflow-x:auto; font-family:monospace; font-size:12px">${code}</pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code style="background:#f3f4f6; padding:1px 4px; border-radius:3px; font-family:monospace; font-size:12px">$1</code>');
  s = s.replace(/^### (.+)$/gm, '<h3 style="margin:8px 0 4px; font-size:15px">$1</h3>');
  s = s.replace(/^## (.+)$/gm,  '<h2 style="margin:10px 0 4px; font-size:16px">$1</h2>');
  s = s.replace(/^# (.+)$/gm,   '<h1 style="margin:12px 0 6px; font-size:18px">$1</h1>');
  s = s.replace(/^([-*]) (.+)$/gm, '<li style="margin-left:20px">$2</li>');
  s = s.replace(/(<li[^>]*>.+<\/li>\n?)+/g, m => '<ul style="margin:4px 0">' + m + '</ul>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--primary)">$1</a>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

// ─── ボード 一覧 ──────────────────────────────────────

export async function renderKanban() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:8px; flex-wrap:wrap">
        <h2 style="margin:0; flex:1">📋 かんばん <span style="font-size:11px; color:#9ca3af; font-weight:normal">Trello 的、 ラボ 共有</span></h2>
        <button id="kb-new" class="btn primary" style="font-size:13px; padding:4px 12px">＋ 新規 ボード</button>
        <button id="kb-toggle-archived" class="btn" style="font-size:12px; padding:4px 8px" title="アーカイブ 済 も 表示">📦</button>
      </div>
    </div>
    <div id="kb-list" class="card"><div class="muted">読み込み中…</div></div>
  `;
  let showArchived = false;
  const load = async () => {
    const root = document.getElementById('kb-list');
    try {
      const d = await get('/api/kanban/boards' + (showArchived ? '?archived=1' : ''));
      const items = d.items || [];
      if (!items.length) {
        root.innerHTML = `<div class="muted" style="padding:20px; text-align:center">まだ ボード が ありません。 「＋ 新規 ボード」 から どうぞ</div>`;
        return;
      }
      root.innerHTML = items.map(b => `
        <a class="list-item" href="#/kanban/boards/${b.id}" style="display:block; padding:12px 14px; border-bottom:1px solid #f3f4f6; text-decoration:none; color:inherit">
          <div class="row center" style="gap:8px">
            <span style="font-size:22px">${b.icon || '📋'}</span>
            <div class="bold" style="flex:1; font-size:15px">${escapeHtml(b.title)}</div>
            <span class="hint-sm" style="font-size:11px">${b.list_count || 0} 列 · ${b.card_count || 0} カード</span>
          </div>
          ${b.description ? `<div class="hint-sm" style="font-size:12px; color:#6b7280; margin-top:4px">${escapeHtml((b.description||'').slice(0, 200))}</div>` : ''}
          <div class="hint-sm" style="font-size:11px; margin-top:6px">
            起案 ${avatarHtml(b.owner_name, b.owner_avatar, 'xs')} ${escapeHtml(b.owner_name || '?')} · ${escapeHtml(b.updated_at || '')}
          </div>
        </a>`).join('');
    } catch (e) {
      root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    }
  };
  document.getElementById('kb-new').addEventListener('click', async () => {
    const title = prompt('ボード の 名前 (例: CHI2027 送り、 週次 タスク、 論文執筆)');
    if (!title) return;
    const icon = prompt('絵文字 (省略 で 📋)', '📋') || '📋';
    try {
      const r = await post('/api/kanban/boards', { title, icon });
      toast('作成 完了');
      navigate('#/kanban/boards/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('kb-toggle-archived').addEventListener('click', () => {
    showArchived = !showArchived;
    document.getElementById('kb-toggle-archived').classList.toggle('primary', showArchived);
    load();
  });
  await load();
}

// ─── ボード 詳細 (カンバン D&D) ────────────────────────

let boardCache = null;

export async function renderKanbanBoard({ params }) {
  const bid = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card" style="padding:6px 10px; margin-bottom:6px">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <a href="#/kanban" class="btn" style="padding:2px 10px; font-size:12px">← 一覧</a>
        <div id="kb-head" style="flex:1"></div>
        <button id="kb-add-list" class="btn" style="font-size:12px; padding:3px 10px">＋ 列 追加</button>
        <button id="kb-labels" class="btn" style="font-size:12px; padding:3px 10px">🏷 ラベル</button>
        <button id="kb-activity" class="btn" style="font-size:12px; padding:3px 10px">📜 履歴</button>
        <button id="kb-edit" class="btn" style="font-size:12px; padding:3px 10px" hidden>✏</button>
        <button id="kb-archive" class="btn" style="font-size:12px; padding:3px 10px" hidden>📦</button>
      </div>
    </div>
    <style>
      #kb-lists { display:flex; gap:10px; overflow-x:auto; padding:6px 4px 12px; min-height:60vh; }
      .kb-col   { flex:0 0 280px; background:#f3f4f6; border-radius:8px; padding:8px; max-height:calc(100vh - 180px); display:flex; flex-direction:column }
      .kb-col-head { display:flex; align-items:center; gap:6px; margin-bottom:6px; padding:2px 4px; font-weight:700; font-size:13px }
      .kb-col-cards { flex:1; overflow-y:auto; min-height:20px; }
      .kb-col-cards.drag-over { background:#e0e7ff; border-radius:6px }
      .kb-card { background:#fff; border:1px solid #e5e7eb; border-radius:6px; padding:6px 8px; margin-bottom:6px; cursor:pointer; font-size:13px; box-shadow:0 1px 2px rgba(0,0,0,0.05) }
      .kb-card.dragging { opacity:0.4 }
      .kb-card:hover { border-color:#a78bfa }
      .kb-card-labels { display:flex; gap:3px; flex-wrap:wrap; margin-bottom:3px }
      .kb-card-label { height:6px; width:36px; border-radius:3px }
      .kb-card-title { font-weight:600 }
      .kb-card-meta { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:4px; font-size:11px; color:#6b7280 }
      .kb-card-done { text-decoration:line-through; opacity:0.6 }
      .kb-add-card-btn { background:transparent; border:1px dashed #9ca3af; color:#6b7280; border-radius:4px; padding:4px; font-size:12px; cursor:pointer; margin-top:4px }
      .kb-add-card-btn:hover { background:#fff }
    </style>
    <div id="kb-lists"></div>
  `;
  await loadBoard(bid);
}

async function loadBoard(bid) {
  try {
    const d = await get('/api/kanban/boards/' + bid);
    boardCache = d;
    const meId = Number(state.me?.id || 0);
    const isOwner = Number(d.owner_user_id) === meId;
    const isAdmin = state.me?.role === 'admin';
    const canEdit = isOwner || isAdmin;

    document.getElementById('kb-head').innerHTML = `
      <div class="row center" style="gap:6px">
        <span style="font-size:22px">${d.icon || '📋'}</span>
        <div class="bold" style="font-size:16px">${escapeHtml(d.title)}</div>
        ${d.description ? `<span class="hint-sm" style="font-size:12px; color:#6b7280">${escapeHtml((d.description||'').slice(0, 100))}</span>` : ''}
      </div>`;
    document.getElementById('kb-edit').hidden = !canEdit;
    document.getElementById('kb-archive').hidden = !canEdit;

    const listsHtml = (d.lists || []).map(l => `
      <div class="kb-col" data-list-id="${l.id}">
        <div class="kb-col-head">
          <span class="grow" style="flex:1; cursor:pointer" data-list-title="${l.id}">${escapeHtml(l.title)}</span>
          <span class="hint-sm" style="font-size:11px">${(l.cards || []).length}</span>
          <button class="btn kb-list-del" data-list-id="${l.id}" style="font-size:10px; padding:1px 5px; margin-left:4px">✕</button>
        </div>
        <div class="kb-col-cards" data-list-id="${l.id}">
          ${(l.cards || []).map(c => renderCardHtml(c)).join('')}
        </div>
        <button class="kb-add-card-btn" data-list-id="${l.id}">＋ カード 追加</button>
      </div>`).join('');
    document.getElementById('kb-lists').innerHTML = listsHtml;

    // ハンドラ束ね
    document.getElementById('kb-add-list').onclick = async () => {
      const title = prompt('列 の 名前 (例: Ideas / Blocked / Review 中)');
      if (!title) return;
      try { await post(`/api/kanban/boards/${bid}/lists`, { title }); loadBoard(bid); toast('列 追加'); }
      catch (e) { toast('失敗: ' + e.message); }
    };
    document.getElementById('kb-labels').onclick = () => openLabelsModal(bid, d.labels || []);
    document.getElementById('kb-activity').onclick = () => openActivityModal(bid);
    document.getElementById('kb-edit').onclick = async () => {
      const title = prompt('タイトル', d.title); if (title === null) return;
      const desc = prompt('説明', d.description || ''); if (desc === null) return;
      const icon = prompt('絵文字', d.icon || '📋') || '📋';
      try { await patch(`/api/kanban/boards/${bid}`, { title, description: desc, icon }); loadBoard(bid); }
      catch (e) { toast('失敗: ' + e.message); }
    };
    document.getElementById('kb-archive').onclick = async () => {
      if (!confirm('この ボード を アーカイブ しますか?')) return;
      try { await patch(`/api/kanban/boards/${bid}`, { archived: 1 }); toast('アーカイブ'); navigate('#/kanban'); }
      catch (e) { toast('失敗: ' + e.message); }
    };

    // 列 の タイトル 変更
    document.querySelectorAll('[data-list-title]').forEach(el => {
      el.addEventListener('click', async () => {
        const lid = Number(el.dataset.listTitle);
        const cur = el.textContent;
        const nt = prompt('列 名', cur);
        if (!nt || nt === cur) return;
        try { await patch(`/api/kanban/lists/${lid}`, { title: nt }); loadBoard(bid); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });

    // 列 削除
    document.querySelectorAll('.kb-list-del').forEach(b => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        if (!confirm('この 列 と 中 の カード を 全部 削除?')) return;
        try { await del(`/api/kanban/lists/${b.dataset.listId}`); loadBoard(bid); toast('列 削除'); }
        catch (e) { toast('失敗: ' + e.message); }
      };
    });

    // カード 追加
    document.querySelectorAll('.kb-add-card-btn').forEach(b => {
      b.onclick = async () => {
        const title = prompt('カード の タイトル');
        if (!title) return;
        try { await post(`/api/kanban/lists/${b.dataset.listId}/cards`, { title }); loadBoard(bid); }
        catch (e) { toast('失敗: ' + e.message); }
      };
    });

    // カード クリック → 詳細 モーダル
    document.querySelectorAll('.kb-card').forEach(c => {
      c.onclick = () => openCardModal(Number(c.dataset.cardId), bid);
    });

    // D&D
    wireDragDrop(bid);
  } catch (e) {
    document.getElementById('kb-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderCardHtml(c) {
  const labels = (c.labels || []).map(l => `<span class="kb-card-label" style="background:${LABEL_COLORS[l.color] || '#9ca3af'}" title="${escapeHtml(l.name)}"></span>`).join('');
  const assignees = (c.assignees || []).slice(0, 3).map(a => avatarHtml(a.display_name, a.avatar_url, 'xs')).join('');
  const check = (c.check_total > 0) ? `<span title="チェックリスト">☑ ${c.check_done}/${c.check_total}</span>` : '';
  const comment = (c.comment_count > 0) ? `<span title="コメント">💬 ${c.comment_count}</span>` : '';
  const due = c.due_at ? `<span title="期限" style="color:${new Date(c.due_at) < new Date() ? '#dc2626' : '#6b7280'}">📅 ${escapeHtml((c.due_at||'').slice(5, 16))}</span>` : '';
  return `
    <div class="kb-card${c.is_done ? ' kb-card-done' : ''}" draggable="true" data-card-id="${c.id}" data-list-id="${c.list_id}">
      ${labels ? `<div class="kb-card-labels">${labels}</div>` : ''}
      <div class="kb-card-title">${escapeHtml(c.title)}</div>
      <div class="kb-card-meta">
        ${check} ${comment} ${due}
        ${assignees ? `<span style="margin-left:auto">${assignees}</span>` : ''}
      </div>
    </div>`;
}

// ─── D&D ──────────────────────────────────────────────

let dragCardId = null;

function wireDragDrop(bid) {
  document.querySelectorAll('.kb-card').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragCardId = Number(el.dataset.cardId);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragCardId));
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragCardId = null;
    });
  });
  document.querySelectorAll('.kb-col-cards').forEach(zone => {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const cid = Number(e.dataTransfer.getData('text/plain'));
      if (!cid) return;
      const listId = Number(zone.dataset.listId);
      // drop 位置 に 応じた sort_order 計算
      const cards = Array.from(zone.querySelectorAll('.kb-card:not(.dragging)'));
      const y = e.clientY;
      let insertAt = cards.length;
      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect();
        if (y < rect.top + rect.height / 2) { insertAt = i; break; }
      }
      try {
        await patch(`/api/kanban/cards/${cid}/move`, { list_id: listId, sort_order: insertAt });
        loadBoard(bid);
      } catch (err) { toast('移動 失敗: ' + err.message); }
    });
  });
}

// ─── カード 詳細 モーダル ─────────────────────────────

async function openCardModal(cid, bid) {
  document.getElementById('kb-card-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'kb-card-modal';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:flex-start; justify-content:center; padding:20px; overflow-y:auto';
  overlay.innerHTML = `<div style="background:#fff; border-radius:10px; max-width:640px; width:100%; padding:16px; max-height:calc(100vh - 40px); overflow-y:auto"><div class="muted">読み込み中…</div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  try {
    const d = await get('/api/kanban/cards/' + cid);
    paintCardModal(overlay, d, bid);
  } catch (e) {
    overlay.querySelector('div div').innerHTML = escapeHtml(e.message);
  }
}

function paintCardModal(overlay, d, bid) {
  const meId = Number(state.me?.id || 0);
  const card = overlay.querySelector('div');
  const b = boardCache || { labels: [], lists: [] };
  const assigneesHtml = (d.assignees || []).map(a => `
    <span class="tag" style="background:#e0e7ff; color:#3730a3; font-size:11px; padding:2px 6px; border-radius:8px; display:inline-flex; gap:4px; align-items:center">
      ${avatarHtml(a.display_name, a.avatar_url, 'xs')} ${escapeHtml(a.display_name)}
      <span class="kb-rm-assignee" data-uid="${a.user_id}" style="cursor:pointer; opacity:0.5">✕</span>
    </span>`).join(' ');
  const labelsHtml = (d.labels || []).map(l => `
    <span class="tag" style="background:${LABEL_COLORS[l.color]||'#9ca3af'}; color:#fff; font-size:11px; padding:2px 6px; border-radius:8px">
      ${escapeHtml(l.name)}
      <span class="kb-rm-label" data-lid="${l.id}" style="cursor:pointer; opacity:0.6; margin-left:2px">✕</span>
    </span>`).join(' ');
  const checklistHtml = (d.checklist || []).map(ci => `
    <div class="row center" style="gap:6px; padding:2px 0">
      <input type="checkbox" ${ci.is_done ? 'checked' : ''} class="kb-check" data-id="${ci.id}">
      <span style="flex:1; ${ci.is_done ? 'text-decoration:line-through; color:#9ca3af' : ''}">${escapeHtml(ci.text)}</span>
      <button class="btn kb-check-del" data-id="${ci.id}" style="font-size:10px; padding:1px 5px">✕</button>
    </div>`).join('');
  const checkDone = (d.checklist || []).filter(c => c.is_done).length;
  const checkTotal = (d.checklist || []).length;
  const progressPct = checkTotal > 0 ? Math.round(checkDone / checkTotal * 100) : 0;
  const commentsHtml = (d.comments || []).map(c => `
    <div style="padding:8px 10px; border-bottom:1px solid #f3f4f6">
      <div class="row center" style="gap:6px">
        ${avatarHtml(c.display_name, c.avatar_url, 'xs')}
        <span class="bold" style="font-size:12px">${escapeHtml(c.display_name)}</span>
        <span class="hint-sm" style="margin-left:auto; font-size:10px">${escapeHtml(c.created_at || '')}</span>
        ${c.user_id === meId ? `<button class="btn danger kb-com-del" data-id="${c.id}" style="font-size:10px; padding:1px 5px">✕</button>` : ''}
      </div>
      <div style="font-size:13px; line-height:1.6; margin-top:4px">${mdToHtml(c.body)}</div>
    </div>`).join('');

  card.innerHTML = `
    <div class="row center" style="gap:6px; margin-bottom:8px">
      <span class="hint-sm" style="font-size:11px; color:#6b7280">${escapeHtml(d.list_title || '')}</span>
      <button id="kb-modal-close" class="btn" style="margin-left:auto; font-size:14px; padding:2px 8px">✕</button>
    </div>
    <input type="text" id="kb-card-title" value="${escapeHtml(d.title)}" style="width:100%; box-sizing:border-box; font-size:18px; font-weight:700; padding:4px 6px; margin-bottom:6px; border:1px solid #e5e7eb; border-radius:4px">
    <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px">
      <label class="row center" style="gap:4px; font-size:12px"><input type="checkbox" id="kb-done" ${d.is_done ? 'checked' : ''}> ✅ 完了</label>
      <input type="datetime-local" id="kb-due" value="${escapeHtml((d.due_at || '').replace(' ', 'T').slice(0, 16))}" style="font-size:12px; padding:2px 6px">
      <button id="kb-save-basic" class="btn primary" style="font-size:12px; padding:2px 10px; margin-left:auto">保存</button>
      <button id="kb-delete" class="btn danger" style="font-size:12px; padding:2px 10px">🗑 削除</button>
    </div>
    <div style="margin-bottom:8px">
      <div class="hint-sm" style="font-size:11px; color:#6b7280; margin-bottom:2px">👥 担当</div>
      <div id="kb-assignees" class="row" style="gap:4px; flex-wrap:wrap">${assigneesHtml || '<span class="muted" style="font-size:11px">なし</span>'}</div>
      <button id="kb-add-assignee" class="btn" style="font-size:11px; padding:2px 8px; margin-top:4px">＋ アサイン</button>
    </div>
    <div style="margin-bottom:8px">
      <div class="hint-sm" style="font-size:11px; color:#6b7280; margin-bottom:2px">🏷 ラベル</div>
      <div id="kb-labels" class="row" style="gap:4px; flex-wrap:wrap">${labelsHtml || '<span class="muted" style="font-size:11px">なし</span>'}</div>
      <button id="kb-add-label" class="btn" style="font-size:11px; padding:2px 8px; margin-top:4px">＋ ラベル</button>
    </div>
    <div style="margin-bottom:8px">
      <div class="hint-sm" style="font-size:11px; color:#6b7280">📝 説明 (Markdown OK)</div>
      <textarea id="kb-desc" rows="4" style="width:100%; box-sizing:border-box; font-size:13px; font-family:monospace">${escapeHtml(d.description || '')}</textarea>
    </div>
    <div style="margin-bottom:8px">
      <div class="row center" style="gap:6px">
        <div class="hint-sm" style="font-size:11px; color:#6b7280">☑ チェックリスト</div>
        ${checkTotal > 0 ? `<span class="hint-sm" style="font-size:11px">${checkDone}/${checkTotal} (${progressPct}%)</span>` : ''}
      </div>
      ${checkTotal > 0 ? `<div style="background:#e5e7eb; height:4px; border-radius:2px; margin-top:2px"><div style="background:#16a34a; height:100%; width:${progressPct}%; border-radius:2px"></div></div>` : ''}
      <div id="kb-checklist" style="margin-top:4px">${checklistHtml}</div>
      <div class="row" style="gap:4px; margin-top:4px">
        <input type="text" id="kb-check-new" placeholder="＋ 追加" style="flex:1; padding:3px 6px; font-size:12px; border:1px solid #e5e7eb; border-radius:3px">
        <button id="kb-check-add" class="btn" style="font-size:11px; padding:2px 8px">追加</button>
      </div>
    </div>
    <div style="margin-top:12px">
      <div class="hint-sm" style="font-size:11px; color:#6b7280">💬 コメント (Markdown)</div>
      <textarea id="kb-com-body" rows="2" placeholder="コメント …" style="width:100%; box-sizing:border-box; font-size:13px; margin-top:4px"></textarea>
      <div class="row" style="justify-content:flex-end"><button id="kb-com-add" class="btn primary" style="font-size:11px; padding:2px 10px">投稿</button></div>
      <div id="kb-comments" style="margin-top:6px">${commentsHtml || '<span class="muted" style="font-size:11px">まだ ありません</span>'}</div>
    </div>
  `;
  document.getElementById('kb-modal-close').onclick = () => overlay.remove();
  document.getElementById('kb-save-basic').onclick = async () => {
    try {
      await patch('/api/kanban/cards/' + d.id, {
        title: document.getElementById('kb-card-title').value,
        description: document.getElementById('kb-desc').value,
        due_at: document.getElementById('kb-due').value.replace('T', ' '),
        is_done: document.getElementById('kb-done').checked ? 1 : 0,
      });
      toast('保存');
      loadBoard(bid);
      overlay.remove();
    } catch (e) { toast('失敗: ' + e.message); }
  };
  document.getElementById('kb-delete').onclick = async () => {
    if (!confirm('この カード を 削除?')) return;
    try { await del('/api/kanban/cards/' + d.id); loadBoard(bid); overlay.remove(); }
    catch (e) { toast('失敗: ' + e.message); }
  };
  document.getElementById('kb-add-assignee').onclick = async () => {
    try {
      const usersR = await get('/api/users');
      const users = usersR.items || [];
      const pick = prompt('番号 で 選択:\n' + users.map((u, i) => `${i+1}. ${u.display_name}`).join('\n'));
      if (!pick) return;
      const idx = Number(pick) - 1;
      if (idx < 0 || idx >= users.length) return;
      await post(`/api/kanban/cards/${d.id}/assignees`, { user_id: users[idx].id });
      toast('アサイン');
      openCardModal(d.id, bid);
    } catch (e) { toast('失敗: ' + e.message); }
  };
  overlay.querySelectorAll('.kb-rm-assignee').forEach(x => {
    x.onclick = async () => {
      await del(`/api/kanban/cards/${d.id}/assignees/${x.dataset.uid}`);
      openCardModal(d.id, bid);
    };
  });
  document.getElementById('kb-add-label').onclick = async () => {
    if (!b.labels || !b.labels.length) { toast('ボード に ラベル 未登録。 🏷 ラベル から 作る'); return; }
    const pick = prompt('番号 で 選択:\n' + b.labels.map((l, i) => `${i+1}. ${l.name} (${l.color})`).join('\n'));
    if (!pick) return;
    const idx = Number(pick) - 1;
    if (idx < 0 || idx >= b.labels.length) return;
    try {
      await post(`/api/kanban/cards/${d.id}/labels`, { label_id: b.labels[idx].id });
      openCardModal(d.id, bid);
    } catch (e) { toast('失敗: ' + e.message); }
  };
  overlay.querySelectorAll('.kb-rm-label').forEach(x => {
    x.onclick = async () => {
      await del(`/api/kanban/cards/${d.id}/labels/${x.dataset.lid}`);
      openCardModal(d.id, bid);
    };
  });
  document.getElementById('kb-check-add').onclick = async () => {
    const text = document.getElementById('kb-check-new').value.trim();
    if (!text) return;
    try { await post(`/api/kanban/cards/${d.id}/checklist`, { text }); openCardModal(d.id, bid); }
    catch (e) { toast('失敗: ' + e.message); }
  };
  overlay.querySelectorAll('.kb-check').forEach(cb => {
    cb.onchange = async () => {
      await patch(`/api/kanban/checklist/${cb.dataset.id}`, { is_done: cb.checked ? 1 : 0 });
      openCardModal(d.id, bid);
    };
  });
  overlay.querySelectorAll('.kb-check-del').forEach(b2 => {
    b2.onclick = async () => {
      await del(`/api/kanban/checklist/${b2.dataset.id}`);
      openCardModal(d.id, bid);
    };
  });
  document.getElementById('kb-com-add').onclick = async () => {
    const body = document.getElementById('kb-com-body').value.trim();
    if (!body) return;
    try { await post(`/api/kanban/cards/${d.id}/comments`, { body }); openCardModal(d.id, bid); loadBoard(bid); }
    catch (e) { toast('失敗: ' + e.message); }
  };
  overlay.querySelectorAll('.kb-com-del').forEach(b2 => {
    b2.onclick = async () => {
      if (!confirm('削除?')) return;
      await del(`/api/kanban/comments/${b2.dataset.id}`);
      openCardModal(d.id, bid);
      loadBoard(bid);
    };
  });
}

// ─── ラベル 管理 モーダル ─────────────────────────────

async function openLabelsModal(bid, initialLabels) {
  document.getElementById('kb-labels-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'kb-labels-modal';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:flex-start; justify-content:center; padding:20px';
  overlay.innerHTML = `<div style="background:#fff; border-radius:10px; max-width:480px; width:100%; padding:16px"><div class="muted">読み込み中…</div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const draw = async () => {
    try {
      const r = await get(`/api/kanban/boards/${bid}/labels`);
      const items = r.items || [];
      const card = overlay.querySelector('div');
      const colorOpts = ['gray','red','orange','yellow','green','blue','purple','pink'].map(c =>
        `<option value="${c}" style="background:${LABEL_COLORS[c]}">${c}</option>`).join('');
      card.innerHTML = `
        <div class="row center" style="gap:6px; margin-bottom:8px">
          <div class="bold" style="flex:1">🏷 ボード の ラベル</div>
          <button id="kb-l-close" class="btn" style="padding:2px 8px">✕</button>
        </div>
        ${items.map(l => `
          <div class="row center" style="gap:6px; padding:4px 0; border-bottom:1px solid #f3f4f6">
            <span style="width:14px; height:14px; border-radius:3px; background:${LABEL_COLORS[l.color]}"></span>
            <span style="flex:1">${escapeHtml(l.name)}</span>
            <button class="btn kb-l-edit" data-id="${l.id}" style="font-size:10px; padding:1px 6px">✏</button>
            <button class="btn danger kb-l-del" data-id="${l.id}" style="font-size:10px; padding:1px 6px">🗑</button>
          </div>`).join('')}
        <div class="row center" style="gap:6px; margin-top:8px">
          <input type="text" id="kb-l-new-name" placeholder="名前" style="flex:1; padding:3px 6px; font-size:12px">
          <select id="kb-l-new-color" style="padding:3px 6px; font-size:12px">${colorOpts}</select>
          <button id="kb-l-new-add" class="btn primary" style="font-size:12px">＋ 追加</button>
        </div>
      `;
      document.getElementById('kb-l-close').onclick = () => overlay.remove();
      document.getElementById('kb-l-new-add').onclick = async () => {
        const name = document.getElementById('kb-l-new-name').value.trim();
        const color = document.getElementById('kb-l-new-color').value;
        if (!name) return;
        try { await post(`/api/kanban/boards/${bid}/labels`, { name, color }); draw(); loadBoard(bid); }
        catch (e) { toast('失敗: ' + e.message); }
      };
      overlay.querySelectorAll('.kb-l-edit').forEach(b => {
        b.onclick = async () => {
          const cur = items.find(x => x.id == b.dataset.id);
          const name = prompt('名前', cur.name); if (name === null) return;
          const color = prompt('色 (gray/red/orange/yellow/green/blue/purple/pink)', cur.color) || 'gray';
          await patch(`/api/kanban/labels/${b.dataset.id}`, { name, color });
          draw(); loadBoard(bid);
        };
      });
      overlay.querySelectorAll('.kb-l-del').forEach(b => {
        b.onclick = async () => {
          if (!confirm('削除?')) return;
          await del(`/api/kanban/labels/${b.dataset.id}`);
          draw(); loadBoard(bid);
        };
      });
    } catch (e) {
      overlay.querySelector('div div').innerHTML = escapeHtml(e.message);
    }
  };
  draw();
}

// ─── 履歴 モーダル ────────────────────────────────────

async function openActivityModal(bid) {
  document.getElementById('kb-act-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'kb-act-modal';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:flex-start; justify-content:center; padding:20px';
  overlay.innerHTML = `<div style="background:#fff; border-radius:10px; max-width:560px; width:100%; padding:16px; max-height:calc(100vh - 40px); overflow-y:auto"><div class="muted">読み込み中…</div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  try {
    const r = await get(`/api/kanban/boards/${bid}/activity`);
    const items = r.items || [];
    const actLabel = {
      create_board: '📋 ボード 作成', edit_board: '✏ ボード 編集',
      create_list: '➕ 列 追加',
      create_card: '➕ カード 追加', edit_card: '✏ カード 編集', delete_card: '🗑 カード 削除',
      move_card: '⇄ カード 移動',
      assign: '👤 アサイン',
      add_comment: '💬 コメント',
    };
    overlay.querySelector('div').innerHTML = `
      <div class="row center" style="gap:6px; margin-bottom:8px">
        <div class="bold" style="flex:1">📜 履歴</div>
        <button id="kb-a-close" class="btn" style="padding:2px 8px">✕</button>
      </div>
      ${items.length ? items.map(a => `
        <div class="row center" style="gap:6px; padding:4px 0; border-bottom:1px solid #f3f4f6; font-size:12px">
          ${avatarHtml(a.display_name, a.avatar_url, 'xs')}
          <span class="bold">${escapeHtml(a.display_name)}</span>
          <span style="color:#6b7280">${escapeHtml(actLabel[a.action] || a.action)}</span>
          <span style="flex:1; color:#9ca3af">${escapeHtml((a.details?.title || '').slice(0, 60))}</span>
          <span class="hint-sm" style="font-size:10px">${escapeHtml((a.created_at || '').slice(5, 16))}</span>
        </div>`).join('') : '<span class="muted">履歴 なし</span>'}
    `;
    document.getElementById('kb-a-close').onclick = () => overlay.remove();
  } catch (e) {
    overlay.querySelector('div div').innerHTML = escapeHtml(e.message);
  }
}
