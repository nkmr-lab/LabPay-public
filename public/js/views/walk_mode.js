// v589 散歩モード。地図全画面 + Wake Lock + GPS 5 秒ポーリング → 軌跡記録。
//   特殊スワイプ (画面横断 2 本指 → ↓↑↓) で解除。終了で軌跡表示 + SNS 投稿可能。

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
        <button id="walk-lock" style="background:#1e293b; color:#fff; border:none; padding:6px 10px; border-radius:6px">🔒 ロック</button>
        <button id="walk-end" style="background:#ef4444; color:#fff; border:none; padding:6px 10px; border-radius:6px">終了</button>
      </div>
      <div id="walk-map" style="flex:1; position:relative"></div>
      <div id="walk-lock-overlay" style="position:fixed; inset:0; background:rgba(0,0,0,0.85); display:none; flex-direction:column; align-items:center; justify-content:center; color:#fff; text-align:center; padding:20px; font-size:14px; z-index:200; user-select:none; touch-action:none">
        <div style="font-size:28px; margin-bottom:10px">🔒 散歩モードロック中</div>
        <div style="margin-bottom:24px; opacity:0.8">↑→↓→↑ を順にスワイプで解除</div>
        <div id="walk-unlock-canvas" style="width:280px; height:280px; border:3px solid #fff; border-radius:24px; position:relative; touch-action:none; background:rgba(255,255,255,0.05)">
          <div id="walk-unlock-arrows" style="position:absolute; inset:0; display:grid; grid-template-rows:1fr 1fr 1fr; grid-template-columns:1fr 1fr 1fr; pointer-events:none; opacity:0.4">
            <div></div>
            <div style="display:flex; align-items:center; justify-content:center; font-size:36px" data-step="up">↑</div>
            <div></div>
            <div></div>
            <div></div>
            <div style="display:flex; align-items:center; justify-content:center; font-size:36px" data-step="right">→</div>
            <div></div>
            <div style="display:flex; align-items:center; justify-content:center; font-size:36px" data-step="down">↓</div>
            <div></div>
          </div>
          <div id="walk-unlock-status" style="position:absolute; bottom:-32px; left:0; right:0; font-size:13px; opacity:0.8">↑ から始めて</div>
        </div>
        <div id="walk-stats-locked" style="margin-top:60px; font-size:16px; font-variant-numeric:tabular-nums; opacity:0.85"></div>
      </div>
    </div>
  `;

  await reqWakeLock();
  // 初期セッション開始
  try {
    const r = await post('/api/walk/sessions', {});
    currentSessionId = r.id;
  } catch (e) { toast('セッション開始失敗: ' + e.message); navigate('#/walk'); return; }

  // 地図初期化
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
      if (d < 2) return; // ノイズ抑制 (< 2m は無視)
      lastPos = pos;
      marker.setLatLng(pos);
      trail.addLatLng(pos);
      map.panTo(pos);
      // サーバへ POST (15 秒ごとまとめる)
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
  // ロックボタン
  document.getElementById('walk-lock').addEventListener('click', () => activateLock());
}

// 特殊スワイプロック (↑→↓→↑ の順に大きくスワイプで解除)
function activateLock() {
  const overlay = document.getElementById('walk-lock-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const seq = ['up', 'right', 'down', 'up'];
  let step = 0;
  let startX = null, startY = null;
  const status = document.getElementById('walk-unlock-status');
  const canvas = document.getElementById('walk-unlock-canvas');
  const updateStatusText = () => {
    if (!status) return;
    const remaining = seq.slice(step);
    const sym = { up: '↑', right: '→', down: '↓', left: '←' };
    status.textContent = `次: ${sym[seq[step]] || '✓'} (${remaining.map(s => sym[s]).join(' → ')})`;
  };
  updateStatusText();
  const flashArrow = (dir) => {
    document.querySelectorAll('#walk-unlock-arrows [data-step]').forEach(el => {
      if (el.dataset.step === dir) {
        el.style.opacity = '1';
        el.style.color = '#22c55e';
        setTimeout(() => { el.style.opacity = '0.4'; el.style.color = '#fff'; }, 300);
      }
    });
  };
  const onStart = (ev) => {
    const t = ev.touches ? ev.touches[0] : ev;
    startX = t.clientX; startY = t.clientY;
  };
  const onEnd = (ev) => {
    if (startX === null) return;
    const t = ev.changedTouches ? ev.changedTouches[0] : ev;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    startX = startY = null;
    if (Math.hypot(dx, dy) < 50) return; // 短すぎ
    let dir;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
    else dir = dy > 0 ? 'down' : 'up';
    if (dir === seq[step]) {
      flashArrow(dir);
      step++;
      if (step >= seq.length) {
        // 解除成功
        overlay.style.display = 'none';
        cleanup();
        return;
      }
      updateStatusText();
    } else {
      // 失敗 → 最初から
      step = 0;
      if (status) {
        status.textContent = `× 失敗 (やり直し)`;
        setTimeout(updateStatusText, 800);
      }
    }
  };
  canvas.addEventListener('touchstart', onStart, { passive: true });
  canvas.addEventListener('touchend', onEnd, { passive: true });
  canvas.addEventListener('mousedown', onStart);
  canvas.addEventListener('mouseup', onEnd);
  const cleanup = () => {
    canvas.removeEventListener('touchstart', onStart);
    canvas.removeEventListener('touchend', onEnd);
    canvas.removeEventListener('mousedown', onStart);
    canvas.removeEventListener('mouseup', onEnd);
  };
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

// 過去のセッション一覧 + 個別表示
export async function renderWalkSessions() {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><a href="#/walk" class="hint">← 散歩</a><h2 style="margin:6px 0">🚶 散歩履歴</h2><div id="ws-list"><div class="hint">読み込み中…</div></div></div>`;
  try {
    const d = await get('/api/walk/sessions');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('ws-list').innerHTML = '<div class="hint">まだ散歩記録がありません。「散歩モード」で開始しましょう。</div>';
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
  const sid = Number(params.id);
  app.innerHTML = `
    <div class="card">
      <a href="#/walk/sessions" class="hint">← 履歴</a>
      <h2 style="margin:6px 0">🚶 散歩軌跡</h2>
      <div id="ws-info" class="hint">読み込み中…</div>
      <div id="ws-map" style="height:400px; margin-top:8px; border-radius:8px; overflow:hidden"></div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">
        <button id="ws-share" class="btn primary">📸 軌跡画像をらぼったーに投稿</button>
        <button id="ws-overlay" class="btn">🗺 過去の軌跡を重ねる</button>
      </div>
      <div id="ws-overlay-list" style="margin-top:8px"></div>
    </div>
  `;
  let mapObj, ptsAll;
  try {
    const d = await get('/api/walk/sessions/' + sid);
    const pts = (d.points || []).map(p => [p[0], p[1]]);
    ptsAll = pts;
    document.getElementById('ws-info').innerHTML = `
      開始 ${escapeHtml(d.started_at)} / 終了 ${d.ended_at ? escapeHtml(d.ended_at) : '進行中'}<br>
      距離 ${(d.total_meters/1000).toFixed(2)} km / プロット ${pts.length} 点
    `;
    if (!pts.length) return;
    const center = pts[Math.floor(pts.length/2)];
    mapObj = window.L.map('ws-map', { preferCanvas: true }).setView(center, 16);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapObj);
    window.L.polyline(pts, { color: '#4a106d', weight: 4, opacity: 0.85 }).addTo(mapObj);
    window.L.circleMarker(pts[0], { radius: 6, color: '#22c55e', fillOpacity: 1 }).bindPopup('スタート').addTo(mapObj);
    window.L.circleMarker(pts[pts.length-1], { radius: 6, color: '#ef4444', fillOpacity: 1 }).bindPopup('ゴール').addTo(mapObj);
    mapObj.fitBounds(window.L.polyline(pts).getBounds(), { padding: [20, 20] });
  } catch (e) {
    document.getElementById('ws-info').textContent = '読み込み失敗';
    return;
  }

  // 軌跡画像 → らぼったーに投稿
  document.getElementById('ws-share').addEventListener('click', async () => {
    const btn = document.getElementById('ws-share');
    btn.disabled = true; btn.textContent = '画像生成中…';
    try {
      const blob = await renderTrailImage(ptsAll);
      // /api/uploads/image に POST して URL を取得
      const fd = new FormData();
      fd.append('file', blob, `walk-${sid}.png`);
      const upRes = await fetch('/api/uploads/image', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      }).then(x => x.json());
      if (!upRes.url) throw new Error('upload 失敗');
      const body = prompt('らぼったーに投稿: 本文 (任意で編集)',
        `🚶 散歩しました!\n距離: ${(ptsAll.length > 1 ? totalMeters(ptsAll) : 0).toFixed(0)} m\n#/walk/session/${sid}`);
      if (body === null) { btn.disabled = false; btn.textContent = '📸 軌跡画像をらぼったーに投稿'; return; }
      const { post: apiPost } = await import('../api.js');
      await apiPost('/api/posts', { body: body.trim(), image_url: upRes.url });
      toast('投稿しました');
    } catch (e) {
      toast('失敗: ' + (e?.message || e));
    } finally {
      btn.disabled = false; btn.textContent = '📸 軌跡画像をらぼったーに投稿';
    }
  });

  // 過去の軌跡重ね合わせ
  document.getElementById('ws-overlay').addEventListener('click', async () => {
    try {
      const lst = await get('/api/walk/sessions');
      const items = (lst.items || []).filter(x => x.id !== sid).slice(0, 12);
      document.getElementById('ws-overlay-list').innerHTML = `
        <div class="hint-sm">他の軌跡をタップで重ねる (薄色)</div>
        ${items.map(it => `<button class="btn ws-add-overlay" data-sid="${it.id}"
            style="font-size:12px; margin:3px; padding:3px 6px">${escapeHtml(it.started_at)} (${(it.total_meters/1000).toFixed(1)} km)</button>`).join('')}
      `;
      document.querySelectorAll('.ws-add-overlay').forEach(b => {
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const d2 = await get('/api/walk/sessions/' + b.dataset.sid);
            const p2 = (d2.points || []).map(p => [p[0], p[1]]);
            if (p2.length) {
              window.L.polyline(p2, { color: '#6b7280', weight: 2.5, opacity: 0.45, dashArray: '4 6' }).addTo(mapObj);
            }
            b.style.background = '#e5e7eb';
            b.textContent = '✓ ' + b.textContent;
          } catch (_) {}
        });
      });
    } catch (_) { toast('履歴取得失敗'); }
  });
}

