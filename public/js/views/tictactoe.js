// v617/v618 #236 ⭕❌ マルバツ。
//   自作ゲーム フレームワーク (custom_games) を JS だけ で 使うサンプル実装。
//   PHP 側は kind を 登録するだけ (CG_REGISTRY)。 ゲームロジックは すべて このファイル に。
//
// state 構造:
//   {
//     board: [9 マス、 0=空 / 1=⭕ / 2=❌],
//     creator_uid: int, opponent_uid: int,
//     turn_user_id: int,
//   }

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const KIND = 'tictactoe';
const POLL_MS = 2500;
let pollTimer = null;

// ── ゲームロジック (JS) ──────────────────────────────────────────
function initialState(creatorUid) {
  return {
    board: Array(9).fill(0),
    creator_uid: creatorUid,
    opponent_uid: 0, // join 時に サーバ側ハンドラ + クライアントで 上書き
    turn_user_id: creatorUid,
  };
}

function joinTransition(state, opponentUid) {
  return { ...state, opponent_uid: opponentUid };
}

// 手を打って 新 state + 勝敗 を返す。 不正手は throw。
function applyMove(state, userId, move) {
  if (state.turn_user_id !== userId) throw new Error('あなたの手番ではありません');
  const idx = Number(move.idx);
  if (!(idx >= 0 && idx <= 8)) throw new Error('idx は 0-8');
  if (state.board[idx] !== 0) throw new Error('そのマスは 既に置かれています');
  const mark = userId === state.creator_uid ? 1 : 2;
  const newBoard = state.board.slice();
  newBoard[idx] = mark;
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  let winnerUid = null;
  for (const line of lines) {
    const a = newBoard[line[0]];
    if (a !== 0 && a === newBoard[line[1]] && a === newBoard[line[2]]) {
      winnerUid = a === 1 ? state.creator_uid : state.opponent_uid;
      break;
    }
  }
  let finished = winnerUid !== null;
  if (!finished && !newBoard.includes(0)) finished = true; // 引分
  const oppUid = userId === state.creator_uid ? state.opponent_uid : state.creator_uid;
  const nextTurn = finished ? null : oppUid;
  return {
    state: { ...state, board: newBoard, turn_user_id: nextTurn },
    finished,
    winner_user_id: winnerUid,
    turn_user_id: nextTurn,
  };
}

// ── UI ──────────────────────────────────────────────────────────
function statusBadge(s) {
  switch (s) {
    case 'waiting':   return '<span class="tag warn">対戦相手 募集中</span>';
    case 'playing':   return '<span class="tag" style="background:#dbeafe; color:#1d4ed8">対戦中</span>';
    case 'finished':  return '<span class="tag muted">終了</span>';
    case 'cancelled': return '<span class="tag" style="background:#fecaca; color:#b91c1c">キャンセル</span>';
  }
  return '';
}

