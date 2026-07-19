// /#/chat-rooms — Slack 風チャット (#248)。 3 固定チャンネル (重要 / 連絡 / 相談) + 1対1 DM。
// 軽 polling (2 秒) で既存メッセージを増分取得。
// (既存 /chat は AI 翻訳用なので別パス)
//
// v1140 中村さん要望まとめて:
//   - 右上のバツボタンが機能していない → 右上に「✕ ホームへ」を新設 (常時表示)
//   - 左上のバツボタンは不要 → v1130 で tabs 左端に追加した ✕ を削除
//   - 重要 / 連絡 / 相談は 3 スレッド同時に見える感じが良い
//     → デスクトップ (>=900px) では 3 主要チャンネルを横並び 3 ペイン、
//       スマホでは選択中の 1 ペインのみ表示 (タブ切替)
//   - DM を開いた時は従来通り 1 ペイン (メインチャンネルへのショートカット付き)

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const POLL_MS = 2000;
const MOBILE_QUERY = '(max-width: 899px)';

// 主要チャンネル (「重要 / 連絡 / 相談」の 3 つを想定)
//   room.type === 'ch' のうち API が返す全チャンネルを対象にする。
//   数が多い場合も先頭 3 つを 3-pane に、余りは選択時に置き換える (in-place)。

// --- module state ---
const _panes = new Map();   // roomKey -> { lastMsgId, pollTimer, roomInfo }
let _focusRoom = null;
let _mediaQuery = null;
let _mediaListener = null;

function stopAllPolls() {
  for (const p of _panes.values()) {
    if (p.pollTimer) { clearInterval(p.pollTimer); p.pollTimer = null; }
  }
  _panes.clear();
}

function isMobile() { return window.matchMedia(MOBILE_QUERY).matches; }

