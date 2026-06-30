// /#/chat-rooms — Slack 風チャット (#248)。 3 固定チャンネル (重要 / 連絡 / 相談) + 1対1 DM。
// 軽 polling (2 秒) で既存メッセージを増分取得。
// (既存 /chat は AI 翻訳用なので別パス)

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

// ─── /#/chat-rooms (ルーム一覧、 Slack 風サイドバー) ─
// v726 #328 タブ UI に統一したので、ここを訪れたら最初のチャンネルへ自動遷移。
export async function renderChatRooms() {
  stopPoll();
  try {
    const d = await get('/api/chat/rooms');
    const rooms = d.rooms || [];
    const first = rooms.find(r => r.type === 'ch') || rooms[0];
    if (first) {
      navigate(`#/chat-rooms/${encodeURIComponent(first.room_key)}`);
      return;
    }
  } catch (_) {}
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card" style="background:#3f0e40; color:#fff; padding:14px">
      <h2 style="margin:0; font-size:20px">💬 LabPay チャット</h2>
      <p style="font-size:12px; margin:4px 0 0; opacity:0.85">
        チャンネル + DM。「🚨 重要」への投稿は全員に通知されます。
      </p>
    </div>
    <div class="card" style="padding:0">
      <div style="padding:10px 14px 6px; font-size:11px; font-weight:700; color:#666; letter-spacing:0.05em; text-transform:uppercase">チャンネル</div>
      <div id="ch-channels"></div>
      <div style="padding:14px 14px 6px; font-size:11px; font-weight:700; color:#666; letter-spacing:0.05em; text-transform:uppercase; border-top:1px solid var(--line)">DM</div>
      <div id="ch-dms"></div>
      <div style="padding:10px 14px; border-top:1px solid var(--line); display:flex; gap:6px; align-items:center">
        <select id="ch-new-dm" style="flex:1">
          <option value="">＋ 新規 DM (相手を選ぶ)</option>
        </select>
        <button id="ch-new-dm-go" class="btn primary" style="flex:none">開く</button>
      </div>
    </div>
  `;
  try {
    const d = await get('/api/chat/rooms');
    const rooms = d.rooms || [];
    const channels = rooms.filter(r => r.type === 'ch');
    const dms      = rooms.filter(r => r.type === 'dm');
    document.getElementById('ch-channels').innerHTML = channels.map(r => roomRow(r)).join('');
    document.getElementById('ch-dms').innerHTML = dms.length
      ? dms.map(r => roomRow(r)).join('')
      : '<div style="padding:8px 14px; color:#888; font-size:12px">まだ DM はありません</div>';
  } catch (e) {
    document.getElementById('ch-channels').innerHTML = `<div class="muted" style="padding:14px">${escapeHtml(e.message)}</div>`;
  }
  try {
    const u = await get('/api/users');
    const sel = document.getElementById('ch-new-dm');
    const meId = Number(state.me?.id);
    sel.innerHTML = '<option value="">＋ 新規 DM (相手を選ぶ)</option>' +
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

function roomRow(r) {
  const unread = r.unread > 0;
  const last = r.last_message;
  const snippet = last ? escapeHtml(String(last.body).slice(0, 50)) : '';
  return `
    <a href="#/chat-rooms/${encodeURIComponent(r.room_key)}"
       style="display:flex; gap:8px; align-items:center; padding:8px 14px; text-decoration:none; color:inherit; ${unread ? 'background:#fff8e6' : ''}">
      <span style="font-size:18px; flex:none">${escapeHtml(r.icon || '#️⃣')}</span>
      <div style="flex:1; min-width:0">
        <div style="${unread ? 'font-weight:700' : ''}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(r.name)}</div>
        ${snippet ? `<div style="font-size:11px; color:#999; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${snippet}</div>` : ''}
      </div>
      ${unread ? `<span style="background:#dc2626; color:#fff; font-weight:700; font-size:11px; padding:1px 7px; border-radius:10px; flex:none">${r.unread}</span>` : ''}
    </a>`;
}

// ─── /#/chat-rooms/:roomKey (メッセージストリーム) ─
// v726 #328 layout 改修:
//   (a) チャンネル / DM 選択をタブ的に上部に並べる + 未読件数バッジ。
//   (b) 入力欄を viewport 下に固定 (旧版は card 内 flex 末尾でスクロール先にあった)。
export async function renderChatRoom({ params }) {
  stopPoll();
  _currentRoom = decodeURIComponent(params.roomKey);
  _lastMsgId = 0;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="cr-shell" style="position:fixed; top:96px; left:0; right:0; bottom:0; display:flex; flex-direction:column; background:#fff; z-index:2">
      <div id="cr-tabs" style="display:flex; overflow-x:auto; background:#3f0e40; flex:none; gap:2px; padding:0"></div>
      <div id="cr-head" style="padding:6px 12px; font-size:12px; color:#555; background:#f3f4f6; border-bottom:1px solid var(--line); flex:none">読み込み中…</div>
      <div id="cr-stream" style="flex:1; overflow-y:auto; padding:10px 14px; display:flex; flex-direction:column; gap:2px; background:#fff; min-height:0">
        <div class="muted">読み込み中…</div>
      </div>
      <div style="border-top:1px solid var(--line); padding:8px 10px; background:#fafafa; display:flex; gap:6px; align-items:flex-end; flex:none">
        <textarea id="cr-input" rows="2" maxlength="4000" placeholder="メッセージを入力 (Ctrl+Enter で送信)" style="flex:1; box-sizing:border-box; resize:none; min-height:36px; max-height:140px; border:1px solid #ccc; border-radius:6px; padding:6px 8px; font-family:inherit; font-size:14px"></textarea>
        <button id="cr-send" class="btn primary" style="flex:none">送信</button>
      </div>
    </div>
  `;
  try {
    const roomsData = await get('/api/chat/rooms');
    const allRooms = roomsData.rooms || [];
    // タブ描画 (チャンネル + DM すべて + 未読バッジ)。
    const tabsEl = document.getElementById('cr-tabs');
    tabsEl.innerHTML = allRooms.map(r => {
      const active = r.room_key === _currentRoom;
      const unread = Number(r.unread) || 0;
      const badge = unread > 0
        ? `<span style="background:#dc2626; color:#fff; font-weight:700; font-size:10px; padding:1px 6px; border-radius:9px; margin-left:4px">${unread > 99 ? '99+' : unread}</span>`
        : '';
      return `
        <a href="#/chat-rooms/${encodeURIComponent(r.room_key)}"
           style="display:inline-flex; align-items:center; gap:4px; padding:8px 12px; text-decoration:none; color:#fff; font-size:13px; white-space:nowrap; border-bottom:3px solid ${active ? '#fff' : 'transparent'}; background:${active ? 'rgba(255,255,255,0.1)' : 'transparent'}; ${unread && !active ? 'font-weight:700' : ''}">
          <span>${escapeHtml(r.icon || '#️⃣')}</span>
          <span>${escapeHtml(r.name)}</span>
          ${badge}
        </a>`;
    }).join('');
    const r = allRooms.find(x => x.room_key === _currentRoom);
    let headHtml = '';
    if (r) {
      headHtml = `<span class="bold" style="font-size:13px">${escapeHtml(r.icon)} ${escapeHtml(r.name)}</span>` +
                 (r.description ? ` ・ ${escapeHtml(r.description)}` : '');
    } else if (_currentRoom.startsWith('dm:')) {
      const [a, b] = _currentRoom.slice(3).split('-').map(Number);
      const meId = Number(state.me?.id);
      const otherUid = meId === a ? b : a;
      try {
        const u = await get('/api/users');
        const other = (u.items || []).find(x => x.id === otherUid);
        if (other) headHtml = `💬 ${escapeHtml(other.display_name)} との DM`;
      } catch (_) {}
    }
    document.getElementById('cr-head').innerHTML = headHtml || `<span class="muted">${escapeHtml(_currentRoom)}</span>`;
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
      stream.innerHTML = '<div class="muted">まだメッセージがありません</div>';
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
      if (!confirm('このメッセージを削除しますか?')) return;
      try {
        await del('/api/chat/messages/' + b.dataset.mid);
        b.closest('.cm-row')?.remove();
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
}

// v670 Slack 風メッセージ表示: 全メッセージ左寄せ、アバター + 名前 + 時刻をヘッダに、
// 削除ボタンは hover で出る (.cm-row:hover .cm-del で表示)。
function renderMsg(m, meId) {
  if (m.deleted_at) {
    return `<div class="cm-row" style="font-size:12px; color:#999; padding:4px 0; font-style:italic">(削除されたメッセージ)</div>`;
  }
  const mine = Number(m.sender_user_id) === meId;
  const time = String(m.created_at).slice(11, 16);
  const linkify = body => escapeHtml(body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:#1264a3; text-decoration:underline">$1</a>');
  return `
    <div class="cm-row" style="display:flex; gap:10px; padding:6px 0; align-items:flex-start; position:relative">
      <div style="flex:none">${avatarHtml(m.sender_name, m.sender_avatar, 'md')}</div>
      <div style="flex:1; min-width:0">
        <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:2px">
          <span style="font-weight:700; color:#1d1c1d; font-size:15px">${escapeHtml(m.sender_name)}</span>
          <span style="color:#616061; font-size:12px">${escapeHtml(time)}</span>
        </div>
        <div style="color:#1d1c1d; font-size:15px; line-height:1.46; white-space:pre-wrap; word-break:break-word">${linkify(m.body)}</div>
      </div>
      ${mine ? `<button class="cm-del" data-mid="${m.id}" style="position:absolute; top:6px; right:0; opacity:0; background:#fff; border:1px solid #ddd; border-radius:4px; padding:2px 8px; font-size:11px; color:#666; cursor:pointer; transition:opacity 0.1s">🗑 削除</button>` : ''}
    </div>`;
}
// hover で削除ボタン表示
if (typeof document !== 'undefined' && !document.getElementById('cm-hover-style')) {
  const s = document.createElement('style');
  s.id = 'cm-hover-style';
  s.textContent = `.cm-row:hover { background:#f8f8f8; } .cm-row:hover .cm-del { opacity:1 !important; }`;
  document.head.appendChild(s);
}
