// 🪙 ニム (Nim、 misère) — 自作ゲーム framework の **最小** サンプル。
//   盤面 ナシ。 21 個の 石を 順番に 1〜3 個 取り、 最後の 石を 取った人が 負け。
//   defineGame() を 使えば 全部で ~45 行。
//
//   登録手順:
//     設定 → 🎮 自作ゲーム 管理 → 新規登録
//     kind: nim / 表示名: 🪙 ニム / icon: 🪙 / JS = このファイル
//   登録後 /#/cg/nim で 動く。

import { defineGame } from '/js/cg_ui.js';

const START_STONES = 21;

export const { renderList, renderDetail } = defineGame({
  kind: 'nim',
  title: '🪙 ニム (石取り、 misère)',
  hint: `${START_STONES} 個の 石を 順番に 1〜3 個 取る。 最後の 石を 取った人が 負け。`,

  initialState: (uid) => ({
    stones: START_STONES,
    creator_uid: uid, opponent_uid: 0, turn_user_id: uid,
  }),

  // take は 1 / 2 / 3 の いずれか
  applyMove: (s, uid, take) => {
    if (s.turn_user_id !== uid) throw new Error('あなたの番ではありません');
    if (![1, 2, 3].includes(take)) throw new Error('取れるのは 1〜3 個');
    if (take > s.stones)            throw new Error('石が 足りない');
    const stones = s.stones - take;
    if (stones === 0) {
      // 最後の石を取った = 負け → 相手が勝者
      const winner = uid === s.creator_uid ? s.opponent_uid : s.creator_uid;
      return { state: { ...s, stones, turn_user_id: null }, finished: true, winner_user_id: winner, turn_user_id: null };
    }
    const next = uid === s.creator_uid ? s.opponent_uid : s.creator_uid;
    return { state: { ...s, stones, turn_user_id: next }, finished: false, winner_user_id: null, turn_user_id: next };
  },

  renderBoard: (s, { myTurn, status }) => {
    const can = status === 'playing' && myTurn;
    const pile = '🪙'.repeat(s.stones) || '(なし)';
    return `
      <h2 style="margin:6px 0">🪙 残り ${s.stones} 個</h2>
      <div style="font-size:28px; line-height:1.4; word-break:break-all; margin:8px 0">${pile}</div>
      ${[1, 2, 3].map(n =>
        `<button data-move="${n}" ${can && n <= s.stones ? '' : 'disabled'}
          class="btn ${can ? 'primary' : ''}" style="margin-right:6px; font-size:18px">${n} 個 取る</button>`
      ).join('')}
    `;
  },
});
