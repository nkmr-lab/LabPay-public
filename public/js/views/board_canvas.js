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
// MODE: 'select' (pan + note ドラッグ) / 'draw' (自由手書き) / 'erase' (ストロークタップで削除) / 'arrow' (ノート → ノート で 矢印)
let MODE = 'select';
let STROKES = [];     // 全ストローク (array)
let STROKE_MAP = {};  // id → stroke
let CURRENT_STROKE = null;  // 描画中: { points:[{x,y},...], color, width }
// v1189 矢印
let ARROWS = [];      // 全矢印
let ARROW_MAP = {};   // id → arrow
let ARROW_SOURCE_NOTE_ID = null;  // arrow モードで 1 本目タップ済 の source note id (2 本目タップで確定)
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
  document.querySelectorAll('#board-shell').forEach(el => el.remove());
  app.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.innerHTML = shellHtml();
  const shell = wrap.firstElementChild;
  document.body.appendChild(shell);
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
    // v1194 body 直下 に 移した shell を 掃除
    document.querySelectorAll('#board-shell').forEach(el => el.remove());
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
        <button class="b-icon-btn board-mode" data-mode="erase"  title="消しゴム (ストローク/矢印 タップで削除)">🩹</button>
        <div class="b-sep"></div>
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

      <!-- v1192 diagnostic bar: 下中央 に DRAG.mode / 点数 / MODE を リアルタイム 表示 -->
      <div id="board-debug" class="b-float" style="top:auto; bottom:8px; left:50%; transform:translateX(-50%); padding:4px 10px; font-size:11px; color:#111827; font-family:monospace; z-index:100">
        <span id="board-dbg-mode">MODE=?</span> <span id="board-dbg-drag">DRAG=?</span> <span id="board-dbg-pts">pts=0</span> <span id="board-dbg-last">last=?</span>
      </div>

      <!-- viewport は 全画面。 UI は 全部 b-float で 上 に 重ねる -->
      <div id="board-viewport" style="position:absolute; top:0; left:0; right:0; bottom:0; overflow:hidden; touch-action:none; user-select:none; -webkit-user-select:none; cursor:grab; background:#fafafa">
        <div id="board-layer" style="position:absolute; left:0; top:0; transform-origin:0 0; will-change:transform">
          <!-- v1173 手書きストローク SVG (world 座標。 board-layer の transform に追随) -->
          <svg id="board-strokes-svg" width="20000" height="20000" style="position:absolute; left:-10000px; top:-10000px; pointer-events:none; overflow:visible"></svg>
          <!-- v1189 note-to-note 矢印 SVG (strokes と 同じ座標系。 note の 上 に 出す ため z-index 高め) -->
          <svg id="board-arrows-svg" width="20000" height="20000" style="position:absolute; left:-10000px; top:-10000px; pointer-events:none; overflow:visible; z-index:5">
            <defs>
              <marker id="board-arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/>
              </marker>
            </defs>
          </svg>
          <!-- v1192 中村さん報告「線が引けない」の 決定的 バグ 修正:
               従来 renderAll で layer.innerHTML = notesHtml していたため
               SVG (strokes / arrows) が 毎回 破棄されていた。 notes 専用の 別 container に
               分離し、 SVG は layer 直下 に 残す。 z-index で notes を SVG より 上 に。 -->
          <div id="board-notes-container" style="position:absolute; left:0; top:0; z-index:2"></div>
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
        // 2 本目が着地 = pinch モード開始。既存の 1 本指 drag/draw をキャンセル
        const [a, b] = [...ACTIVE_POINTERS.values()];
        const dx = b.x - a.x, dy = b.y - a.y;
        PINCH_STATE = { d0: Math.sqrt(dx * dx + dy * dy), scale0: VIEW.scale };
        // 進行中の pan/note/draw を停止 (drag mode 解除、未保存 stroke 廃棄)
        DRAG.mode = null;
        if (CURRENT_STROKE) { CURRENT_STROKE = null; renderCurrentStroke(); }
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
      return;
    }
    // v1173 消しゴムモード: pointerdown で SVG stroke path をタップしたら削除
    if (MODE === 'erase') {
      const path = e.target.closest('path[data-stroke-id]');
      if (path) {
        const sid = parseInt(path.dataset.strokeId, 10);
        deleteStroke(sid).catch(err => toast('削除失敗: ' + err.message));
        updateDebug('erase:stroke');
        return;
      }
      // v1189 消しゴムモードで矢印もタップ削除
      const arrLine = e.target.closest('[data-arrow-id]');
      if (arrLine) {
        deleteArrow(parseInt(arrLine.dataset.arrowId, 10));
        updateDebug('erase:arrow');
        return;
      }
      // v1193 中村さん報告「消しゴム機能せず、ドラッグアンドドロップ」対策:
      //   ノートをタップした時 は 消しゴムモードでは 何もしない (fall-through で drag は 誤解)。
      //   ペン/矢印 の 削除 用 なので、 note を掴んで 動かすのは 意図しない挙動。
      const nEl0 = e.target.closest('.bnote');
      if (nEl0) {
        toast('消しゴムモード: ペンの線 or 矢印 をタップしてね', 1400);
        updateDebug('erase:blocked-note');
        return;
      }
      // 空白タップ は pan させる (下の通常分岐に fall through)
      updateDebug('erase:falling-through-to-pan');
    }
    // v1189 矢印モード: ノートタップ → source, 2 本目ノートタップ → 矢印作成
    if (MODE === 'arrow') {
      const nEl = e.target.closest('.bnote');
      if (nEl) {
        const nid = parseInt(nEl.dataset.id, 10);
        if (!ARROW_SOURCE_NOTE_ID) {
          ARROW_SOURCE_NOTE_ID = nid;
          toast('接続先の付箋をタップしてね', 1400);
          renderArrows();  // 選択状態 の 反映
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
      // 空白タップ で 選択解除 (pan は 下 に fall through で 有効)
      if (ARROW_SOURCE_NOTE_ID) {
        ARROW_SOURCE_NOTE_ID = null;
        renderArrows();
      }
      updateDebug('arrow:falling-through');
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
      DRAG.mode = 'note';
      DRAG.noteId = parseInt(noteEl.dataset.id, 10);
      const n = NOTE_MAP[DRAG.noteId];
      if (!n) return;
      DRAG.startX = e.clientX; DRAG.startY = e.clientY;
      DRAG.noteStartX = n.x; DRAG.noteStartY = n.y;
      // z bump
      bringToFront(DRAG.noteId).catch(() => {});
    } else if (!e.target.closest('button, .bmodal-color, .bpal')) {
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
          const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          const newScale = PINCH_STATE.scale0 * (d / PINCH_STATE.d0);
          zoomAtScreen(cx, cy, newScale);
        }
        return;
      }
    }
    // v1104 自分のカーソル位置 (world 座標) を常時追跡してスロットル送信
    const w = screenToWorld(e.clientX, e.clientY);
    MY_CURSOR.x = w.x; MY_CURSOR.y = w.y;
    scheduleCursorPost();
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
      const n = NOTE_MAP[DRAG.noteId]; if (!n) return;
      n.x = DRAG.noteStartX + dx / VIEW.scale;
      n.y = DRAG.noteStartY + dy / VIEW.scale;
      const el = document.querySelector(`.bnote[data-id="${DRAG.noteId}"]`);
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
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
    vp.style.cursor = 'grab';
    try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
    DRAG.mode = null; DRAG.noteId = null;
    if ((mode === 'note' || mode === 'resize') && nid && moved) {
      const n = NOTE_MAP[nid];
      if (n) {
        try {
          if (mode === 'note')   await patch(`/api/board/notes/${nid}`, { x: n.x, y: n.y });
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
  document.getElementById('board-pen-color').addEventListener('input', (e) => { PEN_COLOR = e.target.value; });
  document.getElementById('board-pen-width').addEventListener('change', (e) => { PEN_WIDTH = Number(e.target.value) || 2.5; });
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
  // v1191 diagnostic: モード切替 が 効いた ことを 中村さんが 目視 で 確認 できる
  if (window.__board_debug !== false) {
    const label = m === 'select' ? '🖱 選択' : m === 'draw' ? '✏️ 手書き' : m === 'arrow' ? '↗ 矢印' : '🩹 消しゴム';
    toast(`モード: ${label}`, 900);
  }
  const pen = document.getElementById('board-pen-group');
  if (pen) pen.style.display = (m === 'draw') ? 'flex' : 'none';
  // v1194 中村さん報告「arrow / erase で drag に なる、 falling-through」の 真犯人:
  //   svg.style.pointerEvents='auto' に する と 20000×20000 の SVG box 全体 が click を
  //   吸収し、 e.target が SVG 本体 = closest('.bnote') が null → arrow/erase 分岐 が
  //   noteEl を 見つけられず fall-through していた。 修正: SVG 本体 は 常に none、
  //   個別 path/line に pointer-events="stroke" を 付けた 部分 だけ が click を 拾う
  //   (v1173 から の path 属性 は 既に そう なっている ので これで 十分)。
  const svg = document.getElementById('board-strokes-svg');
  if (svg) svg.style.pointerEvents = 'none';
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
    // world 座標を SVG viewBox (svg は -10000..10000 の viewport 上に絶対配置) に合わせる
    // ため、各点に +10000 の offset を加える
    const d = s.points.map((p, i) => (i === 0 ? 'M' : 'L') + (p.x + 10000).toFixed(1) + ',' + (p.y + 10000).toFixed(1)).join(' ');
    // 消しゴムモードではヒット判定幅を広くしたいので pointer-events は path の stroke だけに
    const cursorAttr = MODE === 'erase' ? ' style="cursor:pointer" ' : '';
    parts.push(`<path data-stroke-id="${s.id}" d="${d}" stroke="${s.color}" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round" pointer-events="stroke"${cursorAttr}/>`);
  }
  svg.innerHTML = parts.join('');
}

// v1192 diagnostic
function updateDebug(lastEvent) {
  const m = document.getElementById('board-dbg-mode');
  const d = document.getElementById('board-dbg-drag');
  const p = document.getElementById('board-dbg-pts');
  const l = document.getElementById('board-dbg-last');
  if (m) m.textContent = 'MODE=' + MODE;
  if (d) d.textContent = 'DRAG=' + (DRAG.mode || '_');
  if (p) p.textContent = 'pts=' + (CURRENT_STROKE ? CURRENT_STROKE.points.length : 0);
  if (l && lastEvent) l.textContent = 'last=' + lastEvent;
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
  await del(`/api/board/strokes/${sid}`);
  delete STROKE_MAP[sid];
  STROKES = Object.values(STROKE_MAP);
  renderStrokes();
}

// ─── v1189 note-to-note 矢印 ───────────────────────────────────

// note の 中心 world 座標 (fallback: 0,0)
function noteCenter(nid) {
  const n = NOTE_MAP[nid]; if (!n) return null;
  return { x: (n.x || 0) + (n.w || 200) / 2, y: (n.y || 0) + (n.h || 200) / 2 };
}
// 2 点間 の 線分 で、 target 側 の 円 (半径 r) と 交わる 点 を 返す (矢印先端 が ノート に めり込む のを 抑える)
function shortenToward(p1, p2, r) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: p2.x - (dx / d) * r, y: p2.y - (dy / d) * r };
}

