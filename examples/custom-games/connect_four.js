// 🟦 四目並べ (Connect Four) — 自作ゲーム framework サンプル
//
// 使い方:
//   1. LabPay の 設定 → 🎮 自作ゲーム 管理 (/#/my-games) を 開く
//   2. 新規 kind 登録 で 以下を 入力:
//        kind:         connect-four   (好きな slug でも OK)
//        表示名:        🟦 四目並べ
//        説明:         6×7 盤、 重力で 下から積む。 4 つ並べたら 勝ち。
//        icon:         🟦
//        プレイフィー: 1pt (任意)
//        JS ファイル:  このファイル を 選択
//   3. 登録後 /#/cg/connect-four で 一覧、 /#/cg/connect-four/:id で 詳細
//
// 必須 export:
//   - renderList(ctx): 一覧画面 を 描画
//   - renderDetail(ctx): 詳細画面 を 描画 (ctx.params.id, .kind が 渡る)
//
// import 注意:
//   このファイル は /api/custom-games/kinds/:kind/script.js から 配信されるので、
//   LabPay の helpers は **絶対パス** で import する (相対パスは 404)。
//
// 通信モデル:
//   - 起案:    POST /api/custom-games/:kind/games          { initial_state }
//   - 参加:    POST /api/custom-games/:kind/games/:id/join { new_state }
//   - 手:      POST /api/custom-games/:kind/games/:id/move { new_state, finished, winner_user_id, turn_user_id }
//   - キャンセル: POST /api/custom-games/:kind/games/:id/cancel
//   - 詳細:    GET  /api/custom-games/:kind/games/:id
//
// サーバは state_json の中身を 触らず、 turn_user_id の 整合性 + 課金 だけ enforce する。
// 場代は kind 登録者 90% / SYSTEM 10% に 自動分配 (join 成立時に 両者から 徴収)。

import { get, post } from '/js/api.js';
import { state, toast } from '/js/app.js';
import { navigate, escapeHtml } from '/js/router.js';

const KIND = 'connect-four';   // ← 登録時の kind と 同じ にする
const ROWS = 6, COLS = 7;
const POLL_MS = 2500;
let pollTimer = null;

// ─── ゲームロジック (純 JS) ─────────────────────────────────────
function initialState(creatorUid) {
  return {
    board: Array(ROWS * COLS).fill(0),  // 0=空、 1=creator (🔴)、 2=opponent (🟡)
    creator_uid: creatorUid,
    opponent_uid: 0,
    turn_user_id: creatorUid,
  };
}

function joinTransition(s, opponentUid) {
  return { ...s, opponent_uid: opponentUid };
}

// 列 col に コマ を 落とす (重力)。
// 戻り値: { state, finished, winner_user_id, turn_user_id } — サーバへ そのまま POST する形。
function applyMove(s, userId, col) {
  if (s.turn_user_id !== userId) throw new Error('あなたの番ではありません');
  if (col < 0 || col >= COLS) throw new Error('列が不正');
  let row = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (s.board[r * COLS + col] === 0) { row = r; break; }
  }
  if (row < 0) throw new Error('その列は満杯');
  const mark = (userId === s.creator_uid) ? 1 : 2;
  const board = [...s.board];
  board[row * COLS + col] = mark;
  const won = checkWin(board, row, col, mark);
  const full = board.every(v => v !== 0);
  const finished = won || full;
  const next = (userId === s.creator_uid) ? s.opponent_uid : s.creator_uid;
  const turnUid = finished ? null : next;
  return {
    state: { ...s, board, turn_user_id: turnUid },
    finished,
    winner_user_id: won ? userId : null,
    turn_user_id: turnUid,
  };
}

