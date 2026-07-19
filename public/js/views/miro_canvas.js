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
// v1104 他人カーソル (user_id → {x, y, name, avatar, ts, seen}) + 送信スロットル
let CURSORS = {};
let MY_CURSOR = { x: 0, y: 0 };
let CURSOR_POST_TIMER = null;
let CURSOR_LAST_POSTED = 0;
let CURSOR_POST_ANIM = null;
// v1104 ミニマップの開閉
let MINIMAP_OPEN = true;

export async function renderMiroCanvas({ params }) {
  ROOM_ID = parseInt(params?.id, 10);
  if (!ROOM_ID) { navigate('/board'); return; }
  const app = document.getElementById('app');
  app.innerHTML = shellHtml();
  // v1104 miro モードは画面いっぱいで使いたい (トップバー / タブバーを隠す)
  const topbar = document.getElementById('topbar');
  const tabs   = document.getElementById('tabs');
  const wasTopHidden = topbar ? topbar.hidden : true;
  const wasTabsHidden = tabs ? tabs.hidden : true;
  if (topbar) topbar.style.display = 'none';
  if (tabs)   tabs.style.display   = 'none';
  wireToolbar();
  wireCanvas();
  await loadInitial();
  startPolling();
  LEAVE_HANDLER = () => {
    stopPolling();
    if (topbar) topbar.style.display = wasTopHidden  ? '' : '';
    if (tabs)   tabs.style.display   = wasTabsHidden ? '' : '';
    // display を消せば hidden 属性の元制御に戻る
    if (topbar) topbar.style.removeProperty('display');
    if (tabs)   tabs.style.removeProperty('display');
  };
  window.addEventListener('hashchange', LEAVE_HANDLER, { once: true });
}

