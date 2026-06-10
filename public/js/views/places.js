// /#/places — 行きたい店 / 行ったお店 共有 (食べログ的)。
// 一覧 → 詳細 → 口コミ投稿 + 削除。 lat/lng があれば Leaflet で 地図表示。
// 画像 は /api/uploads/image で 先 に 上げ、 返り の URL を image_url に。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { loadLeaflet } from './group_map.js';

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

// v471 本文 内 の URL を クリック 可能 リンク に。 改行 も <br> に。
function linkifyText(s) {
  let h = escapeHtml(s || '');
  h = h.replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--primary); word-break:break-all">$1</a>');
  return h.replace(/\n/g, '<br>');
}

// v502 #119 Google Maps の保存リスト (KML / GeoJSON) を取り込み、 既存と重複しない
//   場所だけを /api/places に登録。 大量の Placemark でもひとつずつ POST する
//   (await 直列) ので 連投 race / ledger 競合を避けやすい。
//
// 重複判定: タイトル (大小無視, 前後空白除去) が同じ + 緯度経度 50m 以内なら同じ場所
//   とみなす。 50m は屋台が並んでる横丁などで誤判定が出ないバランス値。
async function onGmapImport(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (!f) return;
  const text = await f.text();
  let parsed;
  try {
    parsed = f.name.toLowerCase().endsWith('.kml') ? parseKml(text) : parseGeoJson(text);
  } catch (e) {
    toast('読み取り失敗: ' + (e?.message || e));
    return;
  }
  if (!parsed.length) { toast('リストに場所が見つかりませんでした'); return; }
  // 既存リストを 1 度取得して 重複チェック
  let existing = [];
  try { const r = await get('/api/places'); existing = r.items || []; } catch (_) {}
  const isDup = (p) => existing.some(e => {
    if (!e.title || !p.title) return false;
    if (e.title.trim().toLowerCase() !== p.title.trim().toLowerCase()) return false;
    if (e.lat == null || e.lng == null || p.lat == null || p.lng == null) return true; // 名前一致のみで重複扱い
    return haversineMeters(e.lat, e.lng, p.lat, p.lng) < 50;
  });
  const toImport = parsed.filter(p => !isDup(p));
  const dups = parsed.length - toImport.length;
  if (!toImport.length) {
    toast(`全 ${parsed.length} 件は既に登録済みでした`);
    return;
  }
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
  // リストを再描画
  renderPlaces();
}

function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const placemarks = doc.getElementsByTagName('Placemark');
  const out = [];
  for (const pm of placemarks) {
    const name = pm.getElementsByTagName('name')[0]?.textContent?.trim() || '';
    if (!name) continue;
    const desc = pm.getElementsByTagName('description')[0]?.textContent?.trim() || '';
    const addr = pm.getElementsByTagName('address')[0]?.textContent?.trim() || '';
    const coords = pm.getElementsByTagName('coordinates')[0]?.textContent?.trim() || '';
    let lat = null, lng = null;
    if (coords) {
      const parts = coords.split(',').map(s => Number(s.trim()));
      if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) {
        // KML は lng, lat, [alt]
        lng = parts[0]; lat = parts[1];
      }
    }
    out.push({ title: name, description: desc, address: addr, lat, lng });
  }
  return out;
}

