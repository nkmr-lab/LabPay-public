// cg2 サンプル: 🪙 ニム (misère)
// 2 人 用、 ターン制。 21 個 の 石 を 順番に 1〜3 個 ずつ 取り、 最後 の 1 個 を 取った人 が 負け。

import {
  players, myID, isHost, sharedValues, localValues, notifyResult, host,
} from '/js/cg2.js';

const START = 21;

// ── helpers ─────────────────────────────────────
const nextTurn = () => {
  const idx = sharedValues.order.indexOf(sharedValues.turnUid);
  return sharedValues.order[(idx + 1) % sharedValues.order.length];
};

const pickAI = stones => {
  // ニム の 後手 必勝 戦略: 取った 後 の 残り を 4 の 倍数 + 1 に する のが 理想。
  // 「相手 を 必ず 負け に 追い込む 手」 が ある なら それ を、 なければ random。
  for (let take = 1; take <= 3 && take <= stones; take++) {
    const left = stones - take;
    if (left % 4 === 1) return take;       // 必勝 手
  }
  return 1 + Math.floor(Math.random() * Math.min(3, stones));
};

// ── host lifecycle ──────────────────────────────
host.start = () => {
  sharedValues.stones = START;
  sharedValues.order = [...players].map(p => p.uid).sort(() => Math.random() - 0.5);
  sharedValues.turnUid = sharedValues.order[0];
  sharedValues.loserUid = null;     // 「最後 を 取った 人」 = 負け
  sharedValues.ended = false;
};

host.stop = () => {
  if (sharedValues.loserUid) {
    const loser = players.find(p => p.uid === sharedValues.loserUid);
    const winner = players.find(p => p.uid !== sharedValues.loserUid);
    notifyResult(`${winner.name} の 勝ち (${loser.name} が 最後 を 取って 負け)`,
      { winnerUid: winner.uid });
  } else {
    notifyResult('決着 なし');
  }
};

// ── p5 sketch ────────────────────────────────────
export default function sketch(p) {
  const W = 480, H = 320;

  p.setup = () => {
    p.createCanvas(W, H);
    p.textAlign(p.CENTER, p.CENTER);
  };

  p.draw = () => {
    p.background(245);
    const cur = players.find(x => x.uid === sharedValues.turnUid);

    // タイトル
    p.fill(40); p.noStroke(); p.textSize(20);
    p.text(`🪙 ニム — 残り ${sharedValues.stones} 個`, W / 2, 26);

    // 石 を 並べて 描く (7 列 × 3 行 で 21 個 まで)
    const COLS = 7, R = 18;
    const x0 = (W - (COLS - 1) * R * 2.4) / 2;
    const y0 = 70;
    for (let i = 0; i < START; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const cx = x0 + col * R * 2.4;
      const cy = y0 + row * R * 2.4;
      if (i < sharedValues.stones) {
        p.fill(220, 180, 60); p.stroke(120, 90, 20); p.strokeWeight(2);
        p.circle(cx, cy, R * 2);
        p.fill(140, 100, 20); p.noStroke(); p.textSize(11);
        p.text('🪙', cx, cy);
      } else {
        p.fill(220); p.stroke(200); p.strokeWeight(1);
        p.circle(cx, cy, R * 2);
      }
    }

    // 状態 表示
    p.noStroke(); p.fill(40); p.textSize(14);
    let msg;
    if (sharedValues.ended) {
      const winner = players.find(p2 => p2.uid !== sharedValues.loserUid);
      msg = `🏆 ${winner.name} の 勝ち (最後 を 取った 方 が 負け)`;
    } else {
      const tail = cur.uid === myID ? ' ← あなた'
        : cur.is_ai ? ' (思考中…)' : '';
      msg = `手番: ${cur.name}${tail}`;
    }
    p.text(msg, W / 2, H - 70);

    // アクション ボタン (1 / 2 / 3 個 取る)
    if (!sharedValues.ended && sharedValues.turnUid === myID) {
      const BW = 80, BH = 36, GAP = 12;
      const TOTAL = 3 * BW + 2 * GAP;
      const sx = (W - TOTAL) / 2;
      for (let n = 1; n <= 3; n++) {
        const bx = sx + (n - 1) * (BW + GAP);
        const by = H - 50;
        const can = n <= sharedValues.stones;
        const hot = localValues.hoverBtn === n && can;
        p.fill(can ? (hot ? '#7c3aed' : '#a78bfa') : '#e5e7eb');
        p.stroke(can ? '#5b21b6' : '#cbd5e1'); p.strokeWeight(2);
        p.rect(bx, by, BW, BH, 6);
        p.noStroke(); p.fill(can ? '#fff' : '#94a3b8'); p.textSize(15);
        p.text(`${n} 個 取る`, bx + BW / 2, by + BH / 2);
      }
    }

    // CPU 戦 (自分 が host) で AI の 手番 なら 自動 着手
    if (cur && cur.is_ai && !sharedValues.ended && isHost && !localValues.aiThinking) {
      localValues.aiThinking = true;
      setTimeout(() => {
        if (!sharedValues.ended && sharedValues.turnUid === cur.uid) {
          take(pickAI(sharedValues.stones));
        }
        localValues.aiThinking = false;
      }, 600 + Math.random() * 600);
    }
  };

  p.mouseMoved = () => {
    if (sharedValues.ended) { localValues.hoverBtn = null; return; }
    if (sharedValues.turnUid !== myID) { localValues.hoverBtn = null; return; }
    localValues.hoverBtn = btnAt(p.mouseX, p.mouseY);
  };

  p.mousePressed = () => {
    if (sharedValues.ended) return;
    if (sharedValues.turnUid !== myID) return;
    const n = btnAt(p.mouseX, p.mouseY);
    if (!n || n > sharedValues.stones) return;
    take(n);
  };

  // 着手 (人間 / CPU 共通)
  function take(n) {
    sharedValues.stones -= n;
    if (sharedValues.stones === 0) {
      // 最後 の 1 個 を 取った 人 = 負け
      sharedValues.loserUid = sharedValues.turnUid;
      sharedValues.ended = true;
    } else {
      sharedValues.turnUid = nextTurn();
    }
  }

  function btnAt(mx, my) {
    const BW = 80, BH = 36, GAP = 12;
    const TOTAL = 3 * BW + 2 * GAP;
    const sx = (W - TOTAL) / 2;
    const by = H - 50;
    if (my < by || my > by + BH) return null;
    for (let n = 1; n <= 3; n++) {
      const bx = sx + (n - 1) * (BW + GAP);
      if (mx >= bx && mx <= bx + BW) return n;
    }
    return null;
  }
}
