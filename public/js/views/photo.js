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
      <div class="row center">
        <h2 style="margin:0">🖼 フォト アルバム</h2>
        <a href="#/photo/frame" class="btn primary" style="margin-left:auto; font-size:12px; padding:4px 12px; text-decoration:none">📺 フォトフレーム</a>
      </div>
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
    // v1239 中村さん確認「新しい順 で 良い」 → 明示 sort (API 契約 は 撮影日 新しい順 だ が
    //   同点/欠損 に 備えて to → from → 空 の 順 で 降順)
    all.sort((a, b) => String(b.to || b.from || '').localeCompare(String(a.to || a.from || '')));
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
    <div class="row center">
      <h2 style="margin:0; font-size:18px">${escapeHtml(album.title || '(無題)')}</h2>
      <a href="#/photo/frame?album=${encodeURIComponent(album.id)}" class="btn primary"
         style="margin-left:auto; font-size:12px; padding:4px 12px; text-decoration:none">📺 このアルバム で フォトフレーム</a>
    </div>
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
  // v1236 fb (中村さん報告「サムネ画像がちゃんとでてないやつもある」)
  //   media.php は derivatives テーブル に kind (thumb256/view2048/video720/poster)
  //   が 無い と 404 を 返す (原本 は 配信 しない)。 両方 とも 未生成 の 画像 は 現状 表示
  //   できない。 加えて it.ready===false (生成中) / it.failed===true (失敗) の 状態 も
  //   区別 する。
  //   ★戦略: 下敷き に 状態 ラベル を 置き、 その上 に img を 重ねる。 img 読込 成功 で
  //   カバー、 失敗 で 透明化 → 下 の ラベル が 見える。 これ で 「なぜ 出ない か」 が 分かる。
  const notReady = !it.ready;
  const failed = !!it.failed;
  const takenBrief = it.takenAt ? String(it.takenAt).slice(5, 10).replace('-', '/') : '';
  const stateEmoji = failed ? '⚠' : (notReady ? '⏳' : (isVideo ? '🎬' : '📷'));
  const stateLabel = failed ? '生成失敗' : (notReady ? '生成中' : 'サムネ 未 生成');
  const label = `
    <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#9ca3af; text-align:center; padding:4px; font-size:10px; line-height:1.3; pointer-events:none">
      <div style="font-size:22px; opacity:0.7">${stateEmoji}</div>
      <div style="margin-top:2px">${stateLabel}</div>
      <div style="margin-top:2px; opacity:0.7">#${escapeHtml(String(it.id))}${takenBrief ? ` · ${takenBrief}` : ''}</div>
    </div>`;
  // ready かつ !failed の 時 のみ 画像 読込 を 試す。 生成中/失敗 は placeholder のみ。
  let imgHtml = '';
  if (!notReady && !failed) {
    const primary = it.thumb ? 'thumb' : 'medium';
    const src = thumbUrl(it.id, primary);
    // onerror チェーン: thumb→medium→透明 (=下敷き ラベル が 見える)
    const fbUrl = isVideo
      ? `${PHOTO_ORIGIN}/media.php?id=${encodeURIComponent(it.id)}&k=poster`
      : thumbUrl(it.id, 'medium');
    const onerr = `if(!this.dataset.f1){this.dataset.f1=1; this.src=${JSON.stringify(fbUrl)}; return;} this.style.display='none';`;
    imgHtml = `<img src="${escapeHtml(src)}" loading="lazy" alt=""
           style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; background:#f3f4f6"
           onerror="${onerr}">`;
  }
  const dur = isVideo && it.durationMs
    ? `<div style="position:absolute; right:3px; bottom:3px; background:rgba(0,0,0,0.7); color:#fff; padding:1px 5px; border-radius:3px; font-size:10px; font-weight:600; z-index:2">
         ${fmtDuration(it.durationMs)}
       </div>`
    : '';
  const videoBadge = isVideo
    ? `<div style="position:absolute; left:3px; top:3px; background:rgba(0,0,0,0.6); color:#fff; padding:1px 4px; border-radius:3px; font-size:10px; z-index:2">▶</div>`
    : '';
  return `
    <div data-photo-idx="${idx}" style="position:relative; cursor:pointer; background:#f3f4f6; aspect-ratio:1/1; overflow:hidden; border-radius:2px">
      ${label}
      ${imgHtml}
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

// ---------------- Random 一枚 / 数枚 API helper (v1237) ----------------

// 「今日 の ラボ フォト」ウィジェット や フォトフレーム から 使う 共通 API。
// count: 1-12 (LabPhoto 制約)、 seed: 決定論 (60s poll チカチカ防止)、
// album / person_id / year / tag / exclude_ids: 任意 フィルタ。
export async function fetchRandomPhotos(opts = {}) {
  const params = { count: Math.max(1, Math.min(12, Number(opts.count) || 6)) };
  if (opts.seed !== undefined)    params.seed = opts.seed;
  if (opts.album_id)              params.album_id = opts.album_id;
  if (opts.person_id)             params.person_id = opts.person_id;
  if (opts.year)                  params.year = opts.year;
  if (opts.tag)                   params.tag = opts.tag;
  if (Array.isArray(opts.exclude_ids) && opts.exclude_ids.length) {
    params.exclude_ids = opts.exclude_ids.slice(0, 50).join(',');
  }
  const d = await photoApi('random_photos', params);
  return Array.isArray(d.photos) ? d.photos : [];
}

// random_photos の thumb_url は 相対パス で 返る の で PHOTO_ORIGIN を 前置 する 共通処理
export function absolutePhotoUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return PHOTO_ORIGIN + (u.startsWith('/') ? u : ('/' + u));
}

// asset_id から 直接 medium/full URL を 組む
export function assetMediaUrl(assetId, size = 'medium') {
  return thumbUrl(assetId, size);
}

// ---------------- フォトフレーム (#/photo/frame) ----------------
// フルスクリーン スライドショー。 Wake Lock で 画面 スリープ 抑止、 タップ で コントロール
// トグル、 exit で 戻る。
//
// v1240 中村さん要望「フォトフレーム モード の 時、 できれば 黒い 領域 が できない ように
//   タイル状 に 埋めて ほしい」→ 既定 を タイル モード に、 mode=single で 従来 動作。
//   タイル: 画面 アスペクト から cols×rows を 決定 (横長=4×3、 縦長=3×4)、 各セル
//   object-fit:cover で 黒 余白 ゼロ、 一定 秒 毎 に ランダム な 1 タイル を フェード 差替。
//
// query:
//   ?album=<id>   特定 アルバム 限定
//   ?mode=single  1 枚 大表示 モード (従来)、 既定 は tile
//   ?sec=N        single モード の 送り 秒数 (既定 8)
//   ?tile_sec=N   tile モード の 1 タイル 差替 間隔 (既定 4)
//   ?fit=cover|contain  single モード の 表示方式 (既定 contain)
//
// アーキ:
//   バッファ を fetch → 尽きたら 追加。 exclude_ids で 直近 表示 と 被らない よう に。
//   seed は 使わない (毎回 fresh)。

let _pfState = null;

export async function renderPhotoFrame({ query } = {}) {
  const app = document.getElementById('app');
  // 既存 state を 破棄
  if (_pfState) { _cleanupPhotoFrame(); }
  const opts = query || {};
  const mode = opts.mode === 'single' ? 'single' : 'tile';
  const sec = Math.max(2, Math.min(120, Number(opts.sec) || 8));
  const tileSec = Math.max(1, Math.min(30, Number(opts.tile_sec) || 4));
  const albumId = opts.album ? Number(opts.album) : null;
  const fit = opts.fit === 'cover' ? 'cover' : 'contain';

  app.innerHTML = `
    <div id="pf-root"
         style="position:fixed; inset:0; background:#000; z-index:5000; user-select:none; touch-action:pan-y">
      <div id="pf-slide"
           style="position:absolute; inset:0; overflow:hidden;
                  ${mode === 'single' ? 'display:flex; align-items:center; justify-content:center' : ''}">
        <div id="pf-loading" style="color:#999; font-size:14px; position:absolute; inset:0; display:flex; align-items:center; justify-content:center">読み込み中…</div>
      </div>
      <div id="pf-caption"
           style="position:absolute; left:0; right:0; bottom:0; padding:12px 16px 14px; color:#fff; background:linear-gradient(to top, rgba(0,0,0,0.72), transparent); font-size:13px; line-height:1.4; pointer-events:none; opacity:0; transition:opacity 0.3s"></div>
      <div id="pf-controls"
           style="position:absolute; top:12px; right:12px; display:flex; gap:8px; z-index:2; opacity:0; transition:opacity 0.3s">
        <button id="pf-pause"
                style="width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.9); border:none; font-size:18px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.5)">⏸</button>
        <button id="pf-prev" aria-label="前"
                style="width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.9); border:none; font-size:18px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.5)">‹</button>
        <button id="pf-next" aria-label="次"
                style="width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.9); border:none; font-size:18px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.5)">›</button>
        <button id="pf-mode" aria-label="モード" title="tile/single 切替"
                style="width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.9); border:none; font-size:18px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.5)">${mode === 'tile' ? '🎞' : '🎨'}</button>
        <button id="pf-exit" aria-label="閉じる"
                style="width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.9); border:none; font-size:20px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.5)">✕</button>
      </div>
      <!-- v1242 現 テーマ バッジ (シーン 切替 時 に 5 秒 だけ 出す) -->
      <div id="pf-theme"
           style="position:absolute; top:12px; left:12px; padding:6px 14px; background:rgba(0,0,0,0.65); color:#fff; border-radius:16px; font-size:13px; font-weight:600; opacity:0; transition:opacity 0.5s; pointer-events:none; max-width:60vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; z-index:2"></div>
      <div id="pf-hint" style="position:absolute; bottom:12px; left:12px; color:rgba(255,255,255,0.55); font-size:11px; pointer-events:none">タップ で 操作 / ${mode === 'tile' ? 'タイル' : 'single'} モード</div>
    </div>
  `;
  _pfState = {
    queue: [], seen: new Set(), showing: null, idx: -1,
    sec, tileSec, albumId, mode, fit,
    paused: false, timer: null, wakeLock: null,
    controlsShownUntil: 0,
    // tile モード 用
    tileEls: [], tileCount: 0, tilePhotos: [],
    // v1242 テーマ (album/year/person/mixed) + シーン カウンタ + キャッシュ
    theme: null, currentFilter: null, rotationsUntilScene: 8,
    albumsCache: null, peopleCache: null, themeBadgeTimer: null,
  };
  // v1242 最初 の テーマ を 選択 して から バッファ を 埋める
  await _pfNewTheme();
  await _pfLoadMore();
  if (!_pfState.queue.length) {
    const l = document.getElementById('pf-loading');
    if (l) l.textContent = '写真 が 取得 できませんでした';
    return;
  }
  _pfAcquireWakeLock();
  if (mode === 'tile') _pfStartTile();
  else                 _pfNext();
  _pfWireEvents();
  _pfShowControls();
  _pfShowThemeBadge();  // v1242 初回 テーマ を バッジ で 表示
}

// ---------- タイル モード ----------
// v1241 中村さん要望「同 サイズ 分割 は いまいち、 総 6-9 枚 で 良い、 スマホ/iPad の 縦横
//   入れ替え に 対応 して」→ (1) hero (2×2) + サブ タイル の 混合 レイアウト に、 (2) 総 6 タイル
//   に 削減、 (3) 横長/縦長 で 別 レイアウト、 (4) resize/orientationchange で 縦横 が
//   変わった 時 (cols/rows が 変わった 時) は 必ず rebuild。
//
// レイアウト:
//   横長 (4×3 grid、 6 タイル): hero(2×2) + 小(1×1)×2 + 横長(2×1)×3
//   縦長 (3×4 grid、 6 タイル): hero(2×2) + 小(1×1)×2 + 縦長(1×2)×1 + 横長(2×1)×2

// v1242 中村さん要望「レイアウト が 一定 だから ちょっと なー、 ちょくちょく 変わって 欲しい」
//   → 横長/縦長 で 各 3 パターン、 シーン 切替 時 に ランダム で 別 レイアウト に。
//   全 レイアウト は 6 タイル で hero (2×2) + サブ の 混合、 6 タイル 数 は 一定 の ため
//   バッファ ロジック は 共通。
const _PF_LAYOUTS_LANDSCAPE = [
  // LA: hero 左上
  { cols: 4, rows: 3, tiles: [
    { c: '1 / span 2', r: '1 / span 2' }, { c: '3 / span 1', r: '1 / span 1' },
    { c: '4 / span 1', r: '1 / span 1' }, { c: '3 / span 2', r: '2 / span 1' },
    { c: '1 / span 2', r: '3 / span 1' }, { c: '3 / span 2', r: '3 / span 1' },
  ]},
  // LB: hero 右上 (LA の 左右 ミラー)
  { cols: 4, rows: 3, tiles: [
    { c: '3 / span 2', r: '1 / span 2' }, { c: '1 / span 1', r: '1 / span 1' },
    { c: '2 / span 1', r: '1 / span 1' }, { c: '1 / span 2', r: '2 / span 1' },
    { c: '3 / span 2', r: '3 / span 1' }, { c: '1 / span 2', r: '3 / span 1' },
  ]},
  // LC: 上段 に 小 4 個、 下 に hero + 横長 (逆さ 感)
  { cols: 4, rows: 3, tiles: [
    { c: '1 / span 1', r: '1 / span 1' }, { c: '2 / span 1', r: '1 / span 1' },
    { c: '3 / span 1', r: '1 / span 1' }, { c: '4 / span 1', r: '1 / span 1' },
    { c: '1 / span 2', r: '2 / span 2' }, { c: '3 / span 2', r: '2 / span 2' },
  ]},
];
const _PF_LAYOUTS_PORTRAIT = [
  // PA: hero 左上
  { cols: 3, rows: 4, tiles: [
    { c: '1 / span 2', r: '1 / span 2' }, { c: '3 / span 1', r: '1 / span 1' },
    { c: '3 / span 1', r: '2 / span 1' }, { c: '1 / span 1', r: '3 / span 2' },
    { c: '2 / span 2', r: '3 / span 1' }, { c: '2 / span 2', r: '4 / span 1' },
  ]},
  // PB: hero 中央 下段
  { cols: 3, rows: 4, tiles: [
    { c: '1 / span 1', r: '1 / span 1' }, { c: '2 / span 1', r: '1 / span 1' },
    { c: '3 / span 1', r: '1 / span 1' }, { c: '1 / span 3', r: '2 / span 1' },
    { c: '1 / span 2', r: '3 / span 2' }, { c: '3 / span 1', r: '3 / span 2' },
  ]},
  // PC: hero 右上 + 上下 に 横長
  { cols: 3, rows: 4, tiles: [
    { c: '1 / span 1', r: '1 / span 2' }, { c: '2 / span 2', r: '1 / span 2' },
    { c: '1 / span 3', r: '3 / span 1' }, { c: '1 / span 1', r: '4 / span 1' },
    { c: '2 / span 1', r: '4 / span 1' }, { c: '3 / span 1', r: '4 / span 1' },
  ]},
];

function _pfPickLayout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pool = (w > h) ? _PF_LAYOUTS_LANDSCAPE : _PF_LAYOUTS_PORTRAIT;
  const cur = _pfState?.layout;
  let choice = pool[Math.floor(Math.random() * pool.length)];
  // 直前 と 同じ を 避ける (プール が 1 個 だけ の 場合 は 諦め)
  if (pool.length > 1 && cur) {
    let tries = 5;
    while (choice === cur && tries--) choice = pool[Math.floor(Math.random() * pool.length)];
  }
  return choice;
}

function _pfComputeLayout() {
  // 現行 レイアウト が 現在 の 向き で 使える なら そのまま (resize 判定 用)
  if (_pfState?.layout) {
    const w = window.innerWidth, h = window.innerHeight;
    const pool = (w > h) ? _PF_LAYOUTS_LANDSCAPE : _PF_LAYOUTS_PORTRAIT;
    if (pool.includes(_pfState.layout)) return _pfState.layout;
  }
  return _pfPickLayout();
}

function _pfStartTile() {
  if (!_pfState) return;
  const slide = document.getElementById('pf-slide');
  if (!slide) return;
  const layout = _pfComputeLayout();
  const count = layout.tiles.length;
  _pfState.layout = layout;
  _pfState.tileCount = count;
  _pfState.tilePhotos = new Array(count).fill(null);
  // グリッド DOM (各 タイル は grid-column/grid-row で span 指定)
  slide.innerHTML = `
    <div id="pf-tiles" style="position:absolute; inset:0; display:grid;
                              grid-template-columns:repeat(${layout.cols}, 1fr);
                              grid-template-rows:repeat(${layout.rows}, 1fr);
                              gap:3px; background:#000">
      ${layout.tiles.map(t => `
        <div style="grid-column:${t.c}; grid-row:${t.r}; position:relative; overflow:hidden; background:#111">
          <img alt="" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity 0.7s">
        </div>`).join('')}
    </div>
  `;
  _pfState.tileEls = Array.from(document.querySelectorAll('#pf-tiles img'));
  // 初期 埋め: 一気 に。 6 枚 だけ な の で ジグザグ 遅延 は 短め (演出)
  for (let i = 0; i < count; i++) {
    const p = _pfConsume();
    if (p) {
      if (i === 0) _pfPaintTile(i, p);
      else setTimeout(() => {
        if (!_pfState || !_pfState.tileEls[i]) return;
        _pfPaintTile(i, p);
      }, 120 * i);
    }
  }
  _pfScheduleTileRotate();
  // 画面 リサイズ / 回転 で cols か rows が 変わったら 必ず 完全 rebuild
  _pfState.resizeHandler = () => {
    if (!_pfState) return;
    const next = _pfComputeLayout();
    const cur = _pfState.layout;
    if (!cur || cur.cols !== next.cols || cur.rows !== next.rows) {
      _pfStartTile();  // レイアウト 変わったら 全 rebuild
    }
  };
  window.addEventListener('resize', _pfState.resizeHandler);
  window.addEventListener('orientationchange', _pfState.resizeHandler);
}

function _pfConsume() {
  if (!_pfState) return null;
  if (_pfState.queue.length - (_pfState.idx + 1) < 6) _pfLoadMore(); // 補充
  _pfState.idx += 1;
  if (_pfState.idx >= _pfState.queue.length) _pfState.idx = 0;
  return _pfState.queue[_pfState.idx] || null;
}

function _pfPaintTile(i, photo) {
  if (!_pfState || !photo) return;
  const img = _pfState.tileEls[i];
  if (!img) return;
  const src = assetMediaUrl(photo.asset_id, 'medium');
  // フェード アウト → 差替 → フェード イン
  img.style.opacity = '0';
  const swap = () => {
    if (!_pfState || !_pfState.tileEls[i]) return;
    img.onload = () => { img.style.opacity = '1'; };
    img.onerror = () => { img.style.opacity = '0'; };
    img.src = src;
    _pfState.tilePhotos[i] = photo;
  };
  // 初期 (opacity 既に 0) は 即 swap、 差替 時 は 0.4s 待って swap
  if (img.src) setTimeout(swap, 400);
  else         swap();
  // キャプション を 更新 (直近 差替 の 写真)
  _pfSetCaption(photo);
}

function _pfScheduleTileRotate() {
  if (!_pfState) return;
  clearTimeout(_pfState.timer);
  if (_pfState.paused) return;
  _pfState.timer = setTimeout(async () => {
    if (!_pfState) return;
    // v1242 シーン 切替: 一定 回数 の タイル 差替 後 に、 テーマ + レイアウト を 一気 に 更新
    _pfState.rotationsUntilScene = (_pfState.rotationsUntilScene ?? 8) - 1;
    if (_pfState.rotationsUntilScene <= 0) {
      await _pfSceneChange();
      _pfState.rotationsUntilScene = 8;   // 次 の シーン まで の 回数 (~32 秒 @ 4s tileSec)
    } else {
      const i = Math.floor(Math.random() * _pfState.tileCount);
      const p = _pfConsume();
      if (p) _pfPaintTile(i, p);
    }
    _pfScheduleTileRotate();
  }, _pfState.tileSec * 1000);
}

// v1242 シーン 切替: テーマ を 新規 に 選び、 バッファ を リセット して 新テーマ で 埋め、
//   レイアウト も 別 パターン に 差替 (向き は 現在 の を 保つ)。 完全 rebuild。
async function _pfSceneChange() {
  if (!_pfState) return;
  await _pfNewTheme();
  _pfState.queue = [];
  _pfState.seen = new Set();
  _pfState.idx = -1;
  await _pfLoadMore();
  if (!_pfState) return;
  // レイアウト を 別 パターン に (向き は 現在 の まま)
  _pfState.layout = _pfPickLayout();
  _pfStartTile();
  _pfShowThemeBadge();
}

// v1242 テーマ 選択 (album / year / person / mixed)。 バッファ fetch に 反映 する 用 の
//   currentFilter も 設定。 URL に ?album=X 指定 が ある 場合 は そちら に ロック。
async function _pfNewTheme() {
  if (!_pfState) return;
  if (_pfState.albumId) {
    _pfState.theme = { type: 'album', label: '🖼 選択 アルバム' };
    _pfState.currentFilter = { album_id: _pfState.albumId };
    // 選択 アルバム モード な の で 名前 が 分かれば 表示 したい (albums cache から 引く)
    await _pfEnsureAlbumsCache();
    const a = (_pfState.albumsCache || []).find(x => Number(x.id) === Number(_pfState.albumId));
    if (a) _pfState.theme.label = `🖼 ${a.title}`;
    return;
  }
  await _pfEnsureAlbumsCache();
  const albums = _pfState.albumsCache || [];
  const dice = Math.random();
  // 35% album / 25% year / 25% person / 15% mixed
  if (dice < 0.35 && albums.length) {
    const a = albums[Math.floor(Math.random() * albums.length)];
    _pfState.theme = { type: 'album', label: `🖼 ${a.title}` };
    _pfState.currentFilter = { album_id: a.id };
    return;
  }
  if (dice < 0.60) {
    const years = _pfBuildYears(albums);
    if (years.length) {
      const y = years[Math.floor(Math.random() * years.length)];
      _pfState.theme = { type: 'year', label: `📅 ${y} 年 の 写真` };
      _pfState.currentFilter = { year: y };
      return;
    }
  }
  if (dice < 0.85) {
    await _pfEnsurePeopleCache();
    const people = _pfState.peopleCache || [];
    if (people.length) {
      const p = people[Math.floor(Math.random() * people.length)];
      _pfState.theme = { type: 'person', label: `👤 ${p.name}` };
      _pfState.currentFilter = { person_id: p.id };
      return;
    }
  }
  _pfState.theme = { type: 'mixed', label: '🎲 みんなの ランダム' };
  _pfState.currentFilter = {};
}

async function _pfEnsureAlbumsCache() {
  if (_pfState.albumsCache) return _pfState.albumsCache;
  try {
    const d = await photoApi('albums');
    _pfState.albumsCache = (Array.isArray(d.albums) ? d.albums : [])
      .filter(a => (a.count || 0) >= 3);  // 3 枚 以上 の アルバム 限定
  } catch { _pfState.albumsCache = []; }
  return _pfState.albumsCache;
}

async function _pfEnsurePeopleCache() {
  if (_pfState.peopleCache) return _pfState.peopleCache;
  try {
    const d = await photoApi('people');
    _pfState.peopleCache = (Array.isArray(d.people) ? d.people : [])
      .filter(p => (p.photos || 0) >= 10 && p.name && !/^\?|^未|^名前無/.test(String(p.name)));
  } catch { _pfState.peopleCache = []; }
  return _pfState.peopleCache;
}

function _pfBuildYears(albums) {
  const s = new Set();
  for (const a of (albums || [])) {
    const m = String(a.from || '').match(/^(\d{4})/);
    if (m) s.add(m[1]);
  }
  return [...s].filter(y => Number(y) >= 2000).sort();
}

function _pfShowThemeBadge() {
  if (!_pfState || !_pfState.theme) return;
  const el = document.getElementById('pf-theme');
  if (!el) return;
  el.textContent = _pfState.theme.label;
  el.style.opacity = '1';
  clearTimeout(_pfState.themeBadgeTimer);
  _pfState.themeBadgeTimer = setTimeout(() => {
    if (el) el.style.opacity = '0';
  }, 5000);
}

function _pfSetCaption(photo) {
  const caption = document.getElementById('pf-caption');
  if (!caption || !photo) return;
  const bits = [];
  if (photo.taken_at)     bits.push(_pfFmtDate(photo.taken_at));
  if (photo.album?.title) bits.push('🖼 ' + photo.album.title);
  if (Array.isArray(photo.people) && photo.people.length) {
    bits.push('👤 ' + photo.people.slice(0, 5).map(p => p.name).join(' / '));
  }
  if (photo.place_label)  bits.push('📍 ' + photo.place_label);
  caption.textContent = bits.join(' · ');
}

async function _pfLoadMore() {
  if (!_pfState) return;
  const excl = Array.from(_pfState.seen).slice(-40);
  // v1242 currentFilter (テーマ 由来 の album/year/person) を fetch に 反映。
  //   URL ?album=X が あれば albumId が currentFilter に 上書き 済 (単一 テーマ ロック)。
  const f = _pfState.currentFilter || {};
  const items = await fetchRandomPhotos({
    count: 12,
    album_id: f.album_id,
    person_id: f.person_id,
    year: f.year,
    exclude_ids: excl,
  }).catch(e => { console.warn('[pf] fetch failed', e); return []; });
  for (const p of items) {
    if (!p || !p.asset_id) continue;
    if (_pfState.seen.has(p.asset_id)) continue;
    _pfState.queue.push(p);
    _pfState.seen.add(p.asset_id);
  }
  // テーマ に 該当 する 写真 が 尽きた 場合 は 空 で 返る の で、 次 の scene で 別 テーマ に 切替 される
}

function _pfNext() {
  if (!_pfState) return;
  clearTimeout(_pfState.timer);
  // v1242 tile モード の 「次」 は シーン 切替 (新 テーマ + 新 レイアウト) に 変更
  //   従来 の 全 タイル 一気 差替 だと 同 テーマ ばかり で 単調 だった。
  //   _pfSceneChange → _pfStartTile が 内部 で _pfScheduleTileRotate まで やる ので 追加 schedule 不要。
  if (_pfState.mode === 'tile') {
    _pfState.rotationsUntilScene = 8;
    _pfSceneChange();
    return;
  }
  _pfState.idx += 1;
  if (_pfState.idx >= _pfState.queue.length) {
    // 継続 fetch
    _pfLoadMore().then(() => {
      if (!_pfState) return;
      if (_pfState.idx >= _pfState.queue.length) {
        // 追加 も 空 → 頭 から ループ
        _pfState.idx = 0;
      }
      _pfShow(_pfState.queue[_pfState.idx]);
    });
    return;
  }
  _pfShow(_pfState.queue[_pfState.idx]);
  // バッファ が 少なく なったら 裏で 追加
  if (_pfState.queue.length - _pfState.idx < 4) _pfLoadMore();
}

function _pfPrev() {
  if (!_pfState) return;
  clearTimeout(_pfState.timer);
  if (_pfState.mode === 'tile') {
    // tile モード は 前 履歴 を 持って いない ので next と 同じ (別 セット に 差替)
    return _pfNext();
  }
  _pfState.idx = Math.max(0, _pfState.idx - 1);
  _pfShow(_pfState.queue[_pfState.idx]);
}

function _pfShow(photo) {
  if (!_pfState || !photo) return;
  _pfState.showing = photo;
  const slide = document.getElementById('pf-slide');
  const caption = document.getElementById('pf-caption');
  if (!slide) return;
  const src = assetMediaUrl(photo.asset_id, 'full');
  // 画像 差替 (フェード)
  slide.innerHTML = `
    <img src="${escapeHtml(src)}" alt=""
         style="max-width:100%; max-height:100%; width:auto; height:auto; object-fit:${_pfState.fit}; opacity:0; transition:opacity 0.6s"
         onload="this.style.opacity=1"
         onerror="this.style.display='none'; this.parentElement.insertAdjacentHTML('beforeend', '<div style=&quot;color:#666; font-size:14px&quot;>画像 の 取得 に 失敗 (#${escapeHtml(String(photo.asset_id))})</div>');">
  `;
  // キャプション
  const bits = [];
  if (photo.taken_at)     bits.push(_pfFmtDate(photo.taken_at));
  if (photo.album?.title) bits.push('🖼 ' + photo.album.title);
  if (Array.isArray(photo.people) && photo.people.length) {
    bits.push('👤 ' + photo.people.slice(0, 5).map(p => p.name).join(' / '));
  }
  if (photo.place_label)  bits.push('📍 ' + photo.place_label);
  caption.textContent = bits.join(' · ');
  caption.style.opacity = (_pfState.controlsShownUntil > Date.now() ? '1' : '0');
  // 次 の 自動 送り
  if (!_pfState.paused) {
    _pfState.timer = setTimeout(_pfNext, _pfState.sec * 1000);
  }
}

function _pfFmtDate(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s);
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}

function _pfShowControls() {
  if (!_pfState) return;
  _pfState.controlsShownUntil = Date.now() + 3500;
  const c = document.getElementById('pf-controls');
  const cap = document.getElementById('pf-caption');
  if (c)   c.style.opacity = '1';
  if (cap) cap.style.opacity = '1';
  setTimeout(() => {
    if (!_pfState) return;
    if (Date.now() >= _pfState.controlsShownUntil) {
      if (c)   c.style.opacity = '0';
      if (cap) cap.style.opacity = '0';
    }
  }, 3600);
}

function _pfTogglePause() {
  if (!_pfState) return;
  _pfState.paused = !_pfState.paused;
  const btn = document.getElementById('pf-pause');
  if (btn) btn.textContent = _pfState.paused ? '▶' : '⏸';
  clearTimeout(_pfState.timer);
  if (!_pfState.paused) {
    if (_pfState.mode === 'tile') _pfScheduleTileRotate();
    else _pfState.timer = setTimeout(_pfNext, _pfState.sec * 1000);
  }
}

async function _pfAcquireWakeLock() {
  if (!_pfState) return;
  if (!('wakeLock' in navigator)) return;
  try {
    _pfState.wakeLock = await navigator.wakeLock.request('screen');
    // タブ が バックグラウンド に なる と 解除 されるので、 復帰時 に 再取得
    _pfState.visHandler = async () => {
      if (document.visibilityState === 'visible' && _pfState && !_pfState.wakeLock) {
        try { _pfState.wakeLock = await navigator.wakeLock.request('screen'); } catch {}
      }
    };
    document.addEventListener('visibilitychange', _pfState.visHandler);
  } catch (e) { /* 未サポート または 拒否 → 静か に 諦め */ }
}

function _pfReleaseWakeLock() {
  if (!_pfState) return;
  if (_pfState.visHandler) {
    document.removeEventListener('visibilitychange', _pfState.visHandler);
    _pfState.visHandler = null;
  }
  if (_pfState.wakeLock) {
    try { _pfState.wakeLock.release(); } catch {}
    _pfState.wakeLock = null;
  }
}

function _pfWireEvents() {
  if (!_pfState) return;
  const root = document.getElementById('pf-root');
  document.getElementById('pf-exit')?.addEventListener('click', () => {
    history.back();
  });
  document.getElementById('pf-pause')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _pfTogglePause();
    _pfShowControls();
  });
  document.getElementById('pf-prev')?.addEventListener('click', (e) => {
    e.stopPropagation(); _pfPrev(); _pfShowControls();
  });
  document.getElementById('pf-next')?.addEventListener('click', (e) => {
    e.stopPropagation(); _pfNext(); _pfShowControls();
  });
  // v1240 モード 切替 (tile ↔ single) を hash で 実現、 現 URL に mode を 差替
  document.getElementById('pf-mode')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const nextMode = _pfState.mode === 'tile' ? 'single' : 'tile';
    const params = new URLSearchParams();
    if (_pfState.albumId) params.set('album', String(_pfState.albumId));
    params.set('mode', nextMode);
    location.hash = '#/photo/frame?' + params.toString();
  });
  root?.addEventListener('click', (e) => {
    if (e.target === root || e.target.id === 'pf-slide' || e.target.tagName === 'IMG') {
      _pfShowControls();
    }
  });
  // キー
  _pfState.keyHandler = (e) => {
    if (!_pfState) return;
    if (e.key === 'Escape')       history.back();
    else if (e.key === 'ArrowLeft')  { _pfPrev(); _pfShowControls(); }
    else if (e.key === 'ArrowRight') { _pfNext(); _pfShowControls(); }
    else if (e.key === ' ')          { _pfTogglePause(); _pfShowControls(); e.preventDefault(); }
  };
  document.addEventListener('keydown', _pfState.keyHandler);
  // スワイプ (簡易)
  let sx = 0;
  root?.addEventListener('touchstart', (e) => { sx = e.changedTouches[0].screenX; }, { passive: true });
  root?.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].screenX - sx;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) _pfNext(); else _pfPrev();
    _pfShowControls();
  }, { passive: true });
  // hash 変わったら 自動 cleanup
  _pfState.hashHandler = () => {
    if (!location.hash.startsWith('#/photo/frame')) _cleanupPhotoFrame();
  };
  window.addEventListener('hashchange', _pfState.hashHandler);
}

function _cleanupPhotoFrame() {
  if (!_pfState) return;
  clearTimeout(_pfState.timer);
  clearTimeout(_pfState.themeBadgeTimer);
  _pfReleaseWakeLock();
  if (_pfState.keyHandler)    document.removeEventListener('keydown', _pfState.keyHandler);
  if (_pfState.hashHandler)   window.removeEventListener('hashchange', _pfState.hashHandler);
  if (_pfState.resizeHandler) {
    window.removeEventListener('resize', _pfState.resizeHandler);
    window.removeEventListener('orientationchange', _pfState.resizeHandler);
  }
  _pfState = null;
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