function renderArrows() {
  const svg = document.getElementById('board-arrows-svg');
  if (!svg) return;
  const defs = svg.querySelector('defs');
  const parts = [];
  for (const a of Object.values(ARROW_MAP)) {
    if (!a) continue;
    const p1 = noteCenter(a.from_note_id);
    const p2 = noteCenter(a.to_note_id);
    if (!p1 || !p2) continue;
    // ターゲット側の端点を note 半径分 手前 に (見た目 矢印 が ノート に 触れる 程度)
    const nt = NOTE_MAP[a.to_note_id];
    const rt = nt ? (Math.min(nt.w || 200, nt.h || 200) / 2) - 4 : 0;
    const q2 = shortenToward(p1, p2, Math.max(30, rt));
    // ソース側も 少しだけ 内側 (中心 から 半径 分)
    const ns = NOTE_MAP[a.from_note_id];
    const rs = ns ? (Math.min(ns.w || 200, ns.h || 200) / 2) - 4 : 0;
    const q1 = shortenToward(p2, p1, Math.max(20, rs));
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
  // v1194 SVG 本体 は 常に none、 個別 line に pointer-events="stroke" を 付けた
  //   透明ヒット領域 (14px 幅) が click を 拾う。 これで note を 覆う SVG が
  //   click を 吸収して 「arrow/erase で drag に なる」問題 が 解消する。
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
  try {
    await del(`/api/board/arrows/${aid}`);
    delete ARROW_MAP[aid];
    ARROWS = Object.values(ARROW_MAP);
    renderArrows();
  } catch (e) { toast('矢印削除失敗: ' + e.message); }
}

async function tryCreateArrow(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  try {
    const r = await post(`/api/board/rooms/${ROOM_ID}/arrows`, {
      from_note_id: fromId, to_note_id: toId,
    });
    if (r && r.arrow) {
      ARROW_MAP[r.arrow.id] = r.arrow;
      ARROWS = Object.values(ARROW_MAP);
      renderArrows();
      toast(r.existed ? '既にある矢印を選択' : '矢印を追加');
    }
  } catch (e) { toast('矢印作成失敗: ' + e.message); }
}
