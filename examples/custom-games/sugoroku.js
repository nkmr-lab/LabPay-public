// 🎲 すごろく — **4 人用** サンプル。
//
// ルール: 4 人で 順番に サイコロ (1〜6) を 振り、 マスを 進む。
//        30 マス目 に 最初に 到達した人が 勝ち。
//
// 4 人用 ゲーム で 押さえる ポイント:
//   - sketch({ players: 4, ... }) と 書く
//   - 起案者 + 他 3 人 が 参加 → 全員 揃ったら status='playing'。 場代は その瞬間 全員から 徴収
//   - 手番は LabPay が 自動で 4 人 を rotation。 action() で next を 返せば 明示指定も 可
//   - ctx.players = [{uid, name, seat: 0..3, role}, ...] (着席順)
//   - ctx.seat = 自分の seat (0..3)
//   - winner: 'me' = 自分 / 'opponent' = 直前の 相手 / 数値 uid を 直接指定 でも OK
//
// 登録手順:
//   設定 → 🎮 自作ゲーム 管理 → 新規登録
//     kind: sugoroku / 表示名: 🎲 すごろく / icon: 🎲 / プレイヤー数: 4 人 対戦
//   テンプレート から 「🎲 すごろく [4 人]」 で 即注入。

import { sketch } from '/js/cg_ui.js';

const GOAL = 30;

export const { renderList, renderDetail } = sketch({
  kind:    'sugoroku',
  title:   '🎲 すごろく (4 人)',
  hint:    `順番に サイコロ を 振って ${GOAL} マス 目 を 目指す。 一番乗りで 勝ち。`,
  players: 4,                              // ← 4 人 必要

  setup() {
    return { positions: [0, 0, 0, 0], lastRoll: 0, lastSeat: -1 };
  },

  draw(s, ctx) {
    const can = ctx.status === 'playing' && ctx.myTurn;
    const rows = ctx.players.map((p, i) => {
      const cur = i === ctx.players.findIndex(pp => pp.uid === ctx.turn);
      const bar = '█'.repeat(Math.min(GOAL, s.positions[i] || 0)) + '·'.repeat(Math.max(0, GOAL - (s.positions[i] || 0)));
      return `<div style="font-family:monospace; ${cur ? 'font-weight:bold; color:#1d4ed8' : ''}">
        ${cur ? '▶ ' : '  '}${p.name || 'seat ' + i}: ${s.positions[i] || 0}/${GOAL}
        <div style="font-size:10px; letter-spacing:-1px">${bar}</div>
      </div>`;
    }).join('');
    return `
      <h2 style="margin:6px 0">🎲 すごろく (${GOAL} マス ゴール)</h2>
      <div style="margin:8px 0">${rows}</div>
      ${s.lastRoll ? `<div class="hint" style="font-size:13px">前の出目: 🎲 <b>${s.lastRoll}</b> (seat ${s.lastSeat})</div>` : ''}
      <button data-move="roll" ${can ? '' : 'disabled'} class="btn ${can ? 'primary' : ''}" style="font-size:18px; margin-top:8px">🎲 サイコロを 振る</button>
    `;
  },

  action(s, me, _move, ctx) {
    // ctx.seat = 自分の seat (0..3)。 draw と 同じ形 で 渡る。
    const seat = ctx.seat;
    if (seat < 0) throw new Error('seat 不明');
    const roll = 1 + Math.floor(Math.random() * 6);
    const positions = s.positions.slice();
    positions[seat] = Math.min(GOAL, positions[seat] + roll);
    if (positions[seat] >= GOAL) {
      return { state: { positions, lastRoll: roll, lastSeat: seat }, finished: true, winner: 'me' };
    }
    return { state: { positions, lastRoll: roll, lastSeat: seat } };
  },
});
