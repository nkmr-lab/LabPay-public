// cg2 サンプル: 🎲 すごろく (4 人)
// 4 人 用、 ターン制。 順番 に サイコロ を 振って 進み、 30 マス 目 に 最初 に 到達 した 人 が 勝ち。
//
// N 人 (2 以上) 用 ゲーム で 押さえる ポイント:
//   - sharedValues.order に N 人 の uid を シャッフル して 入れる (= 着席 順 ランダム)
//   - 自分 の 「着席 順 (= order の index)」 で 自分 の コマ を 識別

import {
  players, myID, isHost, sharedValues, localValues, notifyResult, host,
} from '/js/cg2.js';

const GOAL = 30;

// ── helpers ─────────────────────────────────────
const mySeat = () => sharedValues.order.indexOf(myID);
const seatOf = uid => sharedValues.order.indexOf(uid);
const nextTurn = () => {
  const idx = sharedValues.order.indexOf(sharedValues.turnUid);
  return sharedValues.order[(idx + 1) % sharedValues.order.length];
};

// プレイヤー 色 (席 順 = order index で 固定)
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

// ── host lifecycle ──────────────────────────────
host.start = () => {
  sharedValues.order = [...players].map(p => p.uid).sort(() => Math.random() - 0.5);
  sharedValues.positions = Array(sharedValues.order.length).fill(0);
  sharedValues.turnUid = sharedValues.order[0];
  sharedValues.lastRoll = 0;
  sharedValues.lastSeat = -1;
  sharedValues.winnerUid = null;
  sharedValues.ended = false;
};

host.stop = () => {
  if (sharedValues.winnerUid) {
    const winner = players.find(p => p.uid === sharedValues.winnerUid);
    notifyResult(`🏆 ${winner.name} の 勝ち`, { winnerUid: winner.uid });
  } else {
    notifyResult('決着 なし');
  }
};

