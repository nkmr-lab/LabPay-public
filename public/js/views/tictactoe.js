// ⭕❌ マルバツ — 自作ゲーム framework のリファレンスサンプル。
//
// sketch() に setup / draw / action の 3 関数を渡すだけで動く。
// 詳しいコメントは examples/custom-games/nim.js が一番短くて読みやすい。

import { sketch, escapeHtml } from '../cg_ui.js';

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

export const { renderTicTacToe, renderTicTacToeDetail } = (() => {
  const g = sketch({
    kind: 'tictactoe',
    detailPath: '#/tictactoe',                    // ビルトインなので旧 path 維持。 ユーザ自作は不要。
    title: '⭕❌ マルバツ',
    hint: '3x3 のマルバツ。 ⭕ vs ❌、 3 つ並べたら勝ち。 プレイフィー 1pt。',

    setup() {
      return { board: Array(9).fill(0) };          // 0 = 空、 1 = ⭕、 2 = ❌
    },

    action(s, me, idx, ctx) {
      if (s.board[idx] !== 0) throw new Error('そのマスは既に置かれてる');
      // ctx.you.role で 「自分が ⭕ (creator) か ❌ (opponent) か」 がわかる
      const mark = ctx.you?.role === 'creator' ? 1 : 2;
      const board = s.board.slice(); board[idx] = mark;

      for (const [a,b,c] of LINES) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
          return { state: { board }, finished: true, winner: 'me' };
        }
      }
      if (!board.includes(0)) return { state: { board }, finished: true, winner: null };  // 引分
      return { state: { board } };
    },

    draw(s, ctx) {
      const meMark = ctx.you?.role === 'creator' ? '⭕' : '❌';
      return `
        <div class="row" style="gap:8px; margin-top:6px">
          <div style="flex:1"><div class="bold">⭕ ${escapeHtml(ctx.you?.role === 'creator' ? ctx.you.name : (ctx.opponent?.name || '— 募集中 —'))}</div></div>
          <div style="flex:1"><div class="bold">❌ ${escapeHtml(ctx.you?.role === 'opponent' ? ctx.you.name : (ctx.opponent?.name || '— 募集中 —'))}</div></div>
        </div>
        ${ctx.status === 'playing' && ctx.myTurn ? `<div class="hint" style="margin:4px 0">あなたの番 (${meMark})</div>` : ''}
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:4px; max-width:320px; margin:10px auto; aspect-ratio:1">
          ${s.board.map((v, i) => {
            const sym = v === 1 ? '⭕' : v === 2 ? '❌' : '';
            const can = ctx.status === 'playing' && ctx.myTurn && v === 0;
            return `<button data-move="${i}" ${can ? '' : 'disabled'}
              style="aspect-ratio:1; font-size:54px; background:${v ? '#fafafa' : '#fff'}; border:2px solid #ddd; border-radius:8px; cursor:${can ? 'pointer' : 'default'}; line-height:1; padding:0">${sym}</button>`;
          }).join('')}
        </div>
      `;
    },
  });
  return { renderTicTacToe: g.renderList, renderTicTacToeDetail: g.renderDetail };
})();
