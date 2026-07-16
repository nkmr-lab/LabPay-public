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

    <!-- edit modal (front / back / color / delete) -->
    <div id="miro-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center; padding:16px">
      <div style="background:#fff; border-radius:12px; padding:16px; width:100%; max-width:520px; max-height:90vh; overflow-y:auto; display:flex; flex-direction:column; gap:10px">
        <div class="row" style="align-items:center; gap:8px">
          <div style="font-weight:700; font-size:15px; flex:1">🗒 ノートを編集</div>
          <button class="btn" id="mmodal-close">×</button>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center">
          <span style="font-size:12px; color:#6b7280">色</span>
          ${PALETTE.map(c => `<button class="mmodal-color" data-color="${c}" style="width:26px; height:26px; border-radius:6px; border:2px solid transparent; background:${c}; padding:0; cursor:pointer"></button>`).join('')}
        </div>
        <div>
          <div style="font-weight:600; font-size:13px; margin-bottom:4px">🌅 オモテ (front)</div>
          <textarea id="mmodal-front-text" rows="4" placeholder="表側の文字" style="width:100%; box-sizing:border-box"></textarea>
          <div id="mmodal-front-image" style="margin-top:6px"></div>
          <div class="row" style="gap:4px; margin-top:4px">
            <button class="btn" data-genimg="front">🎨 画像生成 (表)</button>
            <button class="btn" data-clearimg="front" style="font-size:11px">画像を消す</button>
          </div>
        </div>
        <div>
          <div style="font-weight:600; font-size:13px; margin-bottom:4px">🌒 ウラ (back)</div>
          <textarea id="mmodal-back-text" rows="4" placeholder="裏側の文字" style="width:100%; box-sizing:border-box"></textarea>
          <div id="mmodal-back-image" style="margin-top:6px"></div>
          <div class="row" style="gap:4px; margin-top:4px">
            <button class="btn" data-genimg="back">🎨 画像生成 (裏)</button>
            <button class="btn" data-clearimg="back" style="font-size:11px">画像を消す</button>
          </div>
        </div>
        <div class="row" style="gap:6px; justify-content:space-between; margin-top:6px">
          <button class="btn" id="mmodal-delete" style="color:#b91c1c">🗑 削除</button>
          <div class="row" style="gap:6px">
            <button class="btn" id="mmodal-cancel">キャンセル</button>
            <button class="btn primary" id="mmodal-save">保存</button>
          </div>
        </div>
      </div>
    </div>

    <!-- prompt modal for image gen -->
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
        // ドラッグ中の自分の対象だと弾く (自分の上書き防止)
        if (DRAG.noteId === n.id) continue;
        // 自分の side は保持 (サーバは 1 で返すけど、サーバの my_side は正)
        NOTE_MAP[n.id] = n;
        dirty = true;
      }
      for (const id of d.deletes || []) {
        if (NOTE_MAP[id]) { delete NOTE_MAP[id]; dirty = true; }
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
    try { vp.setPointerCapture(e.pointerId); } catch (_) {}
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
      // v1101 タップ (移動なし): 300 ms 以内に同じノートをもう一度タップ
      //   → ダブルタップ扱いで編集モーダルを開く (flip はキャンセル)。
      //   単発タップ = flip は 300 ms 待ってから実行。
      const now = Date.now();
      if (TAP.noteId === nid && (now - TAP.ts) < DBLTAP_MS) {
        if (TAP.flipTimer) { clearTimeout(TAP.flipTimer); TAP.flipTimer = null; }
        TAP.noteId = null; TAP.ts = 0;
        openEditModal(nid);
      } else {
        TAP.noteId = nid; TAP.ts = now;
        if (TAP.flipTimer) clearTimeout(TAP.flipTimer);
        TAP.flipTimer = setTimeout(() => {
          TAP.flipTimer = null;
          flipNote(nid).catch(() => {});
        }, DBLTAP_MS);
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

function renderAll() {
  const layer = document.getElementById('miro-layer');
  if (!layer) return;
  applyTransform();
  // z_index でソート
  const sorted = [...Object.values(NOTE_MAP)].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
  layer.innerHTML = sorted.map(noteHtml).join('');
  layer.querySelectorAll('.mnote-edit').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(parseInt(el.dataset.editId, 10));
    });
  });
  layer.querySelectorAll('.mnote-flip').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      flipNote(parseInt(el.dataset.flipId, 10));
    });
  });
}