function shellHtml() {
  return `
    <style>
      #miro-shell .mnote-body::-webkit-scrollbar,
      #miro-shell .mnote-editta::-webkit-scrollbar { display:none }
      #miro-shell .mnote-body,
      #miro-shell .mnote-editta { scrollbar-width:none; -ms-overflow-style:none }
    </style>
    <div id="miro-shell" style="position:fixed; top:0; left:0; right:0; bottom:0; width:100vw; height:100vh; display:flex; flex-direction:column; background:#fafafa; z-index:100">
      <!-- toolbar -->
      <div id="miro-toolbar" style="display:flex; gap:6px; align-items:center; padding:6px 10px; background:#fff; border-bottom:1px solid #e5e7eb; flex-wrap:wrap">
        <a href="#/board" class="hint" style="text-decoration:none; padding:4px 8px">← 部屋一覧</a>
        <div id="miro-title" style="font-weight:700; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">…</div>
        <button class="btn" id="miro-add" title="ノートを追加">➕ ノート</button>
        <button class="btn" id="miro-refs" title="自分の文献ストックから貼る">📚 論文</button>
        <button class="btn" id="miro-places" title="食べある記から貼る (画像主体)">🍜 食べある記</button>
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
        <!-- v1104 他人カーソルオーバーレイ (screen 座標、変形しないので上のレイヤ) -->
        <div id="miro-cursors" style="position:absolute; inset:0; pointer-events:none; overflow:hidden"></div>
        <!-- v1104 minimap: 右下に全体マップ (ノート = 小さい色付き矩形、現在視野 = 枠) -->
        <div id="miro-minimap" style="position:absolute; right:10px; bottom:10px; width:180px; height:130px; background:rgba(255,255,255,0.92); border:1px solid #d1d5db; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.12); overflow:hidden; touch-action:none; cursor:pointer; z-index:5">
          <svg id="miro-minimap-svg" width="180" height="130" viewBox="0 0 180 130" style="display:block"></svg>
          <button id="miro-minimap-toggle" title="ミニマップを閉じる" style="position:absolute; right:2px; top:2px; width:18px; height:18px; padding:0; border:none; background:rgba(0,0,0,0.05); border-radius:4px; font-size:11px; line-height:1; cursor:pointer">×</button>
        </div>
        <button id="miro-minimap-open" title="ミニマップを開く" style="display:none; position:absolute; right:10px; bottom:10px; width:38px; height:38px; padding:0; border:1px solid #d1d5db; background:rgba(255,255,255,0.92); border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.12); font-size:18px; cursor:pointer; z-index:5">🗺</button>
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

    <!-- v1110 refs ピッカー (📚 から開く、検索 + チェックリスト) -->
    <div id="miro-refs-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10001; align-items:center; justify-content:center; padding:16px">
      <div style="background:#fff; border-radius:12px; padding:14px; width:100%; max-width:600px; max-height:90vh; display:flex; flex-direction:column; gap:8px">
        <div class="row" style="align-items:center; gap:8px">
          <div style="font-weight:700; flex:1">📚 文献ストックから貼る</div>
          <button class="btn" id="mrefs-close">×</button>
        </div>
        <div class="row" style="gap:6px">
          <input type="text" id="mrefs-q" placeholder="タイトル / 著者 / venue で絞り込み" style="flex:1; padding:6px 8px">
        </div>
        <div id="mrefs-list" style="flex:1; overflow-y:auto; border:1px solid #e5e7eb; border-radius:6px; padding:6px; min-height:200px; max-height:50vh">
          <div class="muted">読み込み中…</div>
        </div>
        <div class="row" style="gap:6px; align-items:center; justify-content:space-between">
          <div class="hint-sm" id="mrefs-count" style="font-size:12px; color:#6b7280">0 件選択中</div>
          <div class="row" style="gap:6px">
            <button class="btn" id="mrefs-cancel">キャンセル</button>
            <button class="btn primary" id="mrefs-go" disabled>選んだ論文を貼る</button>
          </div>
        </div>
      </div>
    </div>

    <!-- v1171 places ピッカー (🍜 から開く、サムネイルグリッド) -->
    <div id="miro-places-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10001; align-items:center; justify-content:center; padding:16px">
      <div style="background:#fff; border-radius:12px; padding:14px; width:100%; max-width:720px; max-height:90vh; display:flex; flex-direction:column; gap:8px">
        <div class="row" style="align-items:center; gap:8px">
          <div style="font-weight:700; flex:1">🍜 食べある記から貼る</div>
          <button class="btn" id="mplc-close">×</button>
        </div>
        <div class="row" style="gap:6px">
          <input type="text" id="mplc-q" placeholder="店名 / カテゴリで絞り込み" style="flex:1; padding:6px 8px">
        </div>
        <div id="mplc-grid" style="flex:1; overflow-y:auto; border:1px solid #e5e7eb; border-radius:6px; padding:6px; min-height:220px; max-height:50vh; display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:6px">
          <div class="muted">読み込み中…</div>
        </div>
        <div class="row" style="gap:6px; align-items:center; justify-content:space-between">
          <div class="hint-sm" id="mplc-count" style="font-size:12px; color:#6b7280">0 件選択中</div>
          <div class="row" style="gap:6px">
            <button class="btn" id="mplc-cancel">キャンセル</button>
            <button class="btn primary" id="mplc-go" disabled>選んだ店を貼る</button>
          </div>
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
    // v1104 初回カーソル
    const nowMs = Date.now();
    CURSORS = {};
    for (const c of (d.cursors || [])) CURSORS[c.user_id] = { ...c, seen: nowMs };
    // 初回は中央にフィット
    fitAll();
    // マウス未動作時のオフスクリーン距離表示用に、初期カーソルを視野中央 world 座標に
    const vp = document.getElementById('miro-viewport');
    const mid = screenToWorld(vp.getBoundingClientRect().left + vp.clientWidth / 2,
                              vp.getBoundingClientRect().top  + vp.clientHeight / 2);
    MY_CURSOR.x = mid.x; MY_CURSOR.y = mid.y;
    renderAll();
    renderCursors();
    renderMinimap();
    wireMinimap();
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
      // v1104 他人カーソルを取り込む (poll ごとに全リフレッシュ、シンプル)
      const nowMs = Date.now();
      const nextCursors = {};
      for (const c of d.cursors || []) nextCursors[c.user_id] = { ...c, seen: nowMs };
      CURSORS = nextCursors;
      renderCursors();
      renderMinimap();
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
  // v1104 視野が変わったらカーソル位置とミニマップの視野枠も動かす
  renderCursors();
  renderMinimap();
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
    // v1104 自分のカーソル位置 (world 座標) を常時追跡してスロットル送信
    const w = screenToWorld(e.clientX, e.clientY);
    MY_CURSOR.x = w.x; MY_CURSOR.y = w.y;
    scheduleCursorPost();
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
      // v1108 タップの解釈:
      //   ・他人が隠している note: 何もしない (中身も見えないので編集不可)
      //   ・それ以外: ダブルタップでインライン編集 (誰でも OK、LabPay の共同編集モデル)
      const n = NOTE_MAP[nid];
      if (n && !n.hidden_for_me) {
        const now = Date.now();
        if (TAP.noteId === nid && (now - TAP.ts) < DBLTAP_MS) {
          TAP.noteId = null; TAP.ts = 0;
          enterInlineEdit(nid, null);
        } else {
          TAP.noteId = nid; TAP.ts = now;
        }
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
  document.getElementById('miro-refs').addEventListener('click', openRefsPicker);
  document.getElementById('miro-places').addEventListener('click', openPlacesPicker);
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
  const bg = escapeHtml(n.color || '#FEF9A8');
  // v1108 セマンティクス変更:
  //   is_hidden は note 単位 (作成者だけが 🙈 / 👀 で切替)。
  //   hidden_for_me = 他人が見た時に隠し状態として表示すべきか (server 計算)。
  //   自分の is_hidden な note は自分にはずっと表 (front_text 見える)、破線ボーダ +
  //   「🙈 自分だけ」バッジで「他人には見えてないよ」を明示。
  const hiddenForMe = !!n.hidden_for_me;
  const isMine     = !!n.is_mine;
  const isHidden   = !!n.is_hidden;
  const btnStyle = 'border:none; background:rgba(255,255,255,0.35); cursor:pointer; padding:3px 8px; font-size:15px; border-radius:5px; line-height:1';
  const btnDanger = btnStyle + '; color:#991b1b';

  let header;
  if (hiddenForMe) {
    const cname = escapeHtml(n.creator_name || 'だれか');
    header = `<div style="display:flex; gap:4px; align-items:center; font-size:11px; color:#4b5563">
      <span style="opacity:0.7">${cname} が隠しています</span>
      <span style="margin-left:auto"></span>
    </div>`;
  } else {
    const flipBtn = isMine
      ? (isHidden
          ? `<button data-flip-id="${n.id}" style="${btnStyle}" title="みんなに公開する (今は自分だけ見える)">👀</button>`
          : `<button data-flip-id="${n.id}" style="${btnStyle}" title="自分だけ見えるようにする">🙈</button>`)
      : '';
    const badge = (isMine && isHidden)
      ? `<span style="font-size:10px; color:#7c3aed; font-weight:700; background:rgba(124,58,237,0.10); padding:1px 6px; border-radius:4px" title="他の人には裏が見えています">🙈 自分だけ</span>`
      : '';
    header = `<div style="display:flex; gap:4px; align-items:center; font-size:11px; color:#4b5563">
       ${badge}
       <span style="margin-left:auto"></span>
       <button data-color-id="${n.id}"  style="${btnStyle}" title="色を変える">🎨</button>
       <button data-genimg-id="${n.id}" style="${btnStyle}" title="AI 画像を生成">🖼</button>
       ${n.front_image_url ? `<button data-clearimg-id="${n.id}" style="${btnStyle}" title="画像を消す">🚫</button>` : ''}
       ${flipBtn}
       <button data-del-id="${n.id}" style="${btnDanger}" title="削除">🗑</button>
     </div>`;
    // 誰でも削除可能 (LabPay の共同モデル)。 hide/show は作成者のみ (creator ownership)
  }

  let body;
  if (hiddenForMe) {
    body = `<div class="mnote-body" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; user-select:none; gap:6px; opacity:0.55">
              <div style="font-size:42px">🙈</div>
              <div style="font-size:11px; color:rgba(0,0,0,0.5); font-weight:600">隠されています</div>
            </div>`;
  } else {
    const img = n.front_image_url;
    const imgBlock = img ? `<img src="${escapeHtml(img)}" style="max-width:100%; max-height:70%; object-fit:contain; border-radius:4px; margin-bottom:4px" alt="">` : '';
    const fpx = dynamicFontSize(n.front_text || '', n.width, n.height);
    body = `<div class="mnote-body" style="flex:1; overflow:hidden; white-space:pre-wrap; word-break:break-word; padding-top:4px; display:flex; flex-direction:column">
              ${imgBlock}
              <div class="mnote-text" style="font-size:${fpx}px; line-height:1.25; text-align:center; display:flex; align-items:center; justify-content:center; flex:1">${escapeHtml(n.front_text || '')}</div>
            </div>`;
  }
  // v1109 自分だけ見えてる (= ウラ) 時の視覚ヒント: 破線ボーダー + 少しグレイアウト
  //   中村さん指示「ウラにすると、自分の画面でも少しグレイアウトしてる感じで見せて欲しい」
  const extraBorder = (isMine && isHidden) ? '; border:2px dashed rgba(124,58,237,0.55)' : '';
  const extraFilter = (isMine && isHidden) ? '; filter:saturate(0.45) opacity(0.82)' : '';
  return `
    <div class="mnote" data-id="${n.id}"
         style="position:absolute; left:${n.x}px; top:${n.y}px; width:${n.width}px; height:${n.height}px;
                background:${bg}; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.15)${extraBorder}${extraFilter};
                transform:rotate(${n.rotation || 0}deg); transform-origin:center; padding:8px;
                display:flex; flex-direction:column; user-select:none; touch-action:none; cursor:grab;
                box-sizing:border-box; font-family:'Segoe UI', system-ui, sans-serif">
      ${header}
      ${body}
      ${n.link_url && !hiddenForMe ? `<a href="${escapeHtml(n.link_url)}" class="mnote-link" data-note-link title="元ページを開く"
              onclick="event.stopPropagation()"
              onpointerdown="event.stopPropagation()"
              onmousedown="event.stopPropagation()"
              style="position:absolute; left:4px; bottom:4px; width:22px; height:22px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.85); color:#0369a1; border-radius:50%; text-decoration:none; font-size:13px; line-height:1; box-shadow:0 1px 2px rgba(0,0,0,0.15); z-index:2">🔗</a>` : ''}
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

