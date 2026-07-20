// v1100 /#/miro/rooms/{id} — Miro 的な共同ポストイット空間の 1 部屋。
//   ・空間 = translate + scale の CSS transform をかけたレイヤ
//   ・pan = 空白ドラッグ / pinch (2 本指) / ホイール
//   ・zoom = ホイール (ctrl 不要) / pinch
//   ・ノート = 空間内 absolute 配置、ドラッグで移動、右下ハンドルでリサイズ、ダブルタップで編集
//   ・オモテウラ (side) はユーザごと個別 (miro_note_flips)
//   ・🎨 画像生成 = OpenAI gpt-image-1 low → /uploads/board/... に保存 → 表 or 裏に貼る
//   ・2 s poll で他人の編集を取り込み

import { get, post, patch, put, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast, state } from '../app.js';

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
// v1173 手書きモード
// v1189 arrow モード追加 (Miro 風 note-to-note 矢印)
// v1201 shape モード追加 (図形: 四角/楕円/直線/破線 の 4 種類 + dashed 切替)
// MODE: 'select' / 'draw' / 'erase' / 'arrow' / 'shape'
let MODE = 'select';
let SHAPE_TYPE = 'rect';   // 'rect' | 'ellipse' | 'line'  (dashed 切替 は 別 flag)
let SHAPE_DASHED = false;
// 図形描画中: 開始点 + 現在点 (world 座標)
let CURRENT_SHAPE = null;   // { x1, y1, x2, y2 }
let STROKES = [];     // 全ストローク (array)
let STROKE_MAP = {};  // id → stroke
let CURRENT_STROKE = null;  // 描画中: { points:[{x,y},...], color, width }
// v1189 矢印
let ARROWS = [];      // 全矢印
let ARROW_MAP = {};   // id → arrow
let ARROW_SOURCE_NOTE_ID = null;  // arrow モードで 1 本目タップ済 の source note id (2 本目タップで確定)

// v1197 世界座標での 手動 hit-test (SVG の pointer-events で 詰まないよう ブラウザ非依存 に)
function hitTestNote(wx, wy) {
  // 上 (z_index 大) から順 に走査、 最初に box に 入った note を返す
  const sorted = [...Object.values(NOTE_MAP)].sort((a, b) => (b.z_index || 0) - (a.z_index || 0));
  for (const n of sorted) {
    if (!n || n.hidden_for_me) continue;
    if (wx >= n.x && wx <= n.x + (n.width || 200) && wy >= n.y && wy <= n.y + (n.height || 200)) {
      return n;
    }
  }
  return null;
}
// 点 (wx,wy) と 線分 (x1,y1)-(x2,y2) の 距離
function distPointToSegment(wx, wy, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(wx - x1, wy - y1);
  let t = ((wx - x1) * dx + (wy - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx, py = y1 + t * dy;
  return Math.hypot(wx - px, wy - py);
}
function hitTestArrow(wx, wy, tol) {
  const T = tol / VIEW.scale;  // ズーム で 判定幅 を 調整
  for (const a of Object.values(ARROW_MAP)) {
    if (!a) continue;
    const p1 = noteCenter(a.from_note_id); if (!p1) continue;
    const p2 = noteCenter(a.to_note_id);   if (!p2) continue;
    if (distPointToSegment(wx, wy, p1.x, p1.y, p2.x, p2.y) <= T) return a;
  }
  return null;
}
function hitTestStroke(wx, wy, tol) {
  const T = tol / VIEW.scale;
  for (const s of Object.values(STROKE_MAP)) {
    if (!s || !Array.isArray(s.points) || s.points.length < 2) continue;
    const shape = s.shape || 'freehand';
    const half = T + (s.width || 2);
    if (shape === 'rect') {
      const p1 = s.points[0], p2 = s.points[s.points.length - 1];
      const x1 = Math.min(p1.x, p2.x), y1 = Math.min(p1.y, p2.y);
      const x2 = Math.max(p1.x, p2.x), y2 = Math.max(p1.y, p2.y);
      // 4 辺 の うち どれか に 近い か
      if (distPointToSegment(wx, wy, x1, y1, x2, y1) <= half) return s;
      if (distPointToSegment(wx, wy, x2, y1, x2, y2) <= half) return s;
      if (distPointToSegment(wx, wy, x2, y2, x1, y2) <= half) return s;
      if (distPointToSegment(wx, wy, x1, y2, x1, y1) <= half) return s;
      continue;
    }
    if (shape === 'ellipse') {
      const p1 = s.points[0], p2 = s.points[s.points.length - 1];
      const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      const rx = Math.abs(p2.x - p1.x) / 2, ry = Math.abs(p2.y - p1.y) / 2;
      if (rx < 1 || ry < 1) continue;
      // 楕円 の 円周距離 の 近似: 点 を 楕円 の 中心 座標系 に 変換 → 正規化
      const dx = (wx - cx) / rx, dy = (wy - cy) / ry;
      const dist = Math.abs(Math.sqrt(dx * dx + dy * dy) - 1);
      // dist は 正規化距離。 実 距離 は 大まかに dist * min(rx, ry)
      if (dist * Math.min(rx, ry) <= half) return s;
      continue;
    }
    // freehand / line: 各セグメント 距離
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1], b = s.points[i];
      if (distPointToSegment(wx, wy, a.x, a.y, b.x, b.y) <= half) return s;
    }
  }
  return null;
}
// v1202/v1203 fb#493/494: 選択状態 (v1203 で 複数選択 対応)
//   SELECTED_NOTE_ID は 互換 のため 残す (単一 選択 の 代表 = Set の 最後 に 追加された id)
let SELECTED_NOTE_ID = null;
const SELECTED_NOTE_IDS = new Set();
// v1203 clipboard は 単一 でなく 配列 に (相対 位置 保持)
let CLIPBOARD_NOTES = [];    // [{ color, front_text, back_text, front_image_url, width, height, dx, dy }]
let LAST_POINTER = { x: 0, y: 0 };  // 直近 pointer 位置 (Ctrl+V の 貼り付け 場所 用)
// v1203 範囲選択 (rubber-band) の 状態
let RECT_SELECT = null;   // { x1, y1, x2, y2 } world 座標
// v1196 Undo スタック — 各アクション を {label, undo: async fn} で 積む、 ↶ ボタン / Ctrl+Z で pop
const UNDO_STACK = [];
const UNDO_LIMIT = 40;
function pushUndo(label, undoFn) {
  UNDO_STACK.push({ label, undo: undoFn });
  if (UNDO_STACK.length > UNDO_LIMIT) UNDO_STACK.shift();
  const btn = document.getElementById('board-undo');
  if (btn) btn.disabled = UNDO_STACK.length === 0;
}
async function doUndo() {
  const action = UNDO_STACK.pop();
  const btn = document.getElementById('board-undo');
  if (btn) btn.disabled = UNDO_STACK.length === 0;
  if (!action) { toast('取り消せる操作 が ないよ', 900); return; }
  try {
    await action.undo();
    toast('↶ ' + action.label, 900);
  } catch (e) {
    toast('取消 失敗: ' + e.message);
  }
}
function boardKeydown(ev) {
  // 編集中 の textarea / input では Ctrl+Z が 効かなくなると 困る の で、 board-shell 内 の 入力欄 で は 通す
  if (!document.getElementById('board-shell')) return;
  const t = ev.target;
  const tag = t?.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || t?.isContentEditable) return;
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && !ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')) {
    ev.preventDefault();
    doUndo();
    return;
  }
  // v1203 fb#493/494 コピー / 貼り付け (複数 対応: 相対位置 保持)
  if (ctrl && (ev.key === 'c' || ev.key === 'C')) {
    const ids = [...SELECTED_NOTE_IDS];
    if (ids.length === 0) return;
    // 全 note の 中心 の 重心 を 基準 に、 各 note の 相対 dx/dy を 保存
    const cx = ids.reduce((s, id) => s + ((NOTE_MAP[id]?.x || 0) + (NOTE_MAP[id]?.width || 200) / 2), 0) / ids.length;
    const cy = ids.reduce((s, id) => s + ((NOTE_MAP[id]?.y || 0) + (NOTE_MAP[id]?.height || 200) / 2), 0) / ids.length;
    CLIPBOARD_NOTES = ids.filter(id => NOTE_MAP[id]).map(id => {
      const n = NOTE_MAP[id];
      return {
        color: n.color, front_text: n.front_text || '', back_text: n.back_text || '',
        front_image_url: n.front_image_url || '', width: n.width, height: n.height,
        dx: (n.x + (n.width || 200) / 2) - cx,
        dy: (n.y + (n.height || 200) / 2) - cy,
      };
    });
    toast(`${CLIPBOARD_NOTES.length} 枚 コピー (Ctrl+V で 貼り付け)`, 1200);
    ev.preventDefault();
    return;
  }
  if (ctrl && (ev.key === 'v' || ev.key === 'V')) {
    if (CLIPBOARD_NOTES.length > 0) {
      pasteClipboardAtCursor();
      ev.preventDefault();
    }
    return;
  }
  // v1203 Delete / Backspace で 選択中 の 付箋 を 一括 削除
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && SELECTED_NOTE_IDS.size > 0) {
    ev.preventDefault();
    const n = SELECTED_NOTE_IDS.size;
    if (!confirm(`選択中 の ${n} 枚 を 削除するよ? (Ctrl+Z で 戻せる)`)) return;
    deleteSelectedNotes();
    return;
  }
}

// v1202/v1203 fb#493 選択状態 の 見た目 反映 (複数選択 対応)
function updateSelectionHighlight() {
  document.querySelectorAll('.bnote').forEach(el => {
    const id = parseInt(el.dataset.id, 10);
    if (SELECTED_NOTE_IDS.has(id)) {
      el.style.outline = '3px solid #4a106d';
      el.style.outlineOffset = '2px';
    } else {
      el.style.outline = '';
      el.style.outlineOffset = '';
    }
  });
}
// 選択の 追加/切替/クリア のユーティリティ
function selectOnlyNote(id) {
  SELECTED_NOTE_IDS.clear();
  SELECTED_NOTE_IDS.add(id);
  SELECTED_NOTE_ID = id;
  updateSelectionHighlight();
}
function toggleNoteSelection(id) {
  if (SELECTED_NOTE_IDS.has(id)) {
    SELECTED_NOTE_IDS.delete(id);
    SELECTED_NOTE_ID = SELECTED_NOTE_IDS.size ? [...SELECTED_NOTE_IDS].pop() : null;
  } else {
    SELECTED_NOTE_IDS.add(id);
    SELECTED_NOTE_ID = id;
  }
  updateSelectionHighlight();
}
function clearNoteSelection() {
  if (SELECTED_NOTE_IDS.size === 0 && SELECTED_NOTE_ID === null) return;
  SELECTED_NOTE_IDS.clear();
  SELECTED_NOTE_ID = null;
  updateSelectionHighlight();
}

// v1203 複数貼り付け: 相対位置 (dx/dy) を 保持 したまま cursor 位置 に 集合 を 落とす
async function pasteClipboardAtCursor() {
  if (!CLIPBOARD_NOTES || CLIPBOARD_NOTES.length === 0) return;
  const cx = LAST_POINTER.x, cy = LAST_POINTER.y;
  const createdIds = [];
  try {
    const results = await Promise.all(CLIPBOARD_NOTES.map(c => {
      const w = c.width || 220, h = c.height || 220;
      const px = cx + c.dx - w / 2, py = cy + c.dy - h / 2;
      return post(`/api/board/rooms/${ROOM_ID}/notes`, {
        x: px, y: py, width: w, height: h,
        color: c.color || MY_DEFAULT_COLOR, front_text: c.front_text || '',
        back_text: c.back_text || '', front_image_url: c.front_image_url || '',
      }).catch(() => null);
    }));
    SELECTED_NOTE_IDS.clear();
    for (const r of results) {
      if (r && r.id) {
        NOTE_MAP[r.id] = r.note;
        SELECTED_NOTE_IDS.add(r.id);
        SELECTED_NOTE_ID = r.id;
        createdIds.push(r.id);
      }
    }
    NOTES = Object.values(NOTE_MAP);
    renderAll();
    if (createdIds.length > 0) {
      pushUndo(`${createdIds.length} 枚 の 貼付 を 取消`, async () => {
        await Promise.all(createdIds.map(id => del(`/api/board/notes/${id}`).catch(() => {})));
        for (const id of createdIds) delete NOTE_MAP[id];
        NOTES = Object.values(NOTE_MAP);
        renderAll();
      });
      toast(`${createdIds.length} 枚 貼り付け`, 1000);
    }
  } catch (e) { toast('貼り付け失敗: ' + e.message); }
}

