// /#/exercise — ポケットに入れて 歩数を カウント。 DeviceMotion API を使う 簡易歩数計。
// iOS 13+ は DeviceMotionEvent.requestPermission() の 明示許可が必要なので、
// 「開始」 ボタン (ユーザ操作) を起点に request → listen 開始。
// 検出: accelerationIncludingGravity の magnitude を 200ms 窓で smoothing し、
// 閾値 2.0 m/s² を超え、 前回検出から 250ms 以上経っていれば 1 歩としてカウント。

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { fmtDateTime } from '../format.js';

let motionListener = null;
let sessionStart = null;
let stepCount = 0;
let lastStepAt = 0;
let lastUiTick = 0;
let smoothedMag = 0;
let aboveThreshold = false;
let elapsedTimer = null;

function stopSession() {
  if (motionListener) {
    window.removeEventListener('devicemotion', motionListener);
    motionListener = null;
  }
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

async function requestMotionPermission() {
  // iOS 13+ は requestPermission を実装。 Android Chrome / デスクトップは 未実装で
  // 直接 listen で OK。
  if (typeof DeviceMotionEvent !== 'undefined'
      && typeof DeviceMotionEvent.requestPermission === 'function') {
    try { return await DeviceMotionEvent.requestPermission(); }
    catch (_) { return 'denied'; }
  }
  return 'granted'; // implicit
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  const mag = Math.sqrt((a.x||0)**2 + (a.y||0)**2 + (a.z||0)**2);
  // gravity ~9.8 を引いた純振動成分。 簡易 low-pass smoothing。
  smoothedMag = smoothedMag * 0.7 + (mag - 9.8) * 0.3;
  const now = performance.now();
  const TH_HI = 2.0, TH_LO = 0.5;
  if (smoothedMag > TH_HI && !aboveThreshold) {
    aboveThreshold = true;
    if (now - lastStepAt > 250) {
      stepCount++;
      lastStepAt = now;
    }
  } else if (smoothedMag < TH_LO) {
    aboveThreshold = false;
  }
  if (now - lastUiTick > 200) {
    lastUiTick = now;
    const el = document.getElementById('ex-count');
    if (el) el.textContent = stepCount.toLocaleString();
  }
}

function startElapsedTimer() {
  const el = document.getElementById('ex-elapsed');
  const update = () => {
    if (!sessionStart || !el) return;
    const sec = Math.floor((Date.now() - sessionStart) / 1000);
    const m = Math.floor(sec / 60), s = sec % 60;
    el.textContent = `${m}:${String(s).padStart(2,'0')}`;
  };
  elapsedTimer = setInterval(update, 1000);
  update();
}

export async function renderExercise() {
  stopSession();
  sessionStart = null; stepCount = 0; lastStepAt = 0; smoothedMag = 0; aboveThreshold = false;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🏃 運動 (歩数 / 階段)</h2>
    </div>
    <div class="card" style="text-align:center" id="ex-runner">
      <div id="ex-count" style="font-size:60px; font-weight:700; font-variant-numeric:tabular-nums">0</div>
      <div class="muted" style="font-size:13px">歩</div>
      <div id="ex-elapsed" class="muted" style="margin-top:6px; font-size:13px; font-variant-numeric:tabular-nums">0:00</div>
      <button id="ex-toggle" class="primary" style="width:100%; margin-top:14px; font-size:18px; padding:14px">開始</button>
      <div id="ex-perm" class="hint" style="margin-top:6px; font-size:12px"></div>
    </div>
    <div class="card">
      <h3 style="margin:0">集計</h3>
      <div id="ex-totals" class="muted">読み込み中…</div>
    </div>
    <div class="card">
      <h3 style="margin:0">今週のラボメンバー</h3>
      <div id="ex-board" class="list"><div class="muted">読み込み中…</div></div>
    </div>
    <div class="card">
      <h3 style="margin:0">最近のセッション</h3>
      <div id="ex-history" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('ex-toggle').addEventListener('click', toggle);
  await reload();
}

async function toggle() {
  const btn = document.getElementById('ex-toggle');
  if (sessionStart) {
    // ── 終了 ──
    stopSession();
    const ended = new Date();
    const started = new Date(sessionStart);
    const duration = Math.max(0, Math.round((ended - started) / 1000));
    const steps = stepCount;
    sessionStart = null;
    btn.textContent = '開始';
    btn.classList.remove('danger'); btn.classList.add('primary');
    if (steps === 0 && duration < 5) {
      toast('歩数 0 / 短すぎなので 保存しません');
      stepCount = 0;
      document.getElementById('ex-count').textContent = '0';
      document.getElementById('ex-elapsed').textContent = '0:00';
      return;
    }
    try {
      await post('/api/exercise', {
        step_count: steps,
        duration_seconds: duration,
        started_at: started.toISOString().slice(0, 19),
        ended_at: ended.toISOString().slice(0, 19),
      });
      toast(`${steps} 歩 / ${duration}秒 を記録`);
      stepCount = 0;
      document.getElementById('ex-count').textContent = '0';
      document.getElementById('ex-elapsed').textContent = '0:00';
      await reload();
    } catch (e) { toast('保存失敗: ' + e.message); }
    return;
  }
  // ── 開始 ──
  const permEl = document.getElementById('ex-perm');
  permEl.textContent = 'センサー許可を確認中…';
  const perm = await requestMotionPermission();
  if (perm !== 'granted') {
    permEl.textContent = 'センサー利用が拒否されました。 ブラウザ設定で 「動き / 方向」 を許可してください';
    return;
  }
  permEl.textContent = '';
  sessionStart = Date.now();
  lastUiTick = 0;
  motionListener = onMotion;
  window.addEventListener('devicemotion', motionListener);
  startElapsedTimer();
  btn.textContent = '■ 終了';
  btn.classList.remove('primary'); btn.classList.add('danger');
}

async function reload() {
  try {
    const my = await get('/api/exercise');
    const t = my.totals || {};
    document.getElementById('ex-totals').innerHTML = `
      <div class="row" style="gap:14px; flex-wrap:wrap">
        <div><span class="muted">今日</span> <span class="bold">${Number(t.today||0).toLocaleString()}</span> 歩</div>
        <div><span class="muted">今週</span> <span class="bold">${Number(t.this_week||0).toLocaleString()}</span> 歩</div>
        <div><span class="muted">今月</span> <span class="bold">${Number(t.this_month||0).toLocaleString()}</span> 歩</div>
        <div><span class="muted">通算</span> <span class="bold">${Number(t.lifetime||0).toLocaleString()}</span> 歩</div>
      </div>`;
    const hist = my.sessions || [];
    const histRoot = document.getElementById('ex-history');
    histRoot.innerHTML = hist.length
      ? hist.map(s => `
          <div class="list-item">
            <div class="grow">
              <div class="bold">${Number(s.step_count).toLocaleString()} 歩</div>
              <div class="meta">${escapeHtml(fmtDateTime(s.started_at))} · ${Math.round(s.duration_seconds/60*10)/10}分</div>
            </div>
            <button class="btn" data-rm="${s.id}" style="font-size:11px">削除</button>
          </div>`).join('')
      : '<div class="empty">まだ記録はありません</div>';
    histRoot.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('削除しますか?')) return;
        try { await del('/api/exercise/' + b.dataset.rm); toast('削除しました'); await reload(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    document.getElementById('ex-totals').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  try {
    const bd = await get('/api/exercise/leaderboard');
    const items = bd.items || [];
    const root = document.getElementById('ex-board');
    if (!items.length) { root.innerHTML = '<div class="empty">今週はまだ誰も記録なし</div>'; return; }
    root.innerHTML = items.map((p, i) => `
      <div class="list-item">
        <div class="grow" style="display:flex; gap:8px; align-items:center">
          <span class="bold" style="min-width:28px">${i + 1}</span>
          ${avatarHtml(p.display_name, p.avatar_url, 'sm')}
          <span>${escapeHtml(p.display_name)}${Number(p.id) === Number(state.me?.id) ? ' (自分)' : ''}</span>
        </div>
        <div class="bold text-primary">${Number(p.this_week).toLocaleString()} 歩</div>
      </div>`).join('');
  } catch (_) { /* swallow */ }
}
