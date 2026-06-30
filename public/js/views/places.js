// /#/places — 行きたい店 / 行ったお店共有 (食べログ的)。
// 一覧 → 詳細 → 口コミ投稿 + 削除。 lat/lng があれば Leaflet で地図表示。
// 画像は /api/uploads/image で先に上げ、 返りの URL を image_url に。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { loadLeaflet } from './group_map.js';
import { openImageLightbox } from '../lightbox.js';

const CATEGORIES = [
  { id: '',       label: '指定なし' },
  { id: 'cafe',   label: '☕ カフェ' },
  { id: 'lunch',  label: '🍱 ランチ' },
  { id: 'dinner', label: '🍣 ディナー' },
  { id: 'bar',    label: '🍺 飲み屋' },
  { id: 'sweets', label: '🍰 スイーツ' },
  { id: 'other',  label: '🍴 その他' },
];
const CAT_LBL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]));

function ratingStars(r) {
  if (r === null || r === undefined) return '';
  const full = Math.round(r);
  return '⭐'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}

// v471 本文内の URL をクリック可能リンクに。 改行も <br> に。
function linkifyText(s) {
  let h = escapeHtml(s || '');
  h = h.replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--primary); word-break:break-all">$1</a>');
  return h.replace(/\n/g, '<br>');
}

// v502 #119 Google Maps の保存リスト (KML / GeoJSON) を取り込み、 既存と重複しない
//   場所だけを /api/places に登録。 共通パーサは ../gmap_import.js に切り出し済み。
async function onGmapImport(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (!f) return;
  const { parseGmapFile, isDupOf } = await import('../gmap_import.js');
  const text = await f.text();
  let parsed;
  try { parsed = parseGmapFile(f.name, text); }
  catch (e) { toast('読み取り失敗: ' + (e?.message || e)); return; }
  if (!parsed.length) { toast('リストに場所が見つかりませんでした'); return; }
  let existing = [];
  try { const r = await get('/api/places'); existing = r.items || []; } catch (_) {}
  const toImport = parsed.filter(p => !isDupOf(existing, p));
  const dups = parsed.length - toImport.length;
  if (!toImport.length) { toast(`全 ${parsed.length} 件は既に登録済みでした`); return; }
  if (!confirm(`Google Map から ${parsed.length} 件読み込みました。\n重複 ${dups} 件をスキップして ${toImport.length} 件を新規登録します。よろしいですか？`)) return;
  let ok = 0, ng = 0;
  for (const p of toImport) {
    try {
      await post('/api/places', {
        title: p.title, address: p.address || '', description: p.description || '',
        lat: p.lat, lng: p.lng,
      });
      ok++;
    } catch (_) { ng++; }
  }
  toast(`登録: ${ok} 件 / 失敗: ${ng} 件 / 重複スキップ: ${dups} 件`);
  renderPlaces();
}