// v1108 flip = 作成者本人が is_hidden をトグル (他人には裏に見える / 自分にはずっと見える)
async function flipNote(id) {
  try {
    const r = await post(`/api/miro/notes/${id}/flip`, {});
    if (r.note && NOTE_MAP[id]) NOTE_MAP[id] = r.note;
    renderAll();
  } catch (e) { toast('切替失敗: ' + e.message); }
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
  const initVal = snapshot ? snapshot.value : (n.front_text || '');
  const fpx = dynamicFontSize(initVal, n.width, n.height);
  body.innerHTML = `
    ${imgHtml}
    <textarea class="mnote-editta" placeholder="ここに書く…"
      style="flex:1; width:100%; box-sizing:border-box; border:none; outline:none; background:transparent;
             resize:none; overflow:hidden; scrollbar-width:none;
             font-size:${fpx}px; line-height:1.25; text-align:center; font-family:inherit; padding:0; color:inherit; user-select:text"
      >${escapeHtml(initVal)}</textarea>
    <div class="hint-sm" style="font-size:10px; color:#6b7280; margin-top:2px; opacity:0.7">Enter で改行 / Esc で取消 / 外をタップで保存</div>
  `;
  const ta = body.querySelector('.mnote-editta');
  ta.focus();
  // 入力しながらフォントサイズを再計算
  ta.addEventListener('input', () => {
    const npx = dynamicFontSize(ta.value, n.width, n.height);
    ta.style.fontSize = npx + 'px';
  });
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
      Object.assign(NOTE_MAP[id], r.note);
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
      Object.assign(NOTE_MAP[id], r.note);
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
          Object.assign(NOTE_MAP[id], rr.note);
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
        Object.assign(NOTE_MAP[PROMPT_NOTE_ID], r.note);
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

// ─── v1104 dynamic font size ──────────────────────────────────
//   文字数と note サイズから font-px を推定。少ないと大きく、多いと
//   小さく。単純にバケット + 少しだけ width で調整。
function dynamicFontSize(text, width, height) {
  const n = String(text || '').length;
  // 幅の縮小比 (基準 220px)
  const wr = Math.max(0.6, Math.min(2.0, (width || 220) / 220));
  let base;
  if (n === 0)       base = 20;
  else if (n <= 3)   base = 52;
  else if (n <= 8)   base = 38;
  else if (n <= 20)  base = 28;
  else if (n <= 50)  base = 20;
  else if (n <= 120) base = 16;
  else               base = 13;
  return Math.max(11, Math.round(base * wr));
}

// ─── v1104 cursor: throttled post + render + minimap ──────────

const CURSOR_POST_INTERVAL_MS = 200;   // 送信は 200 ms スロットル
const CURSOR_TTL_MS           = 15000; // 15 秒以内が生きてるカーソル

function scheduleCursorPost() {
  const now = Date.now();
  const dt = now - CURSOR_LAST_POSTED;
  if (dt >= CURSOR_POST_INTERVAL_MS) {
    CURSOR_LAST_POSTED = now;
    postCursor();
  } else if (!CURSOR_POST_TIMER) {
    CURSOR_POST_TIMER = setTimeout(() => {
      CURSOR_POST_TIMER = null;
      CURSOR_LAST_POSTED = Date.now();
      postCursor();
    }, CURSOR_POST_INTERVAL_MS - dt);
  }
}
function postCursor() {
  if (!ROOM_ID) return;
  post(`/api/miro/rooms/${ROOM_ID}/cursor`, { x: MY_CURSOR.x, y: MY_CURSOR.y }).catch(() => {});
}

// user_id からユニークな色を作る (HSL の hue を hash から)。
function colorForUser(uid) {
  const h = (uid * 137) % 360;
  return `hsl(${h}, 72%, 45%)`;
}

function worldToScreen(wx, wy) {
  const rect = document.getElementById('miro-viewport').getBoundingClientRect();
  return {
    x: wx * VIEW.scale + VIEW.tx,
    y: wy * VIEW.scale + VIEW.ty,
    vw: rect.width,
    vh: rect.height,
  };
}

function renderCursors() {
  const root = document.getElementById('miro-cursors');
  if (!root) return;
  const nowMs = Date.now();
  // 期限切れを間引き
  for (const uid in CURSORS) {
    if (nowMs - (CURSORS[uid].seen || 0) > CURSOR_TTL_MS) delete CURSORS[uid];
  }
  const list = Object.values(CURSORS);
  if (!list.length) { root.innerHTML = ''; return; }
  const rect = document.getElementById('miro-viewport').getBoundingClientRect();
  const vw = rect.width, vh = rect.height;
  root.innerHTML = list.map(c => {
    const s = worldToScreen(c.x, c.y);
    const col = colorForUser(c.user_id);
    const name = escapeHtml(c.name || '?');
    // 視野内: 通常のポインタアイコン + 名前ラベル
    if (s.x >= 0 && s.x <= vw && s.y >= 0 && s.y <= vh) {
      return `<div style="position:absolute; left:${s.x}px; top:${s.y}px; transform:translate(-2px,-2px); pointer-events:none">
        <svg width="18" height="24" viewBox="0 0 18 24" style="filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35))">
          <path d="M 2 2 L 2 18 L 6 14 L 9 22 L 12 21 L 9 13 L 15 13 Z" fill="${col}" stroke="#fff" stroke-width="1"/>
        </svg>
        <div style="display:inline-block; background:${col}; color:#fff; font-size:10px; padding:1px 5px; border-radius:3px; margin-left:14px; margin-top:-6px; white-space:nowrap; font-weight:600">${name}</div>
      </div>`;
    }
    // 視野外: エッジに矢印マーカー (最も近い辺)
    const cx = vw / 2, cy = vh / 2;
    const dx = s.x - cx, dy = s.y - cy;
    // 中心からの方向ベクトルを viewport 矩形と交わる点に射影
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const t = 12; // 端からのマージン
    const halfW = vw / 2 - t, halfH = vh / 2 - t;
    let ex, ey;
    if (ax * halfH > ay * halfW) {
      // 左右辺で当たる
      ex = cx + (dx > 0 ? halfW : -halfW);
      ey = cy + dy * (halfW / ax);
    } else {
      // 上下辺で当たる
      ex = cx + dx * (halfH / ay);
      ey = cy + (dy > 0 ? halfH : -halfH);
    }
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    // 距離 (world) をユーザに見せると親切
    const dist = Math.round(Math.hypot(c.x - MY_CURSOR.x, c.y - MY_CURSOR.y));
    return `<div style="position:absolute; left:${ex}px; top:${ey}px; transform:translate(-50%,-50%); pointer-events:none">
      <div style="width:22px; height:22px; border-radius:50%; background:${col}; color:#fff; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,0.3); position:relative">
        ${escapeHtml((c.name || '?').charAt(0))}
        <div style="position:absolute; left:100%; top:50%; transform:translate(-2px,-50%) rotate(${angle}deg); width:0; height:0; border-left:8px solid ${col}; border-top:5px solid transparent; border-bottom:5px solid transparent"></div>
      </div>
      <div style="text-align:center; font-size:10px; color:${col}; font-weight:700; margin-top:2px; white-space:nowrap; background:rgba(255,255,255,0.85); border-radius:3px; padding:1px 4px">${name} ${dist > 100 ? `<span style="opacity:0.6">${dist}</span>` : ''}</div>
    </div>`;
  }).join('');
}

// ─── v1104 minimap render + interaction ───────────────────────

function renderMinimap() {
  const mm = document.getElementById('miro-minimap');
  const svg = document.getElementById('miro-minimap-svg');
  const open = document.getElementById('miro-minimap-open');
  if (!mm || !svg || !open) return;
  mm.style.display = MINIMAP_OPEN ? 'block' : 'none';
  open.style.display = MINIMAP_OPEN ? 'none' : 'block';
  if (!MINIMAP_OPEN) return;
  const W = 180, H = 130, PAD = 6;
  // world 範囲 = 全ノート + 現在の視野
  const notes = Object.values(NOTE_MAP);
  const rect = document.getElementById('miro-viewport').getBoundingClientRect();
  const vw = rect.width || 800, vh = rect.height || 600;
  // 視野の world 左上・右下
  const vTL = { x: (-VIEW.tx) / VIEW.scale, y: (-VIEW.ty) / VIEW.scale };
  const vBR = { x: (vw - VIEW.tx) / VIEW.scale, y: (vh - VIEW.ty) / VIEW.scale };
  let minX = vTL.x, minY = vTL.y, maxX = vBR.x, maxY = vBR.y;
  for (const n of notes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
  }
  // カーソル位置も範囲に含める
  for (const c of Object.values(CURSORS)) {
    minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const s = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
  const ox = PAD - minX * s + ((W - PAD * 2) - spanX * s) / 2;
  const oy = PAD - minY * s + ((H - PAD * 2) - spanY * s) / 2;
  // ノート矩形
  const noteRects = notes.map(n =>
    `<rect x="${(n.x * s + ox).toFixed(1)}" y="${(n.y * s + oy).toFixed(1)}" width="${Math.max(2, n.width * s).toFixed(1)}" height="${Math.max(2, n.height * s).toFixed(1)}" fill="${escapeHtml(n.color || '#FEF9A8')}" opacity="0.85"/>`
  ).join('');
  // 他人カーソル
  const cursorDots = Object.values(CURSORS).map(c =>
    `<circle cx="${(c.x * s + ox).toFixed(1)}" cy="${(c.y * s + oy).toFixed(1)}" r="2.5" fill="${colorForUser(c.user_id)}" stroke="#fff" stroke-width="0.5"/>`
  ).join('');
  // 視野枠
  const viewRect = `<rect x="${(vTL.x * s + ox).toFixed(1)}" y="${(vTL.y * s + oy).toFixed(1)}" width="${((vBR.x - vTL.x) * s).toFixed(1)}" height="${((vBR.y - vTL.y) * s).toFixed(1)}" fill="rgba(74,16,109,0.10)" stroke="#4a106d" stroke-width="1"/>`;
  svg.innerHTML = noteRects + viewRect + cursorDots;
  // クリック → world 中心へパン
  svg.__mm_transform = { s, ox, oy };
}

function wireMinimap() {
  const svg = document.getElementById('miro-minimap-svg');
  const toggle = document.getElementById('miro-minimap-toggle');
  const opener = document.getElementById('miro-minimap-open');
  if (!svg || !toggle || !opener) return;
  const panTo = (e) => {
    const t = svg.__mm_transform; if (!t) return;
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    // 逆変換で world 座標
    const wx = (mx - t.ox) / t.s;
    const wy = (my - t.oy) / t.s;
    // wx/wy を viewport の中央に来るようにパン
    const vp = document.getElementById('miro-viewport');
    VIEW.tx = vp.clientWidth  / 2 - wx * VIEW.scale;
    VIEW.ty = vp.clientHeight / 2 - wy * VIEW.scale;
    applyTransform();
  };
  svg.addEventListener('pointerdown', (e) => { e.stopPropagation(); panTo(e); });
  svg.addEventListener('pointermove', (e) => { if (e.buttons & 1) { e.stopPropagation(); panTo(e); } });
  toggle.addEventListener('click', (e) => { e.stopPropagation(); MINIMAP_OPEN = false; renderMinimap(); });
  opener.addEventListener('click', (e) => { e.stopPropagation(); MINIMAP_OPEN = true;  renderMinimap(); });
}

// ─── v1110 refs → miro note の一括貼付 ─────────────────────────

let REFS_CACHE = [];              // 読み込んだ refs (直近クエリの結果)
const REFS_SELECTED = new Set();  // 選択中 ref_id
// v1171 places picker 用
let PLACES_CACHE = [];
const PLACES_SELECTED = new Set();

function openRefsPicker() {
  REFS_SELECTED.clear();
  const modal = document.getElementById('miro-refs-modal');
  modal.style.display = 'flex';
  document.getElementById('mrefs-close').onclick  = closeRefsPicker;
  document.getElementById('mrefs-cancel').onclick = closeRefsPicker;
  document.getElementById('mrefs-go').onclick     = commitRefsPicker;
  const q = document.getElementById('mrefs-q');
  q.value = '';
  q.oninput = debounce(() => loadRefs(q.value.trim()), 250);
  updateRefsFooter();
  loadRefs('');
}
function closeRefsPicker() {
  document.getElementById('miro-refs-modal').style.display = 'none';
}

async function loadRefs(query) {
  const root = document.getElementById('mrefs-list');
  root.innerHTML = '<div class="muted">読み込み中…</div>';
  try {
    const params = new URLSearchParams({ limit: '100', sort: 'new' });
    if (query) params.set('q', query);
    const d = await get('/api/refs?' + params.toString());
    REFS_CACHE = d.items || [];
    if (!REFS_CACHE.length) {
      root.innerHTML = '<div class="muted">見つかりませんでした。</div>';
      return;
    }
    renderRefsList();
  } catch (e) {
    root.innerHTML = `<div class="muted" style="color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function renderRefsList() {
  const root = document.getElementById('mrefs-list');
  root.innerHTML = REFS_CACHE.map(r => {
    const checked = REFS_SELECTED.has(r.id) ? 'checked' : '';
    let authors = [];
    try { authors = JSON.parse(r.authors_json || '[]'); } catch (_) {}
    const firstAuthor = authors[0]?.name || '';
    const meta = [firstAuthor && (authors.length > 1 ? firstAuthor + '+' : firstAuthor),
                  r.year || '', r.venue || ''].filter(Boolean).join(' · ');
    return `<label class="mref-row" style="display:flex; gap:6px; align-items:flex-start; padding:6px 8px; border-bottom:1px solid #f3f4f6; cursor:pointer">
      <input type="checkbox" data-ref-id="${r.id}" ${checked} style="margin-top:3px">
      <div style="flex:1; min-width:0">
        <div style="font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(r.title || '(no title)')}</div>
        <div style="font-size:11px; color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(meta)}</div>
      </div>
    </label>`;
  }).join('');
  root.querySelectorAll('input[type=checkbox]').forEach(el => {
    el.addEventListener('change', () => {
      const id = parseInt(el.dataset.refId, 10);
      if (el.checked) REFS_SELECTED.add(id); else REFS_SELECTED.delete(id);
      updateRefsFooter();
    });
  });
}

function updateRefsFooter() {
  const n = REFS_SELECTED.size;
  document.getElementById('mrefs-count').textContent = `${n} 件選択中` + (n > 50 ? ' (50 件までにしてね)' : '');
  const btn = document.getElementById('mrefs-go');
  btn.disabled = n === 0 || n > 50;
  btn.textContent = n === 0 ? '選んだ論文を貼る' : `選んだ ${n} 件を貼る`;
}

async function commitRefsPicker() {
  const ids = [...REFS_SELECTED];
  if (!ids.length) return;
  const btn = document.getElementById('mrefs-go');
  btn.disabled = true; btn.textContent = '貼っています…';
  try {
    // 現在の視野中央 (world 座標) を center に
    const vp = document.getElementById('miro-viewport');
    const rect = vp.getBoundingClientRect();
    const mid = screenToWorld(rect.left + vp.clientWidth / 2, rect.top + vp.clientHeight / 2);
    const r = await post(`/api/miro/rooms/${ROOM_ID}/notes-from-refs`, {
      ref_ids: ids,
      center_x: mid.x,
      center_y: mid.y,
    });
    for (const n of (r.notes || [])) NOTE_MAP[n.id] = n;
    NOTES = Object.values(NOTE_MAP);
    renderAll();
    toast(`${r.created} 件を貼ったよ`);
    closeRefsPicker();
  } catch (e) {
    toast('貼付失敗: ' + e.message);
    btn.disabled = false; btn.textContent = '選んだ論文を貼る';
  }
}

// ─── v1171 places picker ───────────────────────
function openPlacesPicker() {
  PLACES_SELECTED.clear();
  const modal = document.getElementById('miro-places-modal');
  modal.style.display = 'flex';
  document.getElementById('mplc-close').onclick  = closePlacesPicker;
  document.getElementById('mplc-cancel').onclick = closePlacesPicker;
  document.getElementById('mplc-go').onclick     = commitPlacesPicker;
  const q = document.getElementById('mplc-q');
  q.value = '';
  q.oninput = debounce(() => { renderPlacesGrid(q.value.trim()); }, 200);
  updatePlacesFooter();
  loadPlaces();
}
function closePlacesPicker() {
  document.getElementById('miro-places-modal').style.display = 'none';
}

async function loadPlaces() {
  const root = document.getElementById('mplc-grid');
  root.innerHTML = '<div class="muted">読み込み中…</div>';
  try {
    const d = await get('/api/places');
    PLACES_CACHE = d.items || d.places || [];
    if (!PLACES_CACHE.length) {
      root.innerHTML = '<div class="muted">食べある記のデータがありません。</div>';
      return;
    }
    renderPlacesGrid('');
  } catch (e) {
    root.innerHTML = `<div class="muted" style="color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function renderPlacesGrid(query) {
  const root = document.getElementById('mplc-grid');
  const q = query.toLowerCase();
  const filtered = PLACES_CACHE.filter(p =>
    !q || (p.title || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)
  );
  if (!filtered.length) { root.innerHTML = '<div class="muted">見つかりません</div>'; return; }
  root.innerHTML = filtered.map(p => {
    const sel = PLACES_SELECTED.has(p.id);
    const thumb = p.cover_image_thumb || p.cover_image || p.image_url || '';
    const thumbHtml = thumb
      ? `<div style="width:100%; height:80px; background-image:url('${escapeHtml(thumb)}'); background-size:cover; background-position:center; border-radius:6px"></div>`
      : `<div style="width:100%; height:80px; background:#f3f4f6; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#9ca3af; font-size:22px">🍽</div>`;
    return `
      <label style="display:flex; flex-direction:column; gap:4px; padding:4px; border:2px solid ${sel ? '#7b3fa0' : 'transparent'}; border-radius:8px; cursor:pointer; background:${sel ? '#faf5ff' : '#fff'}" data-pid="${p.id}">
        ${thumbHtml}
        <div style="font-size:12px; font-weight:600; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.title || '')}</div>
        <div class="muted" style="font-size:10px">${escapeHtml(p.category || '')}</div>
        <input type="checkbox" data-pid="${p.id}" ${sel ? 'checked' : ''} style="display:none">
      </label>`;
  }).join('');
  root.querySelectorAll('label[data-pid]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const pid = parseInt(el.dataset.pid, 10);
      if (PLACES_SELECTED.has(pid)) PLACES_SELECTED.delete(pid); else PLACES_SELECTED.add(pid);
      renderPlacesGrid(document.getElementById('mplc-q').value.trim());
      updatePlacesFooter();
    });
  });
}

