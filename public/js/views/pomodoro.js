// v1019 🍅 ポモドーロタイマー (中村さん要望「ポモドーロタイマー機能がほしい」)。
//   一般的な Pomodoro Technique に沿った 個人用タイマー:
//     - 集中セッション (デフォ 25 分) → 小休憩 (5 分) を N 回 (デフォ 4)
//       繰り返し、 N 回目 の 後に 大休憩 (15 分)
//     - タスクラベル (任意、 通知に表示)
//     - 完了時: Web Audio API の 3 音チャイム + ブラウザ Notification
//     - 集中中 は wake lock で 画面 sleep を抑止
//     - 日次実績 (集中時間 / 完了ポモドーロ数) を localStorage に保存
//     - 設定 (各 duration + サイクル数) は localStorage、 タブ切替でも 状態保持

import { escapeHtml } from '../router.js';

const DEFAULTS = { work: 25, short: 5, long: 15, cycles: 4 };
const state = {
  running: false,
  mode: 'work',          // 'work' | 'short' | 'long'
  remaining: DEFAULTS.work * 60,
  intervalId: null,
  cycleCount: 0,         // 現サイクル 内 の 完了 work 回数
  taskLabel: '',
  wakeLock: null,
  settings: { ...DEFAULTS },
  initialized: false,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem('labpay.pomo.settings');
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch (_) {}
}
function saveSettings() {
  try { localStorage.setItem('labpay.pomo.settings', JSON.stringify(state.settings)); } catch (_) {}
}
function loadStats() {
  try { return JSON.parse(localStorage.getItem('labpay.pomo.stats') || '{}'); } catch (_) { return {}; }
}
function saveStats(s) {
  try { localStorage.setItem('labpay.pomo.stats', JSON.stringify(s)); } catch (_) {}
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function bumpToday(minutes, pomodoros) {
  const s = loadStats();
  const k = todayKey();
  s[k] = s[k] || { minutes: 0, pomodoros: 0 };
  s[k].minutes   += minutes;
  s[k].pomodoros += pomodoros;
  saveStats(s);
}

function modeLabel(m) { return { work: '🍅 集中', short: '☕ 小休憩', long: '🌴 大休憩' }[m]; }
function modeColor(m) { return { work: '#ef4444', short: '#22c55e', long: '#3b82f6' }[m]; }
function modeDuration(m) {
  return m === 'work' ? state.settings.work : (m === 'short' ? state.settings.short : state.settings.long);
}
function fmtSec(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    // visibility 復帰 時 に 再取得
    document.addEventListener('visibilitychange', reacquireIfNeeded, { once: true });
  } catch (_) {}
}
async function releaseWakeLock() {
  if (state.wakeLock) { try { await state.wakeLock.release(); } catch (_) {} state.wakeLock = null; }
}
function reacquireIfNeeded() {
  if (state.running && document.visibilityState === 'visible' && !state.wakeLock) {
    acquireWakeLock();
  }
}

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, now + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.15, now + i * 0.15 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.15 + 0.5);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.55);
    });
  } catch (_) {}
}
function notifyBrowser(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: '/img/favicon-32.png', tag: 'labpay-pomo' }); } catch (_) {}
  }
}

function startTimer() {
  if (state.intervalId) return;
  state.running = true;
  acquireWakeLock();
  state.intervalId = setInterval(tick, 1000);
  render();
}
function pauseTimer() {
  if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = null; }
  state.running = false;
  releaseWakeLock();
  render();
}
function resetTimer() {
  pauseTimer();
  state.remaining = modeDuration(state.mode) * 60;
  render();
}
function skipToNext() {
  pauseTimer();
  advanceMode(false);
  render();
}
function advanceMode(fromCompletion) {
  if (state.mode === 'work') {
    if (fromCompletion) {
      bumpToday(state.settings.work, 1);
    }
    state.cycleCount++;
    if (state.cycleCount >= state.settings.cycles) {
      state.mode = 'long';
      state.cycleCount = 0;
    } else {
      state.mode = 'short';
    }
  } else {
    state.mode = 'work';
  }
  state.remaining = modeDuration(state.mode) * 60;
}
function tick() {
  state.remaining--;
  if (state.remaining <= 0) {
    const finished = modeLabel(state.mode);
    playChime();
    notifyBrowser(`✅ ${finished} 完了`, state.taskLabel || '次のセッションに移ります');
    advanceMode(true);
    // 自動 開始 は しない (ユーザ が 切替 を 意識 できる ように)
    pauseTimer();
    return;
  }
  updateTimerDisplay();
}

