// 🟦 四目並べ (Connect Four) — 自作ゲーム framework サンプル。
//   defineGame() を 使って ロジック + 盤面描画 だけ で 完結 (~75 行)。
//   設定 → 🎮 自作ゲーム 管理 → 新規 kind 登録 で kind=connect-four、
//   JS ファイル = このファイル を 選択。 登録後 /#/cg/connect-four で 動作。

import { defineGame, escapeHtml } from '/js/cg_ui.js';

const ROWS = 6, COLS = 7;

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

export const { renderList, renderDetail } = defineGame({
  kind: 'connect-four',
  title: '🟦 四目並べ',
  hint: '6×7 盤、 重力で 下から積む。 縦・横・斜め 4 つ並べたら勝ち。',

  initialState: (uid) => ({
    board: Array(ROWS * COLS).fill(0),
    creator_uid: uid, opponent_uid: 0, turn_user_id: uid,
  }),

  applyMove: (s, uid, col) => {
    if (s.turn_user_id !== uid) throw new Error('あなたの番ではありません');
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (s.board[r * COLS + col] === 0) { row = r; break; }
    }
    if (row < 0) throw new Error('その列は満杯');
    const mark = uid === s.creator_uid ? 1 : 2;
    const board = s.board.slice(); board[row * COLS + col] = mark;
    const won = checkWin(board, row, col, mark);
    const finished = won || board.every(v => v !== 0);
    const next = finished ? null : (uid === s.creator_uid ? s.opponent_uid : s.creator_uid);
    return { state: { ...s, board, turn_user_id: next }, finished, winner_user_id: won ? uid : null, turn_user_id: next };
  },

  renderBoard: (s, { d, myTurn, status }) => {
    const canPlay = status === 'playing' && myTurn;
    const colBtns = Array.from({ length: COLS }, (_, c) =>
      `<button data-move="${c}" ${canPlay ? '' : 'disabled'}
         style="aspect-ratio:1; background:${canPlay ? '#3b82f6' : '#cbd5e1'}; color:white; border:none; border-radius:4px; font-size:18px">↓</button>`
    ).join('');
    const cells = s.board.map(v => {
      const stone = v === 1 ? '🔴' : v === 2 ? '🟡' : '';
      return `<div style="aspect-ratio:1; background:#1e40af; display:flex; align-items:center; justify-content:center; font-size:22px; border:1px solid #1e3a8a">${stone}</div>`;
    }).join('');
    return `
      <div class="hint-sm" style="margin-top:6px">🔴 ${escapeHtml(d.creator_name || '')} vs 🟡 ${escapeHtml(d.opponent_name || '…')}</div>
      <div style="max-width:420px; margin:10px auto 0">
        <div style="display:grid; grid-template-columns:repeat(${COLS},1fr); gap:2px">${colBtns}</div>
        <div style="display:grid; grid-template-columns:repeat(${COLS},1fr); gap:2px; background:#1e3a8a; padding:2px; margin-top:2px">${cells}</div>
      </div>
    `;
  },
});