// v1203 選択中 note を 一括削除 (Undo で 復活)
async function deleteSelectedNotes() {
  const ids = [...SELECTED_NOTE_IDS];
  if (ids.length === 0) return;
  const backups = ids.filter(id => NOTE_MAP[id]).map(id => ({ ...NOTE_MAP[id] }));
  try {
    await Promise.all(ids.map(id => del(`/api/board/notes/${id}`).catch(() => {})));
    for (const id of ids) delete NOTE_MAP[id];
    NOTES = Object.values(NOTE_MAP);
    SELECTED_NOTE_IDS.clear();
    SELECTED_NOTE_ID = null;
    renderAll();
    pushUndo(`${backups.length} 枚 の 削除 を 取消`, async () => {
      const news = await Promise.all(backups.map(b =>
        post(`/api/board/rooms/${ROOM_ID}/notes`, {
          x: b.x, y: b.y, width: b.width, height: b.height,
          color: b.color, front_text: b.front_text || '',
          back_text: b.back_text || '', front_image_url: b.front_image_url || '',
        }).catch(() => null)
      ));
      for (const r of news) if (r && r.id) NOTE_MAP[r.id] = r.note;
      NOTES = Object.values(NOTE_MAP);
      renderAll();
    });
    toast(`${backups.length} 枚 削除 (↶ で 戻せる)`, 1400);
  } catch (e) { toast('削除失敗: ' + e.message); }
}

// v1203 範囲選択 の rubber-band 描画 (SVG overlay に 破線 rect)
function renderRectSelect() {
  const svg = document.getElementById('board-strokes-svg');
  if (!svg) return;
  let cur = svg.querySelector('#board-rect-select');
  if (!RECT_SELECT) { if (cur) cur.remove(); return; }
  const { x1, y1, x2, y2 } = RECT_SELECT;
  const X1 = Math.min(x1, x2) + 10000, Y1 = Math.min(y1, y2) + 10000;
  const X2 = Math.max(x1, x2) + 10000, Y2 = Math.max(y1, y2) + 10000;
  if (!cur) {
    cur = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    cur.id = 'board-rect-select';
    cur.setAttribute('fill', 'rgba(122, 55, 175, 0.10)');
    cur.setAttribute('stroke', '#7b3fa0');
    cur.setAttribute('stroke-width', '1.5');
    cur.setAttribute('stroke-dasharray', '6,4');
    svg.appendChild(cur);
  }
  cur.setAttribute('x', X1.toFixed(1)); cur.setAttribute('y', Y1.toFixed(1));
  cur.setAttribute('width', (X2 - X1).toFixed(1)); cur.setAttribute('height', (Y2 - Y1).toFixed(1));
}
// v1182 fb#492 スマホの 2 本指 pinch 拡大縮小用の追跡
const ACTIVE_POINTERS = new Map();  // pointerId → {x, y} (touch のみ、 mouse は追跡しない)
let PINCH_STATE = null;  // { d0, scale0 } / null なら pinch 中でない
let PEN_COLOR = '#111827';  // 黒デフォルト
let PEN_WIDTH = 2.5;

