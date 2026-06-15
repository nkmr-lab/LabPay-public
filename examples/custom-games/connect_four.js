// 🟦 四目並べ (Connect Four) — 自作ゲーム framework サンプル。
//
// 3 関数 (setup / draw / action) だけ で 完結。 詳しい コメントは
// examples/custom-games/nim.js が 一番 短くて 読みやすい。

import { sketch, escapeHtml } from '/js/cg_ui.js';

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

export const { renderList, renderDetail } = sketch({
  kind: 'connect-four',
  title: '🟦 四目並べ',
  hint: '6×7 盤、 重力で 下から積む。 縦・横・斜め 4 つ並べたら勝ち。',

  setup() {
    return { board: Array(ROWS * COLS).fill(0) };
  },

  action(s, me, col, ctx) {
    // 重力で 一番下の 空きマス を 探す
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (s.board[r * COLS + col] === 0) { row = r; break; }
    }
    if (row < 0) throw new Error('その列は満杯');
    const mark = ctx.you?.role === 'creator' ? 1 : 2;
    const board = s.board.slice(); board[row * COLS + col] = mark;
    if (checkWin(board, row, col, mark)) return { state: { board }, finished: true, winner: 'me' };
    if (board.every(v => v !== 0))       return { state: { board }, finished: true, winner: null };
    return { state: { board } };
  },

  draw(s, ctx) {
    const canPlay = ctx.status === 'playing' && ctx.myTurn;
    const colBtns = Array.from({ length: COLS }, (_, c) =>
      `<button data-move="${c}" ${canPlay ? '' : 'disabled'}
         style="aspect-ratio:1; background:${canPlay ? '#3b82f6' : '#cbd5e1'}; color:white; border:none; border-radius:4px; font-size:18px">↓</button>`
    ).join('');
    const cells = s.board.map(v => {
      const stone = v === 1 ? '🔴' : v === 2 ? '🟡' : '';
      return `<div style="aspect-ratio:1; background:#1e40af; display:flex; align-items:center; justify-content:center; font-size:22px; border:1px solid #1e3a8a">${stone}</div>`;
    }).join('');
    return `
      <div class="hint-sm" style="margin-top:6px">🔴 ${escapeHtml(ctx.you?.role === 'creator' ? ctx.you.name : (ctx.opponent?.name || '…'))} vs 🟡 ${escapeHtml(ctx.you?.role === 'opponent' ? ctx.you.name : (ctx.opponent?.name || '…'))}</div>
      <div style="max-width:420px; margin:10px auto 0">
        <div style="display:grid; grid-template-columns:repeat(${COLS},1fr); gap:2px">${colBtns}</div>
        <div style="display:grid; grid-template-columns:repeat(${COLS},1fr); gap:2px; background:#1e3a8a; padding:2px; margin-top:2px">${cells}</div>
      </div>
    `;
  },
});