function totalMeters(pts) {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += haversine(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]);
  return m;
}

// 軌跡を正方形 PNG (1024x1024) にレンダリング (タイルなし、シンプルな線画)。
//   タイル画像は CORS 制約で直接 canvas に描けないため、線画のみ。
async function renderTrailImage(pts) {
  if (!pts.length) throw new Error('点なし');
  const W = 1024, H = 1024;
  const PADDING = 60;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  // 背景
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#fef3c7');
  grad.addColorStop(1, '#dbeafe');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // bounds
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [la, lo] of pts) {
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (lo < minLng) minLng = lo; if (lo > maxLng) maxLng = lo;
  }
  const spanLat = Math.max(1e-6, maxLat - minLat);
  const spanLng = Math.max(1e-6, maxLng - minLng);
  const span = Math.max(spanLat, spanLng);
  const cx = (minLat + maxLat) / 2;
  const cy = (minLng + maxLng) / 2;
  const xy = (la, lo) => {
    // 正方化 + 中心合わせ
    const x = ((lo - cy) / span + 0.5) * (W - 2 * PADDING) + PADDING;
    const y = (1 - ((la - cx) / span + 0.5)) * (H - 2 * PADDING) + PADDING;
    return [x, y];
  };
  // 軌跡線
  ctx.strokeStyle = '#4a106d';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = xy(pts[i][0], pts[i][1]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 始点 (緑) / 終点 (赤)
  const [sx, sy] = xy(pts[0][0], pts[0][1]);
  const [ex, ey] = xy(pts[pts.length-1][0], pts[pts.length-1][1]);
  ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(ex, ey, 14, 0, Math.PI*2); ctx.fill();
  // タイトル
  ctx.fillStyle = '#4a106d';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('🚶 LabPay 散歩', 32, 56);
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#666';
  const km = (totalMeters(pts) / 1000).toFixed(2);
  ctx.fillText(`距離 ${km} km / ${pts.length} 点`, 32, 86);
  ctx.fillText(new Date().toLocaleString('ja-JP'), 32, 110);
  return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