export async function renderBoardCanvas({ params }) {
  ROOM_ID = parseInt(params?.id, 10);
  if (!ROOM_ID) { navigate('/board'); return; }
  const app = document.getElementById('app');
  // v1194 中村さん報告「左右両端まで行かない」→ main#app の padding が 干渉している 疑い。
  //   board-shell は position:fixed だが safety-first で document.body 直下 に 挿入
  //   (前回残置分を掃除)。 app は 空に して SPA の期待 に 合わせる。
  // v1195 前バージョンで firstElementChild だけ を append していて <style> だけ が 移動 →
  //   本体 <div id="board-shell"> が 消えて addEventListener が null に なった 事故。
  //   全ての 子ノード を まとめて body 直下 の board-host div に 移す。
  document.querySelectorAll('#board-shell, #board-host').forEach(el => el.remove());
  app.innerHTML = '';
  const host = document.createElement('div');
  host.id = 'board-host';
  host.innerHTML = shellHtml();
  document.body.appendChild(host);
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
    // v1194 body 直下 に 移した shell + host を 掃除
    document.querySelectorAll('#board-shell, #board-host').forEach(el => el.remove());
    // v1196 undo stack + keydown リスナー を 解放 (Board を 離れたら 有効 に しない)
    UNDO_STACK.length = 0;
    window.removeEventListener('keydown', boardKeydown);
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
      /* v1202 fb#496 中村さん要望「左のツールバーをホバリングで それがなんの機能であるか 表示」→
         native title の 遅延 (500ms) を 短縮 する 素早い 独自 tooltip */
      #board-shell .b-icon-btn { position:relative; }
      #board-shell .b-icon-btn[data-tip]::after {
        content: attr(data-tip);
        position: absolute; left: calc(100% + 8px); top: 50%; transform: translateY(-50%);
        background: rgba(20, 20, 30, 0.92); color: #fff;
        padding: 4px 8px; border-radius: 4px; font-size: 12px; line-height: 1.3;
        white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.12s;
        z-index: 1000;
      }
      #board-shell .b-icon-btn[data-tip]:hover::after { opacity: 1; transition-delay: 0.15s; }
      /* v1194 board-shell を 確実 に フルスクリーン に (親要素 の 制約 を 全上書き) */
      #board-shell {
        position: fixed !important;
        top: 0 !important; left: 0 !important;
        right: 0 !important; bottom: 0 !important;
        width: 100vw !important; height: 100vh !important;
        margin: 0 !important; padding: 0 !important;
        max-width: none !important; max-height: none !important;
        box-sizing: border-box !important;
      }
      #board-shell .bnote-body::-webkit-scrollbar,
      #board-shell .bnote-editta::-webkit-scrollbar { display:none }
      #board-shell .bnote-body,
      #board-shell .bnote-editta { scrollbar-width:none; -ms-overflow-style:none }
      /* v1190 Miro 風 フローティング UI パネル 共通 */
      #board-shell .b-float {
        position:absolute; background:rgba(255,255,255,0.96);
        border:1px solid #d1d5db; border-radius:10px;
        box-shadow:0 4px 12px rgba(0,0,0,0.12);
        z-index:20; user-select:none;
      }
      #board-shell .b-icon-btn {
        width:38px; height:38px; padding:0; border:none; background:transparent;
        display:flex; align-items:center; justify-content:center;
        font-size:18px; cursor:pointer; border-radius:8px;
      }
      #board-shell .b-icon-btn:hover { background:rgba(0,0,0,0.06); }
      #board-shell .b-icon-btn.active { background:#7b3fa0; color:#fff; }
      #board-shell .b-sep { height:1px; background:#e5e7eb; margin:4px 4px; }
    </style>
    <div id="board-shell" style="position:fixed; top:0; left:0; right:0; bottom:0; width:100vw; height:100vh; background:#fafafa; z-index:100">
      <!-- v1190 中村さん指示「Miro って メニュー を 上 に 固める んじゃ なくて ツールバー的 にしてる、
           画面 全体 を 使える の が メリット」→ 従来 の 上固定 toolbar を 撤去、 全 UI を
           floating pane で viewport に 重ねる。 viewport は 常時 全画面。 -->
      <!-- 上左: 戻る + タイトル (compact) -->
      <div class="b-float" style="top:8px; left:8px; padding:6px 12px; display:flex; align-items:center; gap:8px; max-width:calc(100vw - 24px)">
        <a href="#/board" class="hint" style="text-decoration:none; padding:2px 6px; color:#6b7280">← 一覧</a>
        <div id="board-title" style="font-weight:700; font-size:14px; min-width:0; max-width:60vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">…</div>
        <!-- v1188 削除メニュー: 作成者/admin のみ 表示 -->
        <div id="board-more-wrap" hidden style="position:relative">
          <button class="b-icon-btn" id="board-more" title="その他" style="width:28px; height:28px; font-size:16px">⋯</button>
          <div id="board-more-menu" style="display:none; position:absolute; top:100%; right:0; margin-top:4px; background:#fff; border:1px solid #d1d5db; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.12); padding:4px; z-index:10; min-width:180px">
            <button class="btn" id="board-delete" style="display:block; width:100%; text-align:left; padding:6px 10px; border:none; background:none; cursor:pointer; color:#b91c1c">🗑 このボードを削除</button>
          </div>
        </div>
      </div>

      <!-- v1193 中村さん指示: 左ツールバーは 上下中央 に (⋯ 削除メニュー との被り 解消) -->
      <!-- 左レール: 主要ツール (Miro 風 縦アイコン) -->
      <div class="b-float" style="top:50%; left:8px; transform:translateY(-50%); padding:6px; display:flex; flex-direction:column; gap:2px; width:50px">
        <button class="b-icon-btn board-mode" data-mode="select" title="選択/移動 (Miro 風 手のひら)">🖐</button>
        <button class="b-icon-btn board-mode" data-mode="draw"   title="手書き">✏️</button>
        <button class="b-icon-btn board-mode" data-mode="arrow"  title="矢印 (付箋 → 付箋)">↗</button>
        <!-- v1201 図形モード: 押すと 右 に 図形 picker が 出る、 選んだ図形 を ドラッグ で 描画 -->
        <div style="position:relative">
          <button class="b-icon-btn board-mode" data-mode="shape" id="board-mode-shape" title="図形 (四角/楕円/直線 / 破線切替)">⬜</button>
          <div id="board-shape-menu" style="display:none; position:absolute; left:100%; top:0; margin-left:6px; background:#fff; border:1px solid #d1d5db; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.12); padding:4px; z-index:10; width:180px">
            <div class="row" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:2px">
              <button class="b-icon-btn board-shape-type" data-shape="rect"    title="四角">⬜</button>
              <button class="b-icon-btn board-shape-type" data-shape="ellipse" title="楕円">⭕</button>
              <button class="b-icon-btn board-shape-type" data-shape="line"    title="直線">─</button>
            </div>
            <div style="margin-top:4px; display:flex; align-items:center; gap:6px; padding:4px 6px; font-size:12px; border-top:1px solid #eee">
              <input type="checkbox" id="board-shape-dashed"> <label for="board-shape-dashed" style="cursor:pointer">点線</label>
            </div>
          </div>
        </div>
        <button class="b-icon-btn board-mode" data-mode="erase"  title="消しゴム (ストローク/矢印/付箋 タップで削除)">🩹</button>
        <div class="b-sep"></div>
        <button class="b-icon-btn" id="board-undo" title="取り消す (Ctrl+Z)" disabled>↶</button>
        <button class="b-icon-btn" id="board-add" title="ノートを追加">➕</button>
        <div id="board-import-wrap" style="position:relative">
          <button class="b-icon-btn" id="board-import" title="インポート">📥</button>
          <div id="board-import-menu" style="display:none; position:absolute; left:100%; top:0; margin-left:6px; background:#fff; border:1px solid #d1d5db; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.12); padding:4px; z-index:10; min-width:200px">
            <button class="btn board-import-item" data-import="refs"   style="display:block; width:100%; text-align:left; padding:6px 10px; border:none; background:none; cursor:pointer">📚 文献管理から</button>
            <button class="btn board-import-item" data-import="places" style="display:block; width:100%; text-align:left; padding:6px 10px; border:none; background:none; cursor:pointer">🍜 食べある記から</button>
            <button class="btn board-import-item" data-import="images" style="display:block; width:100%; text-align:left; padding:6px 10px; border:none; background:none; cursor:pointer">🖼 画像 (PCから)</button>
            <button class="btn board-import-item" data-import="videos" style="display:block; width:100%; text-align:left; padding:6px 10px; border:none; background:none; cursor:pointer">🎬 動画 (PCから)</button>
          </div>
        </div>
        <input type="file" id="board-import-image-input" accept="image/*" multiple style="display:none">
        <input type="file" id="board-import-video-input" accept="video/*" multiple style="display:none">
      </div>

      <!-- 左レールの下: draw モードのときだけ 出る ペン設定 -->
      <div id="board-pen-group" class="b-float" style="display:none; top:auto; bottom:70px; left:8px; padding:6px; flex-direction:column; align-items:center; gap:4px; width:50px" title="ペン設定">
        <input type="color" id="board-pen-color" value="#111827" style="width:32px; height:32px; padding:0; border:1px solid #d1d5db; border-radius:4px; cursor:pointer">
        <select id="board-pen-width" style="padding:2px 2px; font-size:11px; width:40px">
          <option value="1.5">細</option>
          <option value="2.5" selected>中</option>
          <option value="4">太</option>
          <option value="6">極太</option>
        </select>
      </div>

      <!-- 右下: ズーム コントロール (ミニマップ の 上 に 配置) -->
      <div class="b-float" style="top:auto; bottom:150px; right:8px; padding:4px; display:flex; align-items:center; gap:2px">
        <button class="b-icon-btn" id="board-zoom-out" style="width:32px; height:32px; font-size:20px">−</button>
        <span id="board-zoom-label" style="font-size:12px; color:#6b7280; min-width:46px; text-align:center">100%</span>
        <button class="b-icon-btn" id="board-zoom-in" style="width:32px; height:32px; font-size:20px">＋</button>
        <button class="b-icon-btn" id="board-zoom-fit" style="width:32px; height:32px; font-size:14px" title="全部見える倍率にリセット">⛶</button>
      </div>

      <!-- 上右: デフォルト色パレット (小型) -->
      <div id="board-palette" class="b-float" style="top:8px; right:8px; padding:4px; display:flex; gap:3px; align-items:center" title="新規ノートのデフォルト色">
        ${PALETTE.map(c => `<button class="bpal" data-color="${c}" style="width:20px; height:20px; border-radius:5px; border:2px solid transparent; background:${c}; padding:0; cursor:pointer" title="${c}"></button>`).join('')}
      </div>

      <!-- v1192 diagnostic bar: 下中央、 v1200 で 非表示 (window.__board_debug=true で 有効化)。 内部 は 残す ので 次回 トラブル 時 は 即 切替可能 -->
      <div id="board-debug" class="b-float" style="display:none; top:auto; bottom:8px; left:50%; transform:translateX(-50%); padding:4px 10px; font-size:11px; color:#111827; font-family:monospace; z-index:100">
        <span id="board-dbg-mode">MODE=?</span> <span id="board-dbg-drag">DRAG=?</span> <span id="board-dbg-pts">pts=0</span> <span id="board-dbg-last">last=?</span>
      </div>

      <!-- viewport は 全画面。 UI は 全部 b-float で 上 に 重ねる -->
      <div id="board-viewport" style="position:absolute; top:0; left:0; right:0; bottom:0; overflow:hidden; touch-action:none; user-select:none; -webkit-user-select:none; cursor:grab; background:#fafafa">
        <div id="board-layer" style="position:absolute; left:0; top:0; transform-origin:0 0; will-change:transform">
          <!-- v1173 手書きストローク SVG (world 座標。 board-layer の transform に追随) -->
          <!-- v1197 pointer-events:none 固定 (ブラウザ の SVG hit-test に 依存 しない、 手動 hit-test で 拾う) -->
          <svg id="board-strokes-svg" width="20000" height="20000" style="position:absolute; left:-10000px; top:-10000px; pointer-events:none; overflow:visible; z-index:1"></svg>
          <!-- v1189 note-to-note 矢印 SVG -->
          <svg id="board-arrows-svg" width="20000" height="20000" style="position:absolute; left:-10000px; top:-10000px; pointer-events:none; overflow:visible; z-index:2">
            <defs>
              <marker id="board-arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/>
              </marker>
            </defs>
          </svg>
          <!-- v1192 中村さん報告「線が引けない」の 決定的 バグ 修正:
               従来 renderAll で layer.innerHTML = notesHtml していたため
               SVG (strokes / arrows) が 毎回 破棄されていた。 notes 専用の 別 container に
               分離し、 SVG は layer 直下 に 残す。
               v1196 中村さん再報告「矢印/消しゴム 効かない」→ SVG hit-test に 頼らず
               z-index で notes を 最上位 に (z-index:10)、 note tap の 判定 を 確実に する。
               arrow / stroke の hit test は 個別 line/path の pointer-events="stroke" と
               svg pointer-events:visiblePainted で 拾う。 -->
          <div id="board-notes-container" style="position:absolute; left:0; top:0; z-index:10"></div>
        </div>
        <!-- v1104 他人カーソルオーバーレイ (screen 座標、変形しないので上のレイヤ) -->
        <div id="board-cursors" style="position:absolute; inset:0; pointer-events:none; overflow:hidden"></div>
        <!-- v1104 minimap: 右下に全体マップ (ノート = 小さい色付き矩形、現在視野 = 枠) -->
        <div id="board-minimap" style="position:absolute; right:10px; bottom:10px; width:180px; height:130px; background:rgba(255,255,255,0.92); border:1px solid #d1d5db; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.12); overflow:hidden; touch-action:none; cursor:pointer; z-index:5">
          <svg id="board-minimap-svg" width="180" height="130" viewBox="0 0 180 130" style="display:block"></svg>
          <button id="board-minimap-toggle" title="ミニマップを閉じる" style="position:absolute; right:2px; top:2px; width:18px; height:18px; padding:0; border:none; background:rgba(0,0,0,0.05); border-radius:4px; font-size:11px; line-height:1; cursor:pointer">×</button>
        </div>
        <button id="board-minimap-open" title="ミニマップを開く" style="display:none; position:absolute; right:10px; bottom:10px; width:38px; height:38px; padding:0; border:1px solid #d1d5db; background:rgba(255,255,255,0.92); border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.12); font-size:18px; cursor:pointer; z-index:5">🗺</button>
      </div>
    </div>

    <!-- prompt modal for image gen (残り 1 つだけ、これは長い入力なのでモーダル) -->
    <div id="board-prompt-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center; padding:16px">
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
    <div id="board-color-pop" style="display:none; position:fixed; z-index:10001; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:6px; box-shadow:0 4px 12px rgba(0,0,0,0.15); gap:4px">
      ${PALETTE.map(c => `<button class="bcolor-pop" data-color="${c}" style="width:24px; height:24px; border-radius:5px; border:2px solid transparent; background:${c}; padding:0; cursor:pointer"></button>`).join('')}
    </div>

    <!-- v1110 refs ピッカー (📚 から開く、検索 + チェックリスト) -->
    <div id="board-refs-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10001; align-items:center; justify-content:center; padding:16px">
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
    <div id="board-places-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10001; align-items:center; justify-content:center; padding:16px">
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
    const d = await get(`/api/board/rooms/${ROOM_ID}`);
    ROOM = d.room;
    MY_DEFAULT_COLOR = d.my_default_color || '#FEF9A8';
    NOTES = d.notes || [];
    NOTE_MAP = {};
    for (const n of NOTES) NOTE_MAP[n.id] = n;
    // v1173 手書きストローク
    STROKES = d.strokes || [];
    STROKE_MAP = {};
    for (const s of STROKES) STROKE_MAP[s.id] = s;
    // v1189 note-to-note 矢印
    ARROWS = d.arrows || [];
    ARROW_MAP = {};
    for (const a of ARROWS) ARROW_MAP[a.id] = a;
    ARROW_SOURCE_NOTE_ID = null;
    LAST_SERVER_TIME = d.server_time;
    document.getElementById('board-title').textContent = ROOM.title;
    document.getElementById('board-viewport').style.background = ROOM.bg_color || '#fafafa';
    // v1188 削除メニュー: 作成者 or admin のみ ⋯ を表示
    const myId   = state?.me?.id ?? 0;
    const myRole = state?.me?.role ?? '';
    const canDelete = (Number(ROOM.creator_user_id) === Number(myId)) || myRole === 'admin';
    const moreWrap = document.getElementById('board-more-wrap');
    if (moreWrap) moreWrap.hidden = !canDelete;
    highlightPalette();
    // v1104 初回カーソル
    const nowMs = Date.now();
    CURSORS = {};
    for (const c of (d.cursors || [])) CURSORS[c.user_id] = { ...c, seen: nowMs };
    // 初回は中央にフィット
    fitAll();
    // マウス未動作時のオフスクリーン距離表示用に、初期カーソルを視野中央 world 座標に
    const vp = document.getElementById('board-viewport');
    const mid = screenToWorld(vp.getBoundingClientRect().left + vp.clientWidth / 2,
                              vp.getBoundingClientRect().top  + vp.clientHeight / 2);
    MY_CURSOR.x = mid.x; MY_CURSOR.y = mid.y;
    renderAll();
    renderCursors();
    renderMinimap();
    wireMinimap();
  } catch (e) {
    document.getElementById('board-viewport').innerHTML =
      `<div style="padding:16px; color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function startPolling() {
  stopPolling();
  POLL_TIMER = setInterval(async () => {
    try {
      const d = await get(`/api/board/rooms/${ROOM_ID}/updates?since=${encodeURIComponent(LAST_SERVER_TIME)}`);
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
      // v1173 手書きストロークの diff
      for (const s of d.stroke_upserts || []) { STROKE_MAP[s.id] = s; dirty = true; }
      for (const sid of d.stroke_deletes || []) { if (STROKE_MAP[sid]) { delete STROKE_MAP[sid]; dirty = true; } }
      // v1189 矢印 の diff
      for (const a of d.arrow_upserts || []) { ARROW_MAP[a.id] = a; dirty = true; }
      for (const aid of d.arrow_deletes || []) { if (ARROW_MAP[aid]) { delete ARROW_MAP[aid]; dirty = true; } }
      if (dirty) {
        NOTES = Object.values(NOTE_MAP);
        STROKES = Object.values(STROKE_MAP);
        ARROWS = Object.values(ARROW_MAP);
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
  const layer = document.getElementById('board-layer');
  if (!layer) return;
  layer.style.transform = `translate(${VIEW.tx}px, ${VIEW.ty}px) scale(${VIEW.scale})`;
  const lbl = document.getElementById('board-zoom-label');
  if (lbl) lbl.textContent = Math.round(VIEW.scale * 100) + '%';
  // v1104 視野が変わったらカーソル位置とミニマップの視野枠も動かす
  renderCursors();
  renderMinimap();
}
function screenToWorld(sx, sy) {
  const rect = document.getElementById('board-viewport').getBoundingClientRect();
  const x = (sx - rect.left - VIEW.tx) / VIEW.scale;
  const y = (sy - rect.top  - VIEW.ty) / VIEW.scale;
  return { x, y };
}
function fitAll() {
  const vp = document.getElementById('board-viewport');
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
  const vp    = document.getElementById('board-viewport');
  const layer = document.getElementById('board-layer');

  vp.addEventListener('pointerdown', (e) => {
    // v1182 スマホの 2 本指 pinch 拡大縮小 (fb#492 中村さん要望)
    if (e.pointerType === 'touch') {
      ACTIVE_POINTERS.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ACTIVE_POINTERS.size === 2) {
        // 2 本目が着地 = pinch + pan モード開始。既存の 1 本指 drag/draw をキャンセル
        // v1202 fb#495 中村さん要望「二本指ドラッグで視点移動」→ pinch と 同時 に 2 本指 中点 の
        //   移動 でも view を pan させる (Miro/Google Maps 風)。 PINCH_STATE に mid0 と tx0/ty0 を追加。
        const [a, b] = [...ACTIVE_POINTERS.values()];
        const dx = b.x - a.x, dy = b.y - a.y;
        PINCH_STATE = {
          d0: Math.sqrt(dx * dx + dy * dy), scale0: VIEW.scale,
          mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          tx0: VIEW.tx, ty0: VIEW.ty,
        };
        // 進行中の pan/note/draw を停止 (drag mode 解除、未保存 stroke 廃棄)
        DRAG.mode = null;
        if (CURRENT_STROKE) { CURRENT_STROKE = null; renderCurrentStroke(); }
        if (CURRENT_SHAPE)  { CURRENT_SHAPE  = null; renderCurrentShape(); }
        try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
        return;
      }
    }
    // v1191 中村さん再報告「手書きできない」の 決定版 修正:
    //   v1178 の mousedown 保険 + v1188 の pointerType=='mouse' skip 分岐 は 二重発火 と
    //   誤解 の 温床 だった。 全 pointerType (mouse/pen/touch) を 単一の pointer 経路 で
    //   処理する 単純設計 に 戻す + 「描画開始」を toast で 可視化 する。
    if (MODE === 'draw') {
      // ボタン系 (b-icon-btn, .bpal, .bnote 内部ボタン等) は 描画 の 起点 に しない
      if (e.target.closest('button, .bnote, .bpal, input, select')) { updateDebug('down:blocked'); return; }
      e.preventDefault();
      const w = screenToWorld(e.clientX, e.clientY);
      CURRENT_STROKE = { points: [{ x: w.x, y: w.y }], color: PEN_COLOR, width: PEN_WIDTH };
      DRAG.mode = 'draw';
      DRAG.pointerId = e.pointerId;
      try { vp.setPointerCapture(e.pointerId); } catch (_) {}
      renderCurrentStroke();
      updateDebug('down:' + e.pointerType);
      // v1200: 描画開始 toast は 撤去 (draw 中は 毎回 出ると 邪魔)
      return;
    }
    // v1201 図形モード: ドラッグ で 四角/楕円/直線 を 描画
    if (MODE === 'shape') {
      if (e.target.closest('button, .bnote, .bpal, input, select')) { updateDebug('shape:blocked'); return; }
      e.preventDefault();
      const w = screenToWorld(e.clientX, e.clientY);
      CURRENT_SHAPE = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
      DRAG.mode = 'shape';
      DRAG.pointerId = e.pointerId;
      try { vp.setPointerCapture(e.pointerId); } catch (_) {}
      renderCurrentShape();
      updateDebug('shape:down:' + SHAPE_TYPE);
      return;
    }
    // v1197 消しゴムモード: 手動 hit-test (SVG の pointer-events に 頼らない)
    // v1199 note タップ で note 削除 (Miro 風、 Undo で 復活)
    if (MODE === 'erase') {
      const w0 = screenToWorld(e.clientX, e.clientY);
      // まず stroke (幅 12px 以内)、 次に arrow (10px 以内)、 最後 に note を 判定
      const sHit = hitTestStroke(w0.x, w0.y, 12);
      if (sHit) {
        deleteStroke(sHit.id).catch(err => toast('削除失敗: ' + err.message));
        updateDebug('erase:stroke#' + sHit.id);
        e.preventDefault();
        return;
      }
      const aHit = hitTestArrow(w0.x, w0.y, 10);
      if (aHit) {
        deleteArrow(aHit.id);
        updateDebug('erase:arrow#' + aHit.id);
        e.preventDefault();
        return;
      }
      // note 削除 (DOM ancestry と 世界座標 の 両方 で 判定)
      const nEl = e.target.closest('.bnote');
      let nHit = null;
      if (nEl) {
        const id = parseInt(nEl.dataset.id, 10);
        nHit = NOTE_MAP[id] || null;
      }
      if (!nHit) nHit = hitTestNote(w0.x, w0.y);
      if (nHit) {
        deleteNoteWithUndo(nHit.id);
        updateDebug('erase:note#' + nHit.id);
        e.preventDefault();
        return;
      }
      // 空白 は pan に fall-through
      updateDebug('erase:fall-thr');
    }
    // v1197 矢印モード: note を 拾う。 v1199 DOM ancestor と 世界座標 の 両方 で 判定
    //   どちらか が 見つけたら hit 成立 (screenToWorld / n.width の 微妙な ずれ を 吸収)
    if (MODE === 'arrow') {
      const nEl = e.target.closest('.bnote');
      let nHit = null;
      if (nEl) {
        const id = parseInt(nEl.dataset.id, 10);
        nHit = NOTE_MAP[id] || null;
      }
      if (!nHit) {
        const w0 = screenToWorld(e.clientX, e.clientY);
        nHit = hitTestNote(w0.x, w0.y);
      }
      if (nHit) {
        const nid = nHit.id;
        if (!ARROW_SOURCE_NOTE_ID) {
          ARROW_SOURCE_NOTE_ID = nid;
          toast('接続先の付箋をタップしてね', 1400);
          renderArrows();
        } else if (ARROW_SOURCE_NOTE_ID === nid) {
          ARROW_SOURCE_NOTE_ID = null;
          toast('選択解除', 900);
          renderArrows();
        } else {
          const from = ARROW_SOURCE_NOTE_ID;
          ARROW_SOURCE_NOTE_ID = null;
          tryCreateArrow(from, nid);
        }
        e.preventDefault();
        updateDebug('arrow:note=' + nid);
        return;
      }
      // 空白タップ で source clear + pan に fall-through
      if (ARROW_SOURCE_NOTE_ID) {
        ARROW_SOURCE_NOTE_ID = null;
        renderArrows();
      }
      updateDebug('arrow:fall-thr');
    }
    // 何に触れたか
    const noteEl   = e.target.closest('.bnote');
    const handleEl = e.target.closest('.bhandle');
    if (handleEl && noteEl) {
      DRAG.mode = 'resize';
      DRAG.noteId = parseInt(noteEl.dataset.id, 10);
      const n = NOTE_MAP[DRAG.noteId];
      if (!n) return;
      DRAG.startX = e.clientX; DRAG.startY = e.clientY;
      DRAG.noteStartW = n.width; DRAG.noteStartH = n.height;
    } else if (noteEl && !e.target.closest('button, textarea, input, a')) {
      const nid = parseInt(noteEl.dataset.id, 10);
      const n = NOTE_MAP[nid];
      if (!n) return;
      // v1203 fb#493 複数選択: Shift+click で 追加/削除、 通常 click は 単一 に
      if (e.shiftKey) {
        toggleNoteSelection(nid);
        // Shift 選択 だけ の 時 は drag 開始 しない
        DRAG.mode = null;
        return;
      }
      // 既に 選択済 なら 選択維持 (multi-drag 準備)、 未選択 なら single-select
      if (!SELECTED_NOTE_IDS.has(nid)) selectOnlyNote(nid);
      DRAG.mode = 'note';
      DRAG.noteId = nid;
      DRAG.startX = e.clientX; DRAG.startY = e.clientY;
      DRAG.noteStartX = n.x; DRAG.noteStartY = n.y;
      // v1203 multi-drag 用: 選択中 全 note の 初期位置 を 保存
      DRAG.multi = [];
      for (const sid of SELECTED_NOTE_IDS) {
        const s = NOTE_MAP[sid];
        if (s) DRAG.multi.push({ id: sid, x0: s.x, y0: s.y });
      }
      // z bump
      bringToFront(nid).catch(() => {});
    } else if (!e.target.closest('button, .bmodal-color, .bpal')) {
      // v1203 空白 で Shift+drag = 範囲選択 (rubber-band)
      if (e.shiftKey && MODE === 'select') {
        const w = screenToWorld(e.clientX, e.clientY);
        RECT_SELECT = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
        DRAG.mode = 'rect-select';
        DRAG.pointerId = e.pointerId;
        try { vp.setPointerCapture(e.pointerId); } catch (_) {}
        renderRectSelect();
        return;
      }
      // v1202 空白 タップ で 選択解除
      clearNoteSelection();
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
    // v1182 2 本指 pinch 追跡
    if (e.pointerType === 'touch' && ACTIVE_POINTERS.has(e.pointerId)) {
      ACTIVE_POINTERS.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (PINCH_STATE && ACTIVE_POINTERS.size >= 2) {
        const [a, b] = [...ACTIVE_POINTERS.values()];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0) {
          // v1202 fb#495 pinch (拡大縮小) + pan (2本指中点移動) を 同時 に。
          //   まず scale を 2本指 中点 で 更新、 その後 mid の 移動 分 だけ tx/ty を 追加 シフト。
          const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          const newScale = PINCH_STATE.scale0 * (d / PINCH_STATE.d0);
          zoomAtScreen(cx, cy, newScale);
          // 2 本指 中点 の 移動 = pan 量
          VIEW.tx += (cx - PINCH_STATE.mid0.x);
          VIEW.ty += (cy - PINCH_STATE.mid0.y);
          PINCH_STATE.mid0.x = cx; PINCH_STATE.mid0.y = cy;
          applyTransform();
        }
        return;
      }
    }
    // v1104 自分のカーソル位置 (world 座標) を常時追跡してスロットル送信
    const w = screenToWorld(e.clientX, e.clientY);
    MY_CURSOR.x = w.x; MY_CURSOR.y = w.y;
    LAST_POINTER = { x: w.x, y: w.y };  // v1202 貼り付け 位置 用
    scheduleCursorPost();
    // v1201 図形描画中: 終点 を 更新 + preview 再描画
    if (DRAG.mode === 'shape' && CURRENT_SHAPE) {
      CURRENT_SHAPE.x2 = w.x;
      CURRENT_SHAPE.y2 = w.y;
      renderCurrentShape();
      return;
    }
    // v1173 手書き: 描画中は世界座標で点を追加、SVG に反映
    // v1191 pointerType 分岐 撤廃 (v1188 の mouse skip を 取消)
    if (DRAG.mode === 'draw' && CURRENT_STROKE) {
      const last = CURRENT_STROKE.points[CURRENT_STROKE.points.length - 1];
      // 隣接点間の距離が最低 2px 以上あるときだけ追加 (点数節約)
      const dx = w.x - last.x, dy = w.y - last.y;
      if (dx * dx + dy * dy > 4) {
        CURRENT_STROKE.points.push({ x: w.x, y: w.y });
        renderCurrentStroke();
      } else {
        updateDebug('move:skip');
      }
      return;
    }
    if (DRAG.mode === null) return;
    const dx = e.clientX - DRAG.startX;
    const dy = e.clientY - DRAG.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) DRAG.moved = true;
    if (DRAG.mode === 'pan') {
      VIEW.tx = DRAG.origTx + dx;
      VIEW.ty = DRAG.origTy + dy;
      applyTransform();
    } else if (DRAG.mode === 'note') {
      // v1203 multi-drag: DRAG.multi に 記録した 全 選択 note を 同じ dx/dy で 移動
      const shiftX = dx / VIEW.scale, shiftY = dy / VIEW.scale;
      if (DRAG.multi && DRAG.multi.length > 1) {
        for (const m of DRAG.multi) {
          const n = NOTE_MAP[m.id]; if (!n) continue;
          n.x = m.x0 + shiftX; n.y = m.y0 + shiftY;
          const el = document.querySelector(`.bnote[data-id="${m.id}"]`);
          if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
        }
      } else {
        const n = NOTE_MAP[DRAG.noteId]; if (!n) return;
        n.x = DRAG.noteStartX + shiftX;
        n.y = DRAG.noteStartY + shiftY;
        const el = document.querySelector(`.bnote[data-id="${DRAG.noteId}"]`);
        if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
      }
    } else if (DRAG.mode === 'rect-select') {
      // v1203 範囲選択 の 終点 を 更新 + preview 再描画
      const w = screenToWorld(e.clientX, e.clientY);
      if (RECT_SELECT) { RECT_SELECT.x2 = w.x; RECT_SELECT.y2 = w.y; renderRectSelect(); }
    } else if (DRAG.mode === 'resize') {
      const n = NOTE_MAP[DRAG.noteId]; if (!n) return;
      n.width  = Math.max(80, Math.min(1200, DRAG.noteStartW + dx / VIEW.scale));
      n.height = Math.max(80, Math.min(1200, DRAG.noteStartH + dy / VIEW.scale));
      const el = document.querySelector(`.bnote[data-id="${DRAG.noteId}"]`);
      if (el) { el.style.width = n.width + 'px'; el.style.height = n.height + 'px'; }
    }
  });

  vp.addEventListener('pointerup', async (e) => {
    // v1182 2 本指 pinch: pointer を外す。
    //   v1185 中村さん報告「board、手書きできないね」← touch pointerup で早期 return
    //   していたため draw 完了 POST が走らないバグを修正。 pinch cleanup を先に
    //   済ませて、 draw 完了パスに fall through させる (return しない)。
    if (e.pointerType === 'touch' && ACTIVE_POINTERS.has(e.pointerId)) {
      ACTIVE_POINTERS.delete(e.pointerId);
      if (ACTIVE_POINTERS.size < 2) PINCH_STATE = null;
      // draw モード中なら下の draw 完了パスに任せる。それ以外なら pinch/pan 中断。
      if (DRAG.mode !== 'draw' && ACTIVE_POINTERS.size === 0) DRAG.mode = null;
    }
    // v1201 図形完了: shape stroke として サーバ 保存
    if (DRAG.mode === 'shape' && CURRENT_SHAPE) {
      try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
      const s = CURRENT_SHAPE;
      CURRENT_SHAPE = null;
      DRAG.mode = null;
      const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1);
      // 極小 は 捨てる (誤タップ)
      if (dx < 6 && dy < 6) { renderCurrentShape(); return; }
      // points = [start, end] の 2 点、 shape / dashed で サーバ が 解釈
      try {
        const r = await post(`/api/board/rooms/${ROOM_ID}/strokes`, {
          points: [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }],
          shape: SHAPE_TYPE, dashed: SHAPE_DASHED,
          color: PEN_COLOR, width: PEN_WIDTH,
        });
        if (r && r.stroke) {
          STROKE_MAP[r.stroke.id] = r.stroke;
          STROKES = Object.values(STROKE_MAP);
          renderStrokes();
          const sid = r.stroke.id;
          pushUndo('図形を取消', async () => {
            await del(`/api/board/strokes/${sid}`).catch(() => {});
            delete STROKE_MAP[sid];
            STROKES = Object.values(STROKE_MAP);
            renderStrokes();
          });
        }
      } catch (err) {
        toast('保存失敗: ' + err.message);
      }
      renderCurrentShape();
      return;
    }
    // v1173 手書き完了: サーバ保存
    // v1191 pointerType 分岐 撤廃
    if (DRAG.mode === 'draw' && CURRENT_STROKE) {
      try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
      const stroke = CURRENT_STROKE;
      CURRENT_STROKE = null;
      DRAG.mode = null;
      // 点が 2 未満なら破棄 (単発タップ)
      if (stroke.points.length < 2) { renderCurrentStroke(); return; }
      try {
        const r = await post(`/api/board/rooms/${ROOM_ID}/strokes`, {
          points: stroke.points, color: stroke.color, width: stroke.width,
        });
        if (r && r.stroke) {
          STROKE_MAP[r.stroke.id] = r.stroke;
          STROKES = Object.values(STROKE_MAP);
          // v1196 undo: 直近ストロークを削除
          const sid = r.stroke.id;
          pushUndo('手書きを取消', async () => {
            await del(`/api/board/strokes/${sid}`).catch(() => {});
            delete STROKE_MAP[sid];
            STROKES = Object.values(STROKE_MAP);
            renderStrokes();
          });
        }
      } catch (err) {
        toast('保存失敗: ' + err.message);
      }
      renderCurrentStroke();
      renderStrokes();
      return;
    }
    const mode = DRAG.mode;
    const nid  = DRAG.noteId;
    const moved = DRAG.moved;
    const multi = DRAG.multi;
    vp.style.cursor = 'grab';
    try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
    DRAG.mode = null; DRAG.noteId = null; DRAG.multi = null;
    // v1203 範囲選択 の 確定
    if (mode === 'rect-select' && RECT_SELECT) {
      const r = RECT_SELECT;
      const x1 = Math.min(r.x1, r.x2), y1 = Math.min(r.y1, r.y2);
      const x2 = Math.max(r.x1, r.x2), y2 = Math.max(r.y1, r.y2);
      RECT_SELECT = null;
      renderRectSelect();
      let added = 0;
      // 選択矩形 内 に 完全 に 収まる note を 追加 (Miro/Figma 風、 交差 でなく 内包)
      for (const n of Object.values(NOTE_MAP)) {
        if (!n || n.hidden_for_me) continue;
        const w = n.width || 200, h = n.height || 200;
        if (n.x >= x1 && n.y >= y1 && (n.x + w) <= x2 && (n.y + h) <= y2) {
          SELECTED_NOTE_IDS.add(n.id);
          SELECTED_NOTE_ID = n.id;
          added++;
        }
      }
      updateSelectionHighlight();
      if (added > 0) toast(`${added} 枚 選択`, 900);
      return;
    }
    if ((mode === 'note' || mode === 'resize') && nid && moved) {
      const n = NOTE_MAP[nid];
      if (n) {
        try {
          if (mode === 'note') {
            // v1203 multi-drag: DRAG.multi の 全 note を 並列 で PATCH
            if (multi && multi.length > 1) {
              const backup = multi.map(m => ({ id: m.id, x0: m.x0, y0: m.y0 }));
              await Promise.all(multi.map(m => {
                const nn = NOTE_MAP[m.id];
                if (!nn) return null;
                return patch(`/api/board/notes/${m.id}`, { x: nn.x, y: nn.y }).catch(() => {});
              }));
              // undo: 全 note を 元位置 に 戻す
              pushUndo(`${multi.length} 枚 の 移動 を 取消`, async () => {
                await Promise.all(backup.map(m => {
                  const nn = NOTE_MAP[m.id]; if (!nn) return null;
                  nn.x = m.x0; nn.y = m.y0;
                  return patch(`/api/board/notes/${m.id}`, { x: m.x0, y: m.y0 }).catch(() => {});
                }));
                renderAll();
              });
            } else {
              await patch(`/api/board/notes/${nid}`, { x: n.x, y: n.y });
            }
          }
          if (mode === 'resize') await patch(`/api/board/notes/${nid}`, { width: n.width, height: n.height });
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

  // v1182 pointercancel も pinch 状態を掃除 (touch interrupt 対策)
  vp.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch' && ACTIVE_POINTERS.has(e.pointerId)) {
      ACTIVE_POINTERS.delete(e.pointerId);
      if (ACTIVE_POINTERS.size < 2) PINCH_STATE = null;
    }
  });

  // wheel = zoom
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.0015);
    zoomAtScreen(e.clientX, e.clientY, VIEW.scale * factor);
  }, { passive: false });

  // v1191 中村さん再報告「手書きできない」の 決定版 修正: v1178 の mousedown 保険 と
  //   window mousemove/mouseup は 撤去。 pointer events 単独で 全ての 入力を 扱う (二重
  //   発火 の 誤解を 排除)。 pointerType が mouse/pen/touch のどれでも 上の pointerdown/
  //   move/up の 一本道 で 完結。
}

function zoomAtScreen(sx, sy, newScale) {
  const s = Math.max(0.1, Math.min(4, newScale));
  const rect = document.getElementById('board-viewport').getBoundingClientRect();
  const px = sx - rect.left, py = sy - rect.top;
  const wx = (px - VIEW.tx) / VIEW.scale;
  const wy = (py - VIEW.ty) / VIEW.scale;
  VIEW.scale = s;
  VIEW.tx = px - wx * s;
  VIEW.ty = py - wy * s;
  applyTransform();
}

function wireToolbar() {
  document.getElementById('board-add').addEventListener('click', createNoteAtCenter);
  // v1177 インポートメニュー
  const importBtn = document.getElementById('board-import');
  const importMenu = document.getElementById('board-import-menu');
  importBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    importMenu.style.display = importMenu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => { importMenu.style.display = 'none'; });
  document.querySelectorAll('.board-import-item').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      importMenu.style.display = 'none';
      const kind = b.dataset.import;
      if (kind === 'refs')   openRefsPicker();
      else if (kind === 'places') openPlacesPicker();
      else if (kind === 'images') document.getElementById('board-import-image-input').click();
      else if (kind === 'videos') document.getElementById('board-import-video-input').click();
    });
  });
  document.getElementById('board-import-image-input').addEventListener('change', (ev) => uploadFilesAsNotes(ev.target.files, 'image'));
  document.getElementById('board-import-video-input').addEventListener('change', (ev) => uploadFilesAsNotes(ev.target.files, 'video'));
  // v1173 モード切替
  document.querySelectorAll('.board-mode').forEach(b => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });
  // v1202 fb#496: 左ツールバー の title を data-tip に 反映 (独自 tooltip 用)
  document.querySelectorAll('#board-shell .b-icon-btn[title]').forEach(b => {
    if (!b.dataset.tip) b.dataset.tip = b.title;
  });
  // v1201 図形 picker
  const shapeMenu = document.getElementById('board-shape-menu');
  document.getElementById('board-mode-shape')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    // shape mode ON + menu 表示
    setMode('shape');
    shapeMenu.style.display = shapeMenu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => { if (shapeMenu) shapeMenu.style.display = 'none'; });
  document.querySelectorAll('.board-shape-type').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      SHAPE_TYPE = b.dataset.shape;
      // 選択状態 の highlight
      document.querySelectorAll('.board-shape-type').forEach(x => x.classList.toggle('active', x === b));
      const label = SHAPE_TYPE === 'rect' ? '⬜ 四角' : SHAPE_TYPE === 'ellipse' ? '⭕ 楕円' : '─ 直線';
      toast('図形: ' + label + (SHAPE_DASHED ? ' (点線)' : ''), 1200);
    });
  });
  document.getElementById('board-shape-dashed')?.addEventListener('change', (ev) => {
    SHAPE_DASHED = !!ev.target.checked;
  });
  document.getElementById('board-pen-color').addEventListener('input', (e) => { PEN_COLOR = e.target.value; });
  document.getElementById('board-pen-width').addEventListener('change', (e) => { PEN_WIDTH = Number(e.target.value) || 2.5; });
  // v1196 Undo
  document.getElementById('board-undo')?.addEventListener('click', () => doUndo());
  window.addEventListener('keydown', boardKeydown);
  setMode('select');
  document.getElementById('board-zoom-in').addEventListener('click', () => {
    const vp = document.getElementById('board-viewport');
    zoomAtScreen(vp.clientWidth / 2 + vp.getBoundingClientRect().left,
                 vp.clientHeight / 2 + vp.getBoundingClientRect().top,
                 VIEW.scale * 1.2);
  });
  document.getElementById('board-zoom-out').addEventListener('click', () => {
    const vp = document.getElementById('board-viewport');
    zoomAtScreen(vp.clientWidth / 2 + vp.getBoundingClientRect().left,
                 vp.clientHeight / 2 + vp.getBoundingClientRect().top,
                 VIEW.scale / 1.2);
  });
  document.getElementById('board-zoom-fit').addEventListener('click', () => { fitAll(); });
  // v1188 … メニュー (削除)
  const moreBtn  = document.getElementById('board-more');
  const moreMenu = document.getElementById('board-more-menu');
  moreBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    moreMenu.style.display = moreMenu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => { moreMenu.style.display = 'none'; });
  document.getElementById('board-delete').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    moreMenu.style.display = 'none';
    if (!ROOM) return;
    if (!confirm(`ボード「${ROOM.title}」を削除しますか?\n\n・貼ってあるノートも一緒に見えなくなります\n・作成者 or admin だけが実行できます\n・元に戻すには DB 側 (archived_at を NULL に戻す) 操作が必要です`)) return;
    try {
      await del(`/api/board/rooms/${ROOM_ID}`);
      toast('ボードを削除したよ');
      navigate('/board');
    } catch (e) {
      toast('削除失敗: ' + e.message);
    }
  });
  // palette (デフォルト色)
  document.querySelectorAll('#board-palette .bpal').forEach(el => {
    el.addEventListener('click', async () => {
      MY_DEFAULT_COLOR = el.dataset.color;
      highlightPalette();
      try {
        await put('/api/board/default-color', { color: MY_DEFAULT_COLOR });
        toast('デフォルト色を保存 (' + MY_DEFAULT_COLOR + ')');
      } catch (_) {}
    });
  });
}

function highlightPalette() {
  document.querySelectorAll('#board-palette .bpal').forEach(el => {
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
  const layer = document.getElementById('board-layer');
  if (!layer) return;
  applyTransform();
  // v1173 手書きストロークも同時に描画
  renderStrokes();
  // v1189 note-to-note 矢印 も同時に描画
  renderArrows();
  // z_index でソート
  const sorted = [...Object.values(NOTE_MAP)].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
  // 編集中ノートの現在値を保存 (再描画で消えるので後で戻す)。 EDITING_NOTE_ID を
  //   一時的に null にして innerHTML 破棄で起きる blur を空振りさせる (自動 commit で
  //   空文字が保存されないように)。後で復元 + snapshot 付き enterInlineEdit する。
  let editingSnapshot = null;
  const wasEditing = EDITING_NOTE_ID;
  if (wasEditing) {
    const ta = document.querySelector(`.bnote[data-id="${wasEditing}"] .bnote-editta`);
    if (ta) editingSnapshot = { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
    EDITING_NOTE_ID = null;
  }
  // v1192 layer 直下 の SVG を 破壊 しない よう、 notes は board-notes-container に 書く
  const notesRoot = document.getElementById('board-notes-container') || layer;
  notesRoot.innerHTML = sorted.map(noteHtml).join('');
  notesRoot.querySelectorAll('[data-flip-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      flipNote(parseInt(el.dataset.flipId, 10));
    });
  });
  notesRoot.querySelectorAll('[data-genimg-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openImagePromptFor(parseInt(el.dataset.genimgId, 10));
    });
  });
  notesRoot.querySelectorAll('[data-clearimg-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      clearImageFor(parseInt(el.dataset.clearimgId, 10));
    });
  });
  notesRoot.querySelectorAll('[data-color-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorPop(parseInt(el.dataset.colorId, 10), el);
    });
  });
  notesRoot.querySelectorAll('[data-del-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(parseInt(el.dataset.delId, 10));
    });
  });
  // 編集中だった場合は再度 textarea を立て、値と選択位置を復元
  if (wasEditing && NOTE_MAP[wasEditing]) {
    enterInlineEdit(wasEditing, editingSnapshot);
  }
  // v1202 選択状態 の 見た目 を 復元
  updateSelectionHighlight();
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
    body = `<div class="bnote-body" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; user-select:none; gap:6px; opacity:0.55">
              <div style="font-size:42px">🙈</div>
              <div style="font-size:11px; color:rgba(0,0,0,0.5); font-weight:600">隠されています</div>
            </div>`;
  } else {
    const img = n.front_image_url;
    const imgBlock = img ? `<img src="${escapeHtml(img)}" style="max-width:100%; max-height:70%; object-fit:contain; border-radius:4px; margin-bottom:4px" alt="">` : '';
    const fpx = dynamicFontSize(n.front_text || '', n.width, n.height);
    body = `<div class="bnote-body" style="flex:1; overflow:hidden; white-space:pre-wrap; word-break:break-word; padding-top:4px; display:flex; flex-direction:column">
              ${imgBlock}
              <div class="bnote-text" style="font-size:${fpx}px; line-height:1.25; text-align:center; display:flex; align-items:center; justify-content:center; flex:1">${escapeHtml(n.front_text || '')}</div>
            </div>`;
  }
  // v1109 自分だけ見えてる (= ウラ) 時の視覚ヒント: 破線ボーダー + 少しグレイアウト
  //   中村さん指示「ウラにすると、自分の画面でも少しグレイアウトしてる感じで見せて欲しい」
  const extraBorder = (isMine && isHidden) ? '; border:2px dashed rgba(124,58,237,0.55)' : '';
  const extraFilter = (isMine && isHidden) ? '; filter:saturate(0.45) opacity(0.82)' : '';
  return `
    <div class="bnote" data-id="${n.id}"
         style="position:absolute; left:${n.x}px; top:${n.y}px; width:${n.width}px; height:${n.height}px;
                background:${bg}; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.15)${extraBorder}${extraFilter};
                transform:rotate(${n.rotation || 0}deg); transform-origin:center; padding:8px;
                display:flex; flex-direction:column; user-select:none; touch-action:none; cursor:grab;
                box-sizing:border-box; font-family:'Segoe UI', system-ui, sans-serif">
      ${header}
      ${body}
      ${n.link_url && !hiddenForMe ? `<a href="${escapeHtml(n.link_url)}" class="bnote-link" data-note-link title="元ページを開く"
              onclick="event.stopPropagation()"
              onpointerdown="event.stopPropagation()"
              onmousedown="event.stopPropagation()"
              style="position:absolute; left:4px; bottom:4px; width:22px; height:22px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.85); color:#0369a1; border-radius:50%; text-decoration:none; font-size:13px; line-height:1; box-shadow:0 1px 2px rgba(0,0,0,0.15); z-index:2">🔗</a>` : ''}
      <div class="bhandle" style="position:absolute; right:0; bottom:0; width:16px; height:16px; cursor:nwse-resize; background:linear-gradient(135deg, transparent 40%, rgba(0,0,0,0.25) 50%, transparent 60%)"></div>
    </div>
  `;
}

// ─── actions ──────────────────────────────────────────────────

async function createNoteAtCenter() {
  const vp = document.getElementById('board-viewport');
  const cx = vp.clientWidth / 2, cy = vp.clientHeight / 2;
  const rect = vp.getBoundingClientRect();
  const world = screenToWorld(rect.left + cx, rect.top + cy);
  try {
    const r = await post(`/api/board/rooms/${ROOM_ID}/notes`, {
      x: world.x - 110, y: world.y - 110,
      width: 220, height: 220,
      color: MY_DEFAULT_COLOR,
      front_text: '',
    });
    NOTE_MAP[r.id] = r.note;
    NOTES = Object.values(NOTE_MAP);
    renderAll();
    // v1196 undo: 追加したノートを削除
    const nid = r.id;
    pushUndo('ノート追加を取消', async () => {
      await del(`/api/board/notes/${nid}`).catch(() => {});
      delete NOTE_MAP[nid];
      NOTES = Object.values(NOTE_MAP);
      renderAll();
    });
  } catch (e) { toast('追加失敗: ' + e.message); }
}

async function bringToFront(id) {
  try {
    const r = await patch(`/api/board/notes/${id}`, { z_bump: true });
    if (r.note) NOTE_MAP[id].z_index = r.note.z_index;
  } catch (_) {}
}

// v1108 flip = 作成者本人が is_hidden をトグル (他人には裏に見える / 自分にはずっと見える)
async function flipNote(id) {
  try {
    const r = await post(`/api/board/notes/${id}/flip`, {});
    if (r.note && NOTE_MAP[id]) NOTE_MAP[id] = r.note;
    renderAll();
  } catch (e) { toast('切替失敗: ' + e.message); }
}

// ─── inline text edit (v1103, replaces modal) ─────────────────

function enterInlineEdit(id, snapshot) {
  const n = NOTE_MAP[id]; if (!n) return;
  const el = document.querySelector(`.bnote[data-id="${id}"]`);
  if (!el) return;
  EDITING_NOTE_ID = id;
  EDITING_ORIG = n.front_text || '';
  const body = el.querySelector('.bnote-body');
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
    <textarea class="bnote-editta" placeholder="ここに書く…"
      style="flex:1; width:100%; box-sizing:border-box; border:none; outline:none; background:transparent;
             resize:none; overflow:hidden; scrollbar-width:none;
             font-size:${fpx}px; line-height:1.25; text-align:center; font-family:inherit; padding:0; color:inherit; user-select:text"
      >${escapeHtml(initVal)}</textarea>
    <div class="hint-sm" style="font-size:10px; color:#6b7280; margin-top:2px; opacity:0.7">Enter で改行 / Esc で取消 / 外をタップで保存</div>
  `;
  const ta = body.querySelector('.bnote-editta');
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
  const el = document.querySelector(`.bnote[data-id="${id}"] .bnote-editta`);
  const v  = el ? el.value : '';
  EDITING_NOTE_ID = null;
  if (v === EDITING_ORIG) { renderAll(); return; }   // 差分なし
  try {
    const r = await patch(`/api/board/notes/${id}`, { front_text: v });
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
    await del(`/api/board/notes/${id}`);
    delete NOTE_MAP[id];
    NOTES = Object.values(NOTE_MAP);
    renderAll();
  } catch (e) { toast('削除失敗: ' + e.message); }
}

