// /#/chat-rooms — Slack 風 チャット (#248)。 3 固定 チャンネル (重要 / 連絡 / 相談) + 1対1 DM。
// 軽 polling (2 秒) で 既存 メッセージ を 増分 取得。
// (既存 /chat は AI 翻訳 用 なので 別パス)

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const POLL_MS = 2000;

let _pollTimer = null;
let _lastMsgId = 0;
let _currentRoom = null;

function stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ─── /#/chat-rooms (ルーム 一覧) ─────────────────
export async function renderChatRooms() {
  stopPoll();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">💬 チャット</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        3 つ の チャンネル + 1対1 DM。 重要 への 投稿 は 全員 に 通知 されます。
      </p>
    </div>
    <div class="card">
      <h3>チャンネル / DM</h3>
      <div id="ch-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
    <div class="card">
      <h3>新規 DM を 開始</h3>
      <select id="ch-new-dm" style="margin-right:6px">
        <option value="">-- 相手 を 選ぶ --</option>
      </select>
      <button id="ch-new-dm-go" class="btn primary">開く</button>
    </div>
  `;
  try {
    const d = await get('/api/chat/rooms');
    const list = document.getElementById('ch-list');
    list.innerHTML = (d.rooms || []).map(r => {
      const last = r.last_message;
      const snippet = last ? escapeHtml(String(last.body).slice(0, 80)) : '<span class="muted">まだ メッセージ なし</span>';
      const unreadBadge = r.unread > 0
        ? `<span style="background:#ef4444; color:#fff; font-weight:700; font-size:11px; padding:1px 6px; border-radius:10px; flex:none">${r.unread}</span>`
        : '';
      return `
        <a class="list-item" href="#/chat-rooms/${encodeURIComponent(r.room_key)}" style="gap:8px; align-items:center">
          <span style="font-size:24px; flex:none">${escapeHtml(r.icon || '#️⃣')}</span>
          <div class="grow" style="min-width:0">
            <div class="bold">${escapeHtml(r.name)}${r.description ? ` <span class="hint-sm">${escapeHtml(r.description)}</span>` : ''}</div>
            <div class="meta" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${snippet}</div>
          </div>
          ${unreadBadge}
          <div class="hint">→</div>
        </a>`;
    }).join('') || '<div class="empty">ルーム が ありません</div>';
  } catch (e) {
    document.getElementById('ch-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  try {
    const u = await get('/api/users');
    const sel = document.getElementById('ch-new-dm');
    const meId = Number(state.me?.id);
    sel.innerHTML = '<option value="">-- 相手 を 選ぶ --</option>' +
      (u.items || []).filter(x => x.id !== meId).map(x =>
        `<option value="${x.id}">${escapeHtml(x.display_name)}${x.grade ? ` [${escapeHtml(x.grade)}]` : ''}</option>`).join('');
    document.getElementById('ch-new-dm-go').addEventListener('click', () => {
      const v = Number(sel.value);
      if (!v) return;
      const a = Math.min(meId, v); const b = Math.max(meId, v);
      navigate(`#/chat-rooms/${encodeURIComponent('dm:' + a + '-' + b)}`);
    });
  } catch (_) {}
}

