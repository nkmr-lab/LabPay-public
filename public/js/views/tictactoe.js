// ⭕❌ マルバツ — 自作ゲーム framework の リファレンス サンプル。
//   defineGame() に ロジック (initialState / applyMove) と 盤面描画 (renderBoard) を
//   渡すだけで renderList / renderDetail が 自動で 出る。 ~50 行。

import { defineGame, escapeHtml } from '../cg_ui.js';

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

export const { renderTicTacToe, renderTicTacToeDetail } = (() => {
  const game = defineGame({
    kind: 'tictactoe',
    detailPath: '#/tictactoe',       // ビルトインの旧 path (ユーザ自作は省略 OK)
    title: '⭕❌ マルバツ',
    hint: '3x3 のマルバツ。 起案者=⭕、 参加者=❌。 縦/横/斜め 3 つ並べたら勝ち。 プレイフィー 1pt。',

    initialState: (uid) => ({
      board: Array(9).fill(0), creator_uid: uid, opponent_uid: 0, turn_user_id: uid,
    }),

    applyMove: (s, uid, idx) => {
      if (s.turn_user_id !== uid) throw new Error('あなたの手番ではありません');
      if (s.board[idx] !== 0) throw new Error('そのマスは 既に置かれています');
      const mark = uid === s.creator_uid ? 1 : 2;
      const board = s.board.slice(); board[idx] = mark;
      let winner = null;
      for (const [a,b,c] of LINES) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
          winner = board[a] === 1 ? s.creator_uid : s.opponent_uid; break;
        }
      }
      const finished = winner !== null || !board.includes(0);
      const next = finished ? null : (uid === s.creator_uid ? s.opponent_uid : s.creator_uid);
      return { state: { ...s, board, turn_user_id: next }, finished, winner_user_id: winner, turn_user_id: next };
    },

    renderBoard: (s, { d, myTurn, status }) => `
      <div class="row" style="gap:8px; margin-top:6px">
        <div style="flex:1"><div class="bold">⭕ ${escapeHtml(d.creator_name)}</div></div>
        <div style="flex:1"><div class="bold">❌ ${escapeHtml(d.opponent_name || '— 募集中 —')}</div></div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:4px; max-width:320px; margin:10px auto; aspect-ratio:1">
        ${s.board.map((v, i) => {
          const sym = v === 1 ? '⭕' : v === 2 ? '❌' : '';
          const can = status === 'playing' && myTurn && v === 0;
          return `<button data-move="${i}" ${can ? '' : 'disabled'}
            style="aspect-ratio:1; font-size:54px; background:${v ? '#fafafa' : '#fff'}; border:2px solid #ddd; border-radius:8px; cursor:${can ? 'pointer' : 'default'}; line-height:1; padding:0">${sym}</button>`;
        }).join('')}
      </div>
    `,
  });
  return { renderTicTacToe: game.renderList, renderTicTacToeDetail: game.renderDetail };
})();
