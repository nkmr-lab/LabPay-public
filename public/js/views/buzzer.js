// /#/buzzer — 早押しクイズ。リアル現場 (ゼミ等) で出題者が口頭出題、参加者
//   がスマホで「タップ」 → 1 番早かった人が緑 (回答権) + 他は赤 (順位 + 1 位
//   との差)。出題者「次へ」で全員早押しモードに戻る。 v872 #454。

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

let pollTimer = null;
let pollAbort = false;
let clientRoundStartMs = null; // クライアントがラウンド開始を検知した瞬間の Date.now()
let lastRoundNo = 0;
let myTapElapsedMs = null;     // 自分がタップした時の経過 ms (= 結果表示用)

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
        <h2 style="margin:0">⚡ 早押しクイズ</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/buzzer/new">＋新しいセッション</a>
      </div>
      <div class="hint-sm" style="margin-top:4px">
        リアルのクイズで早押しボタン代わりに。出題者が「次へ」を押すと全員のスマホが入力モードになり、タップした順で順位が決まる。 1 位だけ緑で回答権を取れる。
      </div>
    </div>
    <div id="bz-list"><div class="muted">読込中…</div></div>`;
  try {
    const d = await get('/api/buzzer/sessions');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('bz-list').innerHTML = `
        <div class="card center muted">まだセッションがありません。「＋新しいセッション」から作ってください。</div>`;
      return;
    }
    document.getElementById('bz-list').innerHTML = items.map(it => `
      <a class="card" href="#/buzzer/${it.id}" style="display:block; text-decoration:none; color:inherit">
        <div class="row" style="gap:8px; align-items:center">
          ${avatarHtml(it.creator_name, it.creator_avatar, 'sm')}
          <div style="flex:1; min-width:0">
            <div class="bold" style="font-size:15px">⚡ ${escapeHtml(it.title)} ${it.status === 'active' ? '<span class="tag ok">受付中</span>' : '<span class="tag muted">終了</span>'}</div>
            <div class="muted" style="font-size:12px">
              起案: ${escapeHtml(it.creator_name || '')} ・ラウンド ${it.round_no} ・参加者 ${it.participants} 人
            </div>
          </div>
        </div>
      </a>`).join('');
  } catch (e) {
    document.getElementById('bz-list').innerHTML = `<div class="card muted">読込失敗: ${escapeHtml(e.message)}</div>`;
  }
}

export async function renderBuzzerNew() {
  stopPoll();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <a href="#/buzzer" class="btn">← 一覧</a>
      <h2 style="margin:6px 0 0">＋新しい早押しセッション</h2>
    </div>
    <div class="card">
      <label style="font-size:13px">タイトル (例: ゼミミニクイズ 2026.06.28)</label>
      <input id="bz-title" type="text" maxlength="160" value="早押し" style="width:100%; padding:8px; margin-top:4px">
      <div class="hint-sm" style="margin-top:6px">参加者は一覧からセッションを開くだけで参加できます (事前登録不要)。</div>
      <div style="margin-top:14px">
        <button id="bz-create" class="primary">セッションを開始</button>
      </div>
    </div>`;
  document.getElementById('bz-create').addEventListener('click', async () => {
    const title = document.getElementById('bz-title').value.trim();
    if (!title) { toast('タイトルを入れてください'); return; }
    try {
      const r = await post('/api/buzzer/sessions', { title });
      toast('セッション開始');
      navigate('#/buzzer/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderBuzzerDetail({ params }) {
  // v1117 中村さん報告「早押しクイズ、セッションを作成はできるがゲームに参加できない」
  //   原因: router は { params, query } を渡すのに、この関数は { id } を分解しようとして
  //   id が常に undefined、GET /api/buzzer/sessions/undefined が 404 で「セッション不在」表示。
  //   → { params } に修正して params.id を使う。
  const id = params?.id;
  stopPoll();
  pollAbort = false;
  clientRoundStartMs = null;
  lastRoundNo = 0;
  myTapElapsedMs = null;

  const app = document.getElementById('app');
  app.innerHTML = `<div class="muted">読込中…</div>`;
  let d;
  try { d = await get('/api/buzzer/sessions/' + id); }
  catch (e) { app.innerHTML = `<div class="card muted">読込失敗: ${escapeHtml(e.message)}</div>`; return; }
  if (!d) { app.innerHTML = `<div class="card muted">セッション不在</div>`; return; }
  const isCreator = !!d.is_creator;
  const status = d.status;

  app.innerHTML = `
    <div class="card page-header">
      <a href="#/buzzer" class="btn">← 一覧</a>
      <h2 style="margin:6px 0 0">⚡ ${escapeHtml(d.title)} ${status === 'active' ? '<span class="tag ok">受付中</span>' : '<span class="tag muted">終了</span>'}</h2>
      <div class="muted" style="font-size:12px; margin-top:4px">
        ${avatarHtml(d.creator_name, d.creator_avatar, 'sm')} ${escapeHtml(d.creator_name || '')} ・ラウンド <span id="bz-round-no">${d.round_no}</span>
      </div>
    </div>
    ${status === 'active' ? `
      <div class="card" style="text-align:center; padding:16px">
        <div id="bz-stage" style="min-height:200px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px">
          <div class="muted">${d.round_no === 0 ? '出題者が「次へ」を押すと早押し開始' : '出題者の操作を待ってます…'}</div>
        </div>
      </div>
      ${isCreator ? `
        <div class="card">
          <button id="bz-next" class="primary" style="width:100%; padding:14px; font-size:16px">⏭ 次の問題へ (リセット)</button>
          <button id="bz-end"  class="btn"     style="width:100%; padding:10px; font-size:14px; margin-top:8px; color:#c00">⏹ セッション終了</button>
        </div>` : ''}` :
      `<div class="card center muted">このセッションは終了しました</div>`}
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📊 直近ラウンドの順位</div>
      <div id="bz-ranking"></div>
    </div>`;

  // 起案者ボタン
  document.getElementById('bz-next')?.addEventListener('click', async () => {
    try {
      const r = await post(`/api/buzzer/sessions/${id}/new-round`, {});
      toast(`R${r.round_no} 開始!`);
      // 自分が起案者でも参加者としてタップできる: ローカル開始タイミングをここでセット
      handleRoundChange(r.round_no);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('bz-end')?.addEventListener('click', async () => {
    if (!confirm('セッションを終了します。いいですか?')) return;
    try { await post(`/api/buzzer/sessions/${id}/end`, {}); toast('終了しました'); navigate('#/buzzer'); }
    catch (e) { toast('失敗: ' + e.message); }
  });

  // 開始時 round_no が 0 なら待機状態。 round_no >= 1 なら既存ラウンド (= 表示のみ)
  lastRoundNo = d.round_no;
  if (d.round_no >= 1) renderRanking(d.taps || []);

  // ポーリング開始
  if (status === 'active') startPoll(id);
}

async function startPoll(id) {
  const tick = async () => {
    if (pollAbort) return;
    try {
      const p = await get(`/api/buzzer/sessions/${id}/poll`);
      if (p.status === 'ended') {
        toast('セッションが終了されました');
        navigate('#/buzzer');
        return;
      }
      if (p.round_no !== lastRoundNo) {
        // ラウンド変化を検知 → クライアントの round 開始 ms をセット
        handleRoundChange(p.round_no);
      }
      renderRanking(p.taps || []);
    } catch (_) {}
    if (!pollAbort) pollTimer = setTimeout(tick, 800);
  };
  tick();
}

// ラウンド開始を検知した瞬間。 stage を入力モードに切替、タップハンドラを設置。
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
    <div class="hint-sm" style="font-size:11px">早押し中… 早くタップした順で順位が決まる</div>`;
  const tap = document.getElementById('bz-tap');
  const tapHandler = (ev) => {
    ev.preventDefault();
    if (myTapElapsedMs !== null) return; // 二重タップ防止
    myTapElapsedMs = Date.now() - clientRoundStartMs;
    sendTap(myTapElapsedMs);
    tap.style.background = 'linear-gradient(135deg,#94a3b8,#64748b)';
    tap.textContent = `${myTapElapsedMs} ms ・集計中…`;
  };
  // touchstart を先に拾えば click より数十 ms 早い (スマホ)
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
  } catch (e) { toast('送信失敗: ' + e.message); }
}

function currentSessionIdFromHash() {
  const m = (location.hash || '').match(/^#\/buzzer\/(\d+)/);
  return m ? m[1] : null;
}

function renderRanking(taps) {
  const root = document.getElementById('bz-ranking');
  if (!root) return;
  if (!taps.length) {
    root.innerHTML = '<div class="muted">まだタップなし</div>';
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
  // 自分の stage 色を順位で更新 (1位 = 緑、それ以外 = 赤)
  if (!state.me) return;
  const me = taps.find(t => t.user_id === state.me.id);
  const tap = document.getElementById('bz-tap');
  if (!tap || !me) return;
  if (me.rank === 1) {
    tap.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
    tap.innerHTML = `<div style="text-align:center"><div style="font-size:72px; font-weight:900">1</div><div style="font-size:18px">回答権取得!</div><div style="font-size:14px; opacity:0.85">${me.elapsed_ms} ms</div></div>`;
  } else {
    const winnerMs = taps[0].elapsed_ms;
    tap.style.background = 'linear-gradient(135deg,#ef4444,#b91c1c)';
    tap.innerHTML = `<div style="text-align:center"><div style="font-size:54px; font-weight:800">${me.rank} 位</div><div style="font-size:14px; opacity:0.9">${me.elapsed_ms} ms (+${me.elapsed_ms - winnerMs})</div></div>`;
  }
}
