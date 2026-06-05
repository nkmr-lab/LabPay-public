// /#/groups/:id/map — グループのスケジュールに登録された lat/lng を マップ表示。
// v428 拡張:
//   - 地図の center + zoom を group_id 別 localStorage で 復元
//   - 「📍 自分の位置へ」 ボタン (現在地に flyTo)
//   - 「📡 位置共有」 トグル: ON で 自分の位置を 30s 毎に POST、 メンバー全員 表示
//   - マーカーが 画像URL ありの 場合は サムネ アイコン
//   - ポップアップ に 画像 + タイトル + メモ

import { get, post, del as apiDel } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';

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

// 並び順
const ORDER_KEY  = (gid) => `labpay-map-order-${gid}`;
const VIEW_KEY   = (gid) => `labpay-map-view-${gid}`;
const SHARE_KEY  = (gid) => `labpay-map-share-${gid}`;
const LINE_KEY   = 'labpay-map-line-on';

function loadJSON(k, def) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function rmKey(k) { try { localStorage.removeItem(k); } catch {} }

function loadCustomOrder(gid)   { return loadJSON(ORDER_KEY(gid), null); }
function saveCustomOrder(gid, ids) { saveJSON(ORDER_KEY(gid), ids); }
function clearCustomOrder(gid)  { rmKey(ORDER_KEY(gid)); }
function loadLinePref() { return localStorage.getItem(LINE_KEY) !== '0'; }
function saveLinePref(on) { try { localStorage.setItem(LINE_KEY, on ? '1' : '0'); } catch {} }

// 各 user_id を 色相 ホイールに 振り分け (avatar が 無い ときの 円の色)
function userColor(uid) {
  const h = (uid * 137.508) % 360;
  return `hsl(${h.toFixed(0)}, 70%, 50%)`;
}

// グループマップ用 内部 state (1 ページ生存期間)。
let mapState = null;
function teardownMap() {
  if (!mapState) return;
  if (mapState.watchId !== null) navigator.geolocation.clearWatch(mapState.watchId);
  if (mapState.pingTimer) clearInterval(mapState.pingTimer);
  if (mapState.locPollTimer) clearInterval(mapState.locPollTimer);
  if (mapState.domWatch) clearInterval(mapState.domWatch);
  mapState = null;
}

