// cg2 サンプル: 🟦 ライツアウト 3×3
// 1 人 用 (ソロ)。 3×3 の マス が ランダム 点灯、 タップ で その マス + 上下左右 が 反転、 全部 消えたら クリア。
//
// players: 1 の ソロ ゲーム で 押さえる ポイント:
//   - players は 自分 1 人 だけ → 順番 概念 なし、 sharedValues.order や turnUid は 不要
//   - sharedValues は 「自分 専用 だが 持続 する」 状態 として 使う (= ブラウザ 切れて 戻って も 続き できる)
//   - localValues は 揮発 なので 永続 が 要る もの は sharedValues に

import {
  players, myID, isHost, sharedValues, localValues, notifyResult, host,
} from '/js/cg2.js';

const N = 3;
const NEIGHBORS = [[0,0],[-1,0],[1,0],[0,-1],[0,1]];   // 自分 + 上下左右

// ── host lifecycle ──────────────────────────────
host.start = () => {
  // ランダム に 半分 ほど 点灯。 ソロ なので order/turn は 不要。
  sharedValues.cells = Array.from({ length: N * N }, () => Math.random() < 0.55 ? 1 : 0);
  // 1 マス も 点灯 して ない 開始 を 避ける
  if (sharedValues.cells.every(v => v === 0)) sharedValues.cells[Math.floor(Math.random() * N * N)] = 1;
  sharedValues.moves = 0;
  sharedValues.ended = false;
};

host.stop = () => {
  if (sharedValues.cells.every(v => v === 0)) {
    notifyResult(`クリア (${sharedValues.moves} 手)`, { winnerUid: myID, moves: sharedValues.moves });
  } else {
    notifyResult(`断念 (${sharedValues.moves} 手 / 残り ${sharedValues.cells.filter(v => v).length} 点灯)`);
  }
};

// ── p5 sketch ────────────────────────────────────
export default function sketch(p) {
  const CELL = 80;
  const PAD = 16;
  const BOARD = N * CELL + (N - 1) * 8;
  const W = BOARD + PAD * 2;
  const H = BOARD + PAD * 2 + 60;

  p.setup = () => {
    p.createCanvas(W, H);
    p.textAlign(p.CENTER, p.CENTER);
  };

  p.draw = () => {
    p.background(20, 24, 36);

    // ヘッダ
    p.noStroke(); p.fill(240); p.textSize(16);
    const lit = sharedValues.cells.filter(v => v).length;
    p.text(`🟦 ライツアウト ・ 手数 ${sharedValues.moves} ・ 残り ${lit} 点灯`, W / 2, 24);

    // セル 描画
    for (let i = 0; i < N * N; i++) {
      const r = Math.floor(i / N), c = i % N;
      const x = PAD + c * (CELL + 8);
      const y = PAD + 40 + r * (CELL + 8);
      const on = sharedValues.cells[i] === 1;
      const hot = localValues.hoverCell === i && !sharedValues.ended;

      p.stroke(on ? '#fde68a' : '#374151'); p.strokeWeight(2);
      p.fill(on ? (hot ? '#fbbf24' : '#f59e0b') : (hot ? '#1f2937' : '#111827'));
      p.rect(x, y, CELL, CELL, 8);

      p.noStroke();
      p.fill(on ? '#7c2d12' : '#4b5563');
      p.textSize(on ? 32 : 14);
      p.text(on ? '💡' : '·', x + CELL / 2, y + CELL / 2);
    }

    // フッタ メッセージ
    if (sharedValues.ended) {
      p.noStroke(); p.fill(lit === 0 ? '#22c55e' : '#ef4444'); p.textSize(18);
      p.text(lit === 0 ? `🎉 クリア! ${sharedValues.moves} 手` : `終了 (残り ${lit})`,
        W / 2, H - 14);
    }
  };

  p.mouseMoved = () => {
    if (sharedValues.ended) { localValues.hoverCell = null; return; }
    localValues.hoverCell = cellAt(p.mouseX, p.mouseY);
  };

  p.mousePressed = () => {
    if (sharedValues.ended) return;
    const i = cellAt(p.mouseX, p.mouseY);
    if (i == null) return;

    // タップ した マス + 上下左右 を 反転
    const cells = sharedValues.cells.slice();
    const r = Math.floor(i / N), c = i % N;
    for (const [dr, dc] of NEIGHBORS) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N) cells[nr * N + nc] ^= 1;
    }
    sharedValues.cells = cells;
    sharedValues.moves += 1;

    if (cells.every(v => v === 0)) sharedValues.ended = true;
  };

  function cellAt(mx, my) {
    for (let i = 0; i < N * N; i++) {
      const r = Math.floor(i / N), c = i % N;
      const x = PAD + c * (CELL + 8);
      const y = PAD + 40 + r * (CELL + 8);
      if (mx >= x && mx <= x + CELL && my >= y && my <= y + CELL) return i;
    }
    return null;
  }
}
