// /#/activity — ラボ滞在 (自分の集計) + ラボ活動マップ (全員のヒートマップ)。
// 上半分: 「あなたの今日のラボ滞在」 + 年度の草グリッド。
// 下半分: 部屋ごとの 曜日 × 時間 ヒートマップ。

import { get } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

const WINDOWS = [
  { days: 7,   label: '直近 1 週間' },
  { days: 30,  label: '直近 30 日' },
  { days: 90,  label: '直近 90 日' },
  { days: 365, label: '直近 1 年' },
];

const DAY_LABELS = ['月','火','水','木','金','土','日'];  // Mon-first
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Convert PHP's Sun=0..Sat=6 to our Mon=0..Sun=6 ordering.
function reorderMonFirst(matrixSunFirst) {
  return [1,2,3,4,5,6,0].map(i => matrixSunFirst[i]);
}

export async function renderActivity() {
  const app = document.getElementById('app');
  // Restore the user's last-picked window between visits.
  const savedDays = Number(localStorage.getItem('labpay-activity-days') || 7);
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0">ラボ滞在・ラボ活動マップ</h2>
      <p class="card-subtitle">
        上: あなた個人のラボ滞在。下: 全員のラボ在室パターン (曜日 × 時間)。
      </p>
    </div>

    <!-- ===== 上半分: 自分のラボ滞在 ===== -->
    <div class="card">
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title">あなたのラボ滞在</h3>
      </div>
      <div id="presence-summary" class="hint">読み込み中…</div>
    </div>

    <!-- ===== 下半分: ラボ活動マップ ===== -->
    <div class="card">
      <div class="row center">
        <h3 class="row-title">ラボ活動マップ (全員)</h3>
        <select id="act-window" style="max-width:160px">
          ${WINDOWS.map(w => `
            <option value="${w.days}" ${w.days === savedDays ? 'selected' : ''}>${w.label}</option>
          `).join('')}
        </select>
      </div>
      <p class="card-subtitle">
        曜日 × 時間あたりの平均在室人数。色が濃いほど人が多いです。
      </p>
    </div>
    <div id="act-rooms"><div class="card muted">読み込み中…</div></div>
    <div class="card muted" style="font-size:12px">
      集計元: <code>presence_sessions</code> (Wi-Fi 観測の閉じたセッション)。
      ログが蓄積されるほど長期間のパターンが見えるようになります。
    </div>
  `;
  document.getElementById('act-window').addEventListener('change', e => {
    localStorage.setItem('labpay-activity-days', e.target.value);
    loadHeatmap();
  });
  await renderMyPresenceSummary();
  await loadHeatmap();
}

// 自分の今日の滞在 + 年度の草グリッド (旧 home.js の renderPresenceSummary
// + renderPresenceGrass をそのまま移植)。
async function renderMyPresenceSummary() {
  const root = document.getElementById('presence-summary');
  if (!root) return;
  try {
    const s = await get('/api/me/presence_summary');
    const fmt = (m) => {
      if (m < 1) return '-';
      if (m < 60) return `${m}分`;
      const h = Math.floor(m / 60);
      const r = m % 60;
      return r === 0 ? `${h}時間` : `${h}時間${r}分`;
    };
    const live = s.currently_present
      ? `<div style="margin-top:6px; color:#0e7c63; font-weight:600">● いまラボに居ます</div>`
      : '';
    root.innerHTML = `
      <div style="display:flex; align-items:baseline; gap:14px">
        <div>
          <div class="muted" style="font-size:11px">今日のラボ滞在</div>
          <div class="bold" style="font-size:18px; color:var(--primary)">${fmt(s.today_minutes)}</div>
        </div>
        <div style="flex:1; text-align:right">${live}</div>
      </div>
      <div id="presence-grass" style="margin-top:14px"></div>
    `;
    renderPresenceGrass();
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function renderPresenceGrass() {
  const root = document.getElementById('presence-grass');
  if (!root) return;
  try {
    // 日本の学校年度 (4/1 - 翌 3/31)。今が 4 月以降なら今年、それより前なら去年。
    const now = new Date();
    const m = now.getMonth();
    const fiscalYear = m >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fiscalStart = new Date(fiscalYear, 3, 1);
    const daysSoFar = Math.min(366,
      Math.floor((now - fiscalStart) / 86400000) + 1);
    const c = await get('/api/me/contribution_calendar', { days: daysSoFar });
    if (!c.days.length) { root.innerHTML = ''; return; }
    const cells = c.days.map(d => ({ ...d, dow: (new Date(d.date).getDay() + 6) % 7 }));
    const lead = cells[0].dow;
    const padded = [...Array(lead).fill(null), ...cells];
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
    const max = Math.max(60, ...cells.map(d => d.minutes));
    const color = m => {
      if (m <= 0) return '#ebedf0';
      const t = Math.min(1, m / max);
      if (t < 0.2) return '#c6e48b';
      if (t < 0.4) return '#7bc96f';
      if (t < 0.7) return '#239a3b';
      return '#196127';
    };
    const fmtMin = m => m < 60 ? `${m}分` : `${Math.floor(m/60)}時間${m%60?(m%60)+'分':''}`;
    const dayLabels = ['月','','水','','金','',''];
    const cellHtml = (d) => d
      ? `<div class="grass-cell" style="background:${color(d.minutes)}"
              title="${d.date}: ${d.minutes > 0 ? fmtMin(d.minutes) : '不在'}"></div>`
      : `<div class="grass-cell" style="background:transparent"></div>`;
    root.innerHTML = `
      <div class="muted" style="font-size:11px; margin-bottom:4px">${fiscalYear} 年度のラボ滞在</div>
      <div style="display:flex; gap:3px; overflow-x:auto; padding-bottom:2px">
        <div style="display:grid; grid-template-rows:repeat(7, 12px); gap:2px; padding-right:2px">
          ${dayLabels.map(l => `<div style="font-size:9px; color:var(--muted); line-height:12px">${l}</div>`).join('')}
        </div>
        ${weeks.map(w => `
          <div style="display:grid; grid-template-rows:repeat(7, 12px); gap:2px">
            ${[0,1,2,3,4,5,6].map(r => cellHtml(w[r] ?? null)).join('')}
          </div>`).join('')}
      </div>
      <div class="muted" style="font-size:10px; margin-top:4px; display:flex; align-items:center; gap:4px">
        少
        ${['#ebedf0','#c6e48b','#7bc96f','#239a3b','#196127'].map(c => `<span class="grass-cell" style="background:${c}; width:10px; height:10px"></span>`).join('')}
        多
      </div>
    `;
  } catch (e) {
    root.innerHTML = `<div class="muted" style="font-size:11px">${escapeHtml(e.message)}</div>`;
  }
}

async function loadHeatmap() {
  const root = document.getElementById('act-rooms');
  root.innerHTML = `<div class="card muted">読み込み中…</div>`;
  const days = Number(document.getElementById('act-window').value);
  try {
    const d = await get('/api/presence/heatmap', { days });
    if (!d.rooms.length) {
      root.innerHTML = `<div class="card muted">部屋が登録されていません</div>`;
      return;
    }
    // Cross-room global max so colors are comparable between rooms in the same view.
    let max = 0;
    d.rooms.forEach(r => r.matrix.forEach(row => row.forEach(v => { if (v > max) max = v; })));
    if (max === 0) max = 1; // avoid div by zero on a blank week

    root.innerHTML = d.rooms.map(r => renderRoomCard(r, max)).join('');
  } catch (e) {
    root.innerHTML = `<div class="card muted">${escapeHtml(e.message)}</div>`;
    toast('取得失敗: ' + e.message);
  }
}

function renderRoomCard(room, globalMax) {
  const matrix = reorderMonFirst(room.matrix);
  // Header row: hour labels (show every 3 hours for compactness on phone)
  const hourLabels = HOURS.map(h => h % 3 === 0
    ? `<div class="hm-h-label">${h}</div>`
    : `<div class="hm-h-label"></div>`).join('');
  // Body rows
  const rows = matrix.map((row, di) => `
    <div class="hm-row">
      <div class="hm-d-label">${DAY_LABELS[di]}</div>
      ${row.map(v => {
        const t = Math.min(1, v / globalMax);
        const bg = heatColor(t);
        const txt = v === 0 ? '' : (v < 1 ? v.toFixed(1) : Math.round(v));
        const title = `${DAY_LABELS[di]} ${row.indexOf(v) /* unused */}` ;
        return `<div class="hm-cell" style="background:${bg}" title="平均 ${v.toFixed(2)} 人">${txt}</div>`;
      }).join('')}
    </div>`).join('');

  return `
    <div class="card">
      <h3 style="margin:0 0 8px">${escapeHtml(room.display_name)} <span class="hint-sm">(${room.id})</span></h3>
      <div class="hm-grid">
        <div class="hm-row hm-head">
          <div class="hm-d-label"></div>
          ${hourLabels}
        </div>
        ${rows}
      </div>
    </div>
  `;
}

// Plasma-ish gradient: dark purple → magenta → orange. Linear in t∈[0,1].
function heatColor(t) {
  if (t <= 0) return '#f1f1f4';
  const stops = [
    [0,   [241,241,244]], // empty grey
    [0.1, [232,224,243]],
    [0.3, [188,156,213]],
    [0.5, [157, 90,176]],
    [0.7, [197, 80, 99]],
    [1,   [240,128, 32]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a0, c0] = stops[i-1], [a1, c1] = stops[i];
      const k = (t - a0) / Math.max(0.001, (a1 - a0));
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
      return `rgb(${c.join(',')})`;
    }
  }
  return `rgb(${stops[stops.length-1][1].join(',')})`;
}