// ─── /#/chat-rooms/:roomKey (メッセージ ストリーム) ─
export async function renderChatRoom({ params }) {
  stopPoll();
  _currentRoom = decodeURIComponent(params.roomKey);
  _lastMsgId = 0;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/chat-rooms" class="hint">← チャット 一覧</a>
      <div id="cr-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card" style="display:flex; flex-direction:column; gap:8px">
      <div id="cr-stream" style="overflow-y:auto; max-height:60vh; padding-right:4px; display:flex; flex-direction:column; gap:6px">
        <div class="muted">読み込み中…</div>
      </div>
      <div style="display:flex; gap:6px; align-items:flex-end; border-top:1px solid var(--line); padding-top:8px">
        <textarea id="cr-input" rows="2" maxlength="4000" placeholder="メッセージ を 入力 (Ctrl+Enter で 送信)" style="flex:1; box-sizing:border-box; resize:vertical; min-height:40px"></textarea>
        <button id="cr-send" class="btn primary" style="flex:none">送信</button>
      </div>
    </div>
  `;
  try {
    const rooms = await get('/api/chat/rooms');
    const r = (rooms.rooms || []).find(x => x.room_key === _currentRoom);
    let headHtml = '';
    if (r) {
      headHtml = `<h2 style="margin:6px 0 0">${escapeHtml(r.icon)} ${escapeHtml(r.name)}</h2>` +
                 (r.description ? `<div class="meta">${escapeHtml(r.description)}</div>` : '');
    } else if (_currentRoom.startsWith('dm:')) {
      const [a, b] = _currentRoom.slice(3).split('-').map(Number);
      const meId = Number(state.me?.id);
      const otherUid = meId === a ? b : a;
      try {
        const u = await get('/api/users');
        const other = (u.items || []).find(x => x.id === otherUid);
        if (other) headHtml = `<h2 style="margin:6px 0 0">💬 ${escapeHtml(other.display_name)} と の DM</h2>`;
      } catch (_) {}
    }
    document.getElementById('cr-head').innerHTML = headHtml || `<div class="muted">${escapeHtml(_currentRoom)}</div>`;
    await loadMessages();
  } catch (e) {
    document.getElementById('cr-stream').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  const input = document.getElementById('cr-input');
  const send = async () => {
    const body = input.value.trim();
    if (!body) return;
    try {
      await post(`/api/chat/rooms/${encodeURIComponent(_currentRoom)}/messages`, { body });
      input.value = '';
      await loadMessages(true);
    } catch (e) { toast('失敗: ' + e.message); }
  };
  document.getElementById('cr-send').addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); send(); }
  });

  _pollTimer = setInterval(() => {
    if (!document.getElementById('cr-stream')) { stopPoll(); return; }
    if (document.hidden) return;
    loadMessages().catch(() => {});
  }, POLL_MS);
}

async function loadMessages(scrollToBottom = false) {
  const stream = document.getElementById('cr-stream');
  if (!stream) return;
  const d = await get(`/api/chat/rooms/${encodeURIComponent(_currentRoom)}/messages?since_id=${_lastMsgId}`);
  const items = d.items || [];
  if (!items.length) {
    if (_lastMsgId === 0) {
      stream.innerHTML = '<div class="muted">まだ メッセージ が ありません</div>';
    }
    return;
  }
  const isInitial = _lastMsgId === 0;
  const meId = Number(state.me?.id);
  const html = items.map(m => renderMsg(m, meId)).join('');
  if (isInitial) stream.innerHTML = html;
  else stream.insertAdjacentHTML('beforeend', html);
  _lastMsgId = items[items.length - 1].id;
  patch(`/api/chat/rooms/${encodeURIComponent(_currentRoom)}/read`, { last_read_id: _lastMsgId }).catch(() => {});
  if (isInitial || scrollToBottom || stream.scrollTop + stream.clientHeight >= stream.scrollHeight - 100) {
    requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
  }
  stream.querySelectorAll('.cm-del').forEach(b => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', async () => {
      if (!confirm('この メッセージ を 削除 しますか?')) return;
      try {
        await del('/api/chat/messages/' + b.dataset.mid);
        b.closest('.cm-row')?.remove();
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
}

function renderMsg(m, meId) {
  if (m.deleted_at) {
    return `<div class="cm-row" style="font-size:12px; color:#999; padding:2px 0">(削除 された メッセージ)</div>`;
  }
  const mine = Number(m.sender_user_id) === meId;
  const time = String(m.created_at).slice(11, 16);
  const align = mine ? 'flex-end' : 'flex-start';
  const bg = mine ? '#7c3aed' : '#f3f4f6';
  const color = mine ? '#fff' : '#222';
  const linkify = body => escapeHtml(body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:inherit; text-decoration:underline">$1</a>');
  return `
    <div class="cm-row" style="display:flex; flex-direction:column; align-items:${align}">
      <div style="display:flex; gap:6px; align-items:flex-end; max-width:80%">
        ${mine ? '' : avatarHtml(m.sender_name, m.sender_avatar, 'sm')}
        <div style="display:flex; flex-direction:column; ${mine ? 'align-items:flex-end' : 'align-items:flex-start'}">
          ${mine ? '' : `<div class="hint-sm" style="font-size:11px; margin:0 4px 1px">${escapeHtml(m.sender_name)}</div>`}
          <div style="background:${bg}; color:${color}; padding:6px 10px; border-radius:12px; white-space:pre-wrap; word-break:break-word">${linkify(m.body)}</div>
          <div class="hint-sm" style="font-size:10px; margin:1px 4px 0">${escapeHtml(time)}${mine ? ` ・ <button class="cm-del" data-mid="${m.id}" style="background:none; border:none; color:#888; padding:0; font-size:10px; cursor:pointer">削除</button>` : ''}</div>
        </div>
      </div>
    </div>`;
}