// v1199 消しゴム モード の note タップ 用 (v1201 中村さん要望「付箋の削除の時だけは 確認して欲しい」)
async function deleteNoteWithUndo(id) {
  const backup = NOTE_MAP[id];
  if (!backup) return;
  // 付箋 は 中身 が 大きい ので 誤 タップ 保護 の 確認 (Miro でも 付箋 は 確認あり)
  const preview = (backup.front_text || '').replace(/\s+/g, ' ').slice(0, 40);
  const label = preview ? `「${preview}${preview.length >= 40 ? '…' : ''}」` : 'この空のノート';
  if (!confirm(`${label} を 削除するよ?\n(↶ ボタン / Ctrl+Z で 戻せる)`)) return;
  try {
    await del(`/api/board/notes/${id}`);
    delete NOTE_MAP[id];
    NOTES = Object.values(NOTE_MAP);
    renderAll();
    pushUndo('ノート削除を取消', async () => {
      try {
        const r = await post(`/api/board/rooms/${ROOM_ID}/notes`, {
          x: backup.x, y: backup.y,
          width: backup.width, height: backup.height,
          color: backup.color, front_text: backup.front_text || '',
          back_text: backup.back_text || '', front_image_url: backup.front_image_url || '',
        });
        if (r && r.note) {
          NOTE_MAP[r.id] = r.note;
          NOTES = Object.values(NOTE_MAP);
          renderAll();
        }
      } catch (e) { toast('復元失敗: ' + e.message); }
    });
    toast('ノートを削除 (↶ で戻せる)', 1400);
  } catch (e) { toast('削除失敗: ' + e.message); }
}