function updatePlacesFooter() {
  const n = PLACES_SELECTED.size;
  document.getElementById('mplc-count').textContent = `${n} 件選択中` + (n > 50 ? ' (50 件までにしてね)' : '');
  const btn = document.getElementById('mplc-go');
  btn.disabled = n === 0 || n > 50;
  btn.textContent = n === 0 ? '選んだ店を貼る' : `選んだ ${n} 件を貼る`;
}

async function commitPlacesPicker() {
  const ids = [...PLACES_SELECTED];
  if (!ids.length) return;
  const btn = document.getElementById('mplc-go');
  btn.disabled = true; btn.textContent = '貼っています…';
  try {
    const vp = document.getElementById('miro-viewport');
    const rect = vp.getBoundingClientRect();
    const mid = screenToWorld(rect.left + vp.clientWidth / 2, rect.top + vp.clientHeight / 2);
    const r = await post(`/api/miro/rooms/${ROOM_ID}/notes-from-places`, {
      place_ids: ids, center_x: mid.x, center_y: mid.y,
    });
    for (const n of (r.notes || [])) NOTE_MAP[n.id] = n;
    NOTES = Object.values(NOTE_MAP);
    renderAll();
    toast(`${r.created} 件を貼ったよ`);
    closePlacesPicker();
  } catch (e) {
    toast('貼付失敗: ' + e.message);
    btn.disabled = false; btn.textContent = '選んだ店を貼る';
  }
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
}
