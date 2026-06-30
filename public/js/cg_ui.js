// LabPay 自作ゲーム framework 共通 UI ヘルパー (v626 〜)。
//   各 kind の JS がロビー / 待ち / 参加 / 終了を毎回書かなくて済むように、
//   よく使う部品をここに集約。 ゲームロジック (盤面描画 + applyMove) だけ
//   各 kind が書けば動くのがゴール。
//
//   絶対パスで import:  import { ... } from '/js/cg_ui.js';
//   ビルトイン (tictactoe など) からは相対パスでも OK:  '../cg_ui.js';

import { get, post } from '/js/api.js';
import { state, toast } from '/js/app.js';
import { navigate, escapeHtml } from '/js/router.js';

// 起案時の API へ POST。 initial_state は kind 側が用意。
//   成功で /#/cg/<kind>/<id> へ navigate。 ビルトイン (旧 import パス) は
//   detailPath を渡せる: ({ kind, initialState, detailPath: '#/tictactoe' })
export async function startGame({ kind, initialState, detailPath }) {
  try {
    const r = await post(`/api/custom-games/${kind}/games`, { initial_state: initialState });
    navigate(`${detailPath || `#/cg/${kind}`}/${r.id}`);
  } catch (e) { toast('失敗: ' + (e?.message || e)); }
}

// 一覧 (Lobby) を 1 行で描画。 row は {id, creator_name, status, winner_name, my_turn?}
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
      root.innerHTML = '<div class="hint">対戦卓がありません。 「＋ 新規卓」 で始めましょう。</div>';
      return;
    }
    root.innerHTML = items.map(g => `
      <a href="${dp}/${g.id}" class="list-item">
        <div class="grow">
          <div class="bold">${escapeHtml(g.creator_name)} の卓・ ${escapeHtml(g.status)}</div>
          <div class="meta">${g.winner_name ? `🎉 ${escapeHtml(g.winner_name)} の勝ち` : (g.status === 'finished' ? '🤝 引分' : '')}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('cg-list').innerHTML = `<div class="hint">読み込み失敗: ${escapeHtml(e?.message || e)}</div>`;
  }
}

// 詳細画面の共通ステータスカードを返す (HTML 文字列)。 盤面とは分けて上か下に配置。
//   d は GET /api/custom-games/:kind/games/:id のレスポンス。
//   onJoinState は join 時の new_state を返す純粋関数 (state, meId) => newState。
export function statusCardHtml(d, meId, { joinLabel } = {}) {
  const fee = d.fee ?? 0;
  const players = Array.isArray(d.players) ? d.players : [];
  const meJoined = players.some(p => p.uid === meId);
  if (d.status === 'waiting') {
    if (meId === d.creator_user_id) {
      const joinedCount = players.length;
      const waitingFor = players.length ? `(${joinedCount} 人参加中、 開始まであと ${Math.max(0, /* approx */ 2 - joinedCount)} 人以上)` : '';
      return `<div class="card">
        <div class="hint">相手を待っています。 ${waitingFor} 開始前なので料金はまだ払われていません。</div>
        <button data-cg-action="cancel" class="btn" style="margin-top:6px; color:#c00">キャンセル</button>
      </div>`;
    }
    if (meJoined) {
      return `<div class="card"><div class="hint">参加済み。 全員揃うまでお待ち下さい。</div></div>`;
    }
    return `<div class="card">
      <div class="hint">対戦に参加しますか? 全員揃った時にプレイフィー ${fee}pt が各人から徴収されます。</div>
      <button data-cg-action="join" class="btn primary" style="margin-top:6px">${escapeHtml(joinLabel || '参加する')}</button>
    </div>`;
  }
  if (d.status === 'cancelled') return `<div class="card"><div class="hint">キャンセル済</div></div>`;
  if (d.status === 'finished') {
    let result;
    if (d.winner_user_id === null) result = '🤝 引分';
    else if (d.winner_user_id === meId) result = '🎉 あなたの勝ち!';
    else if (players.length === 1) result = '👏 終了';                        // ソロ
    else result = '😢 あなたの負け';
    return `<div class="card"><h3 style="margin:0">${result}</h3></div>`;
  }
  // playing — 投了ボタンも添える (= 参加者なら常時出す)
  const meIsPlayer = players.some(p => p.uid === meId);
  const resignBtn = meIsPlayer
    ? `<button data-cg-action="resign" class="btn" style="margin-top:6px; font-size:11px; color:#c00">🏳 投了 (ポイント戻りません)</button>`
    : '';
  return d.my_turn
    ? `<div class="card"><div class="bold">あなたの番。 盤面をタップ。</div>${resignBtn}</div>`
    : `<div class="card"><div class="hint">相手の番を待っています…</div>${resignBtn}</div>`;
}

// statusCard 内の data-cg-action="join"/"cancel" を配線するヘルパー。
//   joinState(d, meId) => 新 state を計算する関数。
export function wireStatusCard({ kind, gid, d, meId, joinState, detailPath, onAfter }) {
  document.querySelector('[data-cg-action="cancel"]')?.addEventListener('click', async () => {
    if (!confirm('キャンセルしますか?')) return;
    try {
      await post(`/api/custom-games/${kind}/games/${gid}/cancel`, {});
      navigate(detailPath || `#/cg/${kind}`);
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
  document.querySelector('[data-cg-action="resign"]')?.addEventListener('click', async () => {
    if (!confirm('🏳 投了しますか? (= ゲーム終了、 ポイント戻りません)')) return;
    try {
      await post(`/api/custom-games/${kind}/games/${gid}/resign`, {});
      onAfter?.();
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

// 詳細 polling を抽象化: paint 関数を一定間隔で呼び、 ノードが消えたら自動停止。
//   guardSelector に data 属性などを与えると DOM 検出で自動 unmount。
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

// applyMove の結果をそのままサーバに投げるヘルパー。
//   res = { state, finished, winner_user_id, turn_user_id }
export async function submitMove({ kind, gid, res }) {
  await post(`/api/custom-games/${kind}/games/${gid}/move`, {
    new_state: res.state,
    finished: res.finished,
    winner_user_id: res.winner_user_id,
    turn_user_id: res.turn_user_id,
  });
}

// kind 詳細を取得 (共通ラッパー、 失敗時は一覧へ戻る hint を表示)。
export async function fetchDetail({ kind, gid, detailPath }) {
  try {
    return await get(`/api/custom-games/${kind}/games/${gid}`);
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="card"><a href="${detailPath || `#/cg/${kind}`}" class="hint">← 一覧</a><div class="hint">${escapeHtml(e?.message || e)}</div></div>`;
    return null;
  }
}

// re-export 便利系 (kind 側が import 1 行で済むように)
export { state, toast, navigate, escapeHtml };

// ───────────────────────────────────────────────────────────────
// v628 defineGame: 全部入りラッパー。
//   kind 作者はロジック (initialState / applyMove) と盤面描画 (renderBoard) だけ
//   書けば終わり。 ロビー / 待ち / 参加 / 終了 / polling / submit / 取得は全部自動。
//
//   使い方:
//     export const { renderList, renderDetail } = defineGame({
//       kind:  'mygame',
//       title: '🎲 マイゲーム',
//       hint:  '説明',
//       initialState: (uid) => ({ ..., creator_uid: uid, opponent_uid: 0, turn_user_id: uid }),
//       applyMove:    (s, uid, move) => ({ state, finished, winner_user_id, turn_user_id }),
//       // 盤面描画。 ボタンやマスに data-move="..." (JSON) をつけると自動配線。
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
    // data-move 属性を持つ要素を自動配線。 値はそのまま move として applyMove に渡る。
    //   数値1個なら整数、 JSON っぽければパース、 それ以外は文字列。
    document.querySelectorAll(`[data-cg-gid="cg-${kind}-${gid}"] [data-move]`).forEach(b => {
      b.addEventListener('click', async () => {
        try {
          const raw = b.dataset.move;
          let move;
          if (raw.startsWith('{') || raw.startsWith('[')) move = JSON.parse(raw);
          else if (/^-?\d+$/.test(raw)) move = Number(raw);
          else move = raw;
          // v630 sketch が ctx 構築のため d を参照できるように 4 引数で渡す
          const res = applyMove(d.state, meId, move, d);
          await submitMove({ kind, gid, res });
          paint(gid);
        } catch (e) { toast(e?.message || e); }
      });
    });
  }

  return { renderList, renderDetail };
}

// ───────────────────────────────────────────────────────────────
// v631 sketch(): Processing / p5.js 風の高レベル API。
//
//   書く関数は **3 つだけで足ります** (ターン制ゲームならこれで十分):
//
//     setup(meId)               ── ゲーム開始時に 1 回だけ呼ばれる。
//                                   ゲーム固有の初期 state を return する。
//
//     draw(state, ctx)          ── 画面を描く時に呼ばれる (state が変わるたび)。
//                                   HTML 文字列を return する (盤面でも文字でも OK)。
//                                   自分の番が来たら、 ボタンに <button data-move="X">
//                                   を入れておくと、 タップで action() が呼ばれる。
//
//     action(state, me, move)   ── 自分がボタンを押した時に呼ばれる。
//                                   第3引数 move は data-move="X" の X
//                                   (整数 / 文字 / JSON を自動判定して渡る)。
//                                   { state: 新state, finished?: bool, winner?: 'me'|'opponent'|null }
//                                   を return する。 手番は LabPay が自動で相手に移す。
//
//   呼び出し順序を図で示すと:
//
//      [起案者が ＋新規卓]
//         │
//         ▼ setup(me)             1 回だけ
//       state ──→ DB
//                         [自分の画面] (polling 2.5s)         [相手の画面]
//                              │                                     │
//                              ▼                                     ▼
//                       draw(state, ctx)                       draw(state, ctx)
//                              │                                     │
//                              ▼ ボタンタップ
//                       action(state, me, move)
//                              │
//                              ▼ サーバに送信
//                       新 state ─────────────────────────→  相手の draw も更新
//
//   ctx (draw / action / start の最後の引数) に渡されるもの:
//     ctx.me        - 自分の uid (number)
//     ctx.you       - { uid, name, seat, role: 'creator' | 'opponent' }  自分
//     ctx.opponent  - 相手 (2 人式で waiting 中は null)
//     ctx.players   - 全員の配列 (着席順)。 各要素 {uid, name, seat, role}
//     ctx.seat      - 自分の seat (0..N-1)
//     ctx.turn      - 手番の uid (number、 終了時は null)
//     ctx.myTurn    - 自分の手番か (boolean)
//     ctx.winner    - 勝者の uid (number、 引分 / 進行中は null)
//     ctx.status    - 'waiting' | 'playing' | 'finished' | 'cancelled'
//
//   action() の return:
//     {
//       state:    新しいゲーム固有 state (必須)
//       finished: true なら終了 (省略可、 default false)
//       winner:   'me' | 'opponent' | <uid> | null
//                  'me' = 自分の勝ち、 'opponent' = 相手の勝ち、 null = 引分。
//                  finished=false なら無視されます。
//       next:     次の手番 uid (省略時 framework が自動 rotation)
//     }
// ───────────────────────────────────────────────────────────────
export function sketch(spec) {
  const { kind, title, hint, detailPath, setup, draw } = spec;
  // v631 action() に改名 (旧 play() は後方互換で受け付け)
  const action = spec.action || spec.play;
  if (!action) throw new Error('sketch: action(state, me, move) を渡してください');
  // spec.players: 1 (ソロ) / 2 / 4。 デフォルト 2。
  //   1 → opponent 概念なし、 status='waiting' を飛ばして即 playing (server側処理)
  //   2 → 既存 (turn は相手とトグル)
  //   4 → players 配列を順に rotation
  const playerCount = spec.players === 1 ? 1 : spec.players === 4 ? 4 : 2;

  return defineGame({
    kind, title, hint, detailPath,

    initialState(uid) {
      return {
        creator_uid: uid,
        opponent_uid: 0,                       // 2 人式の後方互換
        turn_user_id: uid,
        g: setup(uid),                          // ユーザのゲーム固有 state は g に
      };
    },

    applyMove(s, uid, move, d) {
      // ctx を action() にも渡す (= draw と同じ形)。 N 人卓で seat / players が取れる。
      const ctx = buildCtx(s, { meId: uid, d: d || { players: [], creator_name: '', opponent_name: '' }, myTurn: true, status: 'playing' });
      const res = action(s.g, uid, move, ctx);
      if (!res || !res.state) throw new Error('action() は { state, ... } を return してください');
      const finished = !!res.finished;
      let winner = null;
      if (finished) {
        if      (res.winner === 'me')        winner = uid;
        else if (res.winner === 'opponent')  winner = ctx.opponent?.uid || null;
        else if (typeof res.winner === 'number') winner = res.winner;
        else                                  winner = null;
      }
      // 次の手番: play() が next を返せばその uid、 なければ framework が自動 rotation。
      let next = null;
      if (!finished) {
        if (typeof res.next === 'number') next = res.next;
        else if (playerCount === 1)       next = uid;             // ソロはずっと自分
        else if (playerCount === 2)       next = uid === s.creator_uid ? s.opponent_uid : s.creator_uid;
        else {                                                    // 4 人 rotation
          const list = (ctx.players || []).map(p => p.uid);
          if (list.length) {
            const idx = list.indexOf(uid);
            next = list[(idx + 1) % list.length];
          } else next = uid;
        }
      }
      return {
        state: { ...s, g: res.state, turn_user_id: next },
        finished,
        winner_user_id: winner,
        turn_user_id: next,
      };
    },

    renderBoard(s, raw) {
      const ctx = buildCtx(s, raw, /*forPlay*/false);
      return draw(s.g, ctx);
    },

    joinTransition(s, oppUid) {
      // 2 人式: opponent_uid を入れる (旧 UI 互換)。 4 人式はサーバの players_json 任せ。
      if (playerCount === 2) return { ...s, opponent_uid: oppUid };
      return s;
    },
  });

  // ctx 組立 (draw / play 共通)
  function buildCtx(s, raw, forPlay) {
    const meId  = raw.meId;
    const d     = raw.d;
    const list  = Array.isArray(d.players) && d.players.length
      ? d.players.map(p => ({ uid: p.uid, name: p.name }))
      : [{ uid: s.creator_uid, name: d.creator_name }, ...(s.opponent_uid ? [{ uid: s.opponent_uid, name: d.opponent_name }] : [])];
    const enriched = list.map((p, i) => ({
      uid: p.uid, name: p.name, seat: i,
      role: p.uid === s.creator_uid ? 'creator' : 'opponent',
    }));
    const you = enriched.find(p => p.uid === meId) || null;
    const opponent = enriched.find(p => p.uid !== meId) || null;
    return {
      me: meId,
      you, opponent,
      players: enriched,
      seat: you?.seat ?? -1,
      turn: s.turn_user_id,
      myTurn: !!raw.myTurn,
      winner: d.winner_user_id,
      status: raw.status,
    };
  }
}