// ─── /#/chat-rooms (ルーム一覧、 Slack 風サイドバー) ─
// v726 #328 タブ UI に統一したので、ここを訪れたら最初のチャンネルへ自動遷移。
export async function renderChatRooms() {
  stopAllPolls();
  try {
    const d = await get('/api/chat/rooms');
    const rooms = d.rooms || [];
    const first = rooms.find(r => r.type === 'ch') || rooms[0];
    if (first) {
      navigate(`#/chat-rooms/${first.room_key}`);
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
          <option value="">＋新規 DM (相手を選ぶ)</option>
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
    sel.innerHTML = '<option value="">＋新規 DM (相手を選ぶ)</option>' +
      (u.items || []).filter(x => x.id !== meId).map(x =>
        `<option value="${x.id}">${escapeHtml(x.display_name)}${x.grade ? ` [${escapeHtml(x.grade)}]` : ''}</option>`).join('');
    document.getElementById('ch-new-dm-go').addEventListener('click', () => {
      const v = Number(sel.value);
      if (!v) return;
      const a = Math.min(meId, v); const b = Math.max(meId, v);
      navigate(`#/chat-rooms/${'dm:' + a + '-' + b}`);
    });
  } catch (_) {}
}

function roomRow(r) {
  const unread = r.unread > 0;
  const last = r.last_message;
  const snippet = last ? escapeHtml(String(last.body).slice(0, 50)) : '';
  return `
    <a href="#/chat-rooms/${r.room_key}"
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
export async function renderChatRoom({ params }) {
  const newFocus = decodeURIComponent(params.roomKey);
  // v1163 中村さん指摘「チャットが微妙にもっさり感がある、特にタブの切替」→ タブ (チャンネル)
  //   切替時は URL の hash が変わって renderChatRoom が再呼び出しされるが、既に
  //   同じパネル集合 (4 チャンネル全部) が DOM にあれば、 focus 変更だけで済ませて
  //   fetch/再描画をスキップ。これで channel タブ切替が実質即時になる。
  const existingShell = document.getElementById('cr-shell');
  const existingPaneEls = existingShell ? existingShell.querySelectorAll('[data-pane]') : [];
  const existingPaneKeys = new Set([...existingPaneEls].map(el => el.dataset.pane));
  if (existingShell && existingPaneKeys.has(newFocus)) {
    _focusRoom = newFocus;
    applyPaneVisibility();
    return;
  }
  stopAllPolls();
  cleanupMediaListener();
  _focusRoom = newFocus;
  const app = document.getElementById('app');
  // v1162 中村さん指摘「上と左右にあきスペースがある」。 chat-rooms は router で
  //   app-fullscreen になり topbar/tabs は非表示なのに、 cr-shell が top:96px で
  //   旧 topbar+tabs 分の空きを残していた → top:0 に。
  app.innerHTML = `<div id="cr-shell" style="position:fixed; top:0; left:0; right:0; bottom:0; background:#fff; z-index:2; display:flex; flex-direction:column">
    <div class="muted" style="padding:14px">読み込み中…</div>
  </div>`;

  let rooms = [];
  try {
    const roomsData = await get('/api/chat/rooms');
    rooms = roomsData.rooms || [];
  } catch (e) {
    document.getElementById('cr-shell').innerHTML =
      `<div class="muted" style="padding:14px">${escapeHtml(e.message)}</div>`;
    return;
  }

  const channels = rooms.filter(r => r.type === 'ch');
  const focusRoomInfo = rooms.find(r => r.room_key === _focusRoom);
  const isDM = _focusRoom.startsWith('dm:');
  const isChannel = !isDM;

  // v1163 中村さん要望「重要、連絡、相談、雑談の 4 つにするかな」→ 3-pane を 4-pane に。
  //   主要チャンネル (先頭 4 つ) を横並び。 DM 時は 1 pane。
  const paneRooms = isChannel
    ? channels.slice(0, 4).map(r => r.room_key === _focusRoom ? r : r)
    : [focusRoomInfo || { room_key: _focusRoom, name: '', icon: '💬', type: 'dm' }];

  // フォーカスされているチャンネルが 4-pane の先頭に含まれていない場合は 4 番目 (末尾) を差し替え
  if (isChannel && !paneRooms.some(r => r.room_key === _focusRoom) && focusRoomInfo) {
    paneRooms[Math.max(0, paneRooms.length - 1)] = focusRoomInfo;
  }

  // DM header (相手名の解決)
  let dmHeader = '';
  if (isDM) {
    const [a, b] = _focusRoom.slice(3).split('-').map(Number);
    const meId = Number(state.me?.id);
    const otherUid = meId === a ? b : a;
    try {
      const u = await get('/api/users');
      const other = (u.items || []).find(x => x.id === otherUid);
      if (other) dmHeader = `💬 ${escapeHtml(other.display_name)} との DM`;
    } catch (_) {}
  }

  const shell = document.getElementById('cr-shell');
  shell.innerHTML = `
    <div id="cr-topbar" style="display:flex; align-items:stretch; background:#3f0e40; color:#fff; flex:none">
      <!-- v1150 中村さん指摘「PC で見た時はタブが不要なので、タブ消してください。 3 つが同時に見えてるだけで OK」
           → cr-tabs コンテナはスマホ (<900px) のみ表示、 PC では applyPaneVisibility が hidden に -->
      <div id="cr-tabs" style="flex:1; overflow-x:auto; display:flex; gap:2px; padding:0">
        ${rooms.map(r => {
          const active = r.room_key === _focusRoom;
          const unread = Number(r.unread) || 0;
          const badge = unread > 0
            ? `<span style="background:#dc2626; color:#fff; font-weight:700; font-size:10px; padding:1px 6px; border-radius:9px; margin-left:4px">${unread > 99 ? '99+' : unread}</span>`
            : '';
          return `<a href="#/chat-rooms/${r.room_key}"
             style="display:inline-flex; align-items:center; gap:4px; padding:8px 12px; text-decoration:none; color:#fff; font-size:13px; white-space:nowrap; border-bottom:3px solid ${active ? '#fff' : 'transparent'}; background:${active ? 'rgba(255,255,255,0.1)' : 'transparent'}; ${unread && !active ? 'font-weight:700' : ''}">
            <span>${escapeHtml(r.icon || '#️⃣')}</span>
            <span>${escapeHtml(r.name || r.room_key)}</span>
            ${badge}
          </a>`;
        }).join('')}
      </div>
      <!-- v1163 cr-close ✕ を復活 (中村さん報告「✕ボタンを押しても閉じない」)。 v1162 で
           fs-close-btn (router の丸✕) と重複するので cr-close を削除したが、 fs-close-btn
           側が何らかの理由で効かない状況が発生。チャット topbar にも明示的な ✕ を再設置
           して確実にホームへ戻れるように。 fs-close-btn と 2 個並ぶ可能性はあるが機能優先。 -->
      <a href="#/" id="cr-close" title="チャットを閉じてホームへ"
         style="display:inline-flex; align-items:center; padding:0 14px; text-decoration:none; color:#fff; font-size:20px; background:#2d0a2f; flex:none">✕</a>
    </div>
    <div id="cr-panes" style="flex:1; min-height:0; display:grid; gap:0; grid-template-columns:${isChannel ? 'repeat(' + paneRooms.length + ', 1fr)' : '1fr'}"></div>
  `;

  // pane HTML を組む (mobile 判定は CSS で切替)
  const panesEl = document.getElementById('cr-panes');
  panesEl.innerHTML = paneRooms.map(r => paneHtml(r, isDM ? dmHeader : '')).join('');

  // v1163 各 pane 初期化を並列化 (旧: for await で 4 チャンネル × 50-100ms シリアル。
  //   新: Promise.all で一括、 wall-clock を 1 回分に短縮)
  for (const r of paneRooms) {
    _panes.set(r.room_key, { lastMsgId: 0, pollTimer: null, roomInfo: r });
    wirePane(r.room_key);
  }
  await Promise.all(paneRooms.map(r => loadMessagesFor(r.room_key, true).catch(() => {})));

  // 選択されている pane 以外を dim (スマホでは選択中のみ表示)
  applyPaneVisibility();

  // 画面サイズ変化に追従
  _mediaQuery = window.matchMedia(MOBILE_QUERY);
  _mediaListener = () => applyPaneVisibility();
  _mediaQuery.addEventListener('change', _mediaListener);
}

function cleanupMediaListener() {
  if (_mediaQuery && _mediaListener) {
    _mediaQuery.removeEventListener('change', _mediaListener);
  }
  _mediaQuery = null; _mediaListener = null;
}

function paneHtml(r, dmHeaderOverride) {
  const key = r.room_key;
  const title = dmHeaderOverride
    ? dmHeaderOverride
    : `${escapeHtml(r.icon || '#️⃣')} ${escapeHtml(r.name || key)}${r.description ? ` <span class="hint-sm" style="font-weight:normal; font-size:11px; margin-left:4px; color:#616061">${escapeHtml(r.description)}</span>` : ''}`;
  return `
    <section data-pane="${escapeHtml(key)}" style="display:flex; flex-direction:column; min-width:0; border-right:1px solid var(--line); background:#fff">
      <div class="cr-pane-head" data-pane-head="${escapeHtml(key)}" style="padding:6px 12px; font-size:13px; color:#1d1c1d; background:#f8f8f8; border-bottom:1px solid var(--line); flex:none; display:flex; align-items:center; justify-content:space-between; gap:6px">
        <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${title}</div>
        <div class="hint-sm" data-pane-focus-hint="${escapeHtml(key)}" style="font-size:10px; color:#7b3fa0; display:none">選択中</div>
      </div>
      <div data-pane-stream="${escapeHtml(key)}" style="flex:1; overflow-y:auto; padding:10px 14px; display:flex; flex-direction:column; gap:2px; background:#fff; min-height:0">
        <div class="muted">読み込み中…</div>
      </div>
      <div style="border-top:1px solid var(--line); padding:8px 10px; background:#fafafa; display:flex; gap:6px; align-items:flex-end; flex:none">
        <textarea data-pane-input="${escapeHtml(key)}" rows="2" maxlength="4000" placeholder="メッセージを入力 (Ctrl+Enter で送信)" style="flex:1; box-sizing:border-box; resize:none; min-height:36px; max-height:140px; border:1px solid #ccc; border-radius:6px; padding:6px 8px; font-family:inherit; font-size:14px"></textarea>
        <button data-pane-send="${escapeHtml(key)}" class="btn primary" style="flex:none">送信</button>
      </div>
    </section>`;
}

function wirePane(key) {
  const inputEl = document.querySelector(`[data-pane-input="${cssSel(key)}"]`);
  const sendEl  = document.querySelector(`[data-pane-send="${cssSel(key)}"]`);
  if (!inputEl || !sendEl) return;
  // v1150 中村さん報告「タイミングによっては同じメッセージが 2 回投稿されてしまう」
  //   → 送信中は sending フラグ + button/input disable で 2 回目クリック / Ctrl+Enter 連打を弾く。
  //   POST 完了 (成功 / 失敗) で解除。
  // v1163 中村さん指摘「書き込んだらすぐに反映されてほしいのだけど、なんかディレイがある」
  //   → optimistic UI 化。従来は POST 完了 → 追加 GET (再取得) の 2 往復待ちで
  //   自分の書き込みが見えなかった。修正: 入力欄クリア + ローカル bubble 描画を
  //   同期に前倒し、 POST は裏で走らせ、完了時に pending bubble を除去して再取得。
  //   失敗時は pending bubble を赤く塗って、入力欄に body を復元。
  let sending = false;
  let pendingSeq = 0;
  const send = async () => {
    if (sending) return;
    const body = inputEl.value.trim();
    if (!body) return;
    sending = true;
    sendEl.disabled = true;
    const origLabel = sendEl.textContent;
    sendEl.textContent = '⌛';
    inputEl.value = '';
    // optimistic bubble を stream 末尾に append
    const stream = document.querySelector(`[data-pane-stream="${cssSel(key)}"]`);
    const pid = `pending-${key}-${++pendingSeq}-${Date.now()}`;
    if (stream) {
      const meName = state.me?.display_name || '(自分)';
      const meAvatar = state.me?.avatar_url || null;
      const time = new Date().toTimeString().slice(0, 5);
      const linkified = escapeHtml(body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:#1264a3; text-decoration:underline">$1</a>');
      stream.insertAdjacentHTML('beforeend', `
        <div class="cm-row cm-pending" data-pid="${pid}" style="display:flex; gap:10px; padding:6px 0; align-items:flex-start; opacity:0.55">
          <div style="flex:none">${avatarHtml(meName, meAvatar, 'md')}</div>
          <div style="flex:1; min-width:0">
            <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:2px">
              <span style="font-weight:700; color:#1d1c1d; font-size:15px">${escapeHtml(meName)}</span>
              <span style="color:#616061; font-size:12px">${escapeHtml(time)} ⌛ 送信中</span>
            </div>
            <div style="color:#1d1c1d; font-size:15px; line-height:1.46; white-space:pre-wrap; word-break:break-word">${linkified}</div>
          </div>
        </div>`);
      requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
    }
    try {
      await post(`/api/chat/rooms/${encodeURIComponent(key)}/messages`, { body });
      // pending bubble を消して本物を GET で取ってくる (重複回避)
      stream?.querySelector(`[data-pid="${pid}"]`)?.remove();
      await loadMessagesFor(key, true);
    } catch (e) {
      // 失敗: bubble を赤く塗って body を入力欄に戻す
      const pending = stream?.querySelector(`[data-pid="${pid}"]`);
      if (pending) {
        pending.style.opacity = '1';
        pending.style.background = '#ffe4e4';
        const meta = pending.querySelector('div > div > div:first-child > span:last-child');
        if (meta) meta.innerHTML = '⚠ 送信失敗';
      }
      if (!inputEl.value) inputEl.value = body;
      toast('失敗: ' + e.message);
    }
    finally {
      sending = false;
      sendEl.disabled = false;
      sendEl.textContent = origLabel;
    }
  };
  sendEl.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); send(); }
  });
  // pane クリックで focus を切り替え (デスクトップ 3-pane 上で入力先を明示)
  const paneEl = document.querySelector(`[data-pane="${cssSel(key)}"]`);
  paneEl?.addEventListener('click', () => {
    if (_focusRoom !== key) {
      _focusRoom = key;
      applyPaneVisibility();
    }
  });

  // polling
  const p = _panes.get(key);
  if (!p) return;
  p.pollTimer = setInterval(() => {
    if (!document.querySelector(`[data-pane-stream="${cssSel(key)}"]`)) {
      if (p.pollTimer) clearInterval(p.pollTimer);
      _panes.delete(key);
      return;
    }
    if (document.hidden) return;
    loadMessagesFor(key).catch(() => {});
  }, POLL_MS);
}

function cssSel(s) {
  // data-* 属性セレクタで安全に使えるように " を escape (room_key は英数と : - _ 前提)
  return String(s).replace(/"/g, '\\"');
}

function applyPaneVisibility() {
  const mobile = isMobile();
  // v1150 PC では 3 pane 同時見えるので上部タブバー不要。スマホでは切替に必要なので表示
  const tabs = document.getElementById('cr-tabs');
  if (tabs) tabs.style.display = mobile ? 'flex' : 'none';
  document.querySelectorAll('[data-pane]').forEach(pane => {
    const key = pane.dataset.pane;
    const focused = key === _focusRoom;
    if (mobile) {
      pane.style.display = focused ? 'flex' : 'none';
    } else {
      pane.style.display = 'flex';
      // PC は 3 pane 見えるので focus 強調不要 (「選択中」バッジも非表示)
      pane.style.background = '#fff';
    }
    const hint = document.querySelector(`[data-pane-focus-hint="${cssSel(key)}"]`);
    if (hint) hint.style.display = 'none';
  });
  // panes grid が 1 pane 表示 (スマホ) の場合は 1fr のまま、複数 pane 表示の場合は grid を維持
  const panesEl = document.getElementById('cr-panes');
  if (panesEl) {
    const visible = [...panesEl.querySelectorAll('[data-pane]')].filter(p => p.style.display !== 'none').length;
    panesEl.style.gridTemplateColumns = visible <= 1 ? '1fr' : `repeat(${visible}, 1fr)`;
  }
}

async function loadMessagesFor(key, scrollToBottom = false) {
  const p = _panes.get(key);
  if (!p) return;
  const stream = document.querySelector(`[data-pane-stream="${cssSel(key)}"]`);
  if (!stream) return;
  const d = await get(`/api/chat/rooms/${encodeURIComponent(key)}/messages?since_id=${p.lastMsgId}`);
  const items = d.items || [];
  if (!items.length) {
    if (p.lastMsgId === 0) {
      stream.innerHTML = '<div class="muted">まだメッセージがありません</div>';
    }
    return;
  }
  const isInitial = p.lastMsgId === 0;
  const meId = Number(state.me?.id);
  const html = items.map(m => renderMsg(m, meId)).join('');
  if (isInitial) stream.innerHTML = html;
  else stream.insertAdjacentHTML('beforeend', html);
  p.lastMsgId = items[items.length - 1].id;
  patch(`/api/chat/rooms/${encodeURIComponent(key)}/read`, { last_read_id: p.lastMsgId }).catch(() => {});
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

// v670 Slack 風メッセージ表示
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