export async function renderTicTacToe() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px">
        <h2 style="margin:0">⭕❌ マルバツ</h2>
        <span style="flex:1"></span>
        <button id="tt-new" class="btn primary">＋ 新規卓 (1pt)</button>
      </div>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        3x3 のマルバツ。 起案者=⭕、 参加者=❌。 縦/横/斜め 3 つ並べたら勝ち。
        1pt プレイフィー、 勝者が pot 総取り (引分は半額返金)。
      </p>
    </div>
    <div id="tt-list"><div class="hint">読み込み中…</div></div>
  `;
  document.getElementById('tt-new').addEventListener('click', async () => {
    try {
      const meId = Number(state.me?.id);
      const initial = initialState(meId);
      const r = await post(`/api/custom-games/${KIND}/games`, { initial_state: initial });
      navigate(`#/tictactoe/${r.id}`);
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
  try {
    const d = await get(`/api/custom-games/${KIND}/games`);
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('tt-list').innerHTML = '<div class="hint">対戦卓 がありません。 「＋ 新規卓」 で 始めましょう。</div>';
      return;
    }
    document.getElementById('tt-list').innerHTML = items.map(g => `
      <a class="list-item" href="#/tictactoe/${g.id}">
        <div class="grow">
          <div class="bold">⭕ ${escapeHtml(g.creator_name)} vs ❌ ${g.opponent_name ? escapeHtml(g.opponent_name) : '<span class="muted">募集中</span>'}
            ${statusBadge(g.status)}
            ${g.me_in ? '<span class="tag ok">参加中</span>' : ''}</div>
          <div class="meta">${g.winner_name ? `🎉 ${escapeHtml(g.winner_name)} の勝ち` : (g.status === 'finished' ? '🤝 引分' : '')}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('tt-list').innerHTML = `<div class="hint">${escapeHtml(e?.message || e)}</div>`;
  }
}

export async function renderTicTacToeDetail({ params }) {
  if (pollTimer) clearInterval(pollTimer);
  const gid = Number(params.id);
  await paint(gid);
  pollTimer = setInterval(() => {
    if (!document.querySelector(`[data-tt-gid="${gid}"]`)) { clearInterval(pollTimer); pollTimer = null; return; }
    paint(gid).catch(() => {});
  }, POLL_MS);
}

async function paint(gid) {
  let d;
  try { d = await get(`/api/custom-games/${KIND}/games/${gid}`); }
  catch (e) { document.getElementById('app').innerHTML = `<div class="card"><a href="#/tictactoe" class="hint">← 一覧</a><div class="hint">${escapeHtml(e.message)}</div></div>`; return; }
  const app = document.getElementById('app');
  const meId = Number(state.me?.id);
  const isCreator = meId === d.creator_user_id;
  const isOpp     = meId === d.opponent_user_id;
  const meIn      = isCreator || isOpp;
  const myMark    = isCreator ? '⭕' : (isOpp ? '❌' : '');

  let actionArea = '';
  if (d.status === 'waiting') {
    if (isCreator) {
      actionArea = `<div class="card">
        <div class="hint">対戦相手を 待っています。</div>
        <button id="tt-cancel" class="btn" style="margin-top:6px; color:#c00">キャンセル (1pt返金)</button>
      </div>`;
    } else {
      actionArea = `<div class="card">
        <div class="hint">対戦相手として 参加しますか? (1pt)</div>
        <button id="tt-join" class="btn primary" style="margin-top:6px">参加する (1pt)</button>
      </div>`;
    }
  } else if (d.status === 'finished') {
    let result;
    if (d.winner_user_id === null) result = '🤝 引分 (双方 半額返金)';
    else if (d.winner_user_id === meId) result = '🎉 あなたの 勝ち!';
    else result = '😢 あなたの 負け';
    actionArea = `<div class="card"><h3 style="margin:0 0 4px">${result}</h3></div>`;
  } else if (d.status === 'playing') {
    actionArea = d.my_turn
      ? `<div class="card"><div class="bold">あなたの番 (${myMark})。 空いてるマスをタップ。</div></div>`
      : `<div class="card"><div class="hint">相手の番を 待っています…</div></div>`;
  }

  const board = d.state?.board || Array(9).fill(0);
  app.innerHTML = `
    <div class="card" data-tt-gid="${gid}">
      <div style="display:flex; align-items:center; gap:8px">
        <a href="#/tictactoe" class="hint">← 一覧</a>
        <span style="flex:1"></span>
        ${statusBadge(d.status)}
      </div>
      <div class="row" style="gap:8px; margin-top:6px">
        <div style="flex:1"><div class="bold">⭕ ${escapeHtml(d.creator_name)}</div></div>
        <div style="flex:1"><div class="bold">❌ ${escapeHtml(d.opponent_name || '— 募集中 —')}</div></div>
      </div>
    </div>
    <div class="card" style="padding:8px">
      <div id="tt-board" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; max-width:320px; margin:0 auto; aspect-ratio:1/1">
        ${board.map((v, i) => {
          const sym = v === 1 ? '⭕' : v === 2 ? '❌' : '';
          const clickable = d.status === 'playing' && d.my_turn && v === 0;
          return `<button data-idx="${i}" ${clickable ? '' : 'disabled'}
            style="aspect-ratio:1/1; font-size:54px; background:${v ? '#fafafa' : '#fff'}; border:2px solid #ddd; border-radius:8px; cursor:${clickable ? 'pointer' : 'default'}; line-height:1; padding:0; display:flex; align-items:center; justify-content:center">${sym}</button>`;
        }).join('')}
      </div>
    </div>
    ${actionArea}
  `;

  document.getElementById('tt-join')?.addEventListener('click', async () => {
    try {
      const newState = joinTransition(d.state, meId);
      await post(`/api/custom-games/${KIND}/games/${gid}/join`, { new_state: newState });
      paint(gid);
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
  document.getElementById('tt-cancel')?.addEventListener('click', async () => {
    if (!confirm('キャンセルしますか? (1pt返金)')) return;
    try { await post(`/api/custom-games/${KIND}/games/${gid}/cancel`, {}); navigate('#/tictactoe'); }
    catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
  document.querySelectorAll('#tt-board button[data-idx]').forEach(b => {
    b.addEventListener('click', async () => {
      const idx = Number(b.dataset.idx);
      try {
        // v618 JS で applyMove して 結果を サーバに POST
        const res = applyMove(d.state, meId, { idx });
        await post(`/api/custom-games/${KIND}/games/${gid}/move`, {
          new_state: res.state,
          finished: res.finished,
          winner_user_id: res.winner_user_id,
          turn_user_id: res.turn_user_id,
        });
        paint(gid);
      } catch (e) { toast('失敗: ' + (e?.message || e)); }
    });
  });
}
