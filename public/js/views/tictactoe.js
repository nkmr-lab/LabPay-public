// ⭕❌ マルバツ — 自作ゲーム framework の リファレンス サンプル。
//   共通 UI ヘルパー (/js/cg_ui.js) を 使う ことで、 各 kind は
//   「ゲームロジック (initialState + applyMove)」 + 「盤面 1 つの 描画」 だけ 書けば 動く。
//   コピー → 改造 → 設定画面 から アップロード で 新ゲーム公開。

import {
  state, toast, escapeHtml,
  renderLobby, startGame, statusCardHtml, wireStatusCard,
  startPolling, submitMove, fetchDetail,
} from '../cg_ui.js';

const KIND = 'tictactoe';
const DETAIL_PATH = '#/tictactoe';   // ビルトインなので 旧 path。 ユーザ自作は '#/cg/<kind>' (cg_ui のデフォルト)

// ── ゲームロジック ───────────────────────────────────────
function initialState(creatorUid) {
  return { board: Array(9).fill(0), creator_uid: creatorUid, opponent_uid: 0, turn_user_id: creatorUid };
}

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function applyMove(s, userId, idx) {
  if (s.turn_user_id !== userId) throw new Error('あなたの手番ではありません');
  if (s.board[idx] !== 0) throw new Error('そのマスは 既に置かれています');
  const mark = userId === s.creator_uid ? 1 : 2;
  const board = s.board.slice(); board[idx] = mark;
  let winner = null;
  for (const [a,b,c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      winner = board[a] === 1 ? s.creator_uid : s.opponent_uid; break;
    }
  }
  const finished = winner !== null || !board.includes(0);
  const next = finished ? null : (userId === s.creator_uid ? s.opponent_uid : s.creator_uid);
  return { state: { ...s, board, turn_user_id: next }, finished, winner_user_id: winner, turn_user_id: next };
}

// ── 一覧 ──────────────────────────────────────────────
export function renderTicTacToe() {
  return renderLobby({
    kind: KIND, detailPath: DETAIL_PATH,
    title: '⭕❌ マルバツ',
    hint: '3x3 のマルバツ。 起案者=⭕、 参加者=❌。 3 つ並べたら勝ち。 プレイフィー 1pt (対戦相手 が 来た時のみ)。',
    onNew: () => startGame({ kind: KIND, detailPath: DETAIL_PATH, initialState: initialState(Number(state.me?.id)) }),
  });
}

// ── 詳細 ──────────────────────────────────────────────
export function renderTicTacToeDetail({ params }) {
  const gid = Number(params.id);
  startPolling({
    paint: () => paintDetail(gid),
    guardSelector: `[data-tt-gid="${gid}"]`,
  });
}

async function paintDetail(gid) {
  const d = await fetchDetail({ kind: KIND, gid, detailPath: DETAIL_PATH });
  if (!d) return;
  const meId = Number(state.me?.id);
  const isCreator = meId === d.creator_user_id;
  const myMark = isCreator ? '⭕' : '❌';
  const board = d.state?.board || Array(9).fill(0);

  document.getElementById('app').innerHTML = `
    <div class="card" data-tt-gid="${gid}">
      <a href="${DETAIL_PATH}" class="hint">← 一覧</a>
      <div class="row" style="gap:8px; margin-top:6px">
        <div style="flex:1"><div class="bold">⭕ ${escapeHtml(d.creator_name)}</div></div>
        <div style="flex:1"><div class="bold">❌ ${escapeHtml(d.opponent_name || '— 募集中 —')}</div></div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; max-width:320px; margin:10px auto; aspect-ratio:1">
        ${board.map((v, i) => {
          const sym = v === 1 ? '⭕' : v === 2 ? '❌' : '';
          const can = d.status === 'playing' && d.my_turn && v === 0;
          return `<button data-idx="${i}" ${can ? '' : 'disabled'}
            style="aspect-ratio:1; font-size:54px; background:${v ? '#fafafa' : '#fff'}; border:2px solid #ddd; border-radius:8px; cursor:${can ? 'pointer' : 'default'}; line-height:1; padding:0">${sym}</button>`;
        }).join('')}
      </div>
    </div>
    ${statusCardHtml(d, meId)}
  `;

  // ステータスカード の join / cancel 配線 (共通)
  wireStatusCard({ kind: KIND, gid, d, meId, detailPath: DETAIL_PATH, onAfter: () => paintDetail(gid) });

  // 盤面タップ で 手を打つ (このゲーム固有)
  document.querySelectorAll(`[data-tt-gid="${gid}"] button[data-idx]`).forEach(b => {
    b.addEventListener('click', async () => {
      try {
        const res = applyMove(d.state, meId, Number(b.dataset.idx));
        await submitMove({ kind: KIND, gid, res });
        paintDetail(gid);
      } catch (e) { toast(e?.message || e); }
    });
  });
}
