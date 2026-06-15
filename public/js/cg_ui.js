// LabPay 自作ゲーム framework 共通 UI ヘルパー (v626 〜)。
//   各 kind の JS が ロビー / 待ち / 参加 / 終了 を 毎回 書かなくて 済むように、
//   よく使う 部品を ここに 集約。 ゲームロジック (盤面描画 + applyMove) だけ
//   各 kind が 書けば 動くのが ゴール。
//
//   絶対パスで import:  import { ... } from '/js/cg_ui.js';
//   ビルトイン (tictactoe など) からは 相対パスでも OK:  '../cg_ui.js';

import { get, post } from '/js/api.js';
import { state, toast } from '/js/app.js';
import { navigate, escapeHtml } from '/js/router.js';

// 起案時の API へ POST。 initial_state は kind 側が 用意。
//   成功で /#/cg/<kind>/<id> へ navigate。 ビルトイン (旧 import パス) は
//   detailPath を 渡せる: ({ kind, initialState, detailPath: '#/tictactoe' })
export async function startGame({ kind, initialState, detailPath }) {
  try {
    const r = await post(`/api/custom-games/${kind}/games`, { initial_state: initialState });
    navigate(`${detailPath || `#/cg/${kind}`}/${r.id}`);
  } catch (e) { toast('失敗: ' + (e?.message || e)); }
}

// 一覧 (Lobby) を 1 行で 描画。 row は {id, creator_name, status, winner_name, my_turn?}
//   detailPath はビルトインの場合 '#/tictactoe' などを渡す。
export async function renderLobby({ kind, title, hint, detailPath, onNew }) {
  const app = document.getElementById('app');
  const dp = detailPath || `#/cg/${kind}`;
  app.innerHTML = `
    <div class="card">
      <div style="display:flex; align-items:center; gap:8px">
        <h2 style="margin:0; flex:1">${escapeHtml(title)}</h2>
        <button id="cg-new" class="btn primary">＋ 新規卓</button>
      </div>
      ${hint ? `<p class="hint" style="font-size:13px; margin:6px 0 0">${escapeHtml(hint)}</p>` : ''}
    </div>
    <div id="cg-list"><div class="hint">読み込み中…</div></div>
  `;
  document.getElementById('cg-new').addEventListener('click', onNew);
  try {
    const d = await get(`/api/custom-games/${kind}/games`);
    const items = d.items || [];
    const root = document.getElementById('cg-list');
    if (!items.length) {
      root.innerHTML = '<div class="hint">対戦卓 がありません。 「＋ 新規卓」 で 始めましょう。</div>';
      return;
    }
    root.innerHTML = items.map(g => `
      <a href="${dp}/${g.id}" class="list-item">
        <div class="grow">
          <div class="bold">${escapeHtml(g.creator_name)} の卓 ・ ${escapeHtml(g.status)}</div>
          <div class="meta">${g.winner_name ? `🎉 ${escapeHtml(g.winner_name)} の勝ち` : (g.status === 'finished' ? '🤝 引分' : '')}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('cg-list').innerHTML = `<div class="hint">読み込み失敗: ${escapeHtml(e?.message || e)}</div>`;
  }
}

// 詳細画面 の 共通 ステータスカード を 返す (HTML 文字列)。 盤面とは 分けて 上か下に配置。
//   d は GET /api/custom-games/:kind/games/:id のレスポンス。
//   onJoinState は join 時の new_state を返す純粋関数 (state, meId) => newState。
export function statusCardHtml(d, meId, { joinLabel } = {}) {
  const fee = d.fee ?? 0;
  if (d.status === 'waiting') {
    if (meId === d.creator_user_id) {
      return `<div class="card">
        <div class="hint">対戦相手 を 待っています。 開始前なので 料金は まだ 払われていません。</div>
        <button data-cg-action="cancel" class="btn" style="margin-top:6px; color:#c00">キャンセル</button>
      </div>`;
    }
    return `<div class="card">
      <div class="hint">対戦相手として 参加しますか? 開始時に 両者から プレイフィー ${fee}pt が 徴収されます。</div>
      <button data-cg-action="join" class="btn primary" style="margin-top:6px">${escapeHtml(joinLabel || '参加する')}</button>
    </div>`;
  }
  if (d.status === 'cancelled') return `<div class="card"><div class="hint">キャンセル済</div></div>`;
  if (d.status === 'finished') {
    let result;
    if (d.winner_user_id === null) result = '🤝 引分';
    else if (d.winner_user_id === meId) result = '🎉 あなたの 勝ち!';
    else result = '😢 あなたの 負け';
    return `<div class="card"><h3 style="margin:0">${result}</h3></div>`;
  }
  // playing
  return d.my_turn
    ? `<div class="card"><div class="bold">あなたの番。 盤面を タップ。</div></div>`
    : `<div class="card"><div class="hint">相手の番を 待っています…</div></div>`;
}

// statusCard 内 の data-cg-action="join"/"cancel" を 配線する ヘルパー。
//   joinState(d, meId) => 新 state を 計算する 関数。
export function wireStatusCard({ kind, gid, d, meId, joinState, detailPath, onAfter }) {
  document.querySelector('[data-cg-action="cancel"]')?.addEventListener('click', async () => {
    if (!confirm('キャンセルしますか?')) return;
    try {
      await post(`/api/custom-games/${kind}/games/${gid}/cancel`, {});
      navigate(detailPath || `#/cg/${kind}`);
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
  document.querySelector('[data-cg-action="join"]')?.addEventListener('click', async () => {
    try {
      await post(`/api/custom-games/${kind}/games/${gid}/join`, {
        new_state: joinState ? joinState(d.state, meId) : { ...d.state, opponent_uid: meId },
      });
      onAfter?.();
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
}

// 詳細 polling を 抽象化: paint 関数を 一定間隔で 呼び、 ノードが 消えたら 自動停止。
//   guardSelector に data 属性などを 与えると DOM 検出で 自動 unmount。
export function startPolling({ paint, ms = 2500, guardSelector }) {
  let timer = null;
  const tick = () => {
    if (guardSelector && !document.querySelector(guardSelector)) {
      clearInterval(timer); timer = null; return;
    }
    paint().catch(() => {});
  };
  paint().catch(() => {});
  timer = setInterval(tick, ms);
  return () => { if (timer) { clearInterval(timer); timer = null; } };
}

// applyMove の 結果を そのまま サーバに 投げる ヘルパー。
//   res = { state, finished, winner_user_id, turn_user_id }
export async function submitMove({ kind, gid, res }) {
  await post(`/api/custom-games/${kind}/games/${gid}/move`, {
    new_state: res.state,
    finished: res.finished,
    winner_user_id: res.winner_user_id,
    turn_user_id: res.turn_user_id,
  });
}

// kind 詳細を取得 (共通ラッパー、 失敗時は 一覧へ戻る hint を 表示)。
export async function fetchDetail({ kind, gid, detailPath }) {
  try {
    return await get(`/api/custom-games/${kind}/games/${gid}`);
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="card"><a href="${detailPath || `#/cg/${kind}`}" class="hint">← 一覧</a><div class="hint">${escapeHtml(e?.message || e)}</div></div>`;
    return null;
  }
}

// re-export 便利系 (kind 側 が import 1 行で 済むように)
export { state, toast, navigate, escapeHtml };

// ───────────────────────────────────────────────────────────────
// v628 defineGame: 全部入りラッパー。
//   kind 作者は ロジック (initialState / applyMove) と 盤面描画 (renderBoard) だけ
//   書けば 終わり。 ロビー / 待ち / 参加 / 終了 / polling / submit / 取得 は 全部 自動。
//
//   使い方:
//     export const { renderList, renderDetail } = defineGame({
//       kind:  'mygame',
//       title: '🎲 マイゲーム',
//       hint:  '説明',
//       initialState: (uid) => ({ ..., creator_uid: uid, opponent_uid: 0, turn_user_id: uid }),
//       applyMove:    (s, uid, move) => ({ state, finished, winner_user_id, turn_user_id }),
//       // 盤面描画。 ボタン や マスに data-move="..." (JSON) を つけると 自動配線。
//       renderBoard:  (s, ctx) => `<div>... <button data-move="0">...</button> ...</div>`,
//     });
//
//   detailPath はビルトイン (旧 path) を使う時だけ指定 (例: '#/tictactoe')。
// ───────────────────────────────────────────────────────────────
export function defineGame(spec) {
  const {
    kind, title, hint, detailPath,
    initialState, applyMove, renderBoard,
    joinTransition = (s, oppUid) => ({ ...s, opponent_uid: oppUid }),
  } = spec;
  const dp = detailPath || `#/cg/${kind}`;
  const guard = `[data-cg-gid="cg-${kind}"]`;

  function renderList() {
    return renderLobby({
      kind, detailPath: dp, title, hint,
      onNew: () => startGame({
        kind, detailPath: dp,
        initialState: initialState(Number(state.me?.id)),
      }),
    });
  }

  function renderDetail({ params }) {
    const gid = Number(params.id);
    startPolling({
      paint: () => paint(gid),
      guardSelector: `[data-cg-gid="cg-${kind}-${gid}"]`,
    });
  }

  async function paint(gid) {
    const d = await fetchDetail({ kind, gid, detailPath: dp });
    if (!d) return;
    const meId = Number(state.me?.id);
    const boardHtml = d.state ? renderBoard(d.state, { meId, d, myTurn: d.my_turn, status: d.status }) : '';
    document.getElementById('app').innerHTML = `
      <div class="card" data-cg-gid="cg-${kind}-${gid}">
        <a href="${dp}" class="hint">← 一覧</a>
        ${boardHtml}
      </div>
      ${statusCardHtml(d, meId)}
    `;
    wireStatusCard({ kind, gid, d, meId, joinState: joinTransition, detailPath: dp, onAfter: () => paint(gid) });
    // data-move 属性を 持つ 要素 を 自動配線。 値は そのまま move として applyMove に渡る。
    //   数値1個 なら 整数、 JSON っぽければ パース、 それ以外は 文字列。
    document.querySelectorAll(`[data-cg-gid="cg-${kind}-${gid}"] [data-move]`).forEach(b => {
      b.addEventListener('click', async () => {
        try {
          const raw = b.dataset.move;
          let move;
          if (raw.startsWith('{') || raw.startsWith('[')) move = JSON.parse(raw);
          else if (/^-?\d+$/.test(raw)) move = Number(raw);
          else move = raw;
          const res = applyMove(d.state, meId, move);
          await submitMove({ kind, gid, res });
          paint(gid);
        } catch (e) { toast(e?.message || e); }
      });
    });
  }

  return { renderList, renderDetail };
}
