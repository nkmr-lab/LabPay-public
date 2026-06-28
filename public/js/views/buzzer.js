// /#/buzzer — 早押し クイズ。 リアル 現場 (ゼミ 等) で 出題者 が 口頭 出題、 参加者
//   が スマホ で 「タップ」 → 1 番 早かった 人 が 緑 (回答権) + 他 は 赤 (順位 + 1 位
//   と の 差)。 出題者 「次 へ」 で 全員 早押し モード に 戻る。 v872 #454。

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

let pollTimer = null;
let pollAbort = false;
let clientRoundStartMs = null; // クライアント が ラウンド 開始 を 検知 した 瞬間 の Date.now()
let lastRoundNo = 0;
let myTapElapsedMs = null;     // 自分 が タップ した 時 の 経過 ms (= 結果 表示 用)

function stopPoll() {
  pollAbort = true;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

export async function renderBuzzerList() {
  stopPoll();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">⚡ 早押し クイズ</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/buzzer/new">＋ 新しい セッション</a>
      </div>
      <div class="hint-sm" style="margin-top:4px">
        リアル の クイズ で 早押し ボタン 代わり に。 出題者 が 「次 へ」 を 押す と 全員 の スマホ が 入力 モード に なり、 タップ し た 順 で 順位 が 決まる。 1 位 だけ 緑 で 回答 権 を 取れる。
      </div>
    </div>
    <div id="bz-list"><div class="muted">読込中…</div></div>`;
  try {
    const d = await get('/api/buzzer/sessions');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('bz-list').innerHTML = `
        <div class="card center muted">まだ セッション が ありません。 「＋ 新しい セッション」 から 作って ください。</div>`;
      return;
    }
    document.getElementById('bz-list').innerHTML = items.map(it => `
      <a class="card" href="#/buzzer/${it.id}" style="display:block; text-decoration:none; color:inherit">
        <div class="row" style="gap:8px; align-items:center">
          ${avatarHtml(it.creator_name, it.creator_avatar, 'sm')}
          <div style="flex:1; min-width:0">
            <div class="bold" style="font-size:15px">⚡ ${escapeHtml(it.title)} ${it.status === 'active' ? '<span class="tag ok">受付中</span>' : '<span class="tag muted">終了</span>'}</div>
            <div class="muted" style="font-size:12px">
              起案: ${escapeHtml(it.creator_name || '')} ・ ラウンド ${it.round_no} ・ 参加者 ${it.participants} 人
            </div>
          </div>
        </div>
      </a>`).join('');
  } catch (e) {
    document.getElementById('bz-list').innerHTML = `<div class="card muted">読込 失敗: ${escapeHtml(e.message)}</div>`;
  }
}

export async function renderBuzzerNew() {
  stopPoll();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <a href="#/buzzer" class="btn">← 一覧</a>
      <h2 style="margin:6px 0 0">＋ 新しい 早押し セッション</h2>
    </div>
    <div class="card">
      <label style="font-size:13px">タイトル (例: ゼミ ミニ クイズ 2026.06.28)</label>
      <input id="bz-title" type="text" maxlength="160" value="早押し" style="width:100%; padding:8px; margin-top:4px">
      <div class="hint-sm" style="margin-top:6px">参加者 は 一覧 から セッション を 開く だけ で 参加 できます (事前 登録 不要)。</div>
      <div style="margin-top:14px">
        <button id="bz-create" class="primary">セッション を 開始</button>
      </div>
    </div>`;
  document.getElementById('bz-create').addEventListener('click', async () => {
    const title = document.getElementById('bz-title').value.trim();
    if (!title) { toast('タイトル を 入れて ください'); return; }
    try {
      const r = await post('/api/buzzer/sessions', { title });
      toast('セッション 開始');
      navigate('#/buzzer/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderBuzzerDetail({ id }) {
  stopPoll();
  pollAbort = false;
  clientRoundStartMs = null;
  lastRoundNo = 0;
  myTapElapsedMs = null;

  const app = document.getElementById('app');
  app.innerHTML = `<div class="muted">読込中…</div>`;
  let d;
  try { d = await get('/api/buzzer/sessions/' + id); }
  catch (e) { app.innerHTML = `<div class="card muted">読込 失敗: ${escapeHtml(e.message)}</div>`; return; }
  if (!d) { app.innerHTML = `<div class="card muted">セッション 不在</div>`; return; }
  const isCreator = !!d.is_creator;
  const status = d.status;

  app.innerHTML = `
    <div class="card page-header">
      <a href="#/buzzer" class="btn">← 一覧</a>
      <h2 style="margin:6px 0 0">⚡ ${escapeHtml(d.title)} ${status === 'active' ? '<span class="tag ok">受付中</span>' : '<span class="tag muted">終了</span>'}</h2>
      <div class="muted" style="font-size:12px; margin-top:4px">
        ${avatarHtml(d.creator_name, d.creator_avatar, 'sm')} ${escapeHtml(d.creator_name || '')} ・ ラウンド <span id="bz-round-no">${d.round_no}</span>
      </div>
    </div>
    ${status === 'active' ? `
      <div class="card" style="text-align:center; padding:16px">
        <div id="bz-stage" style="min-height:200px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px">
          <div class="muted">${d.round_no === 0 ? '出題者 が 「次 へ」 を 押す と 早押し 開始' : '出題者 の 操作 を 待って ます…'}</div>
        </div>
      </div>
      ${isCreator ? `
        <div class="card">
          <button id="bz-next" class="primary" style="width:100%; padding:14px; font-size:16px">⏭ 次 の 問題 へ (リセット)</button>
          <button id="bz-end"  class="btn"     style="width:100%; padding:10px; font-size:14px; margin-top:8px; color:#c00">⏹ セッション 終了</button>
        </div>` : ''}` :
      `<div class="card center muted">この セッション は 終了 しました</div>`}
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📊 直近 ラウンド の 順位</div>
      <div id="bz-ranking"></div>
    </div>`;

  // 起案者 ボタン
  document.getElementById('bz-next')?.addEventListener('click', async () => {
    try {
      const r = await post(`/api/buzzer/sessions/${id}/new-round`, {});
      toast(`R${r.round_no} 開始!`);
      // 自分 が 起案者 でも 参加者 と して タップ できる: ローカル 開始 タイミング を ここ で セット
      handleRoundChange(r.round_no);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('bz-end')?.addEventListener('click', async () => {
    if (!confirm('セッション を 終了 します。 いいですか?')) return;
    try { await post(`/api/buzzer/sessions/${id}/end`, {}); toast('終了 しました'); navigate('#/buzzer'); }
    catch (e) { toast('失敗: ' + e.message); }
  });

  // 開始 時 round_no が 0 なら 待機 状態。 round_no >= 1 なら 既存 ラウンド (= 表示 のみ)
  lastRoundNo = d.round_no;
  if (d.round_no >= 1) renderRanking(d.taps || []);

  // ポーリング 開始
  if (status === 'active') startPoll(id);
}

async function startPoll(id) {
  const tick = async () => {
    if (pollAbort) return;
    try {
      const p = await get(`/api/buzzer/sessions/${id}/poll`);
      if (p.status === 'ended') {
        toast('セッション が 終了 されました');
        navigate('#/buzzer');
        return;
      }
      if (p.round_no !== lastRoundNo) {
        // ラウンド 変化 を 検知 → クライアント の round 開始 ms を セット
        handleRoundChange(p.round_no);
      }
      renderRanking(p.taps || []);
    } catch (_) {}
    if (!pollAbort) pollTimer = setTimeout(tick, 800);
  };
  tick();
}

// ラウンド 開始 を 検知 した 瞬間。 stage を 入力 モード に 切替、 タップ ハンドラ を 設置。
function handleRoundChange(newRoundNo) {
  lastRoundNo = newRoundNo;
  clientRoundStartMs = Date.now();
  myTapElapsedMs = null;
  const noEl = document.getElementById('bz-round-no');
  if (noEl) noEl.textContent = String(newRoundNo);
  const stage = document.getElementById('bz-stage');
  if (!stage) return;
  stage.innerHTML = `
    <div id="bz-tap" tabindex="0" style="cursor:pointer; width:100%; max-width:480px; min-height:240px; border-radius:20px; background:linear-gradient(135deg,#22c55e,#16a34a); color:#fff; display:flex; align-items:center; justify-content:center; font-size:48px; font-weight:800; box-shadow:0 6px 20px rgba(0,0,0,0.2); user-select:none; -webkit-tap-highlight-color:transparent">
      タップ!
    </div>
    <div class="hint-sm" style="font-size:11px">早 押し 中… 早く タップ した 順 で 順位 が 決まる</div>`;
  const tap = document.getElementById('bz-tap');
  const tapHandler = (ev) => {
    ev.preventDefault();
    if (myTapElapsedMs !== null) return; // 二重 タップ 防止
    myTapElapsedMs = Date.now() - clientRoundStartMs;
    sendTap(myTapElapsedMs);
    tap.style.background = 'linear-gradient(135deg,#94a3b8,#64748b)';
    tap.textContent = `${myTapElapsedMs} ms ・ 集計 中…`;
  };
  // touchstart を 先 に 拾えば click より 数十 ms 早い (スマホ)
  tap.addEventListener('touchstart', tapHandler, { passive: false });
  tap.addEventListener('mousedown',  tapHandler);
}

let lastSessionId = null;
async function sendTap(elapsedMs) {
  const id = currentSessionIdFromHash();
  if (!id) return;
  try {
    const r = await post(`/api/buzzer/sessions/${id}/tap`, { elapsed_ms: elapsedMs });
    renderRanking(r.taps || []);
    updateMyStage(r.taps || []);
  } catch (e) { toast('送信 失敗: ' + e.message); }
}

function currentSessionIdFromHash() {
  const m = (location.hash || '').match(/^#\/buzzer\/(\d+)/);
  return m ? m[1] : null;
}

function renderRanking(taps) {
  const root = document.getElementById('bz-ranking');
  if (!root) return;
  if (!taps.length) {
    root.innerHTML = '<div class="muted">まだ タップ なし</div>';
    return;
  }
  const winnerMs = taps[0].elapsed_ms;
  root.innerHTML = taps.map(t => `
    <div class="row" style="padding:6px 0; gap:8px; align-items:center; border-top:1px solid var(--line)">
      <span style="font-weight:700; font-size:18px; color:${t.rank === 1 ? '#16a34a' : '#6b7280'}; min-width:32px">${t.rank}位</span>
      ${avatarHtml(t.display_name, t.avatar_url, 'sm')}
      <span class="bold" style="flex:1">${escapeHtml(t.display_name)}</span>
      <span style="font-variant-numeric:tabular-nums">
        ${t.elapsed_ms} ms ${t.rank > 1 ? `<span class="muted">(+${t.elapsed_ms - winnerMs})</span>` : ''}
      </span>
    </div>`).join('');
}

function updateMyStage(taps) {
  // 自分 の stage 色 を 順位 で 更新 (1位 = 緑、 それ以外 = 赤)
  if (!state.me) return;
  const me = taps.find(t => t.user_id === state.me.id);
  const tap = document.getElementById('bz-tap');
  if (!tap || !me) return;
  if (me.rank === 1) {
    tap.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
    tap.innerHTML = `<div style="text-align:center"><div style="font-size:72px; font-weight:900">1</div><div style="font-size:18px">回答権 取得!</div><div style="font-size:14px; opacity:0.85">${me.elapsed_ms} ms</div></div>`;
  } else {
    const winnerMs = taps[0].elapsed_ms;
    tap.style.background = 'linear-gradient(135deg,#ef4444,#b91c1c)';
    tap.innerHTML = `<div style="text-align:center"><div style="font-size:54px; font-weight:800">${me.rank} 位</div><div style="font-size:14px; opacity:0.9">${me.elapsed_ms} ms (+${me.elapsed_ms - winnerMs})</div></div>`;
  }
}
