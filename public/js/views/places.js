// /#/places — 行きたい店 / 行ったお店 共有 (食べログ的)。
// 一覧 → 詳細 → 口コミ投稿 + 削除。 lat/lng があれば Leaflet で 地図表示。
// 画像 は /api/uploads/image で 先 に 上げ、 返り の URL を image_url に。

import { get, post, del } from '../api.js';
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

export async function renderPlaces() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">📍 行きたい店 / 行ったお店</h2>
        <a class="btn primary" href="#/places/new">＋ 新規</a>
      </div>
      <p class="card-subtitle" style="margin:6px 0 0">
        ラボメンバー で 店情報 を 共有。 口コミ・写真・⭐評価 を 添えて 投稿可。
      </p>
    </div>
    <div id="pl-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/places');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('pl-list').innerHTML = '<div class="empty">まだ お店は ありません</div>';
      return;
    }
    document.getElementById('pl-list').innerHTML = items.map(p => {
      const cat = p.category ? CAT_LBL[p.category] || p.category : '';
      const addr = p.address ? ` · ${escapeHtml(p.address)}` : '';
      const rating = p.avg_rating !== null ? ` · ${ratingStars(p.avg_rating)} (${p.avg_rating.toFixed(1)})` : '';
      const img = p.latest_image
        ? `<img src="${escapeHtml(p.latest_image)}" style="width:60px; height:60px; object-fit:cover; border-radius:6px; margin-right:8px">`
        : '';
      return `
        <a class="list-item" href="#/places/${p.id}" style="align-items:center">
          ${img}
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.title)}</div>
            <div class="meta">${escapeHtml(cat)}${addr}${rating} · 💬 ${p.comment_count} · ${escapeHtml(p.creator_name)}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('pl-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderPlaceNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/places" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">📍 お店 を 登録</h2>
    </div>
    <div class="card">
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
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/places" class="btn">キャンセル</a>
        <button id="pln-save" class="primary">＋ 登録</button>
      </div>
    </div>
  `;
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
      });
      toast('登録しました');
      navigate('#/places/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderPlaceDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/places" class="hint">← 一覧</a>
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
      <button id="pld-del" class="danger">この お店 を 削除</button>
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
    document.getElementById('pld-head').innerHTML = `
      <h2 style="margin:6px 0 0">${escapeHtml(p.title)}</h2>
      ${cat ? `<div class="meta">${escapeHtml(cat)}</div>` : ''}
      ${p.address ? `<div class="meta">📍 ${escapeHtml(p.address)}</div>` : ''}
      ${ratingLine}
      ${p.description ? `<div style="margin-top:8px; white-space:pre-wrap; font-size:14px">${escapeHtml(p.description)}</div>` : ''}
      <div class="meta" style="margin-top:6px">起案 ${escapeHtml(p.creator_name)} · ${escapeHtml(p.created_at || '')}</div>
    `;
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
            ${c.body ? `<div style="white-space:pre-wrap; font-size:14px">${escapeHtml(c.body)}</div>` : ''}
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
    // 削除 (起案者 or admin)
    if (me && (me.id === p.creator_user_id || me.role === 'admin')) {
      const admin = document.getElementById('pld-admin');
      admin.hidden = false;
      document.getElementById('pld-del').onclick = async () => {
        if (!confirm('この お店 を 削除しますか? (口コミ も 全部 消えます)')) return;
        try { await del('/api/places/' + id); navigate('#/places'); }
        catch (e) { toast('失敗: ' + e.message); }
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
        const resp = await fetch('/api/uploads/image', { method: 'POST', body: fd, credentials: 'same-origin' });
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
