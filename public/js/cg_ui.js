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

// ───────────────────────────────────────────────────────────────
// v629 sketch(): Processing / p5.js 風の 高レベル API。
//
//   書く 関数は 3 つ だけ:
//
//     setup(meId)             ── ゲーム開始時に 1 回 だけ 呼ばれる。
//                                 ゲーム固有 の 初期 state を return する。
//
//     draw(state, ctx)        ── 画面を 描く 時に 呼ばれる。
//                                 HTML 文字列 を return する (盤面でも 文字 でも OK)。
//                                 自分の番が 来たら、 ボタン に
//                                 <button data-move="X"> を 入れておくと、
//                                 タップで 自動的に play() が 呼ばれる。
//
//     play(state, me, move)   ── 自分が ボタンを 押した時 に 呼ばれる。
//                                 第3引数 move は data-move="X" の X (= 整数 / 文字 / JSON)。
//                                 { state: 新state, finished?: bool, winner?: 'me'|'opponent'|null }
//                                 を return する。 手番は LabPay が 自動で 相手に 移す。
//
//   呼び出し 順序 を 図で 示すと:
//
//      [起案者が ＋新規卓]
//         │
//         ▼ setup(me)
//       state ──→ DB
//                         [自分の画面] (polling 2.5s)         [相手の画面]
//                              │                                     │
//                              ▼                                     ▼
//                       draw(state, ctx)                       draw(state, ctx)
//                              │                                     │
//                              ▼ ボタンタップ
//                       play(state, me, move)
//                              │
//                              ▼ サーバに 送信
//                       新 state ─────────────────────────→  相手の draw も 更新
//
//   ctx (draw の第2引数) に 渡されるもの:
//     ctx.me        - 自分の uid (number)
//     ctx.you       - { uid, name, role: 'creator' | 'opponent' }  自分
//     ctx.opponent  - { uid, name, role }                          相手 (waiting 中は null)
//     ctx.players   - [you, opponent].filter(Boolean)
//     ctx.turn      - 手番の uid (number、 終了時は null)
//     ctx.myTurn    - 自分の手番か (boolean)
//     ctx.winner    - 勝者の uid (number、 引分 or 進行中は null)
//     ctx.status    - 'waiting' | 'playing' | 'finished' | 'cancelled'
//
//   play() の return:
//     {
//       state:    新しい ゲーム固有 state (必須)
//       finished: true なら 終了 (省略可、 default false)
//       winner:   'me' | 'opponent' | <uid> | null
//                  'me' = 自分の勝ち、 'opponent' = 相手の勝ち、 null = 引分。
//                  finished=false なら 無視されます。
//     }
// ───────────────────────────────────────────────────────────────
export function sketch(spec) {
  const { kind, title, hint, detailPath, setup, draw, play } = spec;

  return defineGame({
    kind, title, hint, detailPath,

    initialState(uid) {
      return {
        creator_uid: uid, opponent_uid: 0, turn_user_id: uid,
        g: setup(uid),                                            // ユーザの ゲーム固有 state は g に 隔離
      };
    },

    applyMove(s, uid, move) {
      const res = play(s.g, uid, move);
      if (!res || !res.state) throw new Error('play() は { state, ... } を return してください');
      const finished = !!res.finished;
      const oppUid = uid === s.creator_uid ? s.opponent_uid : s.creator_uid;
      let winner = null;
      if (finished) {
        if      (res.winner === 'me')        winner = uid;
        else if (res.winner === 'opponent')  winner = oppUid;
        else if (typeof res.winner === 'number') winner = res.winner;
        else                                  winner = null;       // 引分
      }
      const next = finished ? null : oppUid;
      return {
        state: { ...s, g: res.state, turn_user_id: next },
        finished,
        winner_user_id: winner,
        turn_user_id: next,
      };
    },

    renderBoard(s, raw) {
      const meId = raw.meId;
      const d = raw.d;
      const isCreator = meId === s.creator_uid;
      const you = { uid: meId, name: isCreator ? d.creator_name : d.opponent_name, role: isCreator ? 'creator' : 'opponent' };
      const opponent = s.opponent_uid
        ? { uid: isCreator ? s.opponent_uid : s.creator_uid,
            name: isCreator ? d.opponent_name : d.creator_name,
            role: isCreator ? 'opponent' : 'creator' }
        : null;
      return draw(s.g, {
        me: meId, you, opponent,
        players: [you, opponent].filter(Boolean),
        turn: s.turn_user_id,
        myTurn: !!raw.myTurn,
        winner: d.winner_user_id,
        status: raw.status,
      });
    },

    joinTransition(s, oppUid) {
      // sketch 系では 手番は 自動なので opponent_uid だけ 入れる (= デフォルトと 同じ、 明示)
      return { ...s, opponent_uid: oppUid };
    },
  });
}
