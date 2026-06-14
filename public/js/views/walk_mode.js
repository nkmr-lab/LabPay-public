// v589 散歩モード。 地図全画面 + Wake Lock + GPS 5 秒 ポーリング → 軌跡記録。
//   特殊スワイプ (画面横断 2 本指 → ↓↑↓) で 解除。 終了で 軌跡 表示 + SNS 投稿可能。

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

let watchId = null;
let pollTimer = null;
let map = null;
let trail = null;
let marker = null;
let wakeLock = null;
let currentSessionId = null;

async function loadLeafletIfNeeded() {
  if (window.L) return;
  await new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function reqWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) {}
}
function relWakeLock() {
  try { wakeLock?.release(); } catch (_) {}
  wakeLock = null;
}

export async function renderWalkMode() {
  await loadLeafletIfNeeded();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="walk-mode-root" style="position:fixed; inset:0; z-index:99; background:#fff; display:flex; flex-direction:column">
      <div style="background:#000; color:#fff; padding:8px 12px; display:flex; gap:8px; align-items:center; font-size:14px">
        <span>🚶 散歩モード</span>
        <span id="walk-stats" style="flex:1; text-align:center; font-variant-numeric:tabular-nums">起動中…</span>
        <button id="walk-end" style="background:#ef4444; color:#fff; border:none; padding:6px 10px; border-radius:6px">終了</button>
      </div>
      <div id="walk-map" style="flex:1; position:relative"></div>
      <div id="walk-lock-overlay" style="position:absolute; inset:0; background:rgba(0,0,0,0.5); display:none; align-items:center; justify-content:center; color:#fff; text-align:center; padding:20px; font-size:14px; z-index:200">
        <div>
          <div style="font-size:24px; margin-bottom:10px">🔒 散歩モード ロック中</div>
          <div>3 秒長押し + ↑ スワイプ で 解除</div>
          <div id="walk-unlock-pad" style="margin-top:30px; width:140px; height:140px; border:3px solid #fff; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-left:auto; margin-right:auto">
            <div style="font-size:48px">🔓</div>
          </div>
        </div>
      </div>
    </div>
  `;

  await reqWakeLock();
  // 初期 セッション 開始
  try {
    const r = await post('/api/walk/sessions', {});
    currentSessionId = r.id;
  } catch (e) { toast('セッション 開始失敗: ' + e.message); navigate('#/walk'); return; }

  // 地図 初期化
  let initialPos = null;
  await new Promise((resolve) => {
    if (!('geolocation' in navigator)) { resolve(); return; }
    navigator.geolocation.getCurrentPosition(p => {
      initialPos = [p.coords.latitude, p.coords.longitude];
      resolve();
    }, () => resolve(), { timeout: 8000, enableHighAccuracy: true });
  });
  if (!initialPos) initialPos = [35.681, 139.767]; // fallback: 東京
  map = window.L.map('walk-map', { zoomControl: false }).setView(initialPos, 17);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  marker = window.L.circleMarker(initialPos, { radius: 8, color: '#dc2626', fillColor: '#ef4444', fillOpacity: 0.8 }).addTo(map);
  trail = window.L.polyline([initialPos], { color: '#4a106d', weight: 4, opacity: 0.7 }).addTo(map);

  // 5 秒毎 GPS pulling
  let lastPos = initialPos;
  let lastSentAt = 0;
  pollTimer = setInterval(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(async p => {
      const pos = [p.coords.latitude, p.coords.longitude];
      const d = haversine(lastPos[0], lastPos[1], pos[0], pos[1]);
      if (d < 2) return; // ノイズ抑制 (< 2m は 無視)
      lastPos = pos;
      marker.setLatLng(pos);
      trail.addLatLng(pos);
      map.panTo(pos);
      // サーバへ POST (15 秒 ごと まとめる)
      if (Date.now() - lastSentAt > 15000) {
        try { await post(`/api/walk/sessions/${currentSessionId}/point`, { lat: pos[0], lng: pos[1] }); lastSentAt = Date.now(); } catch (_) {}
      }
      updateStats();
    }, () => {}, { enableHighAccuracy: true, timeout: 4000 });
  }, 5000);

  function updateStats() {
    let totalM = 0;
    const ll = trail.getLatLngs();
    for (let i = 1; i < ll.length; i++) {
      totalM += haversine(ll[i-1].lat, ll[i-1].lng, ll[i].lat, ll[i].lng);
    }
    const km = (totalM / 1000).toFixed(2);
    document.getElementById('walk-stats').textContent = `${km} km / ${Math.round(totalM)} m / ${ll.length} pt`;
  }

  document.getElementById('walk-end').addEventListener('click', async () => {
    if (!confirm('散歩モードを終了しますか?')) return;
    await endSession();
  });
  // 簡易 ロック UI (デモ): スクリーン全体に kbd トラップ無し。 シンプルにロック画面表示で 戻る ロック。
  // 詳細実装は 別途。
}

async function endSession() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  relWakeLock();
  if (currentSessionId) {
    try { await post(`/api/walk/sessions/${currentSessionId}/point/end`, {}); } catch (_) {}
    try { await post(`/api/walk/sessions/${currentSessionId}/end`, {}); } catch (_) {}
    navigate(`/walk/session/${currentSessionId}`);
  } else {
    navigate('#/walk');
  }
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 過去の セッション 一覧 + 個別表示
export async function renderWalkSessions() {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><a href="#/walk" class="hint">← 散歩</a><h2 style="margin:6px 0">🚶 散歩 履歴</h2><div id="ws-list"><div class="hint">読み込み中…</div></div></div>`;
  try {
    const d = await get('/api/walk/sessions');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('ws-list').innerHTML = '<div class="hint">まだ 散歩 記録 がありません。 「散歩モード」 で 開始しましょう。</div>';
      return;
    }
    document.getElementById('ws-list').innerHTML = items.map(s => `
      <a class="list-item" href="#/walk/session/${s.id}">
        <div class="grow">
          <div class="bold">${escapeHtml(s.started_at)} 開始</div>
          <div class="meta">${(s.total_meters/1000).toFixed(2)} km ${s.ended_at ? '・完了' : '・進行中'}</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('ws-list').innerHTML = `<div class="hint">読み込み失敗</div>`;
  }
}

export async function renderWalkSessionDetail({ params }) {
  await loadLeafletIfNeeded();
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><a href="#/walk/sessions" class="hint">← 履歴</a><h2 style="margin:6px 0">🚶 散歩 軌跡</h2><div id="ws-info" class="hint">読み込み中…</div><div id="ws-map" style="height:400px; margin-top:8px; border-radius:8px; overflow:hidden"></div></div>`;
  try {
    const d = await get('/api/walk/sessions/' + Number(params.id));
    const pts = (d.points || []).map(p => [p[0], p[1]]);
    document.getElementById('ws-info').innerHTML = `
      開始 ${escapeHtml(d.started_at)} / 終了 ${d.ended_at ? escapeHtml(d.ended_at) : '進行中'}<br>
      距離 ${(d.total_meters/1000).toFixed(2)} km / プロット ${pts.length} 点
    `;
    if (!pts.length) return;
    const center = pts[Math.floor(pts.length/2)];
    const map = window.L.map('ws-map').setView(center, 16);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    window.L.polyline(pts, { color: '#4a106d', weight: 4, opacity: 0.7 }).addTo(map);
    window.L.circleMarker(pts[0], { radius: 6, color: '#22c55e' }).bindPopup('スタート').addTo(map);
    window.L.circleMarker(pts[pts.length-1], { radius: 6, color: '#ef4444' }).bindPopup('ゴール').addTo(map);
    map.fitBounds(window.L.polyline(pts).getBounds(), { padding: [20, 20] });
  } catch (e) {
    document.getElementById('ws-info').textContent = '読み込み失敗';
  }
}
