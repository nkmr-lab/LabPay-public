// v1234 fb (中村さん 依頼) — photo.nkmr.io の アルバム と 写真 を LabPay 内 で 閲覧。
//   これ まで の #/albums は Google Photos アルバム URL を 外部タブ で 開く 一覧 だった が、
//   photo.nkmr.io 側 で LabPay 向け API (`?action=albums` / `album_detail` / `timeline&album=`)
//   と CORS (`*.nkmr.io` 許可 + credentials) が 揃った の で、 ブラウザ 直叩き で LabPay 内 で
//   アルバム を 展開 → タイル → ライトボックス まで やる。
//
// route:
//   #/photo                    — アルバム 一覧 (albums)
//   #/photo/album/:slug        — アルバム 詳細 (timeline&album=<id>, 古い順、 タイル 表示)
//
// Auth: photo.nkmr.io は nkmr-SSO cookie (`.nkmr.io` 共有) で 認可、
//       fetch は `credentials: 'include'` 必須。 401 の 時 は 「未ログイン」と 案内して
//       response の login URL に 誘導。
// 画像: `<img src="https://photo.nkmr.io/media.php?id=X&size=thumb|medium|full">` (CORS 不要)。
//
// 参照: labphotos/docs/API.md / labpay/docs/API_RESPONSE_FROM_LABPHOTO.md。

import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';
import { openImageLightbox } from '../lightbox.js';

const PHOTO_ORIGIN = 'https://photo.nkmr.io';

// ---------------- API helper ----------------

async function photoApi(action, params = {}) {
  const url = new URL(PHOTO_ORIGIN + '/api.php');
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  let r;
  try {
    r = await fetch(url.toString(), { credentials: 'include' });
  } catch (e) {
    throw new Error('photo.nkmr.io に 接続 できません: ' + (e?.message || e));
  }
  if (r.status === 401) {
    // photo.nkmr.io は 302 リダイレクト せず 401 JSON で login URL を 返す 契約
    let j = null;
    try { j = await r.json(); } catch {}
    const loginUrl = j?.login;
    if (loginUrl) {
      if (confirm('photo.nkmr.io に 未 ログイン です。 ログイン 画面 に 移動 しますか?')) {
        location.href = loginUrl;
      }
    }
    throw new Error('photo.nkmr.io に ログイン してください');
  }
  const j = await r.json();
  if (!j || j.ok === false) throw new Error(j?.error || 'photo API エラー');
  return j;
}

function thumbUrl(assetId, size = 'thumb') {
  return `${PHOTO_ORIGIN}/media.php?id=${encodeURIComponent(assetId)}&size=${encodeURIComponent(size)}`;
}

// ---------------- 共通 レンダ helper ----------------

function fmtDateRange(from, to) {
  const f = (s) => {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(s);
    return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
  };
  if (!from && !to) return '';
  const a = f(from), b = f(to);
  if (a === b) return a;
  return `${a} 〜 ${b}`;
}

function shellHtml(bodyHtml) {
  return `
    <div class="card page-header">
      <h2 style="margin:0">🖼 フォト アルバム</h2>
      <div class="hint-sm" style="margin-top:4px">
        <a href="${PHOTO_ORIGIN}" target="_blank" rel="noopener noreferrer">photo.nkmr.io</a> の アルバム を LabPay 内 で 閲覧。
        全機能 は 外部 サイト を どうぞ。
      </div>
    </div>
    ${bodyHtml}
  `;
}

// ---------------- Album 一覧 (#/photo) ----------------

