// /#/sns/map — 自分のらぼったー投稿のうち位置情報がついているものを地図に
// プロット。マップを動かす (= 表示中エリアを変える) と下の一覧がそれに合わせて
// 自動で絞り込まれる (= 食べある記のマップビューと同じ思想)。
//
// v530 #181 実装。自分がらぼったーで投稿した場所一覧 + 地図インターフェース。

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
  // v535 #191 前回 (= 直前にこのページを閉じた時) の中心 + ズームを localStorage に
  //   保存しておき、復元する。ない場合は東京デフォルト。
  let initView = { lat: 35.7, lng: 139.66, zoom: 12 };
  try {
    const j = JSON.parse(localStorage.getItem('labpay-postsmap-view') || 'null');
    if (j && isFinite(j.lat) && isFinite(j.lng) && isFinite(j.zoom)) initView = j;
  } catch (_) {}
  const map = L.map(mapBox, { zoomControl: true }).setView([initView.lat, initView.lng], initView.zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19,
  }).addTo(map);

  // v535 #191 「📍 現在地」ボタン (地図右上)。 geolocation で現在地に setView。
  //   サイズ/ズームは変えず位置だけ移す。
  const locCtl = L.control({ position: 'topright' });
  locCtl.onAdd = () => {
    const div = L.DomUtil.create('div', 'leaflet-bar');
    div.innerHTML = `<a href="#" title="現在地に移動" style="width:30px; height:30px; line-height:30px; text-align:center; display:block; font-size:16px; background:#fff">📍</a>`;
    L.DomEvent.disableClickPropagation(div);
    div.querySelector('a').addEventListener('click', (e) => {
      e.preventDefault();
      if (!navigator.geolocation) { toast('現在地を取得できません (Geolocation 未対応)'); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.setView([pos.coords.latitude, pos.coords.longitude], map.getZoom());
          toast('現在地に移動しました');
        },
        () => { toast('現在地の取得に失敗しました'); },
        { enableHighAccuracy: false, timeout: 8000 },
      );
    });
    return div;
  };
  locCtl.addTo(map);

  // 前回 view が無い (= 初回) の時だけ全マーカーが収まるよう fitBounds する。ある時は
  //   保存した位置を尊重する (= ユーザ意図を維持)。
  const hadSavedView = localStorage.getItem('labpay-postsmap-view') !== null;

  // 自分の投稿で lat/lng が入ってるものだけ集める。多数を期待していい (200 件まで)。
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
      '<div class="empty">位置情報付きの投稿はまだありません。投稿時に 📍 をオンにするとここに出ます。</div>';
    return;
  }

  const markersByPid = new Map();
  for (const p of items) {
    const lat = Number(p.lat), lng = Number(p.lng);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    // v535 #194 写真がある場合はサムネ画像をマーカーアイコンとして表示
    //   (グループ地図 / 食べある記と同様の見せ方)
    const imgSrc = p.image_thumb_url || p.image_url;
    let marker;
    if (imgSrc) {
      const icon = L.divIcon({
        className: 'pm-img-marker',
        html: `<div style="width:42px; height:42px; border-radius:8px; overflow:hidden; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.4); background:#fff"><img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" decoding="async" style="width:100%; height:100%; object-fit:cover"></div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });
      marker = L.marker([lat, lng], { icon }).addTo(map);
    } else {
      // v542 #198 画像なしのマーカーが真っ白で寂しいので、アバター画像 or
      //   本文先頭の絵文字を入れた divIcon で描画。ユーザ色 (display_name hash で
      //   背景色を決定) で「誰の投稿か」も一目で分かる。
      const firstEmoji = extractFirstEmoji(p.body || '');
      const userColor  = colorFromName(p.display_name || '');
      const avatarSrc  = p.avatar_url || '';
      const inner = avatarSrc
        ? `<img src="${escapeHtml(avatarSrc)}" alt="" loading="lazy" decoding="async" style="width:100%; height:100%; object-fit:cover">`
        : `<div style="width:100%; height:100%; background:${userColor}; display:flex; align-items:center; justify-content:center; color:#fff; font-size:${firstEmoji ? 18 : 14}px; font-weight:700">${firstEmoji ? firstEmoji : escapeHtml((p.display_name || '?').slice(0, 1))}</div>`;
      const icon = L.divIcon({
        className: 'pm-noimg-marker',
        html: `<div style="width:38px; height:38px; border-radius:50%; overflow:hidden; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.4); background:${userColor}">${inner}</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });
      marker = L.marker([lat, lng], { icon }).addTo(map);
    }
    const m = marker;
    m.bindPopup(() => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'min-width:200px; max-width:260px; font-size:13px';
      // v534 #190 写真があればサムネで表示 (タップで詳細へ)
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

  // v535 #191 初回 (= 保存 view 無し) のみ全マーカー fitBounds、保存 view 有りなら
  //   ユーザ意図を維持。
  if (!hadSavedView) {
    const group = L.featureGroup([...markersByPid.values()]);
    if (group.getLayers().length) map.fitBounds(group.getBounds().pad(0.2));
  }
  // 移動・ズーム変更時に view を localStorage 保存 (次回復元用)
  const saveView = () => {
    try {
      const c = map.getCenter();
      localStorage.setItem('labpay-postsmap-view', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
    } catch (_) {}
  };
  map.on('moveend zoomend', saveView);

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

// v542 #198 本文の先頭から絵文字 (Unicode Emoji_Presentation 範囲) を 1 つ抽出。
//   なければ '' を返す。シンプルなヒューリスティック (完璧網羅は不要)。
function extractFirstEmoji(s) {
  if (!s) return '';
  // 絵文字っぽい範囲を緩く拾う (記号+変体セレクタ含む)
  const m = s.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}](\u{FE0F})?/u);
  return m ? m[0] : '';
}
// 文字列を簡易 hash → HSL カラー (パステル系) に。同じ名前は同じ色。
function colorFromName(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 55%)`;
}
