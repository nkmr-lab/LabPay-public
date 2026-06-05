// /#/stopwatches — 共有 ストップウォッチ。
//  - 一覧 / 新規 / 詳細
//  - status: running / paused / stopped
//  - 経過秒数 = elapsed_offset_seconds + (running なら server_now - started_at)
//  - 1 秒 tick で 表示更新 + サーバ 同期 (running 中 5s, それ以外 30s)

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';
import { acquireWakeLock, releaseWakeLock, isWakeLockSupported } from '../wakelock.js';

function fmtElapsed(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// v447 ms 精度 (詳細画面 表示用)。 ホーム / 一覧 は 秒精度の fmtElapsed を 継続使用。
function fmtElapsedMs(ms) {
  ms = Math.max(0, Math.floor(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mss = ms % 1000;
  const pad = (n, w=2) => String(n).padStart(w, '0');
  const millis = pad(mss, 3);
  return h > 0
    ? `${h}:${pad(m)}:${pad(s)}.${millis}`
    : `${pad(m)}:${pad(s)}.${millis}`;
}

// ─── List ───
export async function renderStopwatches() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">⏱ ストップウォッチ</h2>
        <a class="btn primary" href="#/stopwatches/new">＋ 新規</a>
      </div>
      <p class="card-subtitle" style="margin:6px 0 0">
        メンバーで 共有する カウントアップ 計測器。 開始 / 一時停止 / リセット 全員 操作可。
      </p>
    </div>
    <div id="sw-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  await loadList();
}

async function loadList() {
  const root = document.getElementById('sw-list');
  if (!root) return;
  try {
    const d = await get('/api/stopwatches');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = `<div class="empty">まだ ストップウォッチは ありません</div>`;
      return;
    }
    root.innerHTML = items.map(s => {
      const statusTag = s.status === 'running' ? '<span class="tag" style="background:#e3f2fd; color:#1565c0">🟢 動作中</span>'
        : s.status === 'paused' ? '<span class="tag warn">⏸ 一時停止</span>'
        : '<span class="tag muted">⏹ リセット済</span>';
      return `
        <a class="list-item" href="#/stopwatches/${s.id}">
          <div class="grow">
            <div class="bold">${escapeHtml(s.title)} ${statusTag}</div>
            <div class="meta" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">
              ${avatarHtml(s.creator_name, s.creator_avatar_url, 'xs')}
              ${escapeHtml(s.creator_name)} · 👥 ${s.participant_count} · 経過 ${fmtElapsed(s.elapsed_seconds)}
            </div>
          </div>
          <div class="hint">→</div>
        </a>`;
    }).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ─── New ───
export async function renderStopwatchNew() {
  const app = document.getElementById('app');
  // members preset (URL ?members=1,2,3 / ?title=...)
  const url = new URL(location.hash.slice(1), location.origin);
  const presetMembers = (url.searchParams.get('members') || '')
    .split(',').map(s => Number(s)).filter(Boolean);
  const presetTitle = url.searchParams.get('title') || '';
  // v441 自分は デフォで 追加。 ?members= で 指定があれば そっち優先 (重複は picker 側で 排除)。
  const meId = Number(state.me?.id) || 0;
  const initial = presetMembers.length ? presetMembers : (meId ? [meId] : []);
  app.innerHTML = `
    <div class="card">
      <a href="#/stopwatches" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">＋ 新規 ストップウォッチ</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル (任意 / 空欄なら 「ストップウォッチ」)</span>
        <input type="text" id="swn-title" maxlength="200"
               placeholder="例: 発表時間 / 雑談タイム" value="${escapeHtml(presetTitle)}" autofocus>
      </label>
      <div class="field">
        <span class="lbl">参加者 (作成者は自動追加)</span>
        <div id="swn-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="swn-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <a href="#/stopwatches" class="btn">キャンセル</a>
        <button id="swn-save" class="primary">作成</button>
      </div>
    </div>
  `;
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer: document.getElementById('swn-bulk'),
      chipsContainer: document.getElementById('swn-members'),
      initial,
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('swn-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  document.getElementById('swn-save').addEventListener('click', async () => {
    const btn = document.getElementById('swn-save');
    btn.disabled = true;
    let title = document.getElementById('swn-title').value.trim();
    try {
      // v442 タイトル空欄なら AI に 適当に 付けてもらう
      if (!title) {
        btn.textContent = '🤖 タイトル生成中…';
        const part = picker ? [...picker.getSelected()].length : 1;
        const ctx = `共有 ストップウォッチ (カウントアップ計測器) を 今 ${part} 人で 作成します。 用途は たぶん 発表時間・雑談計測・作業セット・実験 など。 ピッタリ な 短いタイトルを 1 つ。`;
        try {
          const r = await post('/api/ai/short_title', { context: ctx });
          title = r.title || 'ストップウォッチ';
        } catch (_) {
          title = 'ストップウォッチ';
        }
      }
      btn.textContent = '作成中…';
      const r = await post('/api/stopwatches', {
        title, participant_ids: picker ? [...picker.getSelected()] : [],
      });
      toast('作成しました');
      navigate('#/stopwatches/' + r.id);
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = '作成';
    }
  });
}

// ─── Detail ───
// state: currentSw, clientServerOffsetMs, displayTimer, syncTimer
let swState = null;

export async function renderStopwatchDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/stopwatches" class="hint">← 一覧</a>
      <div id="swd-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card" id="swd-display-card" hidden>
      <div id="swd-display" style="font-family:monospace; font-size:56px; text-align:center; font-weight:700; letter-spacing:1px; padding:18px 0; color:var(--primary); font-variant-numeric:tabular-nums">--:--.---</div>
      <div id="swd-last-lap" class="meta" style="text-align:center; margin:-6px 0 8px; min-height:16px; font-family:monospace"></div>
      <div class="row" style="gap:6px; justify-content:center; flex-wrap:wrap">
        <button id="swd-start" class="primary" style="min-width:90px">▶ 開始</button>
        <button id="swd-pause" class="btn"     style="min-width:90px" hidden>⏸ 一時停止</button>
        <button id="swd-lap"   class="btn"     style="min-width:90px" hidden>🏁 ラップ</button>
        <button id="swd-reset" class="btn"     style="min-width:90px">⏹ リセット</button>
      </div>
      <div class="meta" style="text-align:center; margin-top:8px" id="swd-status-line"></div>
    </div>
    <div class="card" id="swd-laps-card" hidden>
      <h3 style="margin:0 0 6px">🏁 ラップ (<span id="swd-laps-count">0</span>)</h3>
      <div id="swd-laps-list" class="list"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">参加者 (<span id="swd-pcnt">0</span>)</h3>
      <div id="swd-parts" class="list"></div>
    </div>
    <div class="card" id="swd-admin" hidden>
      <button id="swd-del" class="danger">この ストップウォッチを 削除</button>
    </div>
  `;
  await loadDetail(id);
  stopTickers();
  startTickers(id);
}

function stopTickers() {
  if (swState?.displayTimer) clearInterval(swState.displayTimer);
  if (swState?.syncTimer)    clearInterval(swState.syncTimer);
  if (swState) { swState.displayTimer = null; swState.syncTimer = null; }
  // v405 wake lock release
  releaseWakeLock('stopwatch-' + (swState?.sw?.id || ''));
}

function startTickers(id) {
  // v447 50ms tick で ms 表示。 60Hz 完全 同期 までは いらないが、
  // 20Hz あれば 数字が 滑らかに 進む。
  swState.displayTimer = setInterval(() => updateDisplay(), 50);
  // 5 秒 (running) or 30 秒 (それ以外) で サーバ同期 (ms 列の 再取得 + ラップ反映)
  const schedule = () => {
    if (swState?.syncTimer) clearInterval(swState.syncTimer);
    if (!swState) return;
    const ms = swState.sw?.status === 'running' ? 5000 : 30000;
    swState.syncTimer = setInterval(async () => {
      try {
        await loadDetail(id);
        schedule();  // re-schedule with potentially new status
      } catch (_) {}
    }, ms);
  };
  schedule();
  // home から 離れたら timer 停止 (DOM 消失で 検知)
  const watcher = setInterval(() => {
    if (!document.getElementById('swd-display')) {
      clearInterval(watcher);
      stopTickers();
    }
  }, 1000);
}

async function loadDetail(id) {
  try {
    const clientNowAtSend = Date.now();
    const sw = await get('/api/stopwatches/' + id);
    const clientNowAtRecv = Date.now();
    // server_now_ms - client_now_at_recv = サーバが クライアント時計より 進んでいる ms 数
    const serverNowMs = Number(sw.server_now_ms) || Date.parse(sw.server_now);
    swState = swState || {};
    swState.sw = sw;
    swState.clientServerOffsetMs = clientNowAtRecv - serverNowMs;
    // v447 baseElapsedMs / clientAnchorMs を 持って tick 中は サーバを 叩かず 進める。
    swState.baseElapsedMs = Number(sw.elapsed_ms) || 0;
    swState.clientAnchorMs = clientNowAtRecv;
    swState.networkRttHalfMs = Math.max(0, Math.floor((clientNowAtRecv - clientNowAtSend) / 2));
    renderHead(sw);
    renderControls(sw, id);
    renderParts(sw);
    renderLaps(sw);
    updateDisplay();
    if (sw.status === 'running') {
      acquireWakeLock('stopwatch-' + id);
    } else {
      releaseWakeLock('stopwatch-' + id);
    }
  } catch (e) {
    document.getElementById('swd-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// 現在 表示すべき 経過 ms を 計算 (client 時計 ベース)。 running なら
// recv 後の 経過分を 足す、 paused/stopped なら baseElapsedMs そのまま。
function currentElapsedMs() {
  const st = swState;
  if (!st || !st.sw) return 0;
  if (st.sw.status === 'running') {
    return st.baseElapsedMs + Math.max(0, Date.now() - st.clientAnchorMs);
  }
  return st.baseElapsedMs;
}

function renderHead(sw) {
  const statusTag = sw.status === 'running' ? '<span class="tag" style="background:#e3f2fd; color:#1565c0">🟢 動作中</span>'
    : sw.status === 'paused' ? '<span class="tag warn">⏸ 一時停止</span>'
    : '<span class="tag muted">⏹ リセット済</span>';
  document.getElementById('swd-head').innerHTML = `
    <h2 style="margin:0">${escapeHtml(sw.title)} ${statusTag}</h2>
    <div class="meta" style="display:flex; gap:6px; align-items:center; margin-top:4px">
      ${avatarHtml(sw.creator_name, sw.creator_avatar_url, 'sm')}
      ${escapeHtml(sw.creator_name)} さんが作成
    </div>`;
  document.getElementById('swd-display-card').hidden = false;
  if (sw.is_mine) {
    document.getElementById('swd-admin').hidden = false;
    document.getElementById('swd-del').onclick = async () => {
      if (!confirm('この ストップウォッチを 削除しますか?')) return;
      try { await del('/api/stopwatches/' + sw.id); navigate('#/stopwatches'); }
      catch (e) { toast('失敗: ' + e.message); }
    };
  }
}

function renderControls(sw, id) {
  const startBtn = document.getElementById('swd-start');
  const pauseBtn = document.getElementById('swd-pause');
  const resetBtn = document.getElementById('swd-reset');
  const lapBtn   = document.getElementById('swd-lap');
  if (sw.status === 'running') {
    startBtn.hidden = true;
    pauseBtn.hidden = false;
    lapBtn.hidden = false;
  } else {
    startBtn.hidden = false;
    pauseBtn.hidden = true;
    lapBtn.hidden = true;
    startBtn.textContent = sw.status === 'paused' ? '▶ 再開' : '▶ 開始';
  }
  startBtn.onclick = async () => {
    try { await post('/api/stopwatches/' + id + '/start', {}); await loadDetail(id); }
    catch (e) { toast('失敗: ' + e.message); }
  };
  pauseBtn.onclick = async () => {
    try { await post('/api/stopwatches/' + id + '/pause', {}); await loadDetail(id); }
    catch (e) { toast('失敗: ' + e.message); }
  };
  resetBtn.onclick = async () => {
    const msg = (sw.laps && sw.laps.length)
      ? `経過時間を 0 に リセットしますか?\n(ラップ ${sw.laps.length} 件 も 全削除されます)`
      : '経過時間を 0 に リセットしますか?';
    if (!confirm(msg)) return;
    try { await post('/api/stopwatches/' + id + '/reset', {}); await loadDetail(id); }
    catch (e) { toast('失敗: ' + e.message); }
  };
  // v447 ラップ。 client_elapsed_ms を 送って 「タップ瞬間」 を 正確に 反映。
  lapBtn.onclick = async () => {
    if (!swState?.sw || swState.sw.status !== 'running') return;
    const clientMs = currentElapsedMs();
    lapBtn.disabled = true;
    try {
      const r = await post('/api/stopwatches/' + id + '/lap', { client_elapsed_ms: clientMs });
      // 楽観反映: 直近ラップを 即追加して 体感ラグ ゼロに。 5s 後の sync で 整合。
      if (swState.sw) {
        swState.sw.laps = swState.sw.laps || [];
        swState.sw.laps.unshift({
          id: r.id || 0, lap_index: r.lap_index,
          elapsed_ms: r.elapsed_ms, split_ms: r.split_ms,
          recorded_by_user_id: 0, recorded_by_name: '自分',
          recorded_at: new Date().toISOString(),
        });
        renderLaps(swState.sw);
      }
    } catch (e) { toast('失敗: ' + e.message); }
    lapBtn.disabled = false;
  };
}

function renderLaps(sw) {
  const card = document.getElementById('swd-laps-card');
  const list = document.getElementById('swd-laps-list');
  const cnt  = document.getElementById('swd-laps-count');
  const lastEl = document.getElementById('swd-last-lap');
  if (!card || !list || !cnt) return;
  const laps = sw.laps || [];
  cnt.textContent = laps.length;
  card.hidden = laps.length === 0;
  if (!laps.length) {
    list.innerHTML = '';
    if (lastEl) lastEl.textContent = '';
    return;
  }
  // 最新ラップ を ヘッダ 下に 大きめ で 表示。
  if (lastEl) {
    const last = laps[0];
    lastEl.textContent = `🏁 ラップ ${last.lap_index}  ${fmtElapsedMs(last.split_ms)}  /  累計 ${fmtElapsedMs(last.elapsed_ms)}`;
  }
  // 最小 split / 最大 split を ハイライト (ラップ 2 件以上で 意味あり)
  let minSplit = Infinity, maxSplit = -Infinity;
  for (const l of laps) {
    if (l.split_ms < minSplit) minSplit = l.split_ms;
    if (l.split_ms > maxSplit) maxSplit = l.split_ms;
  }
  list.innerHTML = laps.map(l => {
    const tag = l.split_ms === minSplit && laps.length > 1
      ? ' <span class="tag" style="background:#e0f7f1; color:#0e7c63">最速</span>'
      : l.split_ms === maxSplit && laps.length > 1
      ? ' <span class="tag" style="background:#fff3e0; color:#e65100">最遅</span>'
      : '';
    return `
      <div class="list-item" style="gap:8px">
        <div style="min-width:40px; font-weight:700; color:var(--primary)">${l.lap_index}</div>
        <div class="grow" style="min-width:0">
          <div class="bold" style="font-family:monospace; font-size:16px">${fmtElapsedMs(l.split_ms)}${tag}</div>
          <div class="meta" style="font-family:monospace">累計 ${fmtElapsedMs(l.elapsed_ms)}</div>
        </div>
      </div>`;
  }).join('');
}

function renderParts(sw) {
  const root = document.getElementById('swd-parts');
  document.getElementById('swd-pcnt').textContent = (sw.participants || []).length;
  root.innerHTML = (sw.participants || []).map(p => `
    <div class="list-item">
      <div style="flex:1; display:flex; align-items:center; gap:8px">
        ${avatarHtml(p.display_name, p.avatar_url, 'sm')}
        <div class="bold">${escapeHtml(p.display_name)}</div>
      </div>
    </div>`).join('') || '<div class="empty">参加者なし</div>';
}

function updateDisplay() {
  const sw = swState?.sw;
  const display = document.getElementById('swd-display');
  const statusLine = document.getElementById('swd-status-line');
  if (!sw || !display) return;
  const elapsedMs = currentElapsedMs();
  display.textContent = fmtElapsedMs(elapsedMs);
  if (statusLine) {
    statusLine.textContent = sw.status === 'running' ? '計測中…'
      : sw.status === 'paused' ? `一時停止中 (経過 ${fmtElapsedMs(elapsedMs)})`
      : '⏹ リセット済 (経過 0)';
  }
}