export async function renderGroupMap({ params }) {
  teardownMap();
  const id = String(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/groups/${escapeHtml(id)}" class="hint">← グループ詳細</a>
      <h2 style="margin:6px 0 0">🗺️ 行く場所マップ</h2>
      <div id="gm-info" class="muted" style="font-size:13px; margin-top:4px">読み込み中…</div>
      <div class="row" style="gap:8px; margin-top:8px; align-items:center; flex-wrap:wrap">
        <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer">
          <input type="checkbox" id="gm-line-toggle">
          <span>線で結ぶ</span>
        </label>
        <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer">
          <input type="checkbox" id="gm-share-toggle">
          <span>📡 位置共有</span>
        </label>
        <button id="gm-locate" class="btn primary" style="padding:2px 10px; font-size:12px">📍 自分の位置へ</button>
        <button id="gm-reset-order" class="btn" style="padding:2px 10px; font-size:12px">↻ 並び順</button>
      </div>
      <div id="gm-share-st" class="hint-sm" style="margin-top:4px"></div>
    </div>
    <div class="card" style="padding:0; overflow:hidden">
      <div id="gm-map" style="height:46vh; min-height:300px; width:100%; background:#eef"></div>
    </div>
    <div class="card">
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">地点リスト <span id="gm-list-count" class="hint-sm" style="font-weight:400"></span></h3>
        <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px; cursor:pointer">
          <input type="checkbox" id="gm-bounds-only" checked>
          <span>表示中エリアのみ</span>
        </label>
      </div>
      <div id="gm-list" class="list" style="max-height:38vh; overflow-y:auto"></div>
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

  const byId = new Map();
  const naturalOrder = (data.items || []).filter(it => it.lat != null && it.lng != null)
    .sort((a, b) => {
      const ka = (a.day_date || '9999-99-99') + ' ' + (a.start_time || '99:99:99');
      const kb = (b.day_date || '9999-99-99') + ' ' + (b.start_time || '99:99:99');
      return ka.localeCompare(kb);
    });
  naturalOrder.forEach(it => byId.set(Number(it.id), it));

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

  // 地図 init (1 回だけ)。 保存された view を 優先、 無ければ 地点に fitBounds。
  const savedView = loadJSON(VIEW_KEY(id), null);
  const map = L.map('gm-map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  if (savedView && Number.isFinite(savedView.lat) && Number.isFinite(savedView.lng)) {
    map.setView([savedView.lat, savedView.lng], savedView.zoom || 14);
  }
  map.on('moveend zoomend', () => {
    const c = map.getCenter();
    saveJSON(VIEW_KEY(id), { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  });

  const markerLayer = L.layerGroup().addTo(map);
  const memberLayer = L.layerGroup().addTo(map);
  const lineLayer   = L.layerGroup().addTo(map);

  // mapState を 初期化 (teardown 用)
  mapState = {
    gid: id, map, L, memberLayer,
    watchId: null,
    pingTimer: null,
    locPollTimer: null,
    domWatch: null,
    sharing: localStorage.getItem(SHARE_KEY(id)) === '1',
    ownPos: null,
  };

  const buildItemIcon = (it, idx) => {
    if (it.image_url) {
      return L.divIcon({
        html: `<div style="width:40px; height:40px; border-radius:50%; background:#fff center/cover no-repeat url('${escapeHtml(it.image_url)}'); border:3px solid var(--primary,#4a106d); box-shadow:0 1px 4px rgba(0,0,0,0.4); position:relative">
                 <div style="position:absolute; bottom:-4px; right:-4px; background:var(--primary,#4a106d); color:#fff; border-radius:50%; width:18px; height:18px; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; border:2px solid #fff">${idx + 1}</div>
               </div>`,
        className: 'gm-marker',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
    }
    return L.divIcon({
      html: `<div style="background:var(--primary,#4a106d); color:#fff; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,0.3)">${idx + 1}</div>`,
      className: 'gm-marker',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  };

  const popupFor = (it, idx) => {
    const img = it.image_url
      ? `<img src="${escapeHtml(it.image_url)}" alt="" style="width:100%; max-width:240px; max-height:170px; object-fit:cover; border-radius:6px; margin-bottom:6px">`
      : '';
    // v432 popup の 情報量 を 増やす。 時刻範囲 (start-end) / URL リンク / 追加者名 / メモ 300 字。
    const time = (() => {
      const s = (it.start_time || '').slice(0, 5);
      const e = (it.end_time || '').slice(0, 5);
      if (s && e) return `${s}〜${e}`;
      if (s) return s;
      return '';
    })();
    const url = it.url
      ? `<div style="font-size:12px; margin-top:4px"><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" style="color:var(--primary)">🔗 リンクを開く</a></div>` : '';
    const by = it.created_by_name
      ? `<div style="font-size:11px; color:#888; margin-top:4px">追加: ${escapeHtml(it.created_by_name)}</div>` : '';
    const memo = it.memo
      ? `<div style="font-size:12px; color:#333; margin-top:6px; padding-top:6px; border-top:1px dashed #ddd; white-space:pre-wrap; line-height:1.4">${escapeHtml(it.memo.slice(0, 300))}${it.memo.length > 300 ? '…' : ''}</div>` : '';
    return `
      <div style="min-width:200px; max-width:260px">
        ${img}
        <div style="font-weight:700; font-size:14px">${idx + 1}. ${escapeHtml(it.title)}</div>
        <div style="font-size:12px; color:#666; margin-top:2px">${escapeHtml(it.day_date || '')}${time ? ' · ' + escapeHtml(time) : ''}</div>
        ${it.location ? `<div style="font-size:12px; margin-top:4px">📍 ${escapeHtml(it.location)}</div>` : ''}
        ${url}
        ${memo}
        ${by}
      </div>`;
  };

  // v433 markers / lines は 全件、 list は 「表示中エリアのみ」 toggle で
  // map.getBounds() フィルタ → moveend/zoomend で 即 再描画。 1 画面で
  // 地図と 連動する 検索 UI。
  const drawMarkersAndLines = () => {
    markerLayer.clearLayers();
    lineLayer.clearLayers();
    const items = orderedIds.map(x => byId.get(x)).filter(Boolean);
    const latlngs = items.map(it => [Number(it.lat), Number(it.lng)]);
    items.forEach((it, idx) => {
      L.marker(latlngs[idx], { icon: buildItemIcon(it, idx) })
        .addTo(markerLayer)
        .bindPopup(popupFor(it, idx));
    });
    if (lineOn && latlngs.length >= 2) {
      L.polyline(latlngs, { color: '#4a106d', weight: 3, opacity: 0.65, dashArray: '6 4' }).addTo(lineLayer);
    }
    if (!savedView && latlngs.length) {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
    }
  };

  const renderList = () => {
    const items = orderedIds.map(x => byId.get(x)).filter(Boolean);
    const boundsOnly = document.getElementById('gm-bounds-only')?.checked;
    const visIdxs = items.map((_, i) => i);  // 全 index (絶対番号 = 元の 並び順)
    const filteredIdxs = boundsOnly
      ? (() => {
          let b;
          try { b = map.getBounds(); } catch { return visIdxs; }
          return visIdxs.filter(i => {
            const it = items[i];
            const ll = L.latLng(Number(it.lat), Number(it.lng));
            return b.contains(ll);
          });
        })()
      : visIdxs;
    const info = document.getElementById('gm-info');
    if (info) {
      info.textContent = `${items.length} 地点 (表示中 ${filteredIdxs.length}) / ${lineOn ? '時系列で線で結んでいます' : '線は非表示'}`;
    }
    const cntEl = document.getElementById('gm-list-count');
    if (cntEl) {
      cntEl.textContent = boundsOnly
        ? `(${filteredIdxs.length} / ${items.length})`
        : `(${items.length})`;
    }
    const listEl = document.getElementById('gm-list');
    if (!listEl) return;
    if (!filteredIdxs.length) {
      listEl.innerHTML = boundsOnly
        ? '<div class="empty" style="padding:6px">表示中エリアに 地点なし。 地図を 動かしてください。</div>'
        : '<div class="empty" style="padding:6px">地点なし</div>';
      return;
    }
    listEl.innerHTML = filteredIdxs.map((absIdx) => {
      const it = items[absIdx];
      const upDisabled   = absIdx === 0 ? 'disabled' : '';
      const downDisabled = absIdx === items.length - 1 ? 'disabled' : '';
      const thumb = it.image_url
        ? `<img src="${escapeHtml(it.image_url)}" alt="" style="width:40px; height:40px; object-fit:cover; border-radius:6px; flex-shrink:0">`
        : '';
      return `
        <div class="list-item" data-pin-id="${it.id}" style="gap:8px; align-items:center; cursor:pointer">
          <div style="background:var(--primary); color:#fff; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; flex-shrink:0">${absIdx + 1}</div>
          ${thumb}
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:13px">${escapeHtml(it.title)}</div>
            <div class="meta">${escapeHtml(it.day_date || '')} ${escapeHtml((it.start_time || '').slice(0, 5))}${it.location ? ' · ' + escapeHtml(it.location) : ''}</div>
          </div>
          <div style="display:flex; flex-direction:column; gap:2px; flex-shrink:0">
            <button data-mv="up"   data-id="${it.id}" class="btn" style="padding:0 6px; font-size:11px" ${upDisabled}>↑</button>
            <button data-mv="down" data-id="${it.id}" class="btn" style="padding:0 6px; font-size:11px" ${downDisabled}>↓</button>
          </div>
          <a href="https://maps.google.com/?q=${Number(it.lat)},${Number(it.lng)}" target="_blank" rel="noopener" class="btn" style="padding:2px 8px; font-size:11px; color:var(--primary)" onclick="event.stopPropagation()">Maps</a>
        </div>`;
    }).join('');
    // 行 タップで 該当 マーカー の popup を 開く + 中心へ flyTo
    listEl.querySelectorAll('[data-pin-id]').forEach(row => {
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('button,a')) return;
        const tid = Number(row.dataset.pinId);
        const it = byId.get(tid);
        if (!it) return;
        const latlng = [Number(it.lat), Number(it.lng)];
        map.flyTo(latlng, Math.max(map.getZoom(), 15), { duration: 0.5 });
        // popup を 開く: marker レイヤから 同 latlng の マーカーを 探す
        markerLayer.eachLayer(m => {
          const ll = m.getLatLng?.();
          if (ll && Math.abs(ll.lat - latlng[0]) < 1e-6 && Math.abs(ll.lng - latlng[1]) < 1e-6) {
            m.openPopup();
          }
        });
      });
    });
    listEl.querySelectorAll('[data-mv]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
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

  const redraw = () => {
    drawMarkersAndLines();
    renderList();
  };

  // 地図の 移動 / ズーム で 「表示中エリアのみ」 ON の 時 list を 再描画。
  // v435 toggle 状態 に かかわらず moveend/zoomend で 必ず renderList (内部で
  // checkbox を 読んで 分岐するので 二重判定 不要 / 早期 return を 避ける)。
  map.on('moveend zoomend', () => renderList());
  document.getElementById('gm-bounds-only')?.addEventListener('change', renderList);

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

  // 「自分の位置へ」 ボタン
  document.getElementById('gm-locate').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('この端末は 位置情報 に 対応していません'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        map.flyTo([p.coords.latitude, p.coords.longitude], 16, { duration: 0.8 });
        renderOwnDot(L, memberLayer, p.coords.latitude, p.coords.longitude, p.coords.accuracy);
      },
      (err) => toast('位置取得 失敗: ' + (err.message || err.code)),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });

  // 位置共有 トグル
  const shareToggle = document.getElementById('gm-share-toggle');
  shareToggle.checked = mapState.sharing;
  const updateShareStatus = (msg) => {
    document.getElementById('gm-share-st').textContent = msg;
  };
  const startSharing = () => {
    if (!navigator.geolocation) { toast('位置情報 未対応'); shareToggle.checked = false; return; }
    mapState.sharing = true;
    try { localStorage.setItem(SHARE_KEY(id), '1'); } catch {}
    updateShareStatus('📡 共有 開始しています…');
    const ping = (lat, lng, acc) => post(`/api/groups/${id}/locations`, { lat, lng, accuracy: acc });
    mapState.watchId = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude: lat, longitude: lng, accuracy } = p.coords;
        mapState.ownPos = { lat, lng, accuracy };
        ping(lat, lng, accuracy).catch(() => {});
        updateShareStatus(`📡 共有中 (精度 ±${Math.round(accuracy)}m)`);
      },
      (err) => updateShareStatus('位置 取得 エラー: ' + (err.message || err.code)),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
    );
    // 安全網: 30 秒に 1 回 強制 ping (watchPosition が 沈黙する 端末向け)
    mapState.pingTimer = setInterval(() => {
      if (mapState?.ownPos) ping(mapState.ownPos.lat, mapState.ownPos.lng, mapState.ownPos.accuracy).catch(() => {});
    }, 30000);
  };
  const stopSharing = () => {
    mapState.sharing = false;
    try { localStorage.setItem(SHARE_KEY(id), '0'); } catch {}
    if (mapState.watchId !== null) { navigator.geolocation.clearWatch(mapState.watchId); mapState.watchId = null; }
    if (mapState.pingTimer) { clearInterval(mapState.pingTimer); mapState.pingTimer = null; }
    apiDel(`/api/groups/${id}/locations`).catch(() => {});
    updateShareStatus('共有 停止');
  };
  shareToggle.addEventListener('change', (e) => {
    if (e.target.checked) startSharing();
    else stopSharing();
  });
  if (mapState.sharing) startSharing();

  // メンバー位置 ポーリング (20 秒)
  const pollMembers = async () => {
    try {
      const r = await get(`/api/groups/${id}/locations`);
      drawMemberMarkers(L, memberLayer, r.items || []);
    } catch (_) {}
  };
  mapState.locPollTimer = setInterval(pollMembers, 20000);
  await pollMembers();

  // ページ離脱で teardown
  mapState.domWatch = setInterval(() => {
    if (!document.getElementById('gm-map')) {
      teardownMap();
    }
  }, 2000);

  if (byId.size) {
    redraw();
  } else {
    document.getElementById('gm-info').textContent =
      '緯度経度が登録された予定はまだありません。 「📍 自分の位置へ」 や 「位置共有」 は 使えます。';
  }
}

function renderOwnDot(L, layer, lat, lng, accuracy) {
  // own dot は member マーカーと 別管理 (上書きは pollMembers で 自動的に 行われる)
  // ここでは ボタン押下 時の 瞬間 表示用 ピン だけ。
  layer.eachLayer(l => { if (l._ownDot) layer.removeLayer(l); });
  const m = L.circleMarker([lat, lng], { radius: 7, color: '#0e7c63', fillColor: '#3fc3a3', fillOpacity: 0.9, weight: 2 });
  m._ownDot = true;
  m.bindTooltip('あなた (' + Math.round(accuracy) + 'm)', { permanent: false });
  m.addTo(layer);
}

function drawMemberMarkers(L, layer, items) {
  layer.eachLayer(l => { if (!l._ownDot) layer.removeLayer(l); });
  items.forEach(it => {
    const color = userColor(it.user_id);
    const initial = (it.display_name || '?').trim().charAt(0).toUpperCase();
    const avatarBg = it.avatar_url
      ? `background:#fff center/cover no-repeat url('${cssUrl(it.avatar_url)}')`
      : `background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px`;
    const dotClass = it.is_me ? 'border:3px solid #0e7c63' : `border:3px solid ${color}`;
    const html = `<div style="width:32px; height:32px; border-radius:50%; ${avatarBg}; ${dotClass}; box-shadow:0 1px 4px rgba(0,0,0,0.4)">${it.avatar_url ? '' : initial}</div>`;
    const icon = L.divIcon({ html, className: 'gm-member-marker', iconSize: [32, 32], iconAnchor: [16, 16] });
    const since = Math.floor((Date.now() - Date.parse(String(it.updated_at).replace(' ', 'T'))) / 1000);
    const ago = since < 60 ? `${since} 秒前` : since < 3600 ? `${Math.floor(since/60)} 分前` : `${Math.floor(since/3600)} 時間前`;
    const popup = `<div><div style="font-weight:700">${escapeHtml(it.display_name)}${it.is_me ? ' (あなた)' : ''}</div>
                   <div style="font-size:11px; color:#666">${ago}${it.accuracy_m ? ' · 精度 ±' + it.accuracy_m + 'm' : ''}</div></div>`;
    L.marker([it.lat, it.lng], { icon }).addTo(layer).bindPopup(popup);
  });
}

function cssUrl(u) {
  return String(u).replace(/'/g, "%27").replace(/"/g, "%22");
}
