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
  app.innerHTML = `
    <div class="card">
      <a href="#/stopwatches" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">＋ 新規 ストップウォッチ</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル</span>
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
      initial: presetMembers,
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('swn-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  document.getElementById('swn-save').addEventListener('click', async () => {
    const title = document.getElementById('swn-title').value.trim();
    if (!title) { toast('タイトル必須'); return; }
    try {
      const r = await post('/api/stopwatches', {
        title, participant_ids: picker ? [...picker.getSelected()] : [],
      });
      toast('作成しました');
      navigate('#/stopwatches/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
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
      <div id="swd-display" style="font-family:monospace; font-size:56px; text-align:center; font-weight:700; letter-spacing:2px; padding:18px 0; color:var(--primary)">--:--</div>
      <div class="row" style="gap:6px; justify-content:center; flex-wrap:wrap">
        <button id="swd-start" class="primary" style="min-width:90px">▶ 開始</button>
        <button id="swd-pause" class="btn" style="min-width:90px" hidden>⏸ 一時停止</button>
        <button id="swd-reset" class="btn" style="min-width:90px">⏹ リセット</button>
      </div>
      <div class="meta" style="text-align:center; margin-top:8px" id="swd-status-line"></div>
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
  // 1 秒 tick で 表示更新
  swState.displayTimer = setInterval(() => updateDisplay(), 1000);
  // 5 秒 (running) or 30 秒 (それ以外) で サーバ同期
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
    const sw = await get('/api/stopwatches/' + id);
    const serverNowMs = Date.parse(sw.server_now);
    const clientNowMs = Date.now();
    swState = swState || {};
    swState.sw = sw;
    swState.clientServerOffsetMs = clientNowMs - serverNowMs;
    renderHead(sw);
    renderControls(sw, id);
    renderParts(sw);
    updateDisplay();
    // v405 動いている間は スリープしない。 paused/stopped で 解放。
    if (sw.status === 'running') {
      acquireWakeLock('stopwatch-' + id);
    } else {
      releaseWakeLock('stopwatch-' + id);
    }
  } catch (e) {
    document.getElementById('swd-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
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
  if (sw.status === 'running') {
    startBtn.hidden = true;
    pauseBtn.hidden = false;
  } else {
    startBtn.hidden = false;
    pauseBtn.hidden = true;
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
    if (!confirm('経過時間を 0 に リセットしますか?')) return;
    try { await post('/api/stopwatches/' + id + '/reset', {}); await loadDetail(id); }
    catch (e) { toast('失敗: ' + e.message); }
  };
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
  let elapsed = sw.elapsed_offset_seconds;
  if (sw.status === 'running' && sw.started_at) {
    // server's started_at + client time - server time = effective elapsed
    const startedAtMs = Date.parse(sw.started_at.replace(' ', 'T'));
    const effectiveServerNow = Date.now() - (swState.clientServerOffsetMs || 0);
    elapsed += Math.max(0, Math.floor((effectiveServerNow - startedAtMs) / 1000));
  }
  display.textContent = fmtElapsed(elapsed);
  if (statusLine) {
    statusLine.textContent = sw.status === 'running' ? '計測中…'
      : sw.status === 'paused' ? `一時停止中 (経過 ${fmtElapsed(elapsed)})`
      : '停止中';
  }
}