function parseGeoJson(text) {
  const j = JSON.parse(text);
  const features = j.type === 'FeatureCollection' ? (j.features || [])
                  : j.type === 'Feature' ? [j] : [];
  const out = [];
  for (const f of features) {
    const p = f.properties || {};
    const name = (p.name || p.Title || p.title || '').toString().trim();
    if (!name) continue;
    const desc = (p.description || p.Description || '').toString().trim();
    const addr = (p.address || p.Address || '').toString().trim();
    let lat = null, lng = null;
    if (f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
      lng = Number(f.geometry.coordinates[0]);
      lat = Number(f.geometry.coordinates[1]);
      if (!isFinite(lat) || !isFinite(lng)) { lat = null; lng = null; }
    }
    out.push({ title: name, description: desc, address: addr, lat, lng });
  }
  return out;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function renderPlaces() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">🍴 食べある記</h2>
        <span style="flex:1"></span>
        <a class="btn" href="#/places/map">🗺 地図</a>
        <button class="btn" id="pl-gmap-import">📥 Google Map</button>
        <a class="btn primary" href="#/places/new">＋ 新規</a>
      </div>
      <p class="card-subtitle" style="margin:6px 0 0">
        ラボメンバー の グルメ 共有 帳。 口コミ・写真・⭐評価 を 添えて 投稿可。
      </p>
      <input type="file" id="pl-gmap-file" accept=".kml,.json,.geojson,.kmz" hidden>
    </div>
    <div id="pl-list"><div class="muted">読み込み中…</div></div>
  `;
  // v502 #119 Google Maps エクスポート (KML / GeoJSON) を読み込んで重複しないものを
  //   一括登録。 重複判定は (title 大小無視) + 緯度経度 50m 以内。
  document.getElementById('pl-gmap-import')?.addEventListener('click', () => {
    document.getElementById('pl-gmap-file').click();
  });
  document.getElementById('pl-gmap-file')?.addEventListener('change', (ev) => onGmapImport(ev));
  try {
    const d = await get('/api/places');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('pl-list').innerHTML = '<div class="empty">まだ お店は ありません</div>';
      return;
    }
    // v471 タイル状 (購入ページ と 同じ .tile-grid / .tile を 流用)。
    // v486 #80 タイル に いいね 表示 (押せる ようには せず、 数 のみ。 詳細 画面 で 押す)。
    document.getElementById('pl-list').innerHTML = `<div class="tile-grid">${items.map(p => {
      const cat = p.category ? (CAT_LBL[p.category] || p.category) : '';
      const rating = p.avg_rating !== null
        ? `⭐${p.avg_rating.toFixed(1)} (${p.comment_count})`
        : `💬${p.comment_count}`;
      // v487 #82 いいね は 0 件 でも 常時 表示 (押せる 場所 を 認識 して もらう)。
      const likeBadge = ` · ${p.liked_by_me ? '❤️' : '🤍'}${p.like_count || 0}`;
      if (p.cover_image) {
        return `
          <a class="tile" href="#/places/${p.id}" style="background-image:url('${escapeHtml(p.cover_image)}')">
            <div class="tile-overlay">
              <div class="name">${escapeHtml(p.title)}</div>
              <div style="font-size:11px; opacity:0.9">${escapeHtml(cat)} · ${rating}${likeBadge}</div>
            </div>
          </a>`;
      }
      const initial = (p.title || '?').trim().charAt(0);
      return `
        <a class="tile tile-noimg" href="#/places/${p.id}">
          <span style="position:absolute; top:50%; left:50%; transform:translate(-50%,-65%); font-size:42px">🍴</span>
          <div class="tile-overlay">
            <div class="name">${escapeHtml(p.title)}</div>
            <div style="font-size:11px; opacity:0.9">${escapeHtml(cat)} · ${rating}${likeBadge}</div>
          </div>
        </a>`;
    }).join('')}</div>`;
  } catch (e) {
    document.getElementById('pl-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// v471 地図 ビュー: 全 places を Leaflet に プロット + 表示中エリア + カテゴリ で
// 一覧 を 絞り込み。 group_map.js と 同じ 思想 で 「map.getBounds().contains(...)」
// を ベース に した リアクティブ フィルタ。
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
  const map = L.map(mapBox, { zoomControl: true }).setView([35.7, 139.66], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19,
  }).addTo(map);

  let items = [];
  try {
    const d = await get('/api/places');
    items = (d.items || []).filter(p => p.lat !== null && p.lng !== null);
  } catch (e) {
    document.getElementById('pm-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  // マーカー (全 places。 表示状態 は 後述 フィルタ で 制御)
  const markersByPid = new Map();
  for (const p of items) {
    const ratingTxt = p.avg_rating !== null
      ? `${ratingStars(p.avg_rating)} ${p.avg_rating.toFixed(1)}`
      : '';
    const popupHtml = `
      <div style="min-width:160px">
        <div class="bold"><a href="#/places/${p.id}" style="color:var(--primary); text-decoration:none">${escapeHtml(p.title)}</a></div>
        <div class="meta" style="font-size:11px">${escapeHtml(CAT_LBL[p.category] || '')}</div>
        ${ratingTxt ? `<div class="meta" style="font-size:11px">${ratingTxt} (${p.comment_count})</div>` : ''}
      </div>`;
    const marker = L.marker([p.lat, p.lng]).bindPopup(popupHtml).addTo(map);
    markersByPid.set(p.id, marker);
  }
  // 全件 が 入る ように auto-fit。 1 件 なら 適当に zoom-in。
  if (items.length === 1) {
    map.setView([items[0].lat, items[0].lng], 16);
  } else if (items.length > 1) {
    map.fitBounds(L.latLngBounds(items.map(p => [p.lat, p.lng])).pad(0.2));
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
    // マーカー も フィルタ に 同期 (カテゴリ 不一致 は 非表示)
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
      root.innerHTML = '<div class="empty" style="padding:6px; font-size:12px">該当 なし</div>';
      return;
    }
    root.innerHTML = filtered.map(p => {
      const cat2 = p.category ? (CAT_LBL[p.category] || p.category) : '';
      const rating = p.avg_rating !== null ? ` · ${ratingStars(p.avg_rating)} (${p.avg_rating.toFixed(1)})` : '';
      const likeBit = ` · ${p.liked_by_me ? '❤️' : '🤍'}${p.like_count || 0}`;
      const img = p.cover_image
        ? `<img src="${escapeHtml(p.cover_image)}" style="width:48px; height:48px; object-fit:cover; border-radius:6px; margin-right:8px; flex:none">`
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
    // 行 をホバー / タップ で マーカー を 強調 (popup 開く)
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
      <h2 style="margin:6px 0 0">📍 お店 を 登録</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">🔗 URL から 自動取得 (tabelog / Retty / hotpepper)</span>
        <div class="row" style="gap:6px">
          <input type="url" id="pln-import-url" placeholder="https://tabelog.com/..." style="flex:1">
          <button id="pln-import-btn" class="btn primary">取得</button>
        </div>
        <span class="hint-sm" style="font-size:11px" id="pln-import-status">店名 / 住所 / 緯度経度 を 下に 自動入力します</span>
      </label>
      <label class="field"><span class="lbl">お店の 名前 *</span>
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
      <label class="field"><span class="lbl">緯度 / 経度 (任意 — 地図表示 用)</span>
        <div class="row" style="gap:6px">
          <input type="number" id="pln-lat" step="0.000001" placeholder="緯度 (例 35.6586)" style="flex:1">
          <input type="number" id="pln-lng" step="0.000001" placeholder="経度 (例 139.7454)" style="flex:1">
        </div>
        <span class="hint-sm" style="font-size:11px">Google Maps で 右クリック → 座標 コピー で 取得 でき ます</span>
      </label>
      <label class="field"><span class="lbl">紹介文 / なぜ 行きたい か (任意)</span>
        <textarea id="pln-desc" maxlength="4000" rows="4" placeholder="例: 〇〇さん の おすすめ。 □□が 美味しい らしい"></textarea>
      </label>
      <label class="field"><span class="lbl">📷 メイン 写真 (任意)</span>
        <div class="row" style="gap:6px; align-items:center">
          <input type="file" id="pln-img" accept="image/*" style="flex:1">
          <span class="hint-sm" id="pln-img-status"></span>
        </div>
        <span class="hint-sm" style="font-size:11px">タイル / 地図 で 背景画像 に なります。 未設定 なら 最新 レビュー 画像 が 代替で 使われます。</span>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/places" class="btn">キャンセル</a>
        <button id="pln-save" class="primary">＋ 登録</button>
      </div>
    </div>
  `;
  // v478 メイン写真 アップロード
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
  // v471 URL から 自動 取得 (tabelog / Retty / hotpepper)
  const importBtn = document.getElementById('pln-import-btn');
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      const url = document.getElementById('pln-import-url').value.trim();
      if (!url) { toast('URL を 入れて ください'); return; }
      const status = document.getElementById('pln-import-status');
      importBtn.disabled = true;
      status.textContent = '取得中…';
      try {
        const r = await post('/api/places/import_url', { url });
        if (r.title)       document.getElementById('pln-title').value = r.title;
        if (r.address)     document.getElementById('pln-addr').value  = r.address;
        if (r.lat != null) document.getElementById('pln-lat').value   = r.lat;
        if (r.lng != null) document.getElementById('pln-lng').value   = r.lng;
        // 紹介文 が 空 なら URL を 入れて おく (description に URL を 含めて おけば
        // 一覧 / 詳細 で クリック可能 リンク に なる)
        const descEl = document.getElementById('pln-desc');
        if (!descEl.value.trim()) {
          descEl.value = (r.description || '') + (r.description ? '\n\n' : '') + url;
        }
        status.innerHTML = `<span style="color:#0e7c63">✓ 取得 完了</span>`;
      } catch (e) {
        status.innerHTML = `<span style="color:#c62828">失敗: ${escapeHtml(e.message)}</span>`;
      } finally { importBtn.disabled = false; }
    });
  }

  document.getElementById('pln-save').addEventListener('click', async () => {
    const title = document.getElementById('pln-title').value.trim();
    if (!title) { toast('お店の 名前 を 入れて ください'); return; }
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
  // v481 #67 カバー 画像 (negative margin で 上に 12px はみ出る) が 「← 一覧」 ボタン
  //   を 被って 戻り にくい 問題 → 戻り ボタン を 別 カード に 分離。
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
      <h3 style="margin:0 0 6px">＋ 口コミ を 書く</h3>
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
      <textarea id="pld-body" maxlength="4000" rows="3" placeholder="どうだった? 何が 美味しい / どう 行く"></textarea>
      <div class="row" style="gap:6px; margin-top:6px; align-items:center">
        <input type="file" id="pld-img" accept="image/*">
        <span class="hint-sm" id="pld-img-status"></span>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <button id="pld-submit" class="primary">送信</button>
      </div>
    </div>
    <div class="card" id="pld-admin" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="pld-edit" class="btn primary">✏ 編集</button>
        <button id="pld-del" class="danger">この お店 を 削除</button>
      </div>
      <div id="pld-edit-form" hidden style="margin-top:10px"></div>
    </div>
  `;
  await loadPlace(id);
}

let pldImageUrl = null;
async function loadPlace(id) {
  try {
    const d = await get('/api/places/' + id);
    const p = d.place;
    const cat = p.category ? (CAT_LBL[p.category] || p.category) : '';
    const ratingLine = p.avg_rating !== null
      ? `<div class="meta">${ratingStars(p.avg_rating)} <b>${p.avg_rating.toFixed(1)}</b> (${p.comment_count} 件 の 口コミ)</div>`
      : `<div class="meta">${p.comment_count} 件 の 口コミ</div>`;
    // v478 メイン写真 が あれば 上に 大きく
    const heroImg = p.image_url
      ? `<img src="${escapeHtml(p.image_url)}" alt="" style="display:block; width:calc(100% + 20px); max-height:220px; object-fit:cover; margin:-12px -10px 10px; border-radius:8px 8px 0 0">`
      : '';
    // v486 #80 いいね ボタン
    const likeBtn = `
      <button id="pld-like" class="btn"
              data-liked="${p.liked_by_me ? '1' : '0'}"
              style="margin-top:6px; font-size:13px; padding:4px 12px; ${p.liked_by_me ? 'background:#fee2e2; color:#e11d48; border-color:#e11d48' : ''}">
        ${p.liked_by_me ? '❤️' : '🤍'} <span id="pld-like-n">${p.like_count}</span>
      </button>`;
    document.getElementById('pld-head').innerHTML = `
      ${heroImg}
      <h2 style="margin:6px 0 0">${escapeHtml(p.title)}</h2>
      ${cat ? `<div class="meta">${escapeHtml(cat)}</div>` : ''}
      ${p.address ? `<div class="meta">📍 ${escapeHtml(p.address)}</div>` : ''}
      ${ratingLine}
      ${p.description ? `<div style="margin-top:8px; font-size:14px">${linkifyText(p.description)}</div>` : ''}
      <div class="meta" style="margin-top:6px">起案 ${escapeHtml(p.creator_name)} · ${escapeHtml(p.created_at || '')}</div>
      ${likeBtn}
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
        btn.style.cssText = `margin-top:6px; font-size:13px; padding:4px 12px; ${nowLiked ? 'background:#fee2e2; color:#e11d48; border-color:#e11d48' : ''}`;
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
    const me = state.me;
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
            ${c.image_url ? `<a href="${escapeHtml(c.image_url)}" target="_blank"><img src="${escapeHtml(c.image_url)}" style="max-width:200px; max-height:200px; border-radius:6px; margin-top:6px"></a>` : ''}
            ${canDel ? `<button class="btn" data-del-cm="${c.id}" style="font-size:11px; padding:2px 6px; margin-top:4px">削除</button>` : ''}
          </div>
        </div>`;
    }).join('') || '<div class="empty">まだ 口コミ なし</div>';
    document.querySelectorAll('[data-del-cm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この 口コミ を 削除 しますか?')) return;
        try { await del(`/api/places/${id}/comments/${b.dataset.delCm}`); toast('削除しました'); await loadPlace(id); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
    // 編集 / 削除 (起案者 or admin)
    if (me && (me.id === p.creator_user_id || me.role === 'admin')) {
      const admin = document.getElementById('pld-admin');
      admin.hidden = false;
      document.getElementById('pld-del').onclick = async () => {
        if (!confirm('この お店 を 削除しますか? (口コミ も 全部 消えます)')) return;
        try { await del('/api/places/' + id); navigate('#/places'); }
        catch (e) { toast('失敗: ' + e.message); }
      };
      // v472 ✏ 編集 — title / category / address / lat / lng / description を 部分更新
      document.getElementById('pld-edit').onclick = () => {
        const form = document.getElementById('pld-edit-form');
        if (!form.hidden) { form.hidden = true; return; }
        form.hidden = false;
        form.innerHTML = `
          <label class="field"><span class="lbl">お店の 名前</span>
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
              lat: lat !== '' ? Number(lat) : null,
              lng: lng !== '' ? Number(lng) : null,
            });
            toast('保存しました');
            await loadPlace(id);
          } catch (e) { toast('失敗: ' + e.message); }
        };
      };
    }
    // 画像 upload
    pldImageUrl = null;
    const imgInput = document.getElementById('pld-img');
    const imgStatus = document.getElementById('pld-img-status');
    imgInput.addEventListener('change', async () => {
      const f = imgInput.files[0];
      if (!f) { pldImageUrl = null; imgStatus.textContent = ''; return; }
      imgStatus.textContent = 'アップロード中…';
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
        pldImageUrl = j.url || j.path;
        imgStatus.innerHTML = `<span style="color:#0e7c63">✓ アップロード完了</span>`;
      } catch (e) { imgStatus.textContent = '失敗: ' + (e?.message || e); }
    });
    // 投稿
    document.getElementById('pld-submit').onclick = async () => {
      const body = document.getElementById('pld-body').value.trim();
      const ratingRaw = document.getElementById('pld-rating').value;
      const rating = ratingRaw !== '' ? Number(ratingRaw) : null;
      if (!body && !pldImageUrl && rating === null) {
        toast('本文 / 画像 / 評価 の どれか は 入れてください'); return;
      }
      try {
        await post(`/api/places/${id}/comments`, { body, image_url: pldImageUrl || '', rating });
        toast('投稿しました');
        document.getElementById('pld-body').value = '';
        document.getElementById('pld-rating').value = '';
        imgInput.value = '';
        pldImageUrl = null;
        imgStatus.textContent = '';
        await loadPlace(id);
      } catch (e) { toast('失敗: ' + e.message); }
    };
  } catch (e) {
    document.getElementById('pld-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