function noteHtml(n) {
  const side = n.my_side || 1;
  const text = side === 2 ? (n.back_text || '') : (n.front_text || '');
  const img  = side === 2 ? n.back_image_url : n.front_image_url;
  const sideMark = side === 2 ? '🌒 ウラ' : '🌅 オモテ';
  const bg = escapeHtml(n.color || '#FEF9A8');
  const imgBlock = img ? `<img src="${escapeHtml(img)}" style="max-width:100%; max-height:60%; object-fit:contain; border-radius:4px; margin-bottom:4px" alt="">` : '';
  return `
    <div class="mnote" data-id="${n.id}"
         style="position:absolute; left:${n.x}px; top:${n.y}px; width:${n.width}px; height:${n.height}px;
                background:${bg}; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.15);
                transform:rotate(${n.rotation || 0}deg); transform-origin:center; padding:8px;
                display:flex; flex-direction:column; user-select:none; touch-action:none; cursor:grab;
                box-sizing:border-box; font-family:'Segoe UI', system-ui, sans-serif">
      <div style="display:flex; gap:4px; align-items:center; font-size:10px; color:#4b5563; opacity:0.8">
        <span>${sideMark}</span>
        <span style="margin-left:auto"></span>
        <button class="mnote-flip" data-flip-id="${n.id}" style="border:none; background:transparent; cursor:pointer; padding:2px 4px; font-size:12px" title="裏返す">🔄</button>
        <button class="mnote-edit" data-edit-id="${n.id}" style="border:none; background:transparent; cursor:pointer; padding:2px 4px; font-size:12px" title="編集">✏️</button>
      </div>
      <div class="mnote-body" style="flex:1; overflow:auto; font-size:14px; white-space:pre-wrap; word-break:break-word; padding-top:4px; display:flex; flex-direction:column">
        ${imgBlock}
        <div>${escapeHtml(text)}</div>
      </div>
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

// ─── edit modal ───────────────────────────────────────────────

let MODAL_NOTE_ID = null;
let MODAL_COLOR = '#FEF9A8';
let MODAL_FRONT_IMG = null;
let MODAL_BACK_IMG  = null;

function openEditModal(id) {
  const n = NOTE_MAP[id]; if (!n) return;
  MODAL_NOTE_ID = id;
  MODAL_COLOR = n.color || '#FEF9A8';
  MODAL_FRONT_IMG = n.front_image_url || null;
  MODAL_BACK_IMG  = n.back_image_url  || null;
  document.getElementById('mmodal-front-text').value = n.front_text || '';
  document.getElementById('mmodal-back-text').value  = n.back_text  || '';
  refreshModalColors();
  refreshModalImages();
  document.getElementById('miro-modal').style.display = 'flex';
  // wire once (uses live refs so re-wiring OK — replace listeners each open)
  const close = () => { document.getElementById('miro-modal').style.display = 'none'; MODAL_NOTE_ID = null; };
  document.getElementById('mmodal-close').onclick  = close;
  document.getElementById('mmodal-cancel').onclick = close;
  document.getElementById('mmodal-save').onclick   = async () => {
    const body = {
      color:      MODAL_COLOR,
      front_text: document.getElementById('mmodal-front-text').value,
      back_text:  document.getElementById('mmodal-back-text').value,
      front_image_url: MODAL_FRONT_IMG || '',
      back_image_url:  MODAL_BACK_IMG  || '',
    };
    try {
      const r = await patch(`/api/miro/notes/${MODAL_NOTE_ID}`, body);
      if (r.note) NOTE_MAP[MODAL_NOTE_ID] = { ...NOTE_MAP[MODAL_NOTE_ID], ...r.note, my_side: NOTE_MAP[MODAL_NOTE_ID].my_side };
      renderAll();
      close();
    } catch (e) { toast('保存失敗: ' + e.message); }
  };
  document.getElementById('mmodal-delete').onclick = async () => {
    if (!confirm('このノートを削除するよ?')) return;
    try {
      await del(`/api/miro/notes/${MODAL_NOTE_ID}`);
      delete NOTE_MAP[MODAL_NOTE_ID];
      NOTES = Object.values(NOTE_MAP);
      renderAll();
      close();
    } catch (e) { toast('削除失敗: ' + e.message); }
  };
  document.querySelectorAll('.mmodal-color').forEach(el => {
    el.onclick = () => { MODAL_COLOR = el.dataset.color; refreshModalColors(); };
  });
  document.querySelectorAll('[data-genimg]').forEach(el => {
    el.onclick = () => openPromptModal(el.dataset.genimg);
  });
  document.querySelectorAll('[data-clearimg]').forEach(el => {
    el.onclick = () => {
      if (el.dataset.clearimg === 'front') MODAL_FRONT_IMG = null;
      else MODAL_BACK_IMG = null;
      refreshModalImages();
    };
  });
}

function refreshModalColors() {
  document.querySelectorAll('.mmodal-color').forEach(el => {
    el.style.borderColor = (el.dataset.color === MODAL_COLOR) ? '#4a106d' : 'transparent';
  });
}
function refreshModalImages() {
  const f = document.getElementById('mmodal-front-image');
  const b = document.getElementById('mmodal-back-image');
  f.innerHTML = MODAL_FRONT_IMG
    ? `<img src="${escapeHtml(MODAL_FRONT_IMG)}" style="max-width:100%; max-height:160px; border-radius:6px; border:1px solid #e5e7eb">`
    : `<div class="hint-sm" style="font-size:11px; color:#9ca3af">まだ画像なし</div>`;
  b.innerHTML = MODAL_BACK_IMG
    ? `<img src="${escapeHtml(MODAL_BACK_IMG)}" style="max-width:100%; max-height:160px; border-radius:6px; border:1px solid #e5e7eb">`
    : `<div class="hint-sm" style="font-size:11px; color:#9ca3af">まだ画像なし</div>`;
}

// ─── prompt modal for image gen ───────────────────────────────

let PROMPT_SIDE = 'front';

function openPromptModal(side) {
  PROMPT_SIDE = side;
  document.getElementById('mprompt-side-label').textContent = side === 'back' ? 'ウラ' : 'オモテ';
  document.getElementById('mprompt-text').value = '';
  document.getElementById('miro-prompt-modal').style.display = 'flex';
  const close = () => { document.getElementById('miro-prompt-modal').style.display = 'none'; };
  document.getElementById('mprompt-cancel').onclick = close;
  document.getElementById('mprompt-go').onclick = async () => {
    const prompt = document.getElementById('mprompt-text').value.trim();
    if (!prompt) { toast('プロンプトを書いてね'); return; }
    if (!MODAL_NOTE_ID) return;
    const btn = document.getElementById('mprompt-go');
    btn.disabled = true; btn.textContent = '生成中… (最大 2 分)';
    try {
      const r = await post(`/api/miro/notes/${MODAL_NOTE_ID}/generate-image`, { prompt, side: PROMPT_SIDE });
      if (PROMPT_SIDE === 'front') MODAL_FRONT_IMG = r.image_url;
      else                          MODAL_BACK_IMG  = r.image_url;
      if (r.note && NOTE_MAP[MODAL_NOTE_ID]) {
        Object.assign(NOTE_MAP[MODAL_NOTE_ID], r.note, { my_side: NOTE_MAP[MODAL_NOTE_ID].my_side });
      }
      refreshModalImages();
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