// ── p5 sketch ────────────────────────────────────
export default function sketch(p) {
  const W = 560;
  const ROW_H = 56;
  const TRACK_X = 140;
  const TRACK_W = W - TRACK_X - 20;
  const H = 80 + ROW_H * 6;   // 最大 6 人 想定 (余白)

  p.setup = () => {
    p.createCanvas(W, H);
    p.textAlign(p.LEFT, p.CENTER);
  };

  p.draw = () => {
    p.background(245);
    const ord = sharedValues.order || [];

    // タイトル
    p.noStroke(); p.fill(40); p.textAlign(p.CENTER); p.textSize(18);
    p.text(`🎲 すごろく ・ ${GOAL} マス ゴール`, W / 2, 24);

    // 直前 出目
    p.textSize(14);
    if (sharedValues.lastRoll) {
      const lastP = players.find(x => x.uid === ord[sharedValues.lastSeat]);
      p.fill(60);
      p.text(`前 の 出目: 🎲 ${sharedValues.lastRoll} (${lastP?.name ?? '?'})`, W / 2, 50);
    }

    // 各 プレイヤー の トラック
    p.textAlign(p.LEFT, p.CENTER);
    for (let s = 0; s < ord.length; s++) {
      const uid = ord[s];
      const pl = players.find(x => x.uid === uid);
      const y = 80 + s * ROW_H;
      const isCur = uid === sharedValues.turnUid;
      const isMine = uid === myID;
      const pos = sharedValues.positions[s];

      // 名前 (色 付き)
      p.noStroke();
      p.fill(COLORS[s % COLORS.length]);
      p.rect(10, y + 6, 6, ROW_H - 12, 3);
      p.fill(isCur ? '#1d4ed8' : '#333');
      p.textSize(isMine ? 15 : 14);
      p.text((isCur ? '▶ ' : '  ') + (pl?.name ?? `seat ${s}`) + (isMine ? ' (あなた)' : ''),
        24, y + ROW_H / 2);

      // トラック 背景
      p.fill('#e5e7eb'); p.noStroke();
      p.rect(TRACK_X, y + 18, TRACK_W, 8, 4);

      // 進捗 バー
      p.fill(COLORS[s % COLORS.length]);
      p.rect(TRACK_X, y + 18, TRACK_W * Math.min(1, pos / GOAL), 8, 4);

      // コマ (◎)
      const cx = TRACK_X + TRACK_W * Math.min(1, pos / GOAL);
      p.fill('#fff'); p.stroke(COLORS[s % COLORS.length]); p.strokeWeight(2);
      p.circle(cx, y + 22, 18);
      p.noStroke(); p.fill('#333'); p.textSize(11);
      p.textAlign(p.CENTER, p.CENTER);
      p.text(pos, cx, y + 22);
      p.textAlign(p.LEFT, p.CENTER);

      // ゴール マーカー
      p.fill('#fbbf24'); p.noStroke();
      p.textAlign(p.CENTER, p.CENTER); p.textSize(14);
      p.text('🏁', TRACK_X + TRACK_W + 8, y + 22);
      p.textAlign(p.LEFT, p.CENTER);
    }

    // 状態 + サイコロ ボタン
    const cur = players.find(x => x.uid === sharedValues.turnUid);
    const bottomY = 80 + ord.length * ROW_H + 10;
    p.noStroke(); p.fill(40); p.textAlign(p.CENTER); p.textSize(15);
    let msg;
    if (sharedValues.ended) {
      const w = players.find(x => x.uid === sharedValues.winnerUid);
      msg = `🏆 ${w?.name ?? '?'} の 勝ち`;
    } else if (!cur) {
      msg = '...';
    } else {
      const tail = cur.uid === myID ? ' ← あなた'
        : cur.is_ai ? ' (思考中…)' : '';
      msg = `手番: ${cur.name}${tail}`;
    }
    p.text(msg, W / 2, bottomY + 10);

    // サイコロ ボタン (自分 の 手番 のみ)
    if (!sharedValues.ended && sharedValues.turnUid === myID) {
      const BW = 160, BH = 36;
      const bx = (W - BW) / 2;
      const by = bottomY + 28;
      const hot = localValues.hoverDice;
      p.fill(hot ? '#7c3aed' : '#a78bfa');
      p.stroke('#5b21b6'); p.strokeWeight(2);
      p.rect(bx, by, BW, BH, 6);
      p.noStroke(); p.fill('#fff'); p.textSize(15);
      p.text('🎲 サイコロ を 振る', W / 2, by + BH / 2);
    }

    // AI の 手番 なら 自動 ロール
    if (cur && cur.is_ai && !sharedValues.ended && isHost && !localValues.aiThinking) {
      localValues.aiThinking = true;
      setTimeout(() => {
        if (!sharedValues.ended && sharedValues.turnUid === cur.uid) roll();
        localValues.aiThinking = false;
      }, 600 + Math.random() * 600);
    }
  };

  p.mouseMoved = () => {
    if (sharedValues.ended) { localValues.hoverDice = false; return; }
    if (sharedValues.turnUid !== myID) { localValues.hoverDice = false; return; }
    localValues.hoverDice = isOverDice(p.mouseX, p.mouseY);
  };

  p.mousePressed = () => {
    if (sharedValues.ended) return;
    if (sharedValues.turnUid !== myID) return;
    if (!isOverDice(p.mouseX, p.mouseY)) return;
    roll();
  };

  function roll() {
    const seat = seatOf(sharedValues.turnUid);
    const n = 1 + Math.floor(Math.random() * 6);
    const next = Math.min(GOAL, sharedValues.positions[seat] + n);
    const positions = sharedValues.positions.slice();
    positions[seat] = next;
    sharedValues.positions = positions;
    sharedValues.lastRoll = n;
    sharedValues.lastSeat = seat;
    if (next >= GOAL) {
      sharedValues.winnerUid = sharedValues.turnUid;
      sharedValues.ended = true;
    } else {
      sharedValues.turnUid = nextTurn();
    }
  }

  function isOverDice(mx, my) {
    const BW = 160, BH = 36;
    const bx = (W - BW) / 2;
    const by = 80 + sharedValues.order.length * ROW_H + 10 + 28;
    return mx >= bx && mx <= bx + BW && my >= by && my <= by + BH;
  }
}