// 4 方向 (横 / 縦 / 右下↘ / 右上↗) を 中心 (r,c) から 両側に 伸ばして 4 つ続くか チェック
function checkWin(b, r, c, mark) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (const sign of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const nr = r + dr * k * sign, nc = c + dc * k * sign;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
        if (b[nr * COLS + nc] !== mark) break;
        count++;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

// ─── UI ───────────────────────────────────────────────────────
export async function renderList() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <div style="display:flex; gap:8px; align-items:center">
        <h2 style="margin:0; flex:1">🟦 四目並べ</h2>
        <button id="c4-new" class="btn primary">＋ 新規卓</button>
      </div>
      <p class="hint" style="font-size:13px; margin:6px 0 0">
        6×7 盤。 重力で 下から積む。 縦・横・斜め に 4 つ並べたら 勝ち。
      </p>
    </div>
    <div id="c4-list"><div class="hint">読み込み中…</div></div>
  `;
  document.getElementById('c4-new').addEventListener('click', async () => {
    try {
      const r = await post(`/api/custom-games/${KIND}/games`, {
        initial_state: initialState(Number(state.me?.id))
      });
      navigate(`#/cg/${KIND}/${r.id}`);
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
  try {
    const d = await get(`/api/custom-games/${KIND}/games`);
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('c4-list').innerHTML = '<div class="hint">対戦卓 がありません。 「＋ 新規卓」 で 始めましょう。</div>';
      return;
    }
    document.getElementById('c4-list').innerHTML = items.map(g => `
      <a href="#/cg/${KIND}/${g.id}" class="list-item">
        <div class="grow">
          <div class="bold">${escapeHtml(g.creator_name)} の卓 ・ ${g.status}</div>
          <div class="meta">${g.winner_name ? `🎉 ${escapeHtml(g.winner_name)} の勝ち` : (g.status === 'finished' ? '🤝 引分' : '')}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('c4-list').innerHTML = `<div class="hint">読み込み失敗: ${escapeHtml(e?.message || e)}</div>`;
  }
}

export async function renderDetail(ctx) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  const gid = Number(ctx.params.id);
  await paint(gid);
  pollTimer = setInterval(() => {
    if (!document.querySelector(`[data-c4-gid="${gid}"]`)) {
      clearInterval(pollTimer); pollTimer = null; return;
    }
    paint(gid).catch(() => {});
  }, POLL_MS);
}

async function paint(gid) {
  let d;
  try {
    d = await get(`/api/custom-games/${KIND}/games/${gid}`);
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="card"><a href="#/cg/${KIND}" class="hint">← 一覧</a><div class="hint">${escapeHtml(e?.message || e)}</div></div>`;
    return;
  }
  const meId = Number(state.me?.id);
  const board = d.state?.board || Array(ROWS * COLS).fill(0);
  const myMark = meId === d.creator_user_id ? '🔴' : '🟡';

  // ── 状況メッセージ + ボタン ──
  let actionArea = '';
  if (d.status === 'waiting') {
    if (meId === d.creator_user_id) {
      actionArea = `<div class="card">
        <div class="hint">対戦相手 を 待っています。 開始前なので 場代は まだ 払われていません。</div>
        <button id="c4-cancel" class="btn" style="margin-top:6px; color:#c00">キャンセル</button>
      </div>`;
    } else {
      actionArea = `<div class="card">
        <div class="hint">対戦相手として 参加しますか? 開始時に 両者から プレイフィー ${d.fee}pt が 徴収されます。</div>
        <button id="c4-join" class="btn primary" style="margin-top:6px">参加する</button>
      </div>`;
    }
  } else if (d.status === 'finished') {
    let result;
    if (d.winner_user_id === null) result = '🤝 引分';
    else if (d.winner_user_id === meId) result = '🎉 あなたの 勝ち!';
    else result = '😢 あなたの 負け';
    actionArea = `<div class="card"><h3 style="margin:0">${result}</h3></div>`;
  } else if (d.status === 'playing') {
    actionArea = d.my_turn
      ? `<div class="card"><div class="bold">あなたの番 (${myMark})。 列の どこかを タップ。</div></div>`
      : `<div class="card"><div class="hint">相手の番を 待っています…</div></div>`;
  } else if (d.status === 'cancelled') {
    actionArea = `<div class="card"><div class="hint">キャンセル済</div></div>`;
  }

  // ── 盤面描画 ──
  const canPlay = d.status === 'playing' && d.my_turn;
  const colBtns = Array.from({ length: COLS }, (_, c) =>
    `<button class="c4-col-btn" data-col="${c}" ${canPlay ? '' : 'disabled'}
        style="aspect-ratio:1; background:${canPlay ? '#3b82f6' : '#cbd5e1'}; color:white; border:none; border-radius:4px; cursor:${canPlay ? 'pointer' : 'default'}; font-size:18px">↓</button>`
  ).join('');

  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = board[r * COLS + c];
      const stone = v === 1 ? '🔴' : v === 2 ? '🟡' : '';
      cells.push(`<div style="aspect-ratio:1; background:#1e40af; display:flex; align-items:center; justify-content:center; font-size:22px; border:1px solid #1e3a8a">${stone}</div>`);
    }
  }

  document.getElementById('app').innerHTML = `
    <div class="card" data-c4-gid="${gid}">
      <a href="#/cg/${KIND}" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🟦 四目並べ #${gid}</h2>
      <div class="hint-sm">🔴 ${escapeHtml(d.creator_name || '')} vs 🟡 ${escapeHtml(d.opponent_name || '…')}</div>
      <div style="max-width:420px; margin-top:10px">
        <div style="display:grid; grid-template-columns:repeat(${COLS}, 1fr); gap:2px">${colBtns}</div>
        <div style="display:grid; grid-template-columns:repeat(${COLS}, 1fr); gap:2px; background:#1e3a8a; padding:2px; margin-top:2px">${cells.join('')}</div>
      </div>
    </div>
    ${actionArea}
  `;

  document.querySelectorAll('.c4-col-btn').forEach(b => {
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      const col = Number(b.dataset.col);
      try {
        const res = applyMove(d.state, meId, col);
        await post(`/api/custom-games/${KIND}/games/${gid}/move`, {
          new_state: res.state,
          finished: res.finished,
          winner_user_id: res.winner_user_id,
          turn_user_id: res.turn_user_id,
        });
        paint(gid);
      } catch (e) { toast(e?.message || e); }
    });
  });
  document.getElementById('c4-join')?.addEventListener('click', async () => {
    try {
      await post(`/api/custom-games/${KIND}/games/${gid}/join`, {
        new_state: joinTransition(d.state, meId),
      });
      paint(gid);
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
  document.getElementById('c4-cancel')?.addEventListener('click', async () => {
    if (!confirm('キャンセルしますか?')) return;
    try { await post(`/api/custom-games/${KIND}/games/${gid}/cancel`, {}); navigate(`#/cg/${KIND}`); }
    catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
}
