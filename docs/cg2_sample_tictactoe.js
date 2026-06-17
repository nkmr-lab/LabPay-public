// cg2 (Custom Games v2) サンプル: マルバツ
// 2 人 用 (人間 同士 / 人間 1 + CPU 1)。 ターン制。
// このファイル に 書くのは:
//   - host.start / host.stop (host だけ で 走る lifecycle)
//   - export default sketch (= p5 instance mode の 普通 の sketch)

import {
  players,        // 参加者 [{uid, name, is_ai}, ...] (= system 管理)
  myID,           // 自分 の uid (= players の どれか の uid に 一致)
  isHost,         // 自分 が 起案者 か どうか (boolean)
  sharedValues,   // 共有 state (auto-sync。 直接 mutate)
  localValues,    // 個人 state (sync しない。 揮発)
  notifyResult,   // 結果 通知 (= host.stop の 中 から 呼ぶ)
  host,           // host.start / host.stop を ここ に 入れる
} from '/js/cg2.js';

// ── 定数 ──────────────────────────────────────────
const N = 3;              // 盤面 サイズ
const CELL = 100;         // 1 マス px
const BOARD = N * CELL;

// ── helpers ─────────────────────────────────────
// 先行 後攻 は host.start で sharedValues.order に シャッフル して 入れる ので、
// シンボル 割り当て も 「先 に order に 入って る 方 = ⭕」 で 決まる。
const symbolFor = uid => sharedValues.order.indexOf(uid) === 0 ? '⭕' : '❌';

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],   // 横
  [0,3,6],[1,4,7],[2,5,8],   // 縦
  [0,4,8],[2,4,6],           // 斜め
];
function checkWinner() {
  const c = sharedValues.cells;
  for (const [a,b,d] of WIN_LINES) {
    if (c[a] && c[a] === c[b] && c[a] === c[d]) return c[a];
  }
  return null;
}
const isBoardFull = () => sharedValues.cells.every(v => v != null);
const nextTurn = () => {
  const idx = sharedValues.order.indexOf(sharedValues.turnUid);
  return sharedValues.order[(idx + 1) % sharedValues.order.length];
};
const pickRandomEmpty = () => {
  const empty = sharedValues.cells.map((v, i) => v === null ? i : null).filter(i => i !== null);
  return empty[Math.floor(Math.random() * empty.length)];
};

// ── host lifecycle ──────────────────────────────

// 起案者 の ブラウザ で 1 回 だけ。 sharedValues 初期化。
host.start = () => {
  sharedValues.cells = Array(N * N).fill(null);
  // 先行 後攻 は ランダム に。 sharedValues.order[0] = 先手 (⭕)、 order[1] = 後手 (❌)。
  // host だけ で 1 回 確定 して sharedValues に 入れる ので、 全 client が 同じ 順番 を 見る。
  sharedValues.order = [...players].map(p => p.uid).sort(() => Math.random() - 0.5);
  sharedValues.turnUid = sharedValues.order[0];
  sharedValues.winnerUid = null;
  sharedValues.ended = false;
};

// 起案者 の ブラウザ で 1 回 だけ (= sharedValues.ended が true、 or 強制 終了)。
// この 中 で notifyResult を 1 回 呼ぶ。
host.stop = () => {
  if (sharedValues.winnerUid) {
    const winner = players.find(p => p.uid === sharedValues.winnerUid);
    notifyResult(
      `${winner.name} (${symbolFor(winner.uid)}) の 勝ち`,
      { winnerUid: winner.uid },
    );
  } else {
    notifyResult('引き分け');
  }
};

// ── p5 sketch (instance mode) ────────────────────
// framework が host.start 完了 + 同期 完了 を 待って から new p5(sketch, container) する。

export default function sketch(p) {

  p.setup = () => {
    p.createCanvas(BOARD, BOARD + 60);
    p.textAlign(p.CENTER, p.CENTER);
  };

  p.draw = () => {
    p.background(245);

    // 罫線
    p.stroke(180); p.strokeWeight(2);
    for (let i = 1; i < N; i++) {
      p.line(i * CELL, 0, i * CELL, BOARD);
      p.line(0, i * CELL, BOARD, i * CELL);
    }

    // セル の シンボル
    p.noStroke(); p.textSize(64); p.fill(0);
    for (let i = 0; i < N * N; i++) {
      const v = sharedValues.cells[i];
      if (!v) continue;
      const x = (i % N) * CELL + CELL / 2;
      const y = Math.floor(i / N) * CELL + CELL / 2;
      p.text(symbolFor(v), x, y);
    }

    // ホバー ハイライト (= localValues、 自分 だけ に 見える)
    if (
      localValues.hoverCell != null &&
      sharedValues.cells[localValues.hoverCell] == null &&
      sharedValues.turnUid === myID &&
      !sharedValues.ended
    ) {
      const i = localValues.hoverCell;
      const x = (i % N) * CELL;
      const y = Math.floor(i / N) * CELL;
      p.noFill(); p.stroke(120, 100, 220); p.strokeWeight(3);
      p.rect(x + 2, y + 2, CELL - 4, CELL - 4);
    }

    // 下 に 状態 表示
    const cur = players.find(x => x.uid === sharedValues.turnUid);
    p.noStroke(); p.fill(40); p.textSize(18);
    let msg;
    if (sharedValues.ended) {
      msg = sharedValues.winnerUid
        ? `🏆 ${symbolFor(sharedValues.winnerUid)} の 勝ち`
        : '🤝 引き分け';
    } else {
      const tail = cur.uid === myID ? ' ← あなた'
        : cur.is_ai ? ' (思考中…)' : '';
      msg = `手番: ${cur.name} (${symbolFor(cur.uid)})${tail}`;
    }
    p.text(msg, BOARD / 2, BOARD + 30);

    // CPU 戦 (人間 1 + CPU 1) の とき、 唯一 の 人間 = host = 自分 が AI を 動かす。
    // 人間 2 人 戦 では cur.is_ai は 常 に false なので 自動 で 無効。
    if (cur && cur.is_ai && !sharedValues.ended && isHost && !localValues.aiThinking) {
      localValues.aiThinking = true;
      setTimeout(() => {
        if (!sharedValues.ended && sharedValues.turnUid === cur.uid) {
          place(pickRandomEmpty(), cur.uid);
        }
        localValues.aiThinking = false;
      }, 600 + Math.random() * 600);
    }
  };

  // ホバー ハイライト 用 (= localValues に だけ 書く ので 同期 しない)
  p.mouseMoved = () => {
    if (sharedValues.ended) { localValues.hoverCell = null; return; }
    const cell = cellAt(p.mouseX, p.mouseY);
    localValues.hoverCell = cell;
  };

  p.mousePressed = () => {
    if (sharedValues.ended) return;
    if (sharedValues.turnUid !== myID) return;
    const cell = cellAt(p.mouseX, p.mouseY);
    if (cell == null || sharedValues.cells[cell] != null) return;
    place(cell, myID);
  };

  // 共通 着手 (人間 / CPU で 同じ)
  function place(cell, uid) {
    sharedValues.cells[cell] = uid;
    const w = checkWinner();
    if (w) {
      sharedValues.winnerUid = w;
      sharedValues.ended = true;       // ← framework が 検知 して host.stop へ
    } else if (isBoardFull()) {
      sharedValues.ended = true;       // 引き分け
    } else {
      sharedValues.turnUid = nextTurn();
    }
  }

  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= BOARD || y >= BOARD) return null;
    return Math.floor(y / CELL) * N + Math.floor(x / CELL);
  }
}
