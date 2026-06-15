// 🪙 ニム (Nim、 misère) — 自作ゲーム の **最小** サンプル。
//
// ルール:
//   21 個 の 石。 順番に 1〜3 個 ずつ 取る。 最後の 石 を 取った人 が 負け。
//
// 自作ゲーム は 3 つの 関数を 書くだけ:
//   1.  setup()           ゲーム開始時 に 1 回 だけ呼ばれる
//   2.  draw(state, ctx)  画面を 描く 時 に 呼ばれる
//   3.  play(state, ...)  自分が ボタン を 押した時 に 呼ばれる
//
// 流れ:
//   ＋新規卓 → setup() → DB に 入る
//        ↓
//   自動 polling で draw() が 走る (= 画面更新)
//        ↓
//   自分の番で <button data-move="2"> を タップ
//        ↓
//   play(state, 自分のuid, 2) → 新 state を サーバに 送信
//        ↓
//   相手側 も polling で draw() が 走って 反映

import { sketch } from '/js/cg_ui.js';

export const { renderList, renderDetail } = sketch({
  kind:  'nim',
  title: '🪙 ニム (石取り、 misère)',
  hint:  '21 個 の 石 を 順番に 1〜3 個 取る。 最後 の 石 を 取った人 が 負け。',

  // ───── ゲーム開始時 (起案者が ＋新規卓 を 押した時) に 1 回だけ ─────
  setup() {
    return { stones: 21 };
  },

  // ───── 画面 描画 (state が 変わる たび) ─────
  //   ctx.myTurn  : 自分の番か
  //   ctx.status  : 'waiting' / 'playing' / 'finished'
  //   ctx.opponent: 相手の {uid, name, role} (waiting 中は null)
  //
  //   ボタンに data-move="X" を 入れれば、 タップで play(s, me, X) が 呼ばれる。
  draw(s, ctx) {
    const can = ctx.status === 'playing' && ctx.myTurn;
    const pile = '🪙'.repeat(s.stones) || '(なし)';
    return `
      <h2 style="margin:6px 0">🪙 残り ${s.stones} 個</h2>
      <div style="font-size:28px; line-height:1.4; word-break:break-all; margin:8px 0">${pile}</div>
      ${[1, 2, 3].map(n => `
        <button data-move="${n}" ${can && n <= s.stones ? '' : 'disabled'}
          class="btn ${can ? 'primary' : ''}" style="margin-right:6px; font-size:18px">${n} 個 取る</button>
      `).join('')}
    `;
  },

  // ───── 自分が ボタン を 押した時 ─────
  //   第3引数 take は data-move="X" の X (整数)。
  //   { state: 新state, finished?: true, winner?: 'me'|'opponent'|null } を返す。
  play(s, me, take) {
    if (take > s.stones) throw new Error('石が 足りない');
    const stones = s.stones - take;
    if (stones === 0) {
      // 最後の 石 を 取った = 負け → 勝者は 相手
      return { state: { stones }, finished: true, winner: 'opponent' };
    }
    return { state: { stones } };    // 手番は LabPay が 自動で 相手に 移す
  },
});
