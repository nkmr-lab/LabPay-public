// 🟦 ライツアウト 3×3 — **1 人用 (ソロ)** サンプル。
//
// ルール: 3×3 の マスが ランダムに 点灯。 タップで そのマス + 上下左右 が 反転。
//        全部 消えたら クリア。 何手 で 消せるか?
//
// 1 人用 ゲーム で 押さえる ポイント:
//   - sketch({ players: 1, ... }) と 書く だけ
//   - 起案 直後に そのまま playing に なり、 join 不要
//   - opponent は 存在しない、 ctx.opponent === null
//   - 手番は ずっと 自分 (= myTurn は 常に true)
//   - winner: 'me' は 「クリア」、 finished=true winner=null は 「諦め (=途中)」 などに 使える
//
// 登録手順:
//   設定 → 🎮 自作ゲーム 管理 → 新規登録
//     kind: lights-out / 表示名: 🟦 ライツアウト / icon: 🟦 / プレイヤー数: 1 人 (ソロ)
//   テンプレート から 「🟦 ライツアウト [1 人]」 を選べば 即注入。

import { sketch } from '/js/cg_ui.js';

const N = 3;
const NEIGHBORS = [[0,0],[-1,0],[1,0],[0,-1],[0,1]];   // 自分 + 上下左右

export const { renderList, renderDetail } = sketch({
  kind:    'lights-out',
  title:   '🟦 ライツアウト 3×3',
  hint:    'タップで そのマス + 上下左右 が 反転。 全部 OFF で クリア。',
  players: 1,                              // ← ソロ ゲーム

  setup() {
    // ランダムに 半数くらいを 点灯。 setup() の return が 初期 state。
    const cells = Array.from({ length: N * N }, () => Math.random() < 0.55 ? 1 : 0);
    return { cells, moves: 0 };
  },

  draw(s, ctx) {
    const can = ctx.status === 'playing';   // ソロ なので myTurn は常に true
    const cells = s.cells.map((v, i) =>
      `<button data-move="${i}" ${can ? '' : 'disabled'}
        style="aspect-ratio:1; background:${v ? '#fbbf24' : '#1f2937'}; border:2px solid #555; border-radius:6px; cursor:${can ? 'pointer' : 'default'}; font-size:20px">${v ? '💡' : '·'}</button>`
    ).join('');
    return `
      <h2 style="margin:6px 0">🟦 ライツアウト</h2>
      <div class="hint" style="font-size:13px">手数: <b>${s.moves}</b> / 残り 点灯: <b>${s.cells.filter(v => v).length}</b></div>
      <div style="display:grid; grid-template-columns:repeat(${N},1fr); gap:4px; max-width:240px; margin:10px auto; aspect-ratio:1">
        ${cells}
      </div>
    `;
  },

  play(s, me, idx) {
    const cells = s.cells.slice();
    const r = Math.floor(idx / N), c = idx % N;
    for (const [dr, dc] of NEIGHBORS) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N) cells[nr * N + nc] ^= 1;
    }
    const moves = s.moves + 1;
    if (cells.every(v => v === 0)) {
      return { state: { cells, moves }, finished: true, winner: 'me' };  // クリア!
    }
    return { state: { cells, moves } };
  },
});