export async function renderPlaces() {
  const app = document.getElementById('app');
  // v730 #338 #339 たべある記ページのレイアウト調整:
  //   - 表示中はナビ tabs を隠す (場所節約)
  //   - h2 ヘッダー / 📥 インポートボタンを廃止
  //   - 地図 bounds フィルタを復活 (デフォルト ON)
  //   - ハート / 足跡フィルタの「・」 や説明文を間引いて省スペース
  const tabsEl = document.getElementById('tabs');
  if (tabsEl) tabsEl.dataset.placesHidden = tabsEl.hidden ? '0' : '1';
  if (tabsEl) tabsEl.hidden = true;
  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#/places') || location.hash !== '#/places') {
      if (tabsEl && tabsEl.dataset.placesHidden === '1') tabsEl.hidden = false;
    }
  }, { once: true });
  // v885 ビューモード = 'map' | 'recent'。 PC 幅では 'map' で地図(左) + 一覧(右) の
  //   横並びレイアウト、 narrow では縦 (従来通り)。 'recent' は地図を隠して新着順タイルのみ。
  const VIEW_KEY = 'labpay.places.viewMode';
  const initialView = (() => {
    try { const v = localStorage.getItem(VIEW_KEY); return (v === 'recent' || v === 'map') ? v : 'map'; }
    catch { return 'map'; }
  })();
  app.innerHTML = `
    <style>
      /* v885 食べある記 PC 横長対策: 900px 以上で地図(左) + 一覧(右) の split */
      #pl-shell { display:block; }
      #pl-map-wrap { position:relative; height:33vh; min-height:200px; background:#eef; margin:-6px -6px 6px }
      #pl-list-wrap { }
      @media (min-width: 900px) {
        #pl-shell.is-map { display:grid; grid-template-columns: minmax(380px, 1.1fr) 1fr; gap:10px;
          height: calc(100vh - 130px); margin:-6px -6px 0; }
        #pl-shell.is-map #pl-map-wrap { height:100%; min-height:0; margin:0 }
        #pl-shell.is-map #pl-list-wrap { overflow-y:auto; padding:0 6px 12px 0 }
      }
      /* recent モードでは地図を完全に隠す */
      #pl-shell.is-recent #pl-map-wrap { display:none }
    </style>
    <div class="card" style="padding:6px 10px; margin-bottom:6px">
      <div class="row" style="gap:8px; align-items:center; flex-wrap:wrap; font-size:13px">
        <div class="row" style="gap:0; border-radius:14px; overflow:hidden; border:1px solid var(--primary-soft)">
          <button id="pl-mode-map"    type="button" style="border:none; padding:5px 14px; font-size:12px; cursor:pointer; background:${initialView==='map'   ?'var(--primary)':'#fff'}; color:${initialView==='map'   ?'#fff':'var(--primary)'}">🗺 地図</button>
          <button id="pl-mode-recent" type="button" style="border:none; padding:5px 14px; font-size:12px; cursor:pointer; background:${initialView==='recent'?'var(--primary)':'#fff'}; color:${initialView==='recent'?'#fff':'var(--primary)'}">🆕 新着</button>
        </div>
        <a class="btn primary" href="#/places/new" style="padding:4px 10px; font-size:12px">＋ 新規</a>
        <label id="pl-f-bounds-lbl" style="display:inline-flex; gap:4px; align-items:center"><input type="checkbox" id="pl-f-bounds" checked> 🗺 地図内のみ</label>
        <label style="display:inline-flex; gap:4px; align-items:center"><input type="checkbox" id="pl-f-liked"> ❤️</label>
        <label style="display:inline-flex; gap:4px; align-items:center"><input type="checkbox" id="pl-f-visited"> 👣</label>
        <span id="pl-count" class="hint-sm" style="margin-left:auto; font-size:11px"></span>
      </div>
    </div>
    <div id="pl-shell" class="is-${initialView}">
      <div id="pl-map-wrap">
        <div id="pl-map" style="height:100%; width:100%"></div>
        <button id="pl-locate" class="btn" title="現在地に移動"
          style="position:absolute; top:8px; right:8px; z-index:500; background:#fff; padding:6px 10px; font-size:12px; box-shadow:0 1px 4px rgba(0,0,0,0.2)">📍 現在地</button>
      </div>
      <div id="pl-list-wrap">
        <div id="pl-list"><div class="muted">読み込み中…</div></div>
      </div>
    </div>
  `;

  // 地図 (leaflet) 初期化 + 保存ビュー復元 (v721 と同じ key)。
  const MAP_VIEW_KEY = 'labpay.places.mapView';
  let L = null, map = null;
  try { L = await loadLeaflet(); } catch (_) {}
  if (L) {
    map = L.map('pl-map', { zoomControl: true }).setView([35.7, 139.66], 13);
    try {
      const raw = localStorage.getItem(MAP_VIEW_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (typeof v?.lat === 'number' && typeof v?.lng === 'number') {
          map.setView([v.lat, v.lng], v.zoom || 13);
        }
      }
    } catch (_) {}
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    const persistView = () => {
      try {
        const c = map.getCenter();
        localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
      } catch (_) {}
    };
    map.on('moveend', persistView);
    map.on('zoomend', persistView);
  }
  document.getElementById('pl-locate').addEventListener('click', () => {
    if (!map) { toast('地図未初期化'); return; }
    if (!('geolocation' in navigator)) { toast('現在地取得が使えません'); return; }
    navigator.geolocation.getCurrentPosition(
      p => map.setView([p.coords.latitude, p.coords.longitude], 16),
      e => toast('現在地取得失敗: ' + (e?.message || '')),
      { timeout: 6000, enableHighAccuracy: true }
    );
  });

  let allItems = [];
  try {
    const d = await get('/api/places');
    allItems = d.items || [];
  } catch (e) {
    document.getElementById('pl-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  let markers = [];
  const refresh = () => {
    const fLiked   = document.getElementById('pl-f-liked')  .checked;
    const fVisited = document.getElementById('pl-f-visited').checked;
    // v885 新着モードでは地図内フィルタは適用しない (地図が表示されていないので)
    const fBounds  = (typeof viewMode !== 'undefined' && viewMode === 'recent')
                     ? false
                     : document.getElementById('pl-f-bounds').checked;
    const bounds = (fBounds && map) ? map.getBounds() : null;
    const items = allItems.filter(p => {
      if (fLiked   && !p.liked_by_me)   return false;
      if (fVisited && !p.visited_by_me) return false;
      // v734 #343 地図内のみフィルタが ON のとき、 緯度経度未設定の店は除外 (含めると無条件で残ってしまうので)。
      if (bounds) {
        if (p.lat == null || p.lng == null) return false;
        if (!bounds.contains([p.lat, p.lng])) return false;
      }
      return true;
    });
    if (map) {
      // markers はフィルタ前の全件 (lat/lng あり) を出す。 list だけ bounds で絞る。
      markers.forEach(m => map.removeLayer(m));
      markers = [];
      const mItems = allItems.filter(p => {
        if (fLiked   && !p.liked_by_me)   return false;
        if (fVisited && !p.visited_by_me) return false;
        return true;
      });
      for (const p of mItems) {
        if (p.lat == null || p.lng == null) continue;
        // v732 #341 写真があればサムネを divIcon マーカーに (v535 で旧 renderPlacesMap が持っていた挙動を復活)
        const imgSrc = p.cover_image_thumb || p.cover_image;
        const popupImg = imgSrc
          ? `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" style="display:block; width:100%; max-height:120px; object-fit:cover; border-radius:6px; margin-bottom:6px">`
          : '';
        const popup = `<div style="min-width:160px; max-width:220px">${popupImg}<a href="#/places/${p.id}" style="color:var(--primary)"><b>${escapeHtml(p.title)}</b></a></div>`;
        let marker;
        if (imgSrc) {
          const icon = L.divIcon({
            className: 'pl-img-marker',
            html: `<div style="width:42px; height:42px; border-radius:8px; overflow:hidden; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.4); background:#fff"><img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" style="width:100%; height:100%; object-fit:cover"></div>`,
            iconSize: [42, 42],
            iconAnchor: [21, 21],
          });
          marker = L.marker([p.lat, p.lng], { icon }).bindPopup(popup).addTo(map);
        } else {
          marker = L.marker([p.lat, p.lng]).bindPopup(popup).addTo(map);
        }
        markers.push(marker);
      }
    }
    const countEl = document.getElementById('pl-count');
    if (countEl) countEl.textContent = `${items.length} 件`;
    if (!items.length) {
      document.getElementById('pl-list').innerHTML = '<div class="empty">該当するお店はありません</div>';
      return;
    }
    // v730 #339 ハート / 足跡の前に 「・」 は入れない (絵文字だけで区別つく)。
    // v848 #432 ❤ / 👣 をタイル内でもタップでトグルできるボタンに。
    const placeBadgesHtml = (p) => `
      <button type="button" class="pl-tile-like" data-pl-like-id="${p.id}" data-on="${p.liked_by_me ? '1' : '0'}"
              onclick="event.preventDefault(); event.stopPropagation();"
              style="background:rgba(0,0,0,0.45); color:#fff; border:none; border-radius:10px; padding:1px 7px; font-size:11px; cursor:pointer; line-height:1.4">
        ${p.liked_by_me ? '❤️' : '🤍'}<span class="n">${p.like_count || 0}</span>
      </button>
      <button type="button" class="pl-tile-visit" data-pl-visit-id="${p.id}" data-on="${p.visited_by_me ? '1' : '0'}"
              onclick="event.preventDefault(); event.stopPropagation();"
              style="background:rgba(0,0,0,0.45); color:#fff; border:none; border-radius:10px; padding:1px 7px; font-size:11px; cursor:pointer; line-height:1.4; margin-left:4px">
        ${p.visited_by_me ? '👣' : '🐾'}<span class="n">${p.visit_count || 0}</span>
      </button>`;
    document.getElementById('pl-list').innerHTML = `<div class="tile-grid">${items.map(p => {
      const cat = p.category ? (CAT_LBL[p.category] || p.category) : '';
      const rating = p.avg_rating !== null
        ? `⭐${p.avg_rating.toFixed(1)} (${p.comment_count})`
        : `💬${p.comment_count}`;
      const tileBg = p.cover_image_thumb || p.cover_image;
      if (tileBg) {
        return `
          <a class="tile" href="#/places/${p.id}" style="background-image:url('${escapeHtml(tileBg)}')">
            <div class="tile-overlay">
              <div class="name">${escapeHtml(p.title)}</div>
              <div style="font-size:11px; opacity:0.9; margin-top:2px">${escapeHtml(cat)} · ${rating}</div>
              <div style="margin-top:4px">${placeBadgesHtml(p)}</div>
            </div>
          </a>`;
      }
      return `
        <a class="tile tile-noimg" href="#/places/${p.id}">
          <span style="position:absolute; top:50%; left:50%; transform:translate(-50%,-65%); font-size:42px">🍴</span>
          <div class="tile-overlay">
            <div class="name">${escapeHtml(p.title)}</div>
            <div style="font-size:11px; opacity:0.9; margin-top:2px">${escapeHtml(cat)} · ${rating}</div>
            <div style="margin-top:4px">${placeBadgesHtml(p)}</div>
          </div>
        </a>`;
    }).join('')}</div>`;
    // v848 #432 タイル内 ❤ / 👣 ボタンの wire。 トグル成功でその場で表示更新。
    document.getElementById('pl-list').querySelectorAll('.pl-tile-like').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const id = btn.dataset.plLikeId;
        const on = btn.dataset.on === '1';
        btn.disabled = true;
        try {
          const r = on ? await del(`/api/places/${id}/like`) : await post(`/api/places/${id}/like`, {});
          const newOn = !!r.liked_by_me;
          btn.dataset.on = newOn ? '1' : '0';
          btn.firstChild.nodeValue = newOn ? '❤️' : '🤍';
          btn.querySelector('.n').textContent = r.like_count;
        } catch (e) { toast('失敗: ' + e.message); }
        finally { btn.disabled = false; }
      });
    });
    document.getElementById('pl-list').querySelectorAll('.pl-tile-visit').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const id = btn.dataset.plVisitId;
        const on = btn.dataset.on === '1';
        btn.disabled = true;
        try {
          const r = on ? await del(`/api/places/${id}/visit`) : await post(`/api/places/${id}/visit`, {});
          const newOn = !!r.visited_by_me;
          btn.dataset.on = newOn ? '1' : '0';
          btn.firstChild.nodeValue = newOn ? '👣' : '🐾';
          btn.querySelector('.n').textContent = r.visit_count;
        } catch (e) { toast('失敗: ' + e.message); }
        finally { btn.disabled = false; }
      });
    });
  };

  document.getElementById('pl-f-liked')  .addEventListener('change', refresh);
  document.getElementById('pl-f-visited').addEventListener('change', refresh);
  document.getElementById('pl-f-bounds') .addEventListener('change', refresh);
  // v730 #338 地図移動でリスト再フィルタ (デフォルト「地図内のみ」 ON)
  if (map) map.on('moveend', refresh);

  // v885 ビューモード切替 (🗺 地図 / 🆕 新着)
  let viewMode = initialView;
  const applyViewMode = (next) => {
    viewMode = next;
    try { localStorage.setItem(VIEW_KEY, next); } catch (_) {}
    const shell = document.getElementById('pl-shell');
    if (shell) { shell.classList.toggle('is-map', next === 'map'); shell.classList.toggle('is-recent', next === 'recent'); }
    const setBtn = (id, on) => {
      const b = document.getElementById(id); if (!b) return;
      b.style.background = on ? 'var(--primary)' : '#fff';
      b.style.color      = on ? '#fff'           : 'var(--primary)';
    };
    setBtn('pl-mode-map',    next === 'map');
    setBtn('pl-mode-recent', next === 'recent');
    // 新着モードでは「地図内のみ」フィルタは無意味なので隠す
    const blbl = document.getElementById('pl-f-bounds-lbl');
    if (blbl) blbl.style.display = next === 'recent' ? 'none' : '';
    // 地図表示中になったら invalidateSize で leaflet レイアウト再計算 (PC split で初出時にずれる対策)
    if (next === 'map' && map) setTimeout(() => map.invalidateSize(), 50);
    refresh();
  };
  document.getElementById('pl-mode-map')   ?.addEventListener('click', () => applyViewMode('map'));
  document.getElementById('pl-mode-recent')?.addEventListener('click', () => applyViewMode('recent'));
  // 初期状態が recent なら 「地図内のみ」 ラベルも隠す
  if (initialView === 'recent') {
    const blbl = document.getElementById('pl-f-bounds-lbl');
    if (blbl) blbl.style.display = 'none';
  }
  // v845 #428 admin 用 「🔗 tabelog 自動補完」 ボタンとハンドラを撤去。
  //   バックエンドの /api/places/backfill_tabelog_urls は残しているので、 必要なら手動で叩ける。
  refresh();
}

