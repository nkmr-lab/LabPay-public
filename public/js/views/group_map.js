// /#/groups/:id/map — グループのスケジュールに登録された lat/lng を 時系列で
// 結んだ線マップ。 Leaflet (CDN) + OpenStreetMap タイル (API key 不要)。
// 行く順がパッと見で分かる + ピン タップで該当予定の詳細。

import { get } from '../api.js';
import { escapeHtml, navigate } from '../router.js';

let leafletLoadedPromise = null;

// Leaflet を CDN から動的ロード。 すでにロード済みなら再利用。
function loadLeaflet() {
  if (leafletLoadedPromise) return leafletLoadedPromise;
  leafletLoadedPromise = new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    css.crossOrigin = '';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    s.crossOrigin = '';
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('Leaflet 読み込み失敗'));
    document.head.appendChild(s);
  });
  return leafletLoadedPromise;
}

export async function renderGroupMap({ params }) {
  const id = String(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/groups/${escapeHtml(id)}" class="hint">← グループ詳細</a>
      <h2 style="margin:6px 0 0">🗺️ 行く場所マップ</h2>
      <div id="gm-info" class="muted" style="font-size:13px; margin-top:4px">読み込み中…</div>
    </div>
    <div class="card" style="padding:0; overflow:hidden">
      <div id="gm-map" style="height:60vh; min-height:360px; width:100%; background:#eef"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">地点リスト</h3>
      <div id="gm-list" class="list"></div>
    </div>
  `;
  let L;
  try { L = await loadLeaflet(); }
  catch (e) {
    document.getElementById('gm-info').innerHTML = `<span style="color:var(--danger)">${escapeHtml(e.message)}</span>`;
    return;
  }
  let data;
  try { data = await get(`/api/groups/${id}/schedule`); }
  catch (e) {
    document.getElementById('gm-info').innerHTML = `<span style="color:var(--danger)">${escapeHtml(e.message)}</span>`;
    return;
  }
  // lat/lng がある予定だけを 時系列順 (day_date + start_time) に並べる。
  const items = (data.items || []).filter(it => it.lat != null && it.lng != null)
    .sort((a, b) => {
      const ka = (a.day_date || '9999-99-99') + ' ' + (a.start_time || '99:99:99');
      const kb = (b.day_date || '9999-99-99') + ' ' + (b.start_time || '99:99:99');
      return ka.localeCompare(kb);
    });
  document.getElementById('gm-info').textContent = items.length
    ? `${items.length} 地点 / 時系列で線で結んでいます`
    : '緯度経度が登録された予定はまだありません。 予定の編集モーダルで lat/lng を入れてください。';
  if (!items.length) return;

  // 地図を初期化
  const map = L.map('gm-map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);

  // ピン + 順番ラベル
  const latlngs = items.map(it => [Number(it.lat), Number(it.lng)]);
  items.forEach((it, idx) => {
    const icon = L.divIcon({
      html: `<div style="background:var(--primary,#4a106d); color:#fff; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,0.3)">${idx + 1}</div>`,
      className: 'gm-marker',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    const popup = `
      <div style="min-width:160px">
        <div style="font-weight:700; font-size:13px">${escapeHtml(it.title)}</div>
        <div style="font-size:12px; color:#666">${escapeHtml(it.day_date || '')} ${escapeHtml((it.start_time || '').slice(0, 5))}</div>
        ${it.location ? `<div style="font-size:12px; margin-top:4px">📍 ${escapeHtml(it.location)}</div>` : ''}
      </div>`;
    L.marker(latlngs[idx], { icon }).addTo(map).bindPopup(popup);
  });
  // 線で結ぶ
  L.polyline(latlngs, { color: 'var(--primary,#4a106d)', weight: 3, opacity: 0.65, dashArray: '6 4' }).addTo(map);
  // ビューを全マーカーに fit
  map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });

  // リスト表示
  document.getElementById('gm-list').innerHTML = items.map((it, idx) => `
    <div class="list-item" style="gap:8px; align-items:center">
      <div style="background:var(--primary); color:#fff; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; flex-shrink:0">${idx + 1}</div>
      <div class="grow" style="min-width:0">
        <div class="bold" style="font-size:13px">${escapeHtml(it.title)}</div>
        <div class="meta">${escapeHtml(it.day_date || '')} ${escapeHtml((it.start_time || '').slice(0, 5))}${it.location ? ' · ' + escapeHtml(it.location) : ''}</div>
      </div>
      <a href="https://maps.google.com/?q=${Number(it.lat)},${Number(it.lng)}" target="_blank" rel="noopener" class="btn" style="padding:2px 8px; font-size:11px; color:var(--primary)">Maps</a>
    </div>`).join('');
}
