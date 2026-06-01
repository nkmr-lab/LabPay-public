// /#/activity — lab presence heatmap.
// Per room, a Mon-Sun × 0-23 grid of "average distinct users present at that
// hour" averaged over the selected past window. As presence_sessions accumulates,
// the same view can show longer windows (30/90/365 days) for richer patterns.

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
      <div class="row" style="align-items:center">
        <h2 style="flex:1; margin:0">ラボ活動マップ</h2>
        <select id="act-window" style="max-width:160px">
          ${WINDOWS.map(w => `
            <option value="${w.days}" ${w.days === savedDays ? 'selected' : ''}>${w.label}</option>
          `).join('')}
        </select>
      </div>
      <p class="muted" style="font-size:13px; margin:6px 0 0">
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
  await loadHeatmap();
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
      <h3 style="margin:0 0 8px">${escapeHtml(room.display_name)} <span class="muted" style="font-size:12px">(${room.id})</span></h3>
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