// v471 地図ビュー: 全 places を Leaflet にプロット + 表示中エリア + カテゴリで
// 一覧を絞り込み。 group_map.js と同じ思想で 「map.getBounds().contains(...)」
// をベースにしたリアクティブフィルタ。
export async function renderPlacesMap() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card" style="padding:6px 10px; margin:0">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <a href="#/places" class="btn" style="padding:2px 10px; font-size:12px; flex-shrink:0">← 一覧</a>
        <select id="pm-cat" style="font-size:12px; flex:0 0 auto">
          ${CATEGORIES.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('')}
        </select>
        <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px; flex:0 0 auto">
          <input type="checkbox" id="pm-bounds-only" checked> 表示中エリアのみ
        </label>
        <span id="pm-count" class="hint-sm" style="margin-left:auto; font-size:11px"></span>
      </div>
    </div>
    <div class="card" style="padding:0; overflow:hidden; margin:6px 0">
      <div id="pm-map" style="height:55vh; min-height:340px; width:100%; background:#eef"></div>
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
  // v721 #317 前回の表示位置 / ズームを localStorage から復元。
  const MAP_VIEW_KEY = 'labpay.places.mapView';
  let savedView = null;
  try {
    const raw = localStorage.getItem(MAP_VIEW_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v?.lat === 'number' && typeof v?.lng === 'number' && typeof v?.zoom === 'number') {
        savedView = v;
      }
    }
  } catch (_) {}
  const map = L.map(mapBox, { zoomControl: true })
    .setView(savedView ? [savedView.lat, savedView.lng] : [35.7, 139.66],
             savedView ? savedView.zoom : 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19,
  }).addTo(map);
  const persistView = () => {
    try {
      const c = map.getCenter();
      localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
    } catch (_) {}
  };
  map.on('moveend', persistView);
  map.on('zoomend', persistView);

  let items = [];
  try {
    const d = await get('/api/places');
    items = (d.items || []).filter(p => p.lat !== null && p.lng !== null);
  } catch (e) {
    document.getElementById('pm-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  // マーカー (全 places。 表示状態は後述フィルタで制御)
  const markersByPid = new Map();
  for (const p of items) {
    const ratingTxt = p.avg_rating !== null
      ? `${ratingStars(p.avg_rating)} ${p.avg_rating.toFixed(1)}`
      : '';
    // v535 #194 写真があればサムネをマーカーアイコンに (ポップアップにも上に出す)
    const imgSrc = p.cover_image_thumb || p.cover_image;
    const popupImgBlock = imgSrc
      ? `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" decoding="async" style="display:block; width:100%; max-height:120px; object-fit:cover; border-radius:6px; margin-bottom:6px">`
      : '';
    const popupHtml = `
      <div style="min-width:180px; max-width:220px">
        ${popupImgBlock}
        <div class="bold"><a href="#/places/${p.id}" style="color:var(--primary); text-decoration:none">${escapeHtml(p.title)}</a></div>
        <div class="meta" style="font-size:11px">${escapeHtml(CAT_LBL[p.category] || '')}</div>
        ${ratingTxt ? `<div class="meta" style="font-size:11px">${ratingTxt} (${p.comment_count})</div>` : ''}
      </div>`;
    let marker;
    if (imgSrc) {
      const icon = L.divIcon({
        className: 'pl-img-marker',
        html: `<div style="width:42px; height:42px; border-radius:8px; overflow:hidden; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.4); background:#fff"><img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" decoding="async" style="width:100%; height:100%; object-fit:cover"></div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });
      marker = L.marker([p.lat, p.lng], { icon }).bindPopup(popupHtml).addTo(map);
    } else {
      marker = L.marker([p.lat, p.lng]).bindPopup(popupHtml).addTo(map);
    }
    markersByPid.set(p.id, marker);
  }
  // 全件が入るように auto-fit。 1 件なら適当に zoom-in。
  // v721 #317 前回の view が残っていれば復元したものを優先 (auto-fit しない)。
  if (!savedView) {
    if (items.length === 1) {
      map.setView([items[0].lat, items[0].lng], 16);
    } else if (items.length > 1) {
      map.fitBounds(L.latLngBounds(items.map(p => [p.lat, p.lng])).pad(0.2));
    }
  }

  const renderList = () => {
    const cat = document.getElementById('pm-cat').value;
    const boundsOnly = document.getElementById('pm-bounds-only').checked;
    const bounds = map.getBounds();
    const filtered = items.filter(p => {
      if (cat && p.category !== cat) return false;
      if (boundsOnly && !bounds.contains(L.latLng(p.lat, p.lng))) return false;
      return true;
    });
    // マーカーもフィルタに同期 (カテゴリ不一致は非表示)
    for (const [pid, marker] of markersByPid) {
      const p = items.find(x => x.id === pid);
      const ok = !cat || p.category === cat;
      if (ok) {
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else {
        if (map.hasLayer(marker)) map.removeLayer(marker);
      }
    }
    document.getElementById('pm-count').textContent = `${filtered.length} / ${items.length} 件`;
    const root = document.getElementById('pm-list');
    if (!filtered.length) {
      root.innerHTML = '<div class="empty" style="padding:6px; font-size:12px">該当なし</div>';
      return;
    }
    root.innerHTML = filtered.map(p => {
      const cat2 = p.category ? (CAT_LBL[p.category] || p.category) : '';
      const rating = p.avg_rating !== null ? ` · ${ratingStars(p.avg_rating)} (${p.avg_rating.toFixed(1)})` : '';
      const likeBit = ` · ${p.liked_by_me ? '❤️' : '🤍'}${p.like_count || 0} · ${p.visited_by_me ? '👣' : '🐾'}${p.visit_count || 0}`;
      // v503 #127 マップ一覧でもサムネを使う
      const thumb = p.cover_image_thumb || p.cover_image;
      const img = thumb
        ? `<img src="${escapeHtml(thumb)}" style="width:48px; height:48px; object-fit:cover; border-radius:6px; margin-right:8px; flex:none">`
        : '';
      return `
        <a class="list-item" href="#/places/${p.id}" data-pm-pid="${p.id}" style="align-items:center; padding:6px 4px">
          ${img}
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px">${escapeHtml(p.title)}</div>
            <div class="meta" style="font-size:11px">${escapeHtml(cat2)}${rating} · 💬 ${p.comment_count}${likeBit}</div>
          </div>
        </a>`;
    }).join('');
    // 行をホバー / タップでマーカーを強調 (popup 開く)
    root.querySelectorAll('[data-pm-pid]').forEach(el => {
      el.addEventListener('mouseenter', () => {
        const m = markersByPid.get(Number(el.dataset.pmPid));
        if (m) m.openPopup();
      });
    });
  };
  renderList();
  map.on('moveend', renderList);
  map.on('zoomend', renderList);
  document.getElementById('pm-cat').addEventListener('change', renderList);
  document.getElementById('pm-bounds-only').addEventListener('change', renderList);
}

export async function renderPlaceNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/places" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">📍 お店を登録</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">🔍 キーワードで tabelog を検索 → URL 自動取得</span>
        <div class="row" style="gap:6px">
          <input type="text" id="pln-search-kw" maxlength="200" placeholder="例: 〇〇カフェ新宿" style="flex:1">
          <button id="pln-search-btn" class="btn">検索</button>
        </div>
        <span class="hint-sm" style="font-size:11px" id="pln-search-status">tabelog の検索結果から店舗 URL を取得して下の欄に入れます</span>
      </label>
      <label class="field"><span class="lbl">🔗 URL から自動取得 (tabelog / Retty / hotpepper)</span>
        <div class="row" style="gap:6px">
          <input type="url" id="pln-import-url" placeholder="https://tabelog.com/..." style="flex:1">
          <button id="pln-import-btn" class="btn primary">取得</button>
        </div>
        <span class="hint-sm" style="font-size:11px" id="pln-import-status">店名 / 住所 / 緯度経度を下に自動入力します</span>
      </label>
      <label class="field"><span class="lbl">お店の名前 *</span>
        <input type="text" id="pln-title" maxlength="200" placeholder="例: 〇〇カフェ" autofocus>
      </label>
      <label class="field"><span class="lbl">カテゴリ</span>
        <select id="pln-cat">
          ${CATEGORIES.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span class="lbl">住所 (任意)</span>
        <input type="text" id="pln-addr" maxlength="500" placeholder="例: 東京都新宿区...">
      </label>
      <label class="field"><span class="lbl">緯度 / 経度 (任意 — 地図表示用)</span>
        <div class="row" style="gap:6px">
          <input type="number" id="pln-lat" step="0.000001" placeholder="緯度 (例 35.6586)" style="flex:1">
          <input type="number" id="pln-lng" step="0.000001" placeholder="経度 (例 139.7454)" style="flex:1">
        </div>
        <span class="hint-sm" style="font-size:11px">Google Maps で右クリック → 座標コピーで取得できます</span>
      </label>
      <label class="field"><span class="lbl">📞 電話番号 (任意)</span>
        <input type="tel" id="pln-phone" maxlength="50" placeholder="例: 03-1234-5678">
      </label>
      <label class="field"><span class="lbl">🕐 営業時間 (任意)</span>
        <textarea id="pln-hours" maxlength="2000" rows="3" placeholder="例: 平日 11:00-22:00 / 土日 11:00-23:00 / 火曜定休"></textarea>
      </label>
      <label class="field"><span class="lbl">紹介文 / なぜ行きたいか (任意)</span>
        <textarea id="pln-desc" maxlength="4000" rows="4" placeholder="例: 〇〇さんのおすすめ。 □□が美味しいらしい"></textarea>
      </label>
      <!-- v722 #318 元 URL (tabelog / Retty 等) を保存する隠し input -->
      <input type="hidden" id="pln-source-url">
      <label class="field"><span class="lbl">📷 メイン写真 (任意)</span>
        <div class="row" style="gap:6px; align-items:center">
          <input type="file" id="pln-img" accept="image/*" style="flex:1">
          <span class="hint-sm" id="pln-img-status"></span>
        </div>
        <span class="hint-sm" style="font-size:11px">タイル / 地図で背景画像になります。 未設定なら最新レビュー画像が代替で使われます。</span>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/places" class="btn">キャンセル</a>
        <button id="pln-save" class="primary">＋ 登録</button>
      </div>
    </div>
  `;
  // v478 メイン写真アップロード
  let plnImageUrl = null;
  const plnImgInput = document.getElementById('pln-img');
  const plnImgStatus = document.getElementById('pln-img-status');
  plnImgInput?.addEventListener('change', async () => {
    const f = plnImgInput.files[0];
    if (!f) { plnImageUrl = null; plnImgStatus.textContent = ''; return; }
    plnImgStatus.textContent = '送信中…';
    const fd = new FormData();
    fd.append('file', f);
    try {
      const resp = await fetch('/api/uploads/image', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      plnImageUrl = j.url || j.path;
      plnImgStatus.innerHTML = `<span style="color:#0e7c63">✓ アップロード完了</span>`;
    } catch (e) { plnImgStatus.textContent = '失敗: ' + (e?.message || e); }
  });
  // v719 #315 キーワード → tabelog 検索 → URL 自動入力 + import_url 自動実行
  const searchBtn = document.getElementById('pln-search-btn');
  const searchInput = document.getElementById('pln-search-kw');
  const searchStatus = document.getElementById('pln-search-status');
  const doSearch = async () => {
    const q = searchInput.value.trim();
    if (!q) { toast('キーワードを入れてください'); return; }
    searchBtn.disabled = true;
    searchStatus.textContent = 'tabelog 検索中…';
    try {
      const r = await post('/api/places/search_url', { q });
      const url = r.top || (r.candidates && r.candidates[0]);
      if (!url) throw new Error('候補なし');
      document.getElementById('pln-import-url').value = url;
      searchStatus.innerHTML = `<span style="color:#0e7c63">✓ ${url} を取得 → 自動で 「取得」 を実行します</span>`;
      document.getElementById('pln-import-btn').click();
    } catch (e) { searchStatus.innerHTML = `<span style="color:#c00">失敗: ${e?.message || e}</span>`; }
    finally { searchBtn.disabled = false; }
  };
  if (searchBtn) {
    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  }

  // v471 URL から自動取得 (tabelog / Retty / hotpepper)
  // v717 #312 paste 時にも URL 部分のみ残すように即時補正
  const importUrlInput = document.getElementById('pln-import-url');
  if (importUrlInput) {
    importUrlInput.addEventListener('paste', e => {
      setTimeout(() => {
        const v = importUrlInput.value;
        const mm = v.match(/https?:\/\/\S+/);
        if (mm) importUrlInput.value = mm[0].replace(/[\s,;]+$/, '');
      }, 0);
    });
  }
  const importBtn = document.getElementById('pln-import-btn');
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      // v717 #312 ペースト文から URL 部分だけ抽出 (前後の余計な説明文を落とす)。
      let url = document.getElementById('pln-import-url').value.trim();
      const m = url.match(/https?:\/\/\S+/);
      if (m) {
        url = m[0].replace(/[\s,;]+$/, '');
        document.getElementById('pln-import-url').value = url;
      }
      if (!url) { toast('URL を入れてください'); return; }
      const status = document.getElementById('pln-import-status');
      importBtn.disabled = true;
      status.textContent = '取得中…';
      try {
        const r = await post('/api/places/import_url', { url });
        if (r.title)       document.getElementById('pln-title').value = r.title;
        if (r.address)     document.getElementById('pln-addr').value  = r.address;
        if (r.lat != null) document.getElementById('pln-lat').value   = r.lat;
        if (r.lng != null) document.getElementById('pln-lng').value   = r.lng;
        // v722 #318 元 URL を隠し input に保存 (= 詳細でクリック可能リンクに)。
        //   旧版は description に追記していたが、 これで捨てなく済む。
        document.getElementById('pln-source-url').value = r.source_url || url;
        const descEl = document.getElementById('pln-desc');
        if (!descEl.value.trim() && r.description) {
          descEl.value = r.description;
        }
        // v725 #327 電話番号 / 営業時間が取れていれば入れる (空欄なら上書きしない)。
        if (r.phone && !document.getElementById('pln-phone').value.trim()) {
          document.getElementById('pln-phone').value = r.phone;
        }
        if (r.hours && !document.getElementById('pln-hours').value.trim()) {
          document.getElementById('pln-hours').value = r.hours;
        }
        status.innerHTML = `<span style="color:#0e7c63">✓ 取得完了</span>`;
      } catch (e) {
        status.innerHTML = `<span style="color:#c62828">失敗: ${escapeHtml(e.message)}</span>`;
      } finally { importBtn.disabled = false; }
    });
  }

  document.getElementById('pln-save').addEventListener('click', async () => {
    const title = document.getElementById('pln-title').value.trim();
    if (!title) { toast('お店の名前を入れてください'); return; }
    const cat = document.getElementById('pln-cat').value;
    const addr = document.getElementById('pln-addr').value.trim();
    const lat = document.getElementById('pln-lat').value;
    const lng = document.getElementById('pln-lng').value;
    const desc = document.getElementById('pln-desc').value.trim();
    try {
      const r = await post('/api/places', {
        title, category: cat, address: addr,
        lat: lat !== '' ? Number(lat) : null,
        lng: lng !== '' ? Number(lng) : null,
        description: desc,
        source_url: document.getElementById('pln-source-url').value || null,
        phone: document.getElementById('pln-phone').value.trim() || null,
        hours: document.getElementById('pln-hours').value.trim() || null,
        image_url: plnImageUrl || '',
      });
      toast('登録しました');
      navigate('#/places/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderPlaceDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  // v481 #67 カバー画像 (negative margin で上に 12px はみ出る) が 「← 一覧」 ボタン
  //   を被って戻りにくい問題 → 戻りボタンを別カードに分離。
  app.innerHTML = `
    <div class="card" style="padding:6px 10px">
      <a href="#/places" class="hint">← 一覧</a>
    </div>
    <div class="card">
      <div id="pld-head"><div class="muted">読み込み中…</div></div>
    </div>
    <div class="card" id="pld-map-card" hidden>
      <div id="pld-map" style="height:200px; border-radius:6px; overflow:hidden"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">💬 口コミ (<span id="pld-cn">0</span>)</h3>
      <div id="pld-comments" class="list"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">＋ 口コミを書く</h3>
      <div class="row" style="gap:6px; margin-bottom:6px; align-items:center">
        <span class="muted" style="font-size:13px">⭐ 評価:</span>
        <select id="pld-rating" style="font-size:14px">
          <option value="">なし</option>
          <option value="5">⭐⭐⭐⭐⭐ 5</option>
          <option value="4">⭐⭐⭐⭐ 4</option>
          <option value="3">⭐⭐⭐ 3</option>
          <option value="2">⭐⭐ 2</option>
          <option value="1">⭐ 1</option>
        </select>
      </div>
      <textarea id="pld-body" maxlength="4000" rows="3" placeholder="どうだった? 何が美味しい / どう行く"></textarea>
      <div class="row" style="gap:6px; margin-top:6px; align-items:center; flex-wrap:wrap">
        <input type="file" id="pld-img" accept="image/*" multiple>
        <span class="hint-sm" id="pld-img-status"></span>
        <div id="pld-img-thumbs" class="row" style="gap:4px; flex-wrap:wrap; width:100%"></div>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <button id="pld-submit" class="primary">送信</button>
      </div>
    </div>
    <div class="card" id="pld-admin" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="pld-edit" class="btn primary">✏ 編集</button>
        <button id="pld-del" class="danger">このお店を削除</button>
      </div>
      <div id="pld-edit-form" hidden style="margin-top:10px"></div>
    </div>
  `;
  await loadPlace(id);
}

async function loadPlace(id) {
  try {
    const d = await get('/api/places/' + id);
    const p = d.place;
    const cat = p.category ? (CAT_LBL[p.category] || p.category) : '';
    const ratingLine = p.avg_rating !== null
      ? `<div class="meta">${ratingStars(p.avg_rating)} <b>${p.avg_rating.toFixed(1)}</b> (${p.comment_count} 件の口コミ)</div>`
      : `<div class="meta">${p.comment_count} 件の口コミ</div>`;
    // v478 メイン写真があれば上に大きく
    // v512 サムネ優先 (220px 表示で原画像は重い、 サーバが返す image_thumb_url を使う)
    // v745 #356 タップで lightbox (原画像) 表示。 target=_blank だとスマホで「戻れない」 ので。
    // v752 #370 起案者 / admin は拡大 (lightbox) 内で 🔄 ボタンで回転可能。
    // v754 #370 サムネ上のボタンは廃止、 lightbox 内のみに。
    // v753 me をここで先取り (旧版は下の方で const me = ... してたので TDZ エラー)
    const me = state.me;
    const heroSrc = p.image_thumb_url || p.image_url;
    const heroFull = p.image_url || p.image_thumb_url;
    const canEditHero = me && (me.id === p.creator_user_id || me.role === 'admin');
    const heroImg = heroSrc
      ? `<img src="${escapeHtml(heroSrc)}" alt="" loading="lazy" decoding="async" data-zoom-src="${escapeHtml(heroFull)}" data-rot-hero="1" data-can-rot="${canEditHero ? 1 : 0}" style="display:block; width:calc(100% + 20px); max-height:220px; object-fit:cover; margin:-12px -10px 10px; border-radius:8px 8px 0 0; cursor:zoom-in">`
      : '';
    // v486 #80 いいねボタン + v529 #164 行った (足跡) ボタン (2 軸)
    const likeBtn = `
      <button id="pld-like" class="btn"
              data-liked="${p.liked_by_me ? '1' : '0'}"
              style="font-size:13px; padding:4px 12px; ${p.liked_by_me ? 'background:#fee2e2; color:#e11d48; border-color:#e11d48' : ''}">
        ${p.liked_by_me ? '❤️' : '🤍'} <span id="pld-like-n">${p.like_count}</span>
      </button>`;
    const visitBtn = `
      <button id="pld-visit" class="btn"
              data-visited="${p.visited_by_me ? '1' : '0'}"
              title="ここに行った (足跡)"
              style="font-size:13px; padding:4px 12px; ${p.visited_by_me ? 'background:#dcfce7; color:#15803d; border-color:#15803d' : ''}">
        ${p.visited_by_me ? '👣' : '🐾'} <span id="pld-visit-n">${p.visit_count || 0}</span>
      </button>`;
    // v722 #318 source_url (tabelog 等) を表示。
    const srcUrlBlock = p.source_url
      ? `<div class="meta" style="margin-top:4px"><a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener" style="color:var(--primary)">🔗 ${escapeHtml(p.source_url)} ↗</a></div>`
      : '';
    // v725 #327 電話番号 / 営業時間を表示。
    const phoneBlock = p.phone
      ? `<div class="meta" style="margin-top:4px">📞 <a href="tel:${escapeHtml(p.phone)}" style="color:var(--primary)">${escapeHtml(p.phone)}</a></div>`
      : '';
    const hoursBlock = p.hours
      ? `<div class="meta" style="margin-top:4px; white-space:pre-wrap">🕐 ${escapeHtml(p.hours)}</div>`
      : '';
    document.getElementById('pld-head').innerHTML = `
      ${heroImg}
      <h2 style="margin:6px 0 0">${escapeHtml(p.title)}</h2>
      ${cat ? `<div class="meta">${escapeHtml(cat)}</div>` : ''}
      ${p.address ? `<div class="meta">📍 ${escapeHtml(p.address)}</div>` : ''}
      ${phoneBlock}
      ${hoursBlock}
      ${srcUrlBlock}
      ${ratingLine}
      ${p.description ? `<div style="margin-top:8px; font-size:14px">${linkifyText(p.description)}</div>` : ''}
      <div class="meta" style="margin-top:6px">起案 ${escapeHtml(p.creator_name)} · ${escapeHtml(p.created_at || '')}</div>
      <div class="row" style="gap:6px; margin-top:6px; flex-wrap:wrap">${likeBtn}${visitBtn}</div>
    `;
    document.getElementById('pld-like')?.addEventListener('click', async () => {
      const btn = document.getElementById('pld-like');
      const wasLiked = btn.dataset.liked === '1';
      try {
        const r = wasLiked
          ? await del(`/api/places/${id}/like`)
          : await post(`/api/places/${id}/like`, {});
        const nowLiked = !wasLiked;
        btn.dataset.liked = nowLiked ? '1' : '0';
        document.getElementById('pld-like-n').textContent = r.like_count;
        btn.innerHTML = `${nowLiked ? '❤️' : '🤍'} <span id="pld-like-n">${r.like_count}</span>`;
        btn.style.cssText = `font-size:13px; padding:4px 12px; ${nowLiked ? 'background:#fee2e2; color:#e11d48; border-color:#e11d48' : ''}`;
      } catch (e) { toast('失敗: ' + e.message); }
    });
    document.getElementById('pld-visit')?.addEventListener('click', async () => {
      const btn = document.getElementById('pld-visit');
      const wasVisited = btn.dataset.visited === '1';
      try {
        const r = wasVisited
          ? await del(`/api/places/${id}/visit`)
          : await post(`/api/places/${id}/visit`, {});
        const nowVisited = !wasVisited;
        btn.dataset.visited = nowVisited ? '1' : '0';
        document.getElementById('pld-visit-n').textContent = r.visit_count;
        btn.innerHTML = `${nowVisited ? '👣' : '🐾'} <span id="pld-visit-n">${r.visit_count}</span>`;
        btn.style.cssText = `font-size:13px; padding:4px 12px; ${nowVisited ? 'background:#dcfce7; color:#15803d; border-color:#15803d' : ''}`;
      } catch (e) { toast('失敗: ' + e.message); }
    });
    // 地図
    const mapCard = document.getElementById('pld-map-card');
    if (p.lat !== null && p.lng !== null && mapCard) {
      mapCard.hidden = false;
      try {
        const L = await loadLeaflet();
        const mapBox = document.getElementById('pld-map');
        if (mapBox._pldMap) { mapBox._pldMap.remove(); mapBox._pldMap = null; }
        const map = L.map(mapBox, { zoomControl: true }).setView([p.lat, p.lng], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap', maxZoom: 19,
        }).addTo(map);
        L.marker([p.lat, p.lng]).addTo(map).bindPopup(escapeHtml(p.title));
        mapBox._pldMap = map;
      } catch (_) {}
    }
    // 口コミ
    document.getElementById('pld-cn').textContent = (d.comments || []).length;
    // v753 me は上ですでに宣言済み (canEditHero 用に先取りした)
    document.getElementById('pld-comments').innerHTML = (d.comments || []).map(c => {
      const canDel = (me && (me.id === c.user_id || me.role === 'admin'));
      const star = c.rating !== null ? `<span class="bold">${ratingStars(c.rating)}</span> ` : '';
      return `
        <div class="list-item" style="align-items:flex-start; gap:8px">
          ${avatarHtml(c.display_name, c.avatar_url, 'sm')}
          <div class="grow" style="min-width:0">
            <div class="bold">${escapeHtml(c.display_name)} <span class="hint">${escapeHtml(c.created_at || '')}</span></div>
            ${star ? `<div>${star}</div>` : ''}
            ${c.body ? `<div style="font-size:14px">${linkifyText(c.body)}</div>` : ''}
            ${(c.image_urls && c.image_urls.length) || c.image_url
                ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px">${
                    ((c.image_urls && c.image_urls.length) ? c.image_urls : [c.image_url])
                      .map((u, idx) => `<img src="${escapeHtml(u)}" data-zoom-src="${escapeHtml(u)}" data-rot-comment="${c.id}" data-rot-idx="${idx}" data-can-rot="${canDel ? 1 : 0}" loading="lazy" style="width:120px; height:120px; object-fit:cover; border-radius:6px; cursor:zoom-in; background:#f3f4f6">`).join('')
                  }</div>`
                : ''}
            ${canDel ? `<button class="btn" data-del-cm="${c.id}" style="font-size:11px; padding:2px 6px; margin-top:4px">削除</button>` : ''}
          </div>
        </div>`;
    }).join('') || '<div class="empty">まだ口コミなし</div>';
    // v745 #356 data-zoom-src を持つ画像をタップしたら lightbox で全画面表示。
    //   旧版は target=_blank で新タブに開いていたのでスマホで 「戻れない」 状態だった。
    // v754 #370 画像タップで lightbox。 起案者 / 投稿者 / admin なら lightbox 内の
    //   「🔄 回転」 ボタンで 90° 回転 (server で上書き保存) → cache-bust で再ロード。
    document.querySelectorAll('[data-zoom-src]').forEach(el => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const canRot = el.dataset.canRot === '1';
        const opts = {};
        if (canRot) {
          // v856 #440 lightbox 内で回転が成功したら 「回転した」 フラグを立てて、 lightbox を閉じた後に
          //   loadPlace(id) で全画像を再ロード (= サムネ + 一覧 + 詳細すべて反映)。
          let rotated = false;
          if (el.dataset.rotHero === '1') {
            opts.onRotate = async (degrees) => { await post(`/api/places/${id}/rotate-image`, { degrees }); rotated = true; };
          } else if (el.dataset.rotComment) {
            const cid = el.dataset.rotComment;
            const idx = Number(el.dataset.rotIdx || 0);
            opts.onRotate = async (degrees) => { await post(`/api/places/${id}/comments/${cid}/rotate-image`, { index: idx, degrees }); rotated = true; };
          }
          opts.onClose = async () => {
            if (!rotated) return;
            try {
              await loadPlace(id);
              // v856 #440 ブラウザは同じ URL の画像をキャッシュするので、 サムネや詳細の画像が
              //   再ロードされない。 描画後に /uploads/ を含む img と background-image に
              //   ?_t=NOW を付けて強制再フェッチ。
              const stamp = Date.now();
              const root = document.getElementById('app');
              if (!root) return;
              root.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src') || '';
                if (!src.includes('/uploads/')) return;
                const base = src.split('#')[0].replace(/[?&]_t=\d+/g, '').replace(/[?&]$/, '');
                img.src = base + (base.includes('?') ? '&' : '?') + '_t=' + stamp;
              });
              root.querySelectorAll('[style*="background-image"]').forEach(el => {
                const style = el.getAttribute('style') || '';
                const m = style.match(/url\((['"]?)([^'")]*\/uploads\/[^'")]+)\1\)/);
                if (!m) return;
                const orig = m[2];
                const base = orig.split('#')[0].replace(/[?&]_t=\d+/g, '').replace(/[?&]$/, '');
                const newUrl = base + (base.includes('?') ? '&' : '?') + '_t=' + stamp;
                el.setAttribute('style', style.replace(orig, newUrl));
              });
            } catch (_) {}
          };
        }
        openImageLightbox(el.dataset.zoomSrc, opts);
      });
    });
    document.querySelectorAll('[data-del-cm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この口コミを削除しますか?')) return;
        try { await del(`/api/places/${id}/comments/${b.dataset.delCm}`); toast('削除しました'); await loadPlace(id); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
    // 編集 / 削除 (起案者 or admin)
    if (me && (me.id === p.creator_user_id || me.role === 'admin')) {
      const admin = document.getElementById('pld-admin');
      admin.hidden = false;
      document.getElementById('pld-del').onclick = async () => {
        if (!confirm('このお店を削除しますか? (口コミも全部消えます)')) return;
        try { await del('/api/places/' + id); navigate('#/places'); }
        catch (e) { toast('失敗: ' + e.message); }
      };
      // v472 ✏ 編集 — title / category / address / lat / lng / description を部分更新
      document.getElementById('pld-edit').onclick = () => {
        const form = document.getElementById('pld-edit-form');
        if (!form.hidden) { form.hidden = true; return; }
        form.hidden = false;
        form.innerHTML = `
          <label class="field"><span class="lbl">お店の名前</span>
            <input type="text" id="pld-edit-title" maxlength="200" value="${escapeHtml(p.title || '')}">
          </label>
          <label class="field"><span class="lbl">カテゴリ</span>
            <select id="pld-edit-cat">
              ${CATEGORIES.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === (p.category || '') ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span class="lbl">住所</span>
            <input type="text" id="pld-edit-addr" maxlength="500" value="${escapeHtml(p.address || '')}">
          </label>
          <label class="field"><span class="lbl">緯度 / 経度</span>
            <div class="row" style="gap:6px">
              <input type="number" id="pld-edit-lat" step="0.000001" value="${p.lat !== null ? p.lat : ''}" placeholder="緯度" style="flex:1">
              <input type="number" id="pld-edit-lng" step="0.000001" value="${p.lng !== null ? p.lng : ''}" placeholder="経度" style="flex:1">
            </div>
          </label>
          <label class="field"><span class="lbl">📞 電話番号 (任意)</span>
            <input type="tel" id="pld-edit-phone" maxlength="50" value="${escapeHtml(p.phone || '')}" placeholder="例: 03-1234-5678">
          </label>
          <label class="field"><span class="lbl">🕐 営業時間 (任意)</span>
            <textarea id="pld-edit-hours" maxlength="2000" rows="3" placeholder="例: 平日 11:00-22:00 / 火曜定休">${escapeHtml(p.hours || '')}</textarea>
          </label>
          <label class="field"><span class="lbl">紹介文 / メモ</span>
            <textarea id="pld-edit-desc" maxlength="4000" rows="5">${escapeHtml(p.description || '')}</textarea>
          </label>
          <div class="row" style="gap:6px; justify-content:flex-end; margin-top:6px">
            <button id="pld-edit-cancel" class="btn">キャンセル</button>
            <button id="pld-edit-save" class="primary">保存</button>
          </div>`;
        document.getElementById('pld-edit-cancel').onclick = () => { form.hidden = true; };
        document.getElementById('pld-edit-save').onclick = async () => {
          const lat = document.getElementById('pld-edit-lat').value;
          const lng = document.getElementById('pld-edit-lng').value;
          try {
            await patch(`/api/places/${id}`, {
              title:       document.getElementById('pld-edit-title').value.trim(),
              category:    document.getElementById('pld-edit-cat').value,
              address:     document.getElementById('pld-edit-addr').value.trim(),
              description: document.getElementById('pld-edit-desc').value.trim(),
              phone:       document.getElementById('pld-edit-phone').value.trim(),
              hours:       document.getElementById('pld-edit-hours').value.trim(),
              lat: lat !== '' ? Number(lat) : null,
              lng: lng !== '' ? Number(lng) : null,
            });
            toast('保存しました');
            await loadPlace(id);
          } catch (e) { toast('失敗: ' + e.message); }
        };
      };
    }
    // v716 #311 複数画像 upload。 input は multiple、 選んだら並列で全部上げて URL を蓄積。
    let pldImageUrls = [];
    const imgInput = document.getElementById('pld-img');
    const imgStatus = document.getElementById('pld-img-status');
    const imgThumbs = document.getElementById('pld-img-thumbs');
    const renderThumbs = () => {
      imgThumbs.innerHTML = pldImageUrls.map((u, i) => `
        <span style="position:relative; display:inline-block">
          <img src="${escapeHtml(u)}" style="width:50px; height:50px; object-fit:cover; border-radius:4px; border:1px solid #ccc">
          <button type="button" data-rm-img="${i}" style="position:absolute; top:-4px; right:-4px; width:18px; height:18px; padding:0; border-radius:50%; background:#dc2626; color:#fff; border:none; font-size:10px; line-height:1; cursor:pointer">×</button>
        </span>`).join('');
      imgThumbs.querySelectorAll('[data-rm-img]').forEach(btn => {
        btn.addEventListener('click', () => {
          pldImageUrls.splice(Number(btn.dataset.rmImg), 1);
          renderThumbs();
        });
      });
    };
    imgInput.addEventListener('change', async () => {
      const files = Array.from(imgInput.files || []);
      if (!files.length) return;
      imgStatus.textContent = `アップロード中… (0/${files.length})`;
      let done = 0, fails = 0;
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        try {
          const resp = await fetch('/api/uploads/image', {
            method: 'POST', body: fd, credentials: 'same-origin',
            headers: { 'X-Requested-With': 'labpay' },
          });
          const j = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
            throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
          }
          const u = j.url || j.path;
          if (u) pldImageUrls.push(u);
          done++;
        } catch (e) { fails++; console.warn('upload failed', e); }
        imgStatus.textContent = `アップロード中… (${done}/${files.length})`;
      }
      imgStatus.innerHTML = fails
        ? `<span style="color:#c00">${done}/${files.length} 件成功・ ${fails} 件失敗</span>`
        : `<span style="color:#0e7c63">✓ ${done} 件完了</span>`;
      renderThumbs();
      imgInput.value = '';
    });
    // 投稿
    document.getElementById('pld-submit').onclick = async () => {
      const body = document.getElementById('pld-body').value.trim();
      const ratingRaw = document.getElementById('pld-rating').value;
      const rating = ratingRaw !== '' ? Number(ratingRaw) : null;
      if (!body && !pldImageUrls.length && rating === null) {
        toast('本文 / 画像 / 評価のどれかは入れてください'); return;
      }
      try {
        await post(`/api/places/${id}/comments`, { body, image_urls: pldImageUrls, rating });
        toast('投稿しました');
        document.getElementById('pld-body').value = '';
        document.getElementById('pld-rating').value = '';
        imgInput.value = '';
        pldImageUrls = [];
        imgStatus.textContent = '';
        renderThumbs();
        await loadPlace(id);
      } catch (e) { toast('失敗: ' + e.message); }
    };
  } catch (e) {
    document.getElementById('pld-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