// tick 毎 の 部分描画 (全 render は 重い ので タイマー表示 だけ 更新)
function updateTimerDisplay() {
  const el = document.getElementById('pomo-time');
  if (el) el.textContent = fmtSec(state.remaining);
  // タブ タイトル も 更新
  document.title = `${fmtSec(state.remaining)} - ${modeLabel(state.mode).replace(/^[^ ]+ /, '')} · LabPay`;
}

export function renderPomodoro() {
  if (!state.initialized) {
    loadSettings();
    state.remaining = modeDuration(state.mode) * 60;
    state.initialized = true;
  }
  render();
}

function render() {
  const app = document.getElementById('app');
  const color = modeColor(state.mode);
  const stats = loadStats();
  const today = stats[todayKey()] || { minutes: 0, pomodoros: 0 };
  const cycles = state.settings.cycles;
  const dots = Array.from({length: cycles}, (_, i) =>
    `<span style="display:inline-block; width:12px; height:12px; border-radius:50%; margin:0 3px; background:${i < state.cycleCount ? color : '#e5e7eb'}"></span>`
  ).join('');
  const total = modeDuration(state.mode) * 60;
  const progressPct = total > 0 ? Math.max(0, Math.min(100, 100 * (total - state.remaining) / total)) : 0;

  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0">🍅 ポモドーロタイマー</h2>
      <div class="hint-sm" style="margin-top:4px">${state.settings.work}分集中 → ${state.settings.short}分小休憩 を ${cycles} セット、 ${cycles} 回目 の 後 は ${state.settings.long}分 の 大休憩。 集中中 は 画面 sleep 抑止。</div>
    </div>

    <div class="card" style="text-align:center; padding:24px 16px; background:linear-gradient(180deg, ${color}22, #fff)">
      <div style="font-size:20px; color:${color}; font-weight:700">${modeLabel(state.mode)}</div>
      <div id="pomo-time" style="font-size:72px; font-weight:700; font-family:system-ui, sans-serif; color:${color}; letter-spacing:2px; margin:12px 0; font-variant-numeric: tabular-nums">${fmtSec(state.remaining)}</div>
      <div style="height:8px; background:#e5e7eb; border-radius:4px; overflow:hidden; margin:8px auto; max-width:360px">
        <div style="height:100%; width:${progressPct}%; background:${color}; transition: width 0.5s linear"></div>
      </div>
      <div style="margin:12px 0">${dots} <span class="hint-sm" style="margin-left:6px">${state.cycleCount}/${cycles} セット完了</span></div>
      <div class="row" style="gap:8px; justify-content:center; flex-wrap:wrap; margin-top:12px">
        ${state.running
          ? `<button id="pomo-pause" class="btn" style="background:${color}; color:#fff; padding:8px 24px; font-size:16px; border:0">⏸ 一時停止</button>`
          : `<button id="pomo-start" class="btn primary" style="padding:8px 24px; font-size:16px">▶ 開始</button>`}
        <button id="pomo-skip" class="btn" style="padding:8px 16px; font-size:14px">⏭ スキップ</button>
        <button id="pomo-reset" class="btn" style="padding:8px 16px; font-size:14px">🔄 リセット</button>
      </div>
    </div>

    <div class="card">
      <label class="field">
        <span class="lbl">🎯 今何にフォーカスしていますか? (任意、完了通知にも表示)</span>
        <input type="text" id="pomo-task" value="${escapeHtml(state.taskLabel)}" placeholder="例: 論文序論の書き直し" maxlength="120">
      </label>
    </div>

    <div class="card">
      <div class="bold" style="margin-bottom:6px">📊 今日の実績</div>
      <div style="font-size:15px">🍅 <b>${today.pomodoros}</b> ポモドーロ &nbsp;·&nbsp; ⏱ 集中時間 <b>${today.minutes}</b> 分</div>
      ${renderRecentDays(stats)}
    </div>

    <details class="card">
      <summary style="cursor:pointer; font-weight:600">⚙️ 設定 と 通知</summary>
      <div style="display:grid; gap:8px; margin-top:10px">
        <label class="field">
          <span class="lbl">集中セッション (分)</span>
          <input type="number" id="pomo-set-work" min="1" max="120" value="${state.settings.work}">
        </label>
        <label class="field">
          <span class="lbl">小休憩 (分)</span>
          <input type="number" id="pomo-set-short" min="1" max="60" value="${state.settings.short}">
        </label>
        <label class="field">
          <span class="lbl">大休憩 (分)</span>
          <input type="number" id="pomo-set-long" min="1" max="120" value="${state.settings.long}">
        </label>
        <label class="field">
          <span class="lbl">大休憩までのセッション数</span>
          <input type="number" id="pomo-set-cycles" min="2" max="12" value="${state.settings.cycles}">
        </label>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <button id="pomo-save-settings" class="btn primary">設定を保存</button>
          <button id="pomo-notif-permit" class="btn">🔔 完了通知を許可</button>
          <span class="hint-sm" style="align-self:center">現在: ${notifStatus()}</span>
        </div>
        <div class="hint-sm">設定変更後、 実行中でなければ 現セッション の 残り時間 も 新しい 長さ に 揃います。</div>
      </div>
    </details>
  `;

  document.getElementById('pomo-start')?.addEventListener('click', startTimer);
  document.getElementById('pomo-pause')?.addEventListener('click', pauseTimer);
  document.getElementById('pomo-skip')?.addEventListener('click', skipToNext);
  document.getElementById('pomo-reset')?.addEventListener('click', resetTimer);
  document.getElementById('pomo-task')?.addEventListener('input', (e) => {
    state.taskLabel = e.target.value;
  });
  document.getElementById('pomo-save-settings')?.addEventListener('click', () => {
    state.settings.work   = clampInt(document.getElementById('pomo-set-work').value,   1, 120);
    state.settings.short  = clampInt(document.getElementById('pomo-set-short').value,  1,  60);
    state.settings.long   = clampInt(document.getElementById('pomo-set-long').value,   1, 120);
    state.settings.cycles = clampInt(document.getElementById('pomo-set-cycles').value, 2,  12);
    saveSettings();
    if (!state.running) state.remaining = modeDuration(state.mode) * 60;
    render();
  });
  document.getElementById('pomo-notif-permit')?.addEventListener('click', async () => {
    if ('Notification' in window) {
      try { await Notification.requestPermission(); render(); } catch (_) {}
    }
  });
}

function renderRecentDays(stats) {
  const days = [];
  for (let i = 6; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    days.push({ k, s: stats[k] || { minutes: 0, pomodoros: 0 }, mmdd: `${d.getMonth()+1}/${d.getDate()}` });
  }
  const total = days.reduce((n, d) => n + d.s.minutes, 0);
  if (total === 0) return '';
  const maxMin = Math.max(...days.map(d => d.s.minutes), 60);
  return `
    <div style="margin-top:10px">
      <div class="hint-sm" style="margin-bottom:4px">直近 6 日</div>
      <div style="display:flex; gap:4px; align-items:flex-end; height:60px">
        ${days.map(d => `
          <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:2px">
            <div style="width:100%; height:${Math.round(48 * d.s.minutes / maxMin)}px; background:#ef4444aa; border-radius:3px 3px 0 0" title="${d.mmdd}: ${d.s.pomodoros}🍅 / ${d.s.minutes}分"></div>
            <div style="font-size:10px; color:#6b7280">${d.mmdd}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

function notifStatus() {
  if (!('Notification' in window)) return 'ブラウザ非対応';
  return { granted: '✅ 許可済', denied: '❌ 拒否', default: '未設定' }[Notification.permission] || '不明';
}

function clampInt(v, lo, hi) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
