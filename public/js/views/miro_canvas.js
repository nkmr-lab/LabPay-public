// v1100 /#/miro/rooms/{id} — Miro 的な共同ポストイット空間の 1 部屋。
//   ・空間 = translate + scale の CSS transform をかけたレイヤ
//   ・pan = 空白ドラッグ / pinch (2 本指) / ホイール
//   ・zoom = ホイール (ctrl 不要) / pinch
//   ・ノート = 空間内 absolute 配置、ドラッグで移動、右下ハンドルでリサイズ、ダブルタップで編集
//   ・オモテウラ (side) はユーザごと個別 (miro_note_flips)
//   ・🎨 画像生成 = OpenAI gpt-image-1 low → /uploads/miro/... に保存 → 表 or 裏に貼る
//   ・2 s poll で他人の編集を取り込み

import { get, post, patch, put, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';

const PALETTE = [
  '#FEF9A8', // 黄 (デフォ)
  '#FDD9E1', // 桃
  '#BAE6FD', // 空
  '#BBF7D0', // 緑
  '#FED7AA', // 橙
  '#DDD6FE', // 紫
  '#E5E7EB', // 灰
  '#FFFFFF', // 白
];

let ROOM = null;
let NOTES = [];     // 全ノート (array)
let NOTE_MAP = {};  // id → note
let VIEW = { tx: 0, ty: 0, scale: 1 };
let LAST_SERVER_TIME = '1970-01-01 00:00:00';
let POLL_TIMER = null;
let ROOM_ID = 0;
let MY_DEFAULT_COLOR = '#FEF9A8';
let LEAVE_HANDLER = null;

export async function renderMiroCanvas({ params }) {
  ROOM_ID = parseInt(params?.id, 10);
  if (!ROOM_ID) { navigate('/miro'); return; }
  const app = document.getElementById('app');
  app.innerHTML = shellHtml();
  wireToolbar();
  wireCanvas();
  await loadInitial();
  startPolling();
  LEAVE_HANDLER = () => stopPolling();
  window.addEventListener('hashchange', LEAVE_HANDLER, { once: true });
}

function shellHtml() {
  return `
    <div id="miro-shell" style="position:fixed; inset:56px 0 60px 0; display:flex; flex-direction:column; background:#fafafa">
      <!-- toolbar -->
      <div id="miro-toolbar" style="display:flex; gap:6px; align-items:center; padding:6px 10px; background:#fff; border-bottom:1px solid #e5e7eb; flex-wrap:wrap">
        <a href="#/miro" class="hint" style="text-decoration:none; padding:4px 8px">← 部屋一覧</a>
        <div id="miro-title" style="font-weight:700; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">…</div>
        <button class="btn" id="miro-add" title="ノートを追加">➕ ノート</button>
        <div id="miro-palette" style="display:flex; gap:3px; align-items:center; margin-left:6px" title="デフォルト色">
          ${PALETTE.map(c => `<button class="mpal" data-color="${c}" style="width:24px; height:24px; border-radius:6px; border:2px solid transparent; background:${c}; padding:0; cursor:pointer" title="${c}"></button>`).join('')}
        </div>
        <div style="display:flex; gap:3px; align-items:center; margin-left:6px">
          <button class="btn" id="miro-zoom-out" style="padding:4px 8px">−</button>
          <span id="miro-zoom-label" style="font-size:12px; color:#6b7280; min-width:44px; text-align:center">100%</span>
          <button class="btn" id="miro-zoom-in" style="padding:4px 8px">＋</button>
          <button class="btn" id="miro-zoom-fit" style="padding:4px 8px" title="全部見える倍率にリセット">⛶</button>
        </div>
      </div>
      <!-- viewport -->
      <div id="miro-viewport" style="flex:1; overflow:hidden; position:relative; touch-action:none; cursor:grab; background:#fafafa">
        <div id="miro-layer" style="position:absolute; left:0; top:0; transform-origin:0 0; will-change:transform"></div>
      </div>
    </div>

    <!-- prompt modal for image gen (残り 1 つだけ、これは長い入力なのでモーダル) -->
    <div id="miro-prompt-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center; padding:16px">
      <div style="background:#fff; border-radius:12px; padding:16px; width:100%; max-width:440px; display:flex; flex-direction:column; gap:8px">
        <div style="font-weight:700">🎨 <span id="mprompt-side-label">オモテ</span>に画像を生成</div>
        <textarea id="mprompt-text" rows="4" placeholder="例: 夕暮れの海と赤い灯台のイラスト、水彩画風" style="width:100%; box-sizing:border-box"></textarea>
        <div class="hint-sm" style="font-size:11px; color:#6b7280">OpenAI gpt-image-1 low を使います。1 枚あたりおおよそ ¥1.5 相当の計算コスト。</div>
        <div class="row" style="gap:6px; justify-content:flex-end">
          <button class="btn" id="mprompt-cancel">キャンセル</button>
          <button class="btn primary" id="mprompt-go">生成する</button>
        </div>
      </div>
    </div>

    <!-- 小さな色ポップオーバー (ノートヘッダの 🎨 で開く) -->
    <div id="miro-color-pop" style="display:none; position:fixed; z-index:10001; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:6px; box-shadow:0 4px 12px rgba(0,0,0,0.15); gap:4px">
      ${PALETTE.map(c => `<button class="mcolor-pop" data-color="${c}" style="width:24px; height:24px; border-radius:5px; border:2px solid transparent; background:${c}; padding:0; cursor:pointer"></button>`).join('')}
    </div>
  `;
}

// ─── data loading ─────────────────────────────────────────────

async function loadInitial() {
  try {
    const d = await get(`/api/miro/rooms/${ROOM_ID}`);
    ROOM = d.room;
    MY_DEFAULT_COLOR = d.my_default_color || '#FEF9A8';
    NOTES = d.notes || [];
    NOTE_MAP = {};
    for (const n of NOTES) NOTE_MAP[n.id] = n;
    LAST_SERVER_TIME = d.server_time;
    document.getElementById('miro-title').textContent = ROOM.title;
    document.getElementById('miro-viewport').style.background = ROOM.bg_color || '#fafafa';
    highlightPalette();
    // 初回は中央にフィット
    fitAll();
    renderAll();
  } catch (e) {
    document.getElementById('miro-viewport').innerHTML =
      `<div style="padding:16px; color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function startPolling() {
  stopPolling();
  POLL_TIMER = setInterval(async () => {
    try {
      const d = await get(`/api/miro/rooms/${ROOM_ID}/updates?since=${encodeURIComponent(LAST_SERVER_TIME)}`);
      LAST_SERVER_TIME = d.server_time || LAST_SERVER_TIME;
      let dirty = false;
      for (const n of d.upserts || []) {
        // ドラッグ中 or インライン編集中の自分のノートは弾く (自分の入力を上書きしない)
        if (DRAG.noteId === n.id) continue;
        if (EDITING_NOTE_ID === n.id) continue;
        NOTE_MAP[n.id] = n;
        dirty = true;
      }
      for (const id of d.deletes || []) {
        if (NOTE_MAP[id]) { delete NOTE_MAP[id]; dirty = true; }
        if (EDITING_NOTE_ID === id) EDITING_NOTE_ID = null;   // 削除されたら編集終了
      }
      if (dirty) {
        NOTES = Object.values(NOTE_MAP);
        renderAll();
      }
    } catch (_) {}
  }, 2000);
}
function stopPolling() {
  if (POLL_TIMER) { clearInterval(POLL_TIMER); POLL_TIMER = null; }
}

// ─── viewport transforms ──────────────────────────────────────

function applyTransform() {
  const layer = document.getElementById('miro-layer');
  if (!layer) return;
  layer.style.transform = `translate(${VIEW.tx}px, ${VIEW.ty}px) scale(${VIEW.scale})`;
  const lbl = document.getElementById('miro-zoom-label');
  if (lbl) lbl.textContent = Math.round(VIEW.scale * 100) + '%';
}
function screenToWorld(sx, sy) {
  const rect = document.getElementById('miro-viewport').getBoundingClientRect();
  const x = (sx - rect.left - VIEW.tx) / VIEW.scale;
  const y = (sy - rect.top  - VIEW.ty) / VIEW.scale;
  return { x, y };
}
function fitAll() {
  const vp = document.getElementById('miro-viewport');
  if (!vp) return;
  if (!NOTES.length) {
    // 空の時は原点中央
    VIEW.scale = 1;
    VIEW.tx = vp.clientWidth / 2;
    VIEW.ty = vp.clientHeight / 2;
    applyTransform();
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of NOTES) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  const pad = 60;
  const w = (maxX - minX) + pad * 2;
  const h = (maxY - minY) + pad * 2;
  const scale = Math.min(vp.clientWidth / w, vp.clientHeight / h, 1);
  VIEW.scale = Math.max(0.1, scale);
  VIEW.tx = -minX * VIEW.scale + pad * VIEW.scale + (vp.clientWidth  - (maxX - minX + pad * 2) * VIEW.scale) / 2;
  VIEW.ty = -minY * VIEW.scale + pad * VIEW.scale + (vp.clientHeight - (maxY - minY + pad * 2) * VIEW.scale) / 2;
  applyTransform();
}

// ─── input: pan / zoom / drag / resize ────────────────────────

const DRAG = {
  mode: null, // 'pan' | 'note' | 'resize' | null
  noteId: null,
  startX: 0, startY: 0,
  origTx: 0, origTy: 0,
  noteStartX: 0, noteStartY: 0,
  noteStartW: 0, noteStartH: 0,
  pointerId: null,
  moved: false,
  lastPatch: 0,
};

// v1101 ダブルタップで編集モーダル。単一タップ = flip、300 ms 以内に
//   同じノートを再タップ = flip をキャンセルして編集モーダルを開く。
const TAP = { noteId: null, ts: 0, flipTimer: null };
const DBLTAP_MS = 300;

function wireCanvas() {
  const vp    = document.getElementById('miro-viewport');
  const layer = document.getElementById('miro-layer');

  vp.addEventListener('pointerdown', (e) => {
    // 何に触れたか
    const noteEl   = e.target.closest('.mnote');
    const handleEl = e.target.closest('.mhandle');
    if (handleEl && noteEl) {
      DRAG.mode = 'resize';
      DRAG.noteId = parseInt(noteEl.dataset.id, 10);
      const n = NOTE_MAP[DRAG.noteId];
      if (!n) return;
      DRAG.startX = e.clientX; DRAG.startY = e.clientY;
      DRAG.noteStartW = n.width; DRAG.noteStartH = n.height;
    } else if (noteEl && !e.target.closest('button, textarea, input, a')) {
      DRAG.mode = 'note';
      DRAG.noteId = parseInt(noteEl.dataset.id, 10);
      const n = NOTE_MAP[DRAG.noteId];
      if (!n) return;
      DRAG.startX = e.clientX; DRAG.startY = e.clientY;
      DRAG.noteStartX = n.x; DRAG.noteStartY = n.y;
      // z bump
      bringToFront(DRAG.noteId).catch(() => {});
    } else if (!e.target.closest('button, .mmodal-color, .mpal')) {
      DRAG.mode = 'pan';
      DRAG.startX = e.clientX; DRAG.startY = e.clientY;
      DRAG.origTx = VIEW.tx; DRAG.origTy = VIEW.ty;
      vp.style.cursor = 'grabbing';
    }
    DRAG.moved = false;
    DRAG.pointerId = e.pointerId;
    // v1103 ドラッグ / パン開始時のみ pointer capture (button / textarea クリックは非拘束)
    if (DRAG.mode !== null) {
      try { vp.setPointerCapture(e.pointerId); } catch (_) {}
    }
  });

  vp.addEventListener('pointermove', (e) => {
    if (DRAG.mode === null) return;
    const dx = e.clientX - DRAG.startX;
    const dy = e.clientY - DRAG.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) DRAG.moved = true;
    if (DRAG.mode === 'pan') {
      VIEW.tx = DRAG.origTx + dx;
      VIEW.ty = DRAG.origTy + dy;
      applyTransform();
    } else if (DRAG.mode === 'note') {
      const n = NOTE_MAP[DRAG.noteId]; if (!n) return;
      n.x = DRAG.noteStartX + dx / VIEW.scale;
      n.y = DRAG.noteStartY + dy / VIEW.scale;
      const el = document.querySelector(`.mnote[data-id="${DRAG.noteId}"]`);
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    } else if (DRAG.mode === 'resize') {
      const n = NOTE_MAP[DRAG.noteId]; if (!n) return;
      n.width  = Math.max(80, Math.min(1200, DRAG.noteStartW + dx / VIEW.scale));
      n.height = Math.max(80, Math.min(1200, DRAG.noteStartH + dy / VIEW.scale));
      const el = document.querySelector(`.mnote[data-id="${DRAG.noteId}"]`);
      if (el) { el.style.width = n.width + 'px'; el.style.height = n.height + 'px'; }
    }
  });

  vp.addEventListener('pointerup', async (e) => {
    const mode = DRAG.mode;
    const nid  = DRAG.noteId;
    const moved = DRAG.moved;
    vp.style.cursor = 'grab';
    try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
    DRAG.mode = null; DRAG.noteId = null;
    if ((mode === 'note' || mode === 'resize') && nid && moved) {
      const n = NOTE_MAP[nid];
      if (n) {
        try {
          if (mode === 'note')   await patch(`/api/miro/notes/${nid}`, { x: n.x, y: n.y });
          if (mode === 'resize') await patch(`/api/miro/notes/${nid}`, { width: n.width, height: n.height });
        } catch (err) { toast('保存失敗: ' + err.message); }
      }
    } else if (mode === 'note' && !moved && nid) {
      // v1103 単発タップは何もしない (フリップは 🔄 ボタン)。ダブルタップだけで
      //   インライン編集に入る。裏の場合は自動で表にめくってから編集。
      const now = Date.now();
      if (TAP.noteId === nid && (now - TAP.ts) < DBLTAP_MS) {
        TAP.noteId = null; TAP.ts = 0;
        const n = NOTE_MAP[nid];
        if (n && (n.my_side || 2) === 2) {
          // 裏なら flip → 表に切り替わってから inline edit
          flipNote(nid).then(() => enterInlineEdit(nid, null)).catch(() => {});
        } else {
          enterInlineEdit(nid, null);
        }
      } else {
        TAP.noteId = nid; TAP.ts = now;
      }
    }
  });

  // wheel = zoom
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.0015);
    zoomAtScreen(e.clientX, e.clientY, VIEW.scale * factor);
  }, { passive: false });
}

function zoomAtScreen(sx, sy, newScale) {
  const s = Math.max(0.1, Math.min(4, newScale));
  const rect = document.getElementById('miro-viewport').getBoundingClientRect();
  const px = sx - rect.left, py = sy - rect.top;
  const wx = (px - VIEW.tx) / VIEW.scale;
  const wy = (py - VIEW.ty) / VIEW.scale;
  VIEW.scale = s;
  VIEW.tx = px - wx * s;
  VIEW.ty = py - wy * s;
  applyTransform();
}

function wireToolbar() {
  document.getElementById('miro-add').addEventListener('click', createNoteAtCenter);
  document.getElementById('miro-zoom-in').addEventListener('click', () => {
    const vp = document.getElementById('miro-viewport');
    zoomAtScreen(vp.clientWidth / 2 + vp.getBoundingClientRect().left,
                 vp.clientHeight / 2 + vp.getBoundingClientRect().top,
                 VIEW.scale * 1.2);
  });
  document.getElementById('miro-zoom-out').addEventListener('click', () => {
    const vp = document.getElementById('miro-viewport');
    zoomAtScreen(vp.clientWidth / 2 + vp.getBoundingClientRect().left,
                 vp.clientHeight / 2 + vp.getBoundingClientRect().top,
                 VIEW.scale / 1.2);
  });
  document.getElementById('miro-zoom-fit').addEventListener('click', () => { fitAll(); });
  // palette (デフォルト色)
  document.querySelectorAll('#miro-palette .mpal').forEach(el => {
    el.addEventListener('click', async () => {
      MY_DEFAULT_COLOR = el.dataset.color;
      highlightPalette();
      try {
        await put('/api/miro/default-color', { color: MY_DEFAULT_COLOR });
        toast('デフォルト色を保存 (' + MY_DEFAULT_COLOR + ')');
      } catch (_) {}
    });
  });
}

function highlightPalette() {
  document.querySelectorAll('#miro-palette .mpal').forEach(el => {
    el.style.borderColor = (el.dataset.color === MY_DEFAULT_COLOR) ? '#4a106d' : 'transparent';
  });
}

// ─── rendering ────────────────────────────────────────────────

// v1103 中村さん指示: 編集モーダルは廃止、ダブルタップでその場に textarea を出す。
//   裏面は書けない (デフォは裏 = 隠し)、Flip ボタンで表を出す。
//   単発タップは何もしない (フリップは 🔄 ボタン)。
let EDITING_NOTE_ID = null;  // 現在インライン編集中の note.id
let EDITING_ORIG    = '';    // Esc で戻す用の元テキスト

function renderAll() {
  const layer = document.getElementById('miro-layer');
  if (!layer) return;
  applyTransform();
  // z_index でソート
  const sorted = [...Object.values(NOTE_MAP)].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
  // 編集中ノートの現在値を保存 (再描画で消えるので後で戻す)。 EDITING_NOTE_ID を
  //   一時的に null にして innerHTML 破棄で起きる blur を空振りさせる (自動 commit で
  //   空文字が保存されないように)。後で復元 + snapshot 付き enterInlineEdit する。
  let editingSnapshot = null;
  const wasEditing = EDITING_NOTE_ID;
  if (wasEditing) {
    const ta = document.querySelector(`.mnote[data-id="${wasEditing}"] .mnote-editta`);
    if (ta) editingSnapshot = { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
    EDITING_NOTE_ID = null;
  }
  layer.innerHTML = sorted.map(noteHtml).join('');
  layer.querySelectorAll('[data-flip-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      flipNote(parseInt(el.dataset.flipId, 10));
    });
  });
  layer.querySelectorAll('[data-genimg-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openImagePromptFor(parseInt(el.dataset.genimgId, 10));
    });
  });
  layer.querySelectorAll('[data-clearimg-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      clearImageFor(parseInt(el.dataset.clearimgId, 10));
    });
  });
  layer.querySelectorAll('[data-color-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorPop(parseInt(el.dataset.colorId, 10), el);
    });
  });
  layer.querySelectorAll('[data-del-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(parseInt(el.dataset.delId, 10));
    });
  });
  // 編集中だった場合は再度 textarea を立て、値と選択位置を復元
  if (wasEditing && NOTE_MAP[wasEditing]) {
    enterInlineEdit(wasEditing, editingSnapshot);
  }
}

function noteHtml(n) {
  const side = n.my_side || 2;
  const bg = escapeHtml(n.color || '#FEF9A8');
  const isBack = side === 2;
  // ヘッダ: 裏なら Flip のみ (書けない、色/画像/削除も裏でいじる意味薄い)。表なら全部出す。
  const header = isBack
    ? `<div style="display:flex; gap:2px; align-items:center; font-size:11px; color:#4b5563; opacity:0.75">
         <span>🌒 ウラ</span>
         <span style="margin-left:auto"></span>
         <button data-flip-id="${n.id}" style="border:none; background:transparent; cursor:pointer; padding:2px 4px; font-size:14px" title="表を出す">🔄</button>
         <button data-del-id="${n.id}" style="border:none; background:transparent; cursor:pointer; padding:2px 4px; font-size:12px" title="削除">🗑</button>
       </div>`
    : `<div style="display:flex; gap:2px; align-items:center; font-size:11px; color:#4b5563; opacity:0.85">
         <span>🌅 オモテ</span>
         <span style="margin-left:auto"></span>
         <button data-color-id="${n.id}" style="border:none; background:transparent; cursor:pointer; padding:2px 4px; font-size:14px" title="色を変える">🎨</button>
         <button data-genimg-id="${n.id}" style="border:none; background:transparent; cursor:pointer; padding:2px 4px; font-size:14px" title="AI 画像を生成">🖼</button>
         ${n.front_image_url ? `<button data-clearimg-id="${n.id}" style="border:none; background:transparent; cursor:pointer; padding:2px 4px; font-size:12px" title="画像を消す">🚫</button>` : ''}
         <button data-flip-id="${n.id}" style="border:none; background:transparent; cursor:pointer; padding:2px 4px; font-size:14px" title="裏返す">🔄</button>
         <button data-del-id="${n.id}" style="border:none; background:transparent; cursor:pointer; padding:2px 4px; font-size:12px" title="削除">🗑</button>
       </div>`;
  // ボディ: 裏なら装飾のみ、表なら text + image
  let body;
  if (isBack) {
    body = `<div class="mnote-body" style="flex:1; display:flex; align-items:center; justify-content:center; font-size:32px; color:rgba(0,0,0,0.15); font-weight:800; letter-spacing:0.2em; user-select:none">? ? ?</div>`;
  } else {
    const img = n.front_image_url;
    const imgBlock = img ? `<img src="${escapeHtml(img)}" style="max-width:100%; max-height:70%; object-fit:contain; border-radius:4px; margin-bottom:4px" alt="">` : '';
    body = `<div class="mnote-body" style="flex:1; overflow:auto; font-size:14px; white-space:pre-wrap; word-break:break-word; padding-top:4px; display:flex; flex-direction:column">
              ${imgBlock}
              <div class="mnote-text">${escapeHtml(n.front_text || '')}</div>
            </div>`;
  }
  return `
    <div class="mnote" data-id="${n.id}" data-side="${side}"
         style="position:absolute; left:${n.x}px; top:${n.y}px; width:${n.width}px; height:${n.height}px;
                background:${bg}; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.15);
                transform:rotate(${n.rotation || 0}deg); transform-origin:center; padding:8px;
                display:flex; flex-direction:column; user-select:none; touch-action:none; cursor:grab;
                box-sizing:border-box; font-family:'Segoe UI', system-ui, sans-serif">
      ${header}
      ${body}
      <div class="mhandle" style="position:absolute; right:0; bottom:0; width:16px; height:16px; cursor:nwse-resize; background:linear-gradient(135deg, transparent 40%, rgba(0,0,0,0.25) 50%, transparent 60%)"></div>
    </div>
  `;
}

// ─── actions ──────────────────────────────────────────────────

async function createNoteAtCenter() {
  const vp = document.getElementById('miro-viewport');
  const cx = vp.clientWidth / 2, cy = vp.clientHeight / 2;
  const rect = vp.getBoundingClientRect();
  const world = screenToWorld(rect.left + cx, rect.top + cy);
  try {
    const r = await post(`/api/miro/rooms/${ROOM_ID}/notes`, {
      x: world.x - 110, y: world.y - 110,
      width: 220, height: 220,
      color: MY_DEFAULT_COLOR,
      front_text: '',
    });
    NOTE_MAP[r.id] = r.note;
    NOTES = Object.values(NOTE_MAP);
    renderAll();
  } catch (e) { toast('追加失敗: ' + e.message); }
}

async function bringToFront(id) {
  try {
    const r = await patch(`/api/miro/notes/${id}`, { z_bump: true });
    if (r.note) NOTE_MAP[id].z_index = r.note.z_index;
  } catch (_) {}
}

async function flipNote(id) {
  try {
    const r = await post(`/api/miro/notes/${id}/flip`, {});
    if (NOTE_MAP[id]) NOTE_MAP[id].my_side = r.my_side;
    renderAll();
  } catch (e) { toast('反転失敗: ' + e.message); }
}

// ─── inline text edit (v1103, replaces modal) ─────────────────

function enterInlineEdit(id, snapshot) {
  const n = NOTE_MAP[id]; if (!n) return;
  const el = document.querySelector(`.mnote[data-id="${id}"]`);
  if (!el) return;
  EDITING_NOTE_ID = id;
  EDITING_ORIG = n.front_text || '';
  const body = el.querySelector('.mnote-body');
  if (!body) return;
  // 画像は残しつつ、テキスト部分だけを textarea に差し替え
  const imgHtml = n.front_image_url
    ? `<img src="${escapeHtml(n.front_image_url)}" style="max-width:100%; max-height:60%; object-fit:contain; border-radius:4px; margin-bottom:4px" alt="">`
    : '';
  body.style.overflow = 'hidden';
  body.innerHTML = `
    ${imgHtml}
    <textarea class="mnote-editta" placeholder="ここに書く…"
      style="flex:1; width:100%; box-sizing:border-box; border:none; outline:none; background:transparent;
             resize:none; font-size:14px; font-family:inherit; padding:0; color:inherit; user-select:text"
      >${escapeHtml(snapshot ? snapshot.value : (n.front_text || ''))}</textarea>
    <div class="hint-sm" style="font-size:10px; color:#6b7280; margin-top:2px; opacity:0.7">Enter で改行 / Esc で取消 / 外をタップで保存</div>
  `;
  const ta = body.querySelector('.mnote-editta');
  ta.focus();
  if (snapshot) {
    try { ta.setSelectionRange(snapshot.start, snapshot.end); } catch (_) {}
  } else {
    // 末尾にキャレット
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {}
  }
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit();
    }
  });
  // ドラッグを起こさないよう pointer 系をここで stop
  ['pointerdown','pointerup','pointermove','wheel','click'].forEach(evt => {
    ta.addEventListener(evt, (e) => e.stopPropagation());
  });
  ta.addEventListener('blur', () => {
    if (EDITING_NOTE_ID === id) commitInlineEdit();
  });
}

async function commitInlineEdit() {
  const id = EDITING_NOTE_ID;
  if (!id) return;
  const el = document.querySelector(`.mnote[data-id="${id}"] .mnote-editta`);
  const v  = el ? el.value : '';
  EDITING_NOTE_ID = null;
  if (v === EDITING_ORIG) { renderAll(); return; }   // 差分なし
  try {
    const r = await patch(`/api/miro/notes/${id}`, { front_text: v });
    if (r.note && NOTE_MAP[id]) {
      Object.assign(NOTE_MAP[id], r.note, { my_side: NOTE_MAP[id].my_side });
    }
  } catch (e) { toast('保存失敗: ' + e.message); }
  renderAll();
}
function cancelInlineEdit() {
  EDITING_NOTE_ID = null;
  renderAll();
}

async function deleteNote(id) {
  if (!confirm('このノートを削除するよ?')) return;
  try {
    await del(`/api/miro/notes/${id}`);
    delete NOTE_MAP[id];
    NOTES = Object.values(NOTE_MAP);
    renderAll();
  } catch (e) { toast('削除失敗: ' + e.message); }
}

async function clearImageFor(id) {
  try {
    const r = await patch(`/api/miro/notes/${id}`, { front_image_url: '' });
    if (r.note && NOTE_MAP[id]) {
      Object.assign(NOTE_MAP[id], r.note, { my_side: NOTE_MAP[id].my_side });
    }
    renderAll();
  } catch (e) { toast('画像消し失敗: ' + e.message); }
}

// ─── color popover ────────────────────────────────────────────

let COLOR_POP_NOTE_ID = null;

function openColorPop(id, anchorEl) {
  COLOR_POP_NOTE_ID = id;
  const pop = document.getElementById('miro-color-pop');
  const r = anchorEl.getBoundingClientRect();
  pop.style.display = 'flex';
  pop.style.left = Math.max(4, r.left) + 'px';
  pop.style.top  = (r.bottom + 4) + 'px';
  // 現在色を強調
  const cur = NOTE_MAP[id]?.color || '#FEF9A8';
  pop.querySelectorAll('.mcolor-pop').forEach(el => {
    el.style.borderColor = (el.dataset.color === cur) ? '#4a106d' : 'transparent';
    el.onclick = async (e) => {
      e.stopPropagation();
      const newColor = el.dataset.color;
      pop.style.display = 'none';
      try {
        const rr = await patch(`/api/miro/notes/${id}`, { color: newColor });
        if (rr.note && NOTE_MAP[id]) {
          Object.assign(NOTE_MAP[id], rr.note, { my_side: NOTE_MAP[id].my_side });
        }
        renderAll();
      } catch (err) { toast('色変更失敗: ' + err.message); }
    };
  });
  // 外クリックで閉じる (1 回だけ)
  setTimeout(() => {
    const off = (e) => {
      if (!pop.contains(e.target)) {
        pop.style.display = 'none';
        document.removeEventListener('pointerdown', off, true);
      }
    };
    document.addEventListener('pointerdown', off, true);
  }, 0);
}

// ─── image gen prompt (per note, front side only) ─────────────

let PROMPT_NOTE_ID = null;

function openImagePromptFor(id) {
  PROMPT_NOTE_ID = id;
  const n = NOTE_MAP[id]; if (!n) return;
  document.getElementById('mprompt-side-label').textContent = 'オモテ';
  document.getElementById('mprompt-text').value = '';
  document.getElementById('miro-prompt-modal').style.display = 'flex';
  const close = () => { document.getElementById('miro-prompt-modal').style.display = 'none'; PROMPT_NOTE_ID = null; };
  document.getElementById('mprompt-cancel').onclick = close;
  document.getElementById('mprompt-go').onclick = async () => {
    const prompt = document.getElementById('mprompt-text').value.trim();
    if (!prompt) { toast('プロンプトを書いてね'); return; }
    const btn = document.getElementById('mprompt-go');
    btn.disabled = true; btn.textContent = '生成中… (最大 2 分)';
    try {
      const r = await post(`/api/miro/notes/${PROMPT_NOTE_ID}/generate-image`, { prompt, side: 'front' });
      if (r.note && NOTE_MAP[PROMPT_NOTE_ID]) {
        Object.assign(NOTE_MAP[PROMPT_NOTE_ID], r.note, { my_side: NOTE_MAP[PROMPT_NOTE_ID].my_side });
      }
      renderAll();
      close();
      toast('画像を生成したよ');
    } catch (e) {
      toast('生成失敗: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '生成する';
    }
  };
}
