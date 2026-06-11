// /#/walk — 散歩に行きたくなるアプリ。 v538 #169。
// 現在地周辺の 食べある記 places から おすすめ散歩先を提案。 未訪を優先 + 距離順
// + ランダム要素 (「✨ 今日のおすすめ」 はサーバ返却 top 数件から自分でランダム抽出)。

import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';
import { loadLeaflet } from './group_map.js';

let myLat = null, myLng = null;
let suggestions = [];
let lmap = null;
let myMarker = null;

export async function renderWalk() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">🚶 散歩に行こう</h2>
        <span style="flex:1"></span>
        <select id="wk-radius" style="font-size:12px">
          <option value="500">500m</option>
          <option value="1000">1km</option>
          <option value="2000" selected>2km</option>
          <option value="3000">3km</option>
          <option value="5000">5km</option>
        </select>
        <button id="wk-locate" class="btn primary" style="padding:4px 10px; font-size:12px">📍 現在地</button>
      </div>
    </div>
    <div class="card" id="wk-hero"><div class="muted">「📍 現在地」 を押すと、 周辺の食べある記から 散歩先を提案します。</div></div>
    <div class="card" style="padding:0; overflow:hidden">
      <div id="wk-map" style="height:40vh; min-height:240px; width:100%; background:#eef"></div>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📋 他の候補</div>
      <div id="wk-list" class="list"><div class="muted">現在地取得後に候補が出ます</div></div>
    </div>
  `;
  document.getElementById('wk-locate').addEventListener('click', locateAndFetch);
  document.getElementById('wk-radius').addEventListener('change', () => {
    if (myLat !== null) fetchSuggestions();
  });
  try {
    const L = await loadLeaflet();
    lmap = L.map(document.getElementById('wk-map'), { zoomControl: true }).setView([35.7, 139.66], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19,
    }).addTo(lmap);
  } catch (e) {
    document.getElementById('wk-map').innerHTML = `<div class="muted" style="padding:20px">${escapeHtml(e.message)}</div>`;
  }
  // ロード時に自動で現在地を試す (失敗時はボタン押下で再試行)
  locateAndFetch();
}

function locateAndFetch() {
  if (!navigator.geolocation) {
    toast('Geolocation 非対応');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      myLat = pos.coords.latitude;
      myLng = pos.coords.longitude;
      if (lmap) {
        lmap.setView([myLat, myLng], 15);
        if (!myMarker) {
          const L = window.L;
          if (L) {
            const icon = L.divIcon({
              className: 'wk-me-marker',
              html: '<div style="width:18px; height:18px; border-radius:50%; background:#1d4ed8; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>',
              iconSize: [18, 18],
              iconAnchor: [9, 9],
            });
            myMarker = L.marker([myLat, myLng], { icon }).addTo(lmap);
          }
        } else {
          myMarker.setLatLng([myLat, myLng]);
        }
      }
      fetchSuggestions();
    },
    () => { toast('現在地の取得に失敗'); },
    { enableHighAccuracy: false, timeout: 8000 },
  );
}

async function fetchSuggestions() {
  const radius = Number(document.getElementById('wk-radius').value || 2000);
  try {
    const d = await get('/api/walk/suggestions', { lat: myLat, lng: myLng, radius });
    suggestions = d.items || [];
    paint();
  } catch (e) {
    document.getElementById('wk-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function paint() {
  // 全マーカークリア (myMarker は残す)
  if (lmap) {
    lmap.eachLayer(layer => {
      if (layer instanceof window.L.Marker && layer !== myMarker) lmap.removeLayer(layer);
    });
  }
  const hero = document.getElementById('wk-hero');
  if (!suggestions.length) {
    hero.innerHTML = '<div class="empty">この範囲には まだ食べある記がありません。 もっと広い範囲で検索してみてください。</div>';
    document.getElementById('wk-list').innerHTML = '';
    return;
  }
  // 今日のおすすめ = 距離順上位 5 件からランダム 1 件
  const topN = suggestions.slice(0, 5);
  const pick = topN[Math.floor(Math.random() * topN.length)];
  const directionDeg = bearingDeg(myLat, myLng, pick.lat, pick.lng);
  const arrow = arrowChar(directionDeg);
  const hasImage = !!pick.image_thumb_url || !!pick.image_url;
  const imgSrc = pick.image_thumb_url || pick.image_url || '';
  const visited = pick.visited_by_me;
  hero.innerHTML = `
    <div class="bold" style="font-size:13px; color:var(--primary); margin-bottom:6px">✨ 今日のおすすめ</div>
    <div style="display:flex; gap:10px; align-items:flex-start">
      ${hasImage ? `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" decoding="async" style="width:80px; height:80px; object-fit:cover; border-radius:8px; flex:none">` : `<div style="width:80px; height:80px; background:linear-gradient(135deg, #fde68a, #f59e0b); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:36px; flex:none">🍴</div>`}
      <div class="grow">
        <div class="bold" style="font-size:16px">${escapeHtml(pick.title)}</div>
        ${pick.address ? `<div class="meta" style="font-size:12px">📍 ${escapeHtml(pick.address)}</div>` : ''}
        <div style="margin-top:4px; font-size:13px">
          <span style="font-size:18px">${arrow}</span>
          <span class="bold">${pick.distance_m} m</span> 先 ·
          🚶 約 <span class="bold">${pick.walk_minutes}</span> 分
          ${visited ? '<span class="tag" style="background:#dcfce7; color:#15803d; margin-left:4px">行ったことある</span>' : '<span class="tag" style="background:#fef3c7; color:#a16207; margin-left:4px">未訪</span>'}
        </div>
      </div>
    </div>
    <div class="row" style="gap:6px; margin-top:8px">
      <a href="#/places/${pick.id}" class="btn" style="font-size:12px; padding:4px 10px">詳細 →</a>
      <a href="https://maps.google.com/?q=${pick.lat},${pick.lng}&saddr=${myLat},${myLng}" target="_blank" rel="noopener" class="btn primary" style="font-size:12px; padding:4px 10px">🗺 Google Maps で経路</a>
      <button id="wk-reroll" class="btn" style="font-size:12px; padding:4px 10px">🎲 別の場所</button>
    </div>`;
  document.getElementById('wk-reroll').addEventListener('click', () => paint());

  // 地図にマーカー
  if (lmap && window.L) {
    const L = window.L;
    for (const p of suggestions) {
      const isPick = p.id === pick.id;
      const html = `<div style="width:${isPick ? 36 : 28}px; height:${isPick ? 36 : 28}px; border-radius:50%; border:${isPick ? 3 : 2}px solid #fff; background:${isPick ? '#dc2626' : (p.visited_by_me ? '#15803d' : '#f59e0b')}; box-shadow:0 1px 4px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; font-size:${isPick ? 18 : 14}px; color:#fff">${isPick ? '⭐' : '🍴'}</div>`;
      const icon = L.divIcon({ className: 'wk-marker', html, iconSize: [isPick ? 36 : 28, isPick ? 36 : 28], iconAnchor: [isPick ? 18 : 14, isPick ? 18 : 14] });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(lmap);
      marker.bindPopup(`<div class="bold">${escapeHtml(p.title)}</div><div style="font-size:11px">${p.distance_m}m · ${p.walk_minutes}分</div><a href="#/places/${p.id}" style="color:var(--primary)">詳細 →</a>`);
    }
  }

  // 他の候補リスト (pick 以外)
  const others = suggestions.filter(s => s.id !== pick.id).slice(0, 15);
  document.getElementById('wk-list').innerHTML = others.length
    ? others.map(s => `
        <a class="list-item" href="#/places/${s.id}" style="gap:8px; align-items:center">
          ${s.image_thumb_url || s.image_url
            ? `<img src="${escapeHtml(s.image_thumb_url || s.image_url)}" alt="" loading="lazy" decoding="async" style="width:42px; height:42px; object-fit:cover; border-radius:6px; flex:none">`
            : `<span style="font-size:24px; flex:none">🍴</span>`}
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(s.title)}</div>
            <div class="meta" style="font-size:11px">${s.distance_m}m · 🚶${s.walk_minutes}分 ${s.visited_by_me ? '· 👣' : ''}</div>
          </div>
        </a>`).join('')
    : '<div class="empty" style="font-size:12px">他の候補はありません</div>';
}

// 進行方位 (北=0、 東=90、 南=180、 西=270) を 矢印文字に変換
function bearingDeg(lat1, lng1, lat2, lng2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function arrowChar(deg) {
  const arrows = ['↑','↗','→','↘','↓','↙','←','↖'];
  return arrows[Math.round(deg / 45) % 8];
}
