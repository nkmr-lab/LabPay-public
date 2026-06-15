// 🟦 四目並べ (Connect Four) — 自作ゲーム framework サンプル。
//
// 共通 UI ヘルパー (/js/cg_ui.js) を 使って、 ロビー / 待ち / 参加 / 終了 の 描画は
// LabPay 任せ、 自分の kind は **ゲームロジック (initialState + applyMove) + 盤面 1 つ**
// だけ 書けば 動く。 ~130 行。
//
// 使い方 (登録手順):
//   1. このファイルを ローカル保存
//   2. LabPay → 設定 → 🎮 自作ゲーム 管理 → 新規 kind 登録
//        kind:        connect-four          (= 下の const KIND と 一致)
//        表示名:       🟦 四目並べ
//        icon:        🟦
//        プレイフィー: 1pt (任意)
//        JS ファイル:  このファイル
//   3. 登録後 /#/cg/connect-four で 動作。 app.js 変更不要。
//
// 必須 export: renderList(ctx), renderDetail(ctx)

import {
  state, toast, escapeHtml,
  renderLobby, startGame, statusCardHtml, wireStatusCard,
  startPolling, submitMove, fetchDetail,
} from '/js/cg_ui.js';

const KIND = 'connect-four';   // ← 登録時の kind と 同じ にする
const ROWS = 6, COLS = 7;

// ── ゲームロジック ─────────────────────────────────────
function initialState(creatorUid) {
  return {
    board: Array(ROWS * COLS).fill(0),
    creator_uid: creatorUid, opponent_uid: 0,
    turn_user_id: creatorUid,
  };
}

function applyMove(s, userId, col) {
  if (s.turn_user_id !== userId) throw new Error('あなたの番ではありません');
  // 重力で 一番下の 空きマス を 探す
  let row = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (s.board[r * COLS + col] === 0) { row = r; break; }
  }
  if (row < 0) throw new Error('その列は満杯');
  const mark = userId === s.creator_uid ? 1 : 2;
  const board = s.board.slice(); board[row * COLS + col] = mark;
  const won = checkWin(board, row, col, mark);
  const finished = won || board.every(v => v !== 0);
  const next = finished ? null : (userId === s.creator_uid ? s.opponent_uid : s.creator_uid);
  return { state: { ...s, board, turn_user_id: next }, finished, winner_user_id: won ? userId : null, turn_user_id: next };
}

function checkWin(b, r, c, mark) {
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    let count = 1;
    for (const sign of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const nr = r + dr*k*sign, nc = c + dc*k*sign;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || b[nr*COLS+nc] !== mark) break;
        count++;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

// ── UI ───────────────────────────────────────────────
export function renderList() {
  return renderLobby({
    kind: KIND,
    title: '🟦 四目並べ',
    hint: '6×7 盤、 重力で 下から積む。 縦・横・斜め 4 つ並べたら勝ち。',
    onNew: () => startGame({ kind: KIND, initialState: initialState(Number(state.me?.id)) }),
  });
}

export function renderDetail({ params }) {
  const gid = Number(params.id);
  startPolling({
    paint: () => paint(gid),
    guardSelector: `[data-c4-gid="${gid}"]`,
  });
}

async function paint(gid) {
  const d = await fetchDetail({ kind: KIND, gid });
  if (!d) return;
  const meId = Number(state.me?.id);
  const board = d.state?.board || Array(ROWS * COLS).fill(0);
  const canPlay = d.status === 'playing' && d.my_turn;

  const colBtns = Array.from({ length: COLS }, (_, c) =>
    `<button data-col="${c}" ${canPlay ? '' : 'disabled'}
       style="aspect-ratio:1; background:${canPlay ? '#3b82f6' : '#cbd5e1'}; color:white; border:none; border-radius:4px; font-size:18px">↓</button>`
  ).join('');
  const cells = board.map(v => {
    const stone = v === 1 ? '🔴' : v === 2 ? '🟡' : '';
    return `<div style="aspect-ratio:1; background:#1e40af; display:flex; align-items:center; justify-content:center; font-size:22px; border:1px solid #1e3a8a">${stone}</div>`;
  }).join('');

  document.getElementById('app').innerHTML = `
    <div class="card" data-c4-gid="${gid}">
      <a href="#/cg/${KIND}" class="hint">← 一覧</a>
      <div class="hint-sm" style="margin-top:6px">🔴 ${escapeHtml(d.creator_name || '')} vs 🟡 ${escapeHtml(d.opponent_name || '…')}</div>
      <div style="max-width:420px; margin:10px auto 0">
        <div style="display:grid; grid-template-columns:repeat(${COLS},1fr); gap:2px">${colBtns}</div>
        <div style="display:grid; grid-template-columns:repeat(${COLS},1fr); gap:2px; background:#1e3a8a; padding:2px; margin-top:2px">${cells}</div>
      </div>
    </div>
    ${statusCardHtml(d, meId)}
  `;

  wireStatusCard({ kind: KIND, gid, d, meId, onAfter: () => paint(gid) });

  document.querySelectorAll(`[data-c4-gid="${gid}"] button[data-col]`).forEach(b => {
    b.addEventListener('click', async () => {
      try {
        const res = applyMove(d.state, meId, Number(b.dataset.col));
        await submitMove({ kind: KIND, gid, res });
        paint(gid);
      } catch (e) { toast(e?.message || e); }
    });
  });
}