export async function renderPhotoAlbums() {
  const app = document.getElementById('app');
  app.innerHTML = shellHtml(`
    <div class="card">
      <input type="search" id="photo-q" placeholder="🔍 タイトル / タグ で 絞り込み" maxlength="100"
             style="width:100%; box-sizing:border-box; padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:14px">
    </div>
    <div id="photo-albums-status" class="hint-sm" style="text-align:center; padding:20px">読み込み中…</div>
    <div id="photo-albums-grid"
         style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px; margin-top:8px"></div>
  `);
  let all = [];
  try {
    const d = await photoApi('albums');
    all = Array.isArray(d.albums) ? d.albums : [];
  } catch (e) {
    document.getElementById('photo-albums-status').innerHTML =
      `<span style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</span>`;
    return;
  }
  const statusEl = document.getElementById('photo-albums-status');
  const gridEl   = document.getElementById('photo-albums-grid');
  const q = document.getElementById('photo-q');

  const paint = (filter) => {
    const kw = (filter || '').trim().toLowerCase();
    const items = kw
      ? all.filter(a => {
          const t = String(a.title || '').toLowerCase();
          const tags = (a.tags || []).map(x => String(x).toLowerCase()).join(' ');
          return t.includes(kw) || tags.includes(kw);
        })
      : all;
    statusEl.textContent = `${items.length} 件${kw ? ` (${all.length} 件 中)` : ''}`;
    if (!items.length) {
      gridEl.innerHTML = `<div class="empty" style="grid-column:1/-1">該当 アルバム なし</div>`;
      return;
    }
    gridEl.innerHTML = items.map(albumCardHtml).join('');
    gridEl.querySelectorAll('[data-album-slug]').forEach(el => {
      el.addEventListener('click', () => {
        const slug = el.dataset.albumSlug;
        if (slug) navigate('#/photo/album/' + encodeURIComponent(slug));
      });
    });
  };
  paint('');

  let qt = null;
  q.addEventListener('input', () => {
    clearTimeout(qt);
    qt = setTimeout(() => paint(q.value), 150);
  });
}

function albumCardHtml(a) {
  // v1235 cover が thumb256 派生 を 持たない ケース は medium (view2048) を 試して、 それ も
  //   ダメ なら placeholder に フォールバック。 medium 表紙 で 先 に 出す (thumb256 が 無い ケース に 強い)。
  const coverFallback = a.cover ? `${PHOTO_ORIGIN}/media.php?id=${encodeURIComponent(a.cover)}&k=view2048` : '';
  const cover = a.cover
    ? `<img src="${escapeHtml(thumbUrl(a.cover, 'medium'))}" loading="lazy"
             style="width:100%; aspect-ratio:1/1; object-fit:cover; display:block; background:#e5e7eb"
             onerror="if(!this.dataset.f1){this.dataset.f1=1; this.src=${JSON.stringify(coverFallback)}; return;} this.style.opacity=0.2; this.removeAttribute('src'); this.parentElement.style.background='#fee';">`
    : `<div style="width:100%; aspect-ratio:1/1; background:linear-gradient(135deg, #ede4f3, #d4b8e8); display:flex; align-items:center; justify-content:center; font-size:32px">🖼</div>`;
  const tags = (a.tags || []).slice(0, 3).map(t =>
    `<span style="display:inline-block; font-size:10px; padding:1px 6px; margin:2px 2px 0 0; background:#e5e7eb; color:#374151; border-radius:8px">${escapeHtml(t)}</span>`
  ).join('');
  return `
    <div class="card" data-album-slug="${escapeHtml(a.slug || '')}"
         style="cursor:pointer; padding:0; overflow:hidden; border:1px solid #e5e7eb">
      ${cover}
      <div style="padding:6px 8px">
        <div style="font-weight:600; font-size:13px; line-height:1.3; word-break:break-word">${escapeHtml(a.title || '(無題)')}</div>
        <div class="hint-sm" style="font-size:11px; margin-top:2px; color:#6b7280">
          ${a.count ? `📷 ${a.count} 枚` : ''}
          ${a.from ? ` · ${escapeHtml(fmtDateRange(a.from, a.to))}` : ''}
        </div>
        ${tags ? `<div style="margin-top:3px">${tags}</div>` : ''}
      </div>
    </div>`;
}

// ---------------- Album 詳細 (#/photo/album/:slug) ----------------