async function clearImageFor(id) {
  try {
    const r = await patch(`/api/board/notes/${id}`, { front_image_url: '' });
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
  const pop = document.getElementById('board-color-pop');
  const r = anchorEl.getBoundingClientRect();
  pop.style.display = 'flex';
  pop.style.left = Math.max(4, r.left) + 'px';
  pop.style.top  = (r.bottom + 4) + 'px';
  // 現在色を強調
  const cur = NOTE_MAP[id]?.color || '#FEF9A8';
  pop.querySelectorAll('.bcolor-pop').forEach(el => {
    el.style.borderColor = (el.dataset.color === cur) ? '#4a106d' : 'transparent';
    el.onclick = async (e) => {
      e.stopPropagation();
      const newColor = el.dataset.color;
      pop.style.display = 'none';
      try {
        const rr = await patch(`/api/board/notes/${id}`, { color: newColor });
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
  document.getElementById('board-prompt-modal').style.display = 'flex';
  const close = () => { document.getElementById('board-prompt-modal').style.display = 'none'; PROMPT_NOTE_ID = null; };
  document.getElementById('mprompt-cancel').onclick = close;
  document.getElementById('mprompt-go').onclick = async () => {
    const prompt = document.getElementById('mprompt-text').value.trim();
    if (!prompt) { toast('プロンプトを書いてね'); return; }
    const btn = document.getElementById('mprompt-go');
    btn.disabled = true; btn.textContent = '生成中… (最大 2 分)';
    try {
      const r = await post(`/api/board/notes/${PROMPT_NOTE_ID}/generate-image`, { prompt, side: 'front' });
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
  post(`/api/board/rooms/${ROOM_ID}/cursor`, { x: MY_CURSOR.x, y: MY_CURSOR.y }).catch(() => {});
}

// user_id からユニークな色を作る (HSL の hue を hash から)。
function colorForUser(uid) {
  const h = (uid * 137) % 360;
  return `hsl(${h}, 72%, 45%)`;
}

function worldToScreen(wx, wy) {
  const rect = document.getElementById('board-viewport').getBoundingClientRect();
  return {
    x: wx * VIEW.scale + VIEW.tx,
    y: wy * VIEW.scale + VIEW.ty,
    vw: rect.width,
    vh: rect.height,
  };
}

function renderCursors() {
  const root = document.getElementById('board-cursors');
  if (!root) return;
  const nowMs = Date.now();
  // 期限切れを間引き
  for (const uid in CURSORS) {
    if (nowMs - (CURSORS[uid].seen || 0) > CURSOR_TTL_MS) delete CURSORS[uid];
  }
  const list = Object.values(CURSORS);
  if (!list.length) { root.innerHTML = ''; return; }
  const rect = document.getElementById('board-viewport').getBoundingClientRect();
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
  const mm = document.getElementById('board-minimap');
  const svg = document.getElementById('board-minimap-svg');
  const open = document.getElementById('board-minimap-open');
  if (!mm || !svg || !open) return;
  mm.style.display = MINIMAP_OPEN ? 'block' : 'none';
  open.style.display = MINIMAP_OPEN ? 'none' : 'block';
  if (!MINIMAP_OPEN) return;
  const W = 180, H = 130, PAD = 6;
  // world 範囲 = 全ノート + 現在の視野
  const notes = Object.values(NOTE_MAP);
  const rect = document.getElementById('board-viewport').getBoundingClientRect();
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
  const svg = document.getElementById('board-minimap-svg');
  const toggle = document.getElementById('board-minimap-toggle');
  const opener = document.getElementById('board-minimap-open');
  if (!svg || !toggle || !opener) return;
  const panTo = (e) => {
    const t = svg.__mm_transform; if (!t) return;
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    // 逆変換で world 座標
    const wx = (mx - t.ox) / t.s;
    const wy = (my - t.oy) / t.s;
    // wx/wy を viewport の中央に来るようにパン
    const vp = document.getElementById('board-viewport');
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
  const modal = document.getElementById('board-refs-modal');
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
  document.getElementById('board-refs-modal').style.display = 'none';
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
    const vp = document.getElementById('board-viewport');
    const rect = vp.getBoundingClientRect();
    const mid = screenToWorld(rect.left + vp.clientWidth / 2, rect.top + vp.clientHeight / 2);
    const r = await post(`/api/board/rooms/${ROOM_ID}/notes-from-refs`, {
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
  const modal = document.getElementById('board-places-modal');
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
  document.getElementById('board-places-modal').style.display = 'none';
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
    const vp = document.getElementById('board-viewport');
    const rect = vp.getBoundingClientRect();
    const mid = screenToWorld(rect.left + vp.clientWidth / 2, rect.top + vp.clientHeight / 2);
    const r = await post(`/api/board/rooms/${ROOM_ID}/notes-from-places`, {
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

// ─── v1177 ファイルアップロード → 画像ノート化 ─────────────────
async function uploadFilesAsNotes(files, mediaType) {
  if (!files || !files.length) return;
  if (mediaType === 'video') {
    toast('動画対応は次バージョン (要 /api/uploads/video 実装) で対応予定');
    return;
  }
  const arr = [...files].slice(0, 20);  // 一度に 20 個まで
  if (files.length > 20) toast('20 個を超えたので先頭 20 個だけ処理します');
  toast(`${arr.length} 個のファイルをアップロード中…`);
  // 視野中央 (world 座標) からグリッド配置
  const vp = document.getElementById('board-viewport');
  const rect = vp.getBoundingClientRect();
  const mid = screenToWorld(rect.left + vp.clientWidth / 2, rect.top + vp.clientHeight / 2);
  const W = 260, H = 260, GAP = 20;
  const cols = Math.max(1, Math.ceil(Math.sqrt(arr.length)));
  const rows = Math.ceil(arr.length / cols);
  const totalW = cols * W + (cols - 1) * GAP;
  const totalH = rows * H + (rows - 1) * GAP;
  const x0 = mid.x - totalW / 2, y0 = mid.y - totalH / 2;
  let ok = 0, fail = 0;
  for (let i = 0; i < arr.length; i++) {
    const file = arr[i];
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/api/uploads/image', { method: 'POST', body: fd, credentials: 'include' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const url = data.url || data.image_url;
      if (!url) throw new Error('response に url なし');
      const col = i % cols, row = Math.floor(i / cols);
      const x = x0 + col * (W + GAP), y = y0 + row * (H + GAP);
      // ノート作成 (画像のみ、テキストなし)
      const r = await post(`/api/board/rooms/${ROOM_ID}/notes`, {
        x, y, width: W, height: H,
        front_image_url: url,
        front_text: null,
      });
      if (r && r.note) {
        NOTE_MAP[r.note.id] = r.note;
      }
      ok++;
    } catch (e) {
      console.error('upload failed', file.name, e);
      fail++;
    }
  }
  NOTES = Object.values(NOTE_MAP);
  renderAll();
  toast(`${ok} 個アップロード完了` + (fail ? ` (${fail} 個失敗)` : ''));
  // input をリセット (同ファイル再選択できるように)
  document.getElementById('board-import-image-input').value = '';
}

// ─── v1173 手書き ───────────────────────────────────────
function setMode(m) {
  MODE = m;
  // v1190 レール ボタン は .active クラスで highlight (b-icon-btn.active)
  document.querySelectorAll('.board-mode').forEach(b => {
    const active = b.dataset.mode === m;
    b.classList.toggle('active', active);
    // 旧 .btn 系 の 直接 style 上書きも残しておく (b-icon-btn 以外の セレクタから 呼ばれても 効くよう)
    b.style.background = active ? '#7b3fa0' : '';
    b.style.color      = active ? '#fff'   : '';
  });
  // v1200 モード切替 の toast を 使い方 付き に (中村さん実測「矢印はノード間、消しゴムはクリックなのね」→ 一目で 分かる 説明を 添える)
  const HINT = {
    select: '🖐 選択/移動: パン+ドラッグ / Shift+クリック で 複数選択 / Shift+ドラッグ で 範囲選択 / Ctrl+C/V',
    draw:   '✏️ 手書き: ドラッグで 自由 に 線を 引く',
    arrow:  '↗ 矢印: ノードA → ノードB を 順にタップ で 接続',
    shape:  '⬜ 図形: ドラッグ で 四角/楕円/直線 を 描く (点線 チェックで 破線に)',
    erase:  '🩹 消しゴム: 線/矢印/ノート を タップで 削除 (↶ で 戻せる)',
  };
  toast(HINT[m] || m, 1600);
  const pen = document.getElementById('board-pen-group');
  if (pen) pen.style.display = (m === 'draw' || m === 'shape') ? 'flex' : 'none';
  // v1197 SVG root は none 固定 (hit-test は 手動 で NOTE_MAP / STROKE_MAP / ARROW_MAP から)
  const svg = document.getElementById('board-strokes-svg');
  if (svg) svg.style.pointerEvents = 'none';
  const asvg = document.getElementById('board-arrows-svg');
  if (asvg) asvg.style.pointerEvents = 'none';
  const vp = document.getElementById('board-viewport');
  if (vp) {
    vp.style.cursor = m === 'draw' ? 'crosshair'
                    : m === 'erase' ? 'not-allowed'
                    : m === 'arrow' ? 'cell'
                    : 'grab';
  }
  // v1189 モード切替 で 矢印 の 選択状態 は 常にクリア + 再描画 (pointerEvents 反映)
  if (m !== 'arrow') ARROW_SOURCE_NOTE_ID = null;
  renderArrows();
}

function renderStrokes() {
  const svg = document.getElementById('board-strokes-svg');
  if (!svg) return;
  const parts = [];
  for (const s of Object.values(STROKE_MAP)) {
    if (!s || !Array.isArray(s.points) || s.points.length < 2) continue;
    const shape = s.shape || 'freehand';
    const dash = s.dashed ? ' stroke-dasharray="8,6"' : '';
    // v1201 shape 別 rendering
    if (shape === 'rect' || shape === 'ellipse' || shape === 'line') {
      const p1 = s.points[0], p2 = s.points[s.points.length - 1];
      const x1 = Math.min(p1.x, p2.x) + 10000;
      const y1 = Math.min(p1.y, p2.y) + 10000;
      const x2 = Math.max(p1.x, p2.x) + 10000;
      const y2 = Math.max(p1.y, p2.y) + 10000;
      if (shape === 'rect') {
        parts.push(`<rect data-stroke-id="${s.id}" x="${x1.toFixed(1)}" y="${y1.toFixed(1)}" width="${(x2-x1).toFixed(1)}" height="${(y2-y1).toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="${s.width}"${dash} pointer-events="stroke" />`);
      } else if (shape === 'ellipse') {
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        const rx = Math.max(1, (x2 - x1) / 2), ry = Math.max(1, (y2 - y1) / 2);
        parts.push(`<ellipse data-stroke-id="${s.id}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="${s.width}"${dash} pointer-events="stroke" />`);
      } else {  // line
        parts.push(`<line data-stroke-id="${s.id}" x1="${(p1.x + 10000).toFixed(1)}" y1="${(p1.y + 10000).toFixed(1)}" x2="${(p2.x + 10000).toFixed(1)}" y2="${(p2.y + 10000).toFixed(1)}" stroke="${s.color}" stroke-width="${s.width}"${dash} stroke-linecap="round" pointer-events="stroke" />`);
      }
      continue;
    }
    // freehand (既存 path)
    const d = s.points.map((p, i) => (i === 0 ? 'M' : 'L') + (p.x + 10000).toFixed(1) + ',' + (p.y + 10000).toFixed(1)).join(' ');
    parts.push(`<path data-stroke-id="${s.id}" d="${d}" stroke="${s.color}" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${dash} pointer-events="stroke"/>`);
  }
  svg.innerHTML = parts.join('');
}

// v1201 図形描画中 の preview (drag 中 に 半透明で 出す)
function renderCurrentShape() {
  const svg = document.getElementById('board-strokes-svg');
  if (!svg) return;
  let cur = svg.querySelector('#board-current-shape');
  if (!CURRENT_SHAPE) { if (cur) cur.remove(); return; }
  const { x1, y1, x2, y2 } = CURRENT_SHAPE;
  const X1 = Math.min(x1, x2) + 10000, Y1 = Math.min(y1, y2) + 10000;
  const X2 = Math.max(x1, x2) + 10000, Y2 = Math.max(y1, y2) + 10000;
  const dash = SHAPE_DASHED ? '8,6' : '';
  if (cur) cur.remove();
  let el;
  if (SHAPE_TYPE === 'rect') {
    el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    el.setAttribute('x', X1.toFixed(1)); el.setAttribute('y', Y1.toFixed(1));
    el.setAttribute('width', (X2 - X1).toFixed(1)); el.setAttribute('height', (Y2 - Y1).toFixed(1));
  } else if (SHAPE_TYPE === 'ellipse') {
    el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    el.setAttribute('cx', ((X1 + X2) / 2).toFixed(1));
    el.setAttribute('cy', ((Y1 + Y2) / 2).toFixed(1));
    el.setAttribute('rx', Math.max(1, (X2 - X1) / 2).toFixed(1));
    el.setAttribute('ry', Math.max(1, (Y2 - Y1) / 2).toFixed(1));
  } else {  // line
    el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    el.setAttribute('x1', (x1 + 10000).toFixed(1)); el.setAttribute('y1', (y1 + 10000).toFixed(1));
    el.setAttribute('x2', (x2 + 10000).toFixed(1)); el.setAttribute('y2', (y2 + 10000).toFixed(1));
    el.setAttribute('stroke-linecap', 'round');
  }
  el.id = 'board-current-shape';
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', PEN_COLOR);
  el.setAttribute('stroke-width', String(PEN_WIDTH));
  if (dash) el.setAttribute('stroke-dasharray', dash);
  el.setAttribute('opacity', '0.8');
  svg.appendChild(el);
}

// v1192 diagnostic
function updateDebug(lastEvent, targetTag) {
  const m = document.getElementById('board-dbg-mode');
  const d = document.getElementById('board-dbg-drag');
  const p = document.getElementById('board-dbg-pts');
  const l = document.getElementById('board-dbg-last');
  if (m) m.textContent = 'MODE=' + MODE;
  if (d) d.textContent = 'DRAG=' + (DRAG.mode || '_');
  if (p) p.textContent = 'pts=' + (CURRENT_STROKE ? CURRENT_STROKE.points.length : 0);
  if (l && lastEvent) l.textContent = 'last=' + lastEvent + (targetTag ? '|t=' + targetTag : '');
}

function renderCurrentStroke() {
  // 描画中の暫定 stroke を専用の path として付ける (id=board-current-stroke)
  const svg = document.getElementById('board-strokes-svg');
  if (!svg) return;
  let cur = svg.querySelector('#board-current-stroke');
  if (!CURRENT_STROKE || CURRENT_STROKE.points.length < 2) {
    if (cur) cur.remove();
    updateDebug('render(none)');
    return;
  }
  const d = CURRENT_STROKE.points.map((p, i) => (i === 0 ? 'M' : 'L') + (p.x + 10000).toFixed(1) + ',' + (p.y + 10000).toFixed(1)).join(' ');
  if (!cur) {
    cur = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    cur.id = 'board-current-stroke';
    cur.setAttribute('fill', 'none');
    cur.setAttribute('stroke-linecap', 'round');
    cur.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(cur);
  }
  cur.setAttribute('d', d);
  cur.setAttribute('stroke', CURRENT_STROKE.color);
  cur.setAttribute('stroke-width', String(CURRENT_STROKE.width));
  updateDebug('render(' + CURRENT_STROKE.points.length + ')');
}

async function deleteStroke(sid) {
  const backup = STROKE_MAP[sid];
  await del(`/api/board/strokes/${sid}`);
  delete STROKE_MAP[sid];
  STROKES = Object.values(STROKE_MAP);
  renderStrokes();
  // v1196 undo: 消したストロークを再作成
  if (backup && backup.points) {
    pushUndo('線の削除を取消', async () => {
      try {
        const r = await post(`/api/board/rooms/${ROOM_ID}/strokes`, {
          points: backup.points, color: backup.color, width: backup.width,
        });
        if (r && r.stroke) {
          STROKE_MAP[r.stroke.id] = r.stroke;
          STROKES = Object.values(STROKE_MAP);
          renderStrokes();
        }
      } catch (e) { toast('再作成失敗: ' + e.message); }
    });
  }
}

// ─── v1189 note-to-note 矢印 ───────────────────────────────────

// note の 中心 world 座標 (v1201: n.width/n.height の フィールド名 バグ 修正)
function noteCenter(nid) {
  const n = NOTE_MAP[nid]; if (!n) return null;
  return { x: (n.x || 0) + (n.width || 200) / 2, y: (n.y || 0) + (n.height || 200) / 2 };
}
// note の bounding box (world 座標)
function noteBox(nid) {
  const n = NOTE_MAP[nid]; if (!n) return null;
  const x1 = n.x || 0, y1 = n.y || 0;
  const w = n.width || 200, h = n.height || 200;
  return { x1, y1, x2: x1 + w, y2: y1 + h, cx: x1 + w / 2, cy: y1 + h / 2 };
}
// note の rect edge と 中心 → 外向き の 線分 の 交点。 gap 分 さらに 外側 に 押し出す。
//   矢印 の 始点/終点 が 付箋 から 少し 離れる ように する ため。
function rectEdgeToward(box, tx, ty, gap) {
  const cx = box.cx, cy = box.cy;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // 中心 から 外へ の parametric line: (cx + t*dx, cy + t*dy)。 rect の 4 辺 の うち 最短 の t (>0) を 探す。
  const halfW = (box.x2 - box.x1) / 2;
  const halfH = (box.y2 - box.y1) / 2;
  const tx2 = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const ty2 = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tx2, ty2);
  // 交点 = 中心 + t * (dx, dy)
  const ex = cx + t * dx, ey = cy + t * dy;
  // gap 分 (px) 外向き に 追加
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len, uy = dy / len;
  return { x: ex + ux * gap, y: ey + uy * gap };
}

function renderArrows() {
  const svg = document.getElementById('board-arrows-svg');
  if (!svg) return;
  const defs = svg.querySelector('defs');
  const parts = [];
  for (const a of Object.values(ARROW_MAP)) {
    if (!a) continue;
    const boxS = noteBox(a.from_note_id);
    const boxT = noteBox(a.to_note_id);
    if (!boxS || !boxT) continue;
    // v1201 中村さん要望「矢印の始点終点は 付箋から少し離して」→ rect の 実際 の 辺 で 交点 を 取って、
    //   gap:14px 分 外側 に 押し出す。 これで 付箋 と 矢印線 の 間 に 空気層 が 生まれる。
    const GAP = 14;
    const q1 = rectEdgeToward(boxS, boxT.cx, boxT.cy, GAP);
    const q2 = rectEdgeToward(boxT, boxS.cx, boxS.cy, GAP);
    const dash = a.style === 'dashed' ? ' stroke-dasharray="8,6"' : '';
    // 選択中の source を強調
    const highlight = (a.from_note_id === ARROW_SOURCE_NOTE_ID || a.to_note_id === ARROW_SOURCE_NOTE_ID);
    const strokeW = highlight ? 4 : 2.5;
    // 太い透明ライン を 下敷き に 置いて タップ判定 を 広げる (12px ヒット)
    parts.push(`<line data-arrow-id="${a.id}" x1="${(q1.x+10000).toFixed(1)}" y1="${(q1.y+10000).toFixed(1)}" x2="${(q2.x+10000).toFixed(1)}" y2="${(q2.y+10000).toFixed(1)}" stroke="transparent" stroke-width="14" pointer-events="stroke" style="cursor:pointer" />`);
    parts.push(`<line data-arrow-id="${a.id}" x1="${(q1.x+10000).toFixed(1)}" y1="${(q1.y+10000).toFixed(1)}" x2="${(q2.x+10000).toFixed(1)}" y2="${(q2.y+10000).toFixed(1)}" stroke="${a.color}" stroke-width="${strokeW}" marker-end="url(#board-arrow-head)"${dash} pointer-events="none" />`);
    if (a.label) {
      const mx = (q1.x + q2.x) / 2 + 10000;
      const my = (q1.y + q2.y) / 2 + 10000;
      const w = Math.max(20, (a.label.length * 8) + 12);
      parts.push(`<rect x="${(mx - w / 2).toFixed(1)}" y="${(my - 11).toFixed(1)}" width="${w.toFixed(1)}" height="18" rx="3" fill="#fff" stroke="${a.color}" stroke-width="1" pointer-events="none" />`);
      parts.push(`<text x="${mx.toFixed(1)}" y="${(my + 3).toFixed(1)}" font-size="12" text-anchor="middle" fill="${a.color}" pointer-events="none">${escapeHtml(a.label)}</text>`);
    }
  }
  // defs は 残して 本体を差替え
  svg.innerHTML = (defs ? defs.outerHTML : '') + parts.join('');
  // v1197 SVG root は 常に none、 hit-test は 手動 (hitTestArrow) で NOTE_MAP から 幾何計算。
  svg.style.pointerEvents = 'none';
  // 各矢印線 に click ハンドラ
  svg.querySelectorAll('[data-arrow-id]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const aid = parseInt(el.dataset.arrowId, 10);
      onArrowClick(aid);
    });
  });
}

function onArrowClick(aid) {
  const a = ARROW_MAP[aid]; if (!a) return;
  if (MODE === 'erase') { deleteArrow(aid); return; }
  // arrow / select モード: 簡易ダイアログ
  const nxt = prompt(`矢印 のラベル (空欄で無し / "delete" で削除 / "dash" で 破線切替)\n色は 頭に #RRGGBB を 付ければ 一緒に 変更 (例: "#ff0000 因果")`, a.label || '');
  if (nxt === null) return;
  const trimmed = nxt.trim();
  if (trimmed === 'delete') { deleteArrow(aid); return; }
  if (trimmed === 'dash') { patchArrow(aid, { style: a.style === 'solid' ? 'dashed' : 'solid' }); return; }
  let color = a.color, label = trimmed;
  const m = trimmed.match(/^(#[0-9A-Fa-f]{6})\s*(.*)$/);
  if (m) { color = m[1]; label = m[2].trim(); }
  patchArrow(aid, { color, label });
}

async function patchArrow(aid, body) {
  try {
    const r = await patch(`/api/board/arrows/${aid}`, body);
    if (r && r.arrow) { ARROW_MAP[aid] = r.arrow; renderArrows(); }
  } catch (e) { toast('矢印更新失敗: ' + e.message); }
}
async function deleteArrow(aid) {
  const backup = ARROW_MAP[aid];
  try {
    await del(`/api/board/arrows/${aid}`);
    delete ARROW_MAP[aid];
    ARROWS = Object.values(ARROW_MAP);
    renderArrows();
    // v1196 undo: 消した矢印を再作成
    if (backup && backup.from_note_id && backup.to_note_id) {
      pushUndo('矢印の削除を取消', async () => {
        try {
          const r = await post(`/api/board/rooms/${ROOM_ID}/arrows`, {
            from_note_id: backup.from_note_id, to_note_id: backup.to_note_id,
            color: backup.color, style: backup.style, label: backup.label,
          });
          if (r && r.arrow) {
            ARROW_MAP[r.arrow.id] = r.arrow;
            ARROWS = Object.values(ARROW_MAP);
            renderArrows();
          }
        } catch (e) { toast('再作成失敗: ' + e.message); }
      });
    }
  } catch (e) { toast('矢印削除失敗: ' + e.message); }
}

async function tryCreateArrow(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  try {
    const r = await post(`/api/board/rooms/${ROOM_ID}/arrows`, {
      from_note_id: fromId, to_note_id: toId,
    });
    if (r && r.arrow) {
      const wasNew = !r.existed;
      ARROW_MAP[r.arrow.id] = r.arrow;
      ARROWS = Object.values(ARROW_MAP);
      renderArrows();
      toast(r.existed ? '既にある矢印を選択' : '矢印を追加');
      if (wasNew) {
        const aid = r.arrow.id;
        pushUndo('矢印を取消', async () => {
          await del(`/api/board/arrows/${aid}`).catch(() => {});
          delete ARROW_MAP[aid];
          ARROWS = Object.values(ARROW_MAP);
          renderArrows();
        });
      }
    }
  } catch (e) { toast('矢印作成失敗: ' + e.message); }
}
