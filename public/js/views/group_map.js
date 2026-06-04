// /#/groups/:id/map — グループのスケジュールに登録された lat/lng を マップ表示。
// 「線で結ぶ / 結ばない」 トグル + ↑↓ で並び替え。 並び替えは module-level で
// 持ち回す (= ページ離脱で消える) + ローカルストレージで group_id 別に永続化。
// Leaflet (CDN) + OpenStreetMap (API key 不要)。

import { get } from '../api.js';
import { escapeHtml } from '../router.js';

let leafletLoadedPromise = null;
export function loadLeaflet() {
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

// 並び順 (= 表示する item id の配列) を group ごとに記憶。
const ORDER_KEY = (gid) => `labpay-map-order-${gid}`;
function loadCustomOrder(gid) {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY(gid)) || 'null'); }
  catch { return null; }
}
function saveCustomOrder(gid, ids) {
  try { localStorage.setItem(ORDER_KEY(gid), JSON.stringify(ids)); } catch {}
}
function clearCustomOrder(gid) {
  try { localStorage.removeItem(ORDER_KEY(gid)); } catch {}
}

const LINE_KEY = 'labpay-map-line-on';
function loadLinePref() {
  return localStorage.getItem(LINE_KEY) !== '0'; // デフォルト ON
}
function saveLinePref(on) {
  try { localStorage.setItem(LINE_KEY, on ? '1' : '0'); } catch {}
}

export async function renderGroupMap({ params }) {
  const id = String(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/groups/${escapeHtml(id)}" class="hint">← グループ詳細</a>
      <h2 style="margin:6px 0 0">🗺️ 行く場所マップ</h2>
      <div id="gm-info" class="muted" style="font-size:13px; margin-top:4px">読み込み中…</div>
      <div class="row" style="gap:10px; margin-top:8px; align-items:center; flex-wrap:wrap">
        <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer">
          <input type="checkbox" id="gm-line-toggle">
          <span>線で結ぶ</span>
        </label>
        <button id="gm-reset-order" class="btn" style="padding:2px 10px; font-size:12px">↻ 並び順をリセット</button>
      </div>
    </div>
    <div class="card" style="padding:0; overflow:hidden">
      <div id="gm-map" style="height:60vh; min-height:360px; width:100%; background:#eef"></div>
    </div>
    <div class="card">
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">地点リスト</h3>
        <span class="hint-sm">↑↓ で並び替え</span>
      </div>
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
  // lat/lng がある予定だけ抜く。
  const byId = new Map();
  const naturalOrder = (data.items || []).filter(it => it.lat != null && it.lng != null)
    .sort((a, b) => {
      const ka = (a.day_date || '9999-99-99') + ' ' + (a.start_time || '99:99:99');
      const kb = (b.day_date || '9999-99-99') + ' ' + (b.start_time || '99:99:99');
      return ka.localeCompare(kb);
    });
  naturalOrder.forEach(it => byId.set(Number(it.id), it));
  if (!byId.size) {
    document.getElementById('gm-info').textContent =
      '緯度経度が登録された予定はまだありません。 予定の編集モーダルで lat/lng を入れてください。';
    return;
  }
  // カスタム順があればそれを優先。 新規アイテム (= カスタム順に居ない) は末尾に追加。
  const customIds = loadCustomOrder(id);
  let orderedIds;
  if (Array.isArray(customIds) && customIds.length) {
    orderedIds = customIds.filter(x => byId.has(Number(x))).map(Number);
    const known = new Set(orderedIds);
    naturalOrder.forEach(it => { if (!known.has(Number(it.id))) orderedIds.push(Number(it.id)); });
  } else {
    orderedIds = naturalOrder.map(it => Number(it.id));
  }

  let lineOn = loadLinePref();
  document.getElementById('gm-line-toggle').checked = lineOn;

  // 地図 init (1 回だけ)
  const map = L.map('gm-map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const lineLayer = L.layerGroup().addTo(map);

  const redraw = () => {
    markerLayer.clearLayers();
    lineLayer.clearLayers();
    const items = orderedIds.map(x => byId.get(x)).filter(Boolean);
    document.getElementById('gm-info').textContent =
      `${items.length} 地点 / ${lineOn ? '時系列で線で結んでいます' : '線は非表示'}`;
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
      L.marker(latlngs[idx], { icon }).addTo(markerLayer).bindPopup(popup);
    });
    if (lineOn && latlngs.length >= 2) {
      L.polyline(latlngs, { color: '#4a106d', weight: 3, opacity: 0.65, dashArray: '6 4' }).addTo(lineLayer);
    }
    if (latlngs.length) {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
    }

    // リスト
    document.getElementById('gm-list').innerHTML = items.map((it, idx) => {
      const upDisabled = idx === 0 ? 'disabled' : '';
      const downDisabled = idx === items.length - 1 ? 'disabled' : '';
      return `
        <div class="list-item" style="gap:8px; align-items:center">
          <div style="background:var(--primary); color:#fff; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; flex-shrink:0">${idx + 1}</div>
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:13px">${escapeHtml(it.title)}</div>
            <div class="meta">${escapeHtml(it.day_date || '')} ${escapeHtml((it.start_time || '').slice(0, 5))}${it.location ? ' · ' + escapeHtml(it.location) : ''}</div>
          </div>
          <div style="display:flex; flex-direction:column; gap:2px; flex-shrink:0">
            <button data-mv="up" data-id="${it.id}" class="btn" style="padding:0 6px; font-size:11px" ${upDisabled}>↑</button>
            <button data-mv="down" data-id="${it.id}" class="btn" style="padding:0 6px; font-size:11px" ${downDisabled}>↓</button>
          </div>
          <a href="https://maps.google.com/?q=${Number(it.lat)},${Number(it.lng)}" target="_blank" rel="noopener" class="btn" style="padding:2px 8px; font-size:11px; color:var(--primary)">Maps</a>
        </div>`;
    }).join('');
    document.querySelectorAll('[data-mv]').forEach(b => {
      b.addEventListener('click', () => {
        const targetId = Number(b.dataset.id);
        const i = orderedIds.indexOf(targetId);
        if (i < 0) return;
        const j = b.dataset.mv === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= orderedIds.length) return;
        [orderedIds[i], orderedIds[j]] = [orderedIds[j], orderedIds[i]];
        saveCustomOrder(id, orderedIds);
        redraw();
      });
    });
  };

  document.getElementById('gm-line-toggle').addEventListener('change', (e) => {
    lineOn = e.target.checked;
    saveLinePref(lineOn);
    redraw();
  });
  document.getElementById('gm-reset-order').addEventListener('click', () => {
    if (!confirm('並び順を時系列にリセットしますか?')) return;
    clearCustomOrder(id);
    orderedIds = naturalOrder.map(it => Number(it.id));
    redraw();
  });

  redraw();
}