export async function renderPhotoAlbumDetail({ params }) {
  const slug = params.slug;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div><a href="#/photo" class="hint" style="font-size:12px">← アルバム 一覧 に 戻る</a></div>
      <div id="photo-album-hdr" style="margin-top:6px">読み込み中…</div>
    </div>
    <div id="photo-album-status" class="hint-sm" style="text-align:center; padding:14px">写真 読み込み中…</div>
    <div id="photo-album-grid"
         style="display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:4px; margin-top:8px"></div>
    <div id="photo-album-more" style="text-align:center; margin:14px 0"></div>
  `;

  // ヘッダ (メタ) を 別 fetch で 先出し。 timeline は 別 で 走らせて 並列化
  let album = null;
  const metaPromise = photoApi('album_detail', { slug })
    .then(r => { album = r.album; renderHeader(album); })
    .catch(e => {
      document.getElementById('photo-album-hdr').innerHTML =
        `<span style="color:#dc2626">アルバム 情報 取得 失敗: ${escapeHtml(e?.message || String(e))}</span>`;
    });

  // メタ が 来る まで album.id が 分からない ので await する (slug → id の 変換 に 必要)
  await metaPromise;
  if (!album) return; // ヘッダ で エラー 表示 済み

  await loadAlbumPage(album.id, null, null, /*append=*/false);
}

function renderHeader(album) {
  const el = document.getElementById('photo-album-hdr');
  if (!el) return;
  const tags = (album.tags || []).map(t =>
    `<span style="display:inline-block; font-size:11px; padding:1px 6px; margin:0 3px 0 0; background:#e5e7eb; color:#374151; border-radius:8px">${escapeHtml(t)}</span>`
  ).join('');
  el.innerHTML = `
    <h2 style="margin:0; font-size:18px">${escapeHtml(album.title || '(無題)')}</h2>
    <div class="hint-sm" style="margin-top:4px">
      ${album.count ? `📷 ${album.count} 枚` : ''}
      ${album.from ? ` · ${escapeHtml(fmtDateRange(album.from, album.to))}` : ''}
    </div>
    ${tags ? `<div style="margin-top:4px">${tags}</div>` : ''}
    ${album.description ? `<div class="hint-sm" style="margin-top:6px">${escapeHtml(album.description)}</div>` : ''}
  `;
}

// 「その アルバム で 今 まで 読み込んだ 画像」を 溜めて おき、 ライトボックス に 一括 で 渡す。
// ライトボックス は 開いた 瞬間 の 配列 を 使う (追加 ページ 読み込み 後 は 次回 開いた 時 に 反映)。
const _albumImagesCache = new Map();     // album_id → [{id, type, taken_at}, ...]
const _albumNextCursor  = new Map();     // album_id → {before, before_id} or null (=終端)

async function loadAlbumPage(albumId, before, beforeId, append) {
  const status = document.getElementById('photo-album-status');
  const grid   = document.getElementById('photo-album-grid');
  const more   = document.getElementById('photo-album-more');
  if (!status || !grid || !more) return;
  if (!append) status.textContent = '写真 読み込み中…';
  else         more.innerHTML = '<span class="hint-sm">読み込み中…</span>';

  try {
    const params = { album: albumId, limit: 200 };
    if (before)   params.before = before;
    if (beforeId) params.before_id = beforeId;
    const d = await photoApi('timeline', params);
    const items = Array.isArray(d.items) ? d.items : [];
    const prev = _albumImagesCache.get(albumId) || [];
    const merged = append ? prev.concat(items) : items;
    _albumImagesCache.set(albumId, merged);
    _albumNextCursor.set(albumId, d.next || null);

    if (!merged.length) {
      status.innerHTML = `<div class="empty">写真 が ありません</div>`;
      grid.innerHTML = '';
      more.innerHTML = '';
      return;
    }
    status.textContent = `${merged.length} 枚${d.next ? '+' : ''}`;
    grid.innerHTML = merged.map((it, idx) => thumbTileHtml(it, idx)).join('');
    // タップ で ライトボックス
    grid.querySelectorAll('[data-photo-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.photoIdx);
        openAlbumLightbox(albumId, idx);
      });
    });
    // 続き ボタン
    if (d.next) {
      more.innerHTML = `<button class="btn primary" id="photo-more-btn" style="font-size:13px">▼ 続き を 読み込む</button>`;
      document.getElementById('photo-more-btn').addEventListener('click', () => {
        loadAlbumPage(albumId, d.next.before, d.next.before_id, /*append=*/true);
      });
    } else {
      more.innerHTML = `<div class="hint-sm" style="color:#6b7280">— これ で 全部 —</div>`;
    }
  } catch (e) {
    if (!append) {
      status.innerHTML = `<span style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</span>`;
    } else {
      more.innerHTML = `<span style="color:#dc2626">続き 読み込み 失敗: ${escapeHtml(e?.message || String(e))}</span>`;
    }
  }
}

function thumbTileHtml(it, idx) {
  const isVideo = it.type === 'video';
  // v1235 fb (中村さん報告「部分的にサムネイル画像がでてない」)
  //   timeline items は has_thumb フラグ (`it.thumb`) を 持ち、 thumb256 派生 が 無い もの が
  //   ある (古い/未生成)。 thumb 無し は 直接 medium (view2048) に フォールバック、
  //   さらに <img onerror> で medium → poster (動画用) → 透明化 の 3 段 フォールバック。
  const primary = it.thumb ? 'thumb' : 'medium';
  const src = thumbUrl(it.id, primary);
  // onerror チェーン: thumb→medium→placeholder / video→poster→placeholder
  const fbUrl = isVideo
    ? `${PHOTO_ORIGIN}/media.php?id=${encodeURIComponent(it.id)}&k=poster`
    : thumbUrl(it.id, 'medium');
  const onerr = `
    if(!this.dataset.f1){this.dataset.f1=1; this.src=${JSON.stringify(fbUrl)}; return;}
    this.style.opacity=0.2; this.removeAttribute('src'); this.parentElement.style.background='#fee';`;
  const dur = isVideo && it.durationMs
    ? `<div style="position:absolute; right:3px; bottom:3px; background:rgba(0,0,0,0.7); color:#fff; padding:1px 5px; border-radius:3px; font-size:10px; font-weight:600">
         ${fmtDuration(it.durationMs)}
       </div>`
    : '';
  const videoBadge = isVideo
    ? `<div style="position:absolute; left:3px; top:3px; background:rgba(0,0,0,0.6); color:#fff; padding:1px 4px; border-radius:3px; font-size:10px">▶</div>`
    : '';
  return `
    <div data-photo-idx="${idx}" style="position:relative; cursor:pointer; background:#f3f4f6; aspect-ratio:1/1; overflow:hidden; border-radius:2px">
      <img src="${escapeHtml(src)}" loading="lazy" alt=""
           style="width:100%; height:100%; object-fit:cover; display:block"
           onerror="${onerr.replace(/\n\s*/g, ' ')}">
      ${videoBadge}
      ${dur}
    </div>`;
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function openAlbumLightbox(albumId, startIdx) {
  const items = _albumImagesCache.get(albumId) || [];
  if (!items.length) return;
  // 動画 は ライトボックス で は 開けない (静止画 URL のみ 対応) の で 画像 だけ に 絞る。
  // 動画 は 別窓 で photo.nkmr.io へ 誘導 する。
  const it = items[startIdx];
  if (it && it.type === 'video') {
    // media.php?k=video720 で 直リンク 開き
    const vurl = `${PHOTO_ORIGIN}/media.php?id=${encodeURIComponent(it.id)}&k=video720`;
    window.open(vurl, '_blank', 'noopener,noreferrer');
    return;
  }
  const imageItems = items.filter(x => x.type !== 'video');
  const images = imageItems.map(x => thumbUrl(x.id, 'medium'));
  // startIdx は 全体 に 対する index、 imageItems は 動画 抜き の 配列 な の で 変換
  const originalId = items[startIdx].id;
  const mappedIdx = Math.max(0, imageItems.findIndex(x => x.id === originalId));
  openImageLightbox(images[mappedIdx] || images[0], { images, index: mappedIdx });
}
