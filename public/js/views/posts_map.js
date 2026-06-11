// /#/sns/map — 自分の らぼったー 投稿のうち 位置情報がついているものを 地図に
// プロット。 マップを動かす (= 表示中エリアを変える) と 下の一覧が それに合わせて
// 自動で絞り込まれる (= 食べある記の マップビューと 同じ思想)。
//
// v530 #181 実装。 自分が らぼったー で 投稿した場所 一覧 + 地図インターフェース。

import { get } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { loadLeaflet } from './group_map.js';

export async function renderPostsMap() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card" style="padding:6px 10px; margin:0">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <a href="#/sns" class="btn" style="padding:2px 10px; font-size:12px; flex-shrink:0">← タイムライン</a>
        <h2 style="margin:0; font-size:15px">📍 自分の投稿の場所</h2>
        <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px; flex:0 0 auto">
          <input type="checkbox" id="pm-bounds-only" checked> 表示中エリアのみ
        </label>
        <span id="pm-count" class="hint-sm" style="margin-left:auto; font-size:11px"></span>
      </div>
    </div>
    <div class="card" style="padding:0; overflow:hidden; margin:6px 0">
      <div id="pm-map" style="height:50vh; min-height:300px; width:100%; background:#eef"></div>
    </div>
    <div class="card" style="padding:6px 10px; margin:0">
      <div id="pm-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;

  let L;
  try { L = await loadLeaflet(); }
  catch (e) {
    document.getElementById('pm-map').innerHTML = `<div class="muted" style="padding:20px">${escapeHtml(e.message)}</div>`;
    return;
  }

  const mapBox = document.getElementById('pm-map');
  const map = L.map(mapBox, { zoomControl: true }).setView([35.7, 139.66], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19,
  }).addTo(map);

  // 自分の投稿で lat/lng が入ってるものだけ集める。 多数を期待していい (200 件まで)。
  const meId = Number(state.me?.id);
  let items = [];
  try {
    const d = await get('/api/posts', { user_id: meId, limit: 200 });
    items = (d.items || []).filter(p => p.lat !== null && p.lng !== null);
  } catch (e) {
    document.getElementById('pm-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  if (!items.length) {
    document.getElementById('pm-list').innerHTML =
      '<div class="empty">位置情報付きの投稿はまだありません。 投稿時に 📍 をオンにすると ここに出ます。</div>';
    return;
  }

  const markersByPid = new Map();
  for (const p of items) {
    const lat = Number(p.lat), lng = Number(p.lng);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const m = L.marker([lat, lng]).addTo(map);
    m.bindPopup(() => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'min-width:200px; max-width:260px; font-size:13px';
      // v534 #190 写真があれば サムネで表示 (タップで詳細へ)
      const imgSrc = p.image_thumb_url || p.image_url;
      const imgBlock = imgSrc
        ? `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" decoding="async" style="display:block; width:100%; max-height:160px; object-fit:cover; border-radius:6px; margin-bottom:6px">`
        : '';
      wrap.innerHTML = `
        ${imgBlock}
        <div class="bold" style="font-size:13px">${escapeHtml((p.body || '').slice(0, 80))}</div>
        <div class="meta" style="font-size:11px">${escapeHtml(p.created_at || '')}</div>
        <a href="#/sns/${p.id}" style="color:var(--primary); font-size:12px">詳細 →</a>`;
      return wrap;
    });
    markersByPid.set(p.id, m);
  }

  // 全マーカーが収まるようズーム調整
  const group = L.featureGroup([...markersByPid.values()]);
  if (group.getLayers().length) map.fitBounds(group.getBounds().pad(0.2));

  const boundsCheckbox = document.getElementById('pm-bounds-only');
  function refreshList() {
    const bounds = map.getBounds();
    const onlyBounds = !!boundsCheckbox.checked;
    const filtered = onlyBounds
      ? items.filter(p => bounds.contains([Number(p.lat), Number(p.lng)]))
      : items;
    document.getElementById('pm-count').textContent = `${filtered.length} 件`;
    if (!filtered.length) {
      document.getElementById('pm-list').innerHTML =
        '<div class="empty" style="padding:6px; font-size:12px">表示中エリアに投稿はありません</div>';
      return;
    }
    document.getElementById('pm-list').innerHTML = filtered.map(p => {
      // v534 #190 写真がある投稿は 48px サムネを左に出す
      const imgSrc = p.image_thumb_url || p.image_url;
      const thumb = imgSrc
        ? `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" decoding="async" style="width:48px; height:48px; object-fit:cover; border-radius:6px; flex:none">`
        : `<span style="display:inline-flex; flex:none">${avatarHtml(p.display_name, p.avatar_url, 'sm')}</span>`;
      return `
        <a class="list-item" href="#/sns/${p.id}" style="gap:8px; align-items:flex-start">
          ${thumb}
          <div class="grow" style="min-width:0">
            <div style="font-size:13px; line-height:1.4; overflow:hidden; text-overflow:ellipsis">${escapeHtml((p.body || '').slice(0, 100))}</div>
            <div class="meta" style="font-size:11px">${escapeHtml(p.created_at || '')}</div>
          </div>
        </a>`;
    }).join('');
  }
  refreshList();
  map.on('moveend zoomend', refreshList);
  boundsCheckbox.addEventListener('change', refreshList);
}
