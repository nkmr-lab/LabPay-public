// v1234 fb (中村さん 依頼) — photo.nkmr.io の アルバム と 写真 を LabPay 内 で 閲覧。
//   これ まで の #/albums は Google Photos アルバム URL を 外部タブ で 開く 一覧 だった が、
//   photo.nkmr.io 側 で LabPay 向け API (`?action=albums` / `album_detail` / `timeline&album=`)
//   と CORS (`*.nkmr.io` 許可 + credentials) が 揃った の で、 ブラウザ 直叩き で LabPay 内 で
//   アルバム を 展開 → タイル → ライトボックス まで やる。
//
// route:
//   #/photo                    — アルバム 一覧 (albums)
//   #/photo/album/:slug        — アルバム 詳細 (timeline&album=<id>, 古い順、 タイル 表示)
//   #/photo/frame              — フォトフレーム (フルスクリーン、 タイル/顔/single、 Wake Lock)
//   #/photo/people             — 人物 一覧 + 名前検索 (v1245 P3)
//   #/photo/people/:id         — 人物 プロフィール (表情 / 共写り / 場所 / 写真 一覧) (v1245 P3)
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
      <div class="row center" style="flex-wrap:wrap; gap:6px">
        <h2 style="margin:0">🖼 フォト アルバム</h2>
        <a href="#/photo/people" class="btn" style="margin-left:auto; font-size:12px; padding:4px 12px; text-decoration:none">👤 人物</a>
        <!-- v1258 中村さん判断: フォトフレーム UI は 完成度 低い の で ボタン 撤去。 route は 残す。 -->
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
      <!-- v1258 フォトフレーム ボタン 撤去 (完成度 低い) -->
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
  // v1244 中村さん要望「LabPhoto に 顔だけ の 画像 が 山ほど ある、 face mode やって」
  //   → 3 way: tile (既定、 全体写真 タイル) / face (顔 crop タイル) / single (1 枚)
  const mode = (opts.mode === 'single' || opts.mode === 'face') ? opts.mode : 'tile';
  const sec = Math.max(2, Math.min(120, Number(opts.sec) || 8));
  const tileSec = Math.max(1, Math.min(30, Number(opts.tile_sec) || 4));
  const albumId = opts.album ? Number(opts.album) : null;
  const personLockId = opts.person ? Number(opts.person) : null;   // v1245 特定 人物 の 写真 だけ
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
        <button id="pf-mode" aria-label="モード" title="tile / face / single 切替"
                style="width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.9); border:none; font-size:18px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.5)">${mode === 'tile' ? '🎞' : (mode === 'face' ? '👤' : '🎨')}</button>
        <button id="pf-exit" aria-label="閉じる"
                style="width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.9); border:none; font-size:20px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.5)">✕</button>
      </div>
      <!-- v1242 現 テーマ バッジ (シーン 切替 時 に 5 秒 だけ 出す) -->
      <div id="pf-theme"
           style="position:absolute; top:12px; left:12px; padding:6px 14px; background:rgba(0,0,0,0.65); color:#fff; border-radius:16px; font-size:13px; font-weight:600; opacity:0; transition:opacity 0.5s; pointer-events:none; max-width:60vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; z-index:2"></div>
      <div id="pf-hint" style="position:absolute; bottom:12px; left:12px; color:rgba(255,255,255,0.55); font-size:11px; pointer-events:none">タップ で 操作 / ${mode === 'tile' ? 'タイル' : (mode === 'face' ? '顔タイル' : 'single')} モード</div>
    </div>
  `;
  _pfState = {
    queue: [], seen: new Set(), showing: null, idx: -1,
    sec, tileSec, albumId, personLockId, mode, fit,
    paused: false, timer: null, wakeLock: null,
    controlsShownUntil: 0,
    // face タイル (grid) 用
    tileWraps: [], tileCount: 0, tilePhotos: [],
    // v1247 photo モザイク 用 (aspect 保持 の 事前ロード pool + 現在 tile 情報)
    mosaicPool: [], mosaicTiles: [],
    // v1242 テーマ (album/year/person/mixed) + シーン カウンタ + キャッシュ
    theme: null, currentFilter: null, rotationsUntilScene: 8,
    albumsCache: null, peopleCache: null, themeBadgeTimer: null,
  };
  // v1242 最初 の テーマ を 選択 して から バッファ を 埋める。
  // v1244 face モード は テーマ 固定 (「👤 顔 タイル」)、 通常 モード は _pfNewTheme で ランダム 選択
  if (mode === 'face') {
    _pfState.theme = { type: 'face', label: '👤 顔 タイル' };
    _pfState.currentFilter = null;
  } else {
    await _pfNewTheme();
  }
  await _pfLoadMore();
  if (!_pfState.queue.length) {
    const l = document.getElementById('pf-loading');
    if (l) l.textContent = '写真 が 取得 できませんでした';
    return;
  }
  _pfAcquireWakeLock();
  // v1244 face モード も tile モード と 同じ グリッド レイアウト を 使う (中身 が 顔 crop に なる だけ)
  if (mode === 'tile' || mode === 'face') _pfStartTile();
  else                                    _pfNext();
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
  // v1246 fb#505 photo モード (mode='tile') は フォトモザイク (justified rows) で 縦横 考慮
  //   して 敷き詰める。 空き 領域 ゼロ。 face モード は 従来 の hero+サブ グリッド 継続
  //   (顔 crop は 均一 サイズ な の で グリッド で 綺麗)。
  if (_pfState.mode === 'tile') return _pfStartMosaic();
  const slide = document.getElementById('pf-slide');
  if (!slide) return;
  const layout = _pfComputeLayout();
  const count = layout.tiles.length;
  _pfState.layout = layout;
  _pfState.tileCount = count;
  _pfState.tilePhotos = new Array(count).fill(null);
  // v1243 中村さん要望「できるだけ 画像 全体 が 出る ように、 顔 が 見えない と かある」
  //   → object-fit:cover (トリミング) → contain (全体表示) に 変更、 ただし 単純 contain だ と
  //   タイル に 黒枠 が 出る の で、 同じ 画像 を **ブラー して 引き伸ばした 背景** で 埋める。
  //   Apple Music / Spotify カバー 風 の 見た目。 これ で 顔 が 切れず、 黒枠 も 目立たない。
  slide.innerHTML = `
    <div id="pf-tiles" style="position:absolute; inset:0; display:grid;
                              grid-template-columns:repeat(${layout.cols}, 1fr);
                              grid-template-rows:repeat(${layout.rows}, 1fr);
                              gap:3px; background:#000">
      ${layout.tiles.map(t => `
        <div class="pf-tile" style="grid-column:${t.c}; grid-row:${t.r}; position:relative; overflow:hidden; background:#111">
          <img class="pf-bg" alt="" style="position:absolute; inset:-8%; width:116%; height:116%; object-fit:cover; filter:blur(22px) brightness(0.55) saturate(1.2); opacity:0; transition:opacity 0.7s">
          <img class="pf-fg" alt="" style="position:absolute; inset:0; width:100%; height:100%; object-fit:contain; opacity:0; transition:opacity 0.7s; z-index:1">
          <div class="pf-tile-label" style="position:absolute; bottom:0; left:0; right:0; padding:4px 8px; color:#fff; background:linear-gradient(to top, rgba(0,0,0,0.75), transparent); font-size:12px; font-weight:600; opacity:0; transition:opacity 0.7s; z-index:2; text-align:center; pointer-events:none; text-shadow:0 1px 2px rgba(0,0,0,0.8)"></div>
        </div>`).join('')}
    </div>
  `;
  _pfState.tileWraps = Array.from(document.querySelectorAll('#pf-tiles .pf-tile'));
  // 初期 埋め: 一気 に。 6 枚 だけ な の で ジグザグ 遅延 は 短め (演出)
  for (let i = 0; i < count; i++) {
    const p = _pfConsume();
    if (p) {
      if (i === 0) _pfPaintTile(i, p);
      else setTimeout(() => {
        if (!_pfState || !_pfState.tileWraps[i]) return;
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

// ---------- v1246 フォトモザイク (photo モード = mode='tile') ----------
// 中村さん要望「フォトフレーム が 写真を全部入れる ように したので、 何もない領域が多くて
//   カッコ悪い。 フォトモザイクの タイルの ように 縦横考慮しつつ、 しっかり敷き詰めるように」
//
// 実装: justified rows (Flickr / Google Photos 風)。 各 写真 の 自然 縦横比 を Image.decode()
//   で 取得 → 目標 行高 (画面 高 / 目標行数) を 基準 に、 累積 aspect が 幅 を 超えた ところ
//   で 行 を 折る → 各 行 の 実 行高 = 幅 / 累積aspect、 各 タイル 幅 = 行高 × aspect。
//   これ で タイル と 画像 の 縦横比 が 完全 一致 → object-fit は cover/contain どちら でも
//   同じ (画像全体 表示 かつ 空き ゼロ)。
//   ローテ: 完全 reflow (新しい 写真 + 新しい 縦横比 で 自動 的 に レイアウト 変わる)。

function _loadImgDims(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1200, h: img.naturalHeight || 800 });
    img.onerror = () => resolve({ w: 1200, h: 800 });   // 失敗 は landscape default で スキップ せず 続行
    img.src = src;
  });
}

async function _pfBuildMosaicRows(photos, containerW, containerH) {
  // 各 写真 の 自然 サイズ を 並列 取得 (medium = view2048、 fetch はブラウザキャッシュに乗る)
  const withDims = await Promise.all(photos.map(async (p) => {
    const src = assetMediaUrl(p.asset_id, 'medium');
    const d = await _loadImgDims(src);
    // 極端 な aspect は 抑制 (2 パノラマ が 1 行 占領 する の を 避け、 縦長 too 縦 も 制限)
    let aspect = d.w / d.h;
    if (!isFinite(aspect) || aspect <= 0) aspect = 1.5;
    aspect = Math.max(0.5, Math.min(3.0, aspect));
    return { photo: p, aspect };
  }));

  // 目標 行数: landscape=3、 portrait=4 (画面 高 と の 比 で 決定)
  const landscape = containerW > containerH;
  const rowCount = landscape ? 3 : 4;
  const targetRowH = containerH / rowCount;
  // Justified pack: 累積 aspect × targetRowH が 幅 を 超えたら 行 を 閉じる
  const rows = [];
  let cur = [];
  let curSum = 0;
  for (const it of withDims) {
    cur.push(it);
    curSum += it.aspect;
    if (curSum * targetRowH >= containerW) {
      rows.push({ height: containerW / curSum, items: cur });
      cur = []; curSum = 0;
    }
  }
  // 余った 分 は 最後 の 行 に (最大 targetRowH * 1.3 で 抑える)
  if (cur.length) {
    const h = Math.min(targetRowH * 1.3, containerW / Math.max(curSum, 0.5));
    rows.push({ height: h, items: cur });
  }
  // 全体 行高 合計 が 画面 高 と 大きく ズレる 場合 は 均等 スケール (下 に 隙間 が 出ない ように)
  const totalH = rows.reduce((a, r) => a + r.height, 0);
  if (totalH > 0 && totalH < containerH * 0.98) {
    const k = containerH / totalH;
    rows.forEach(r => r.height *= k);
  } else if (totalH > containerH * 1.02) {
    const k = containerH / totalH;
    rows.forEach(r => r.height *= k);
  }
  return rows;
}

// v1247 中村さん要望「モザイク の 中 の 1 枚 ずつ を、 配置可能 な ところ に 上手く あて
//   込みつつ 配置 して、 定期的 に (例えば 1 分 おきに) 全部 表示 を 変える 感じ」
//   → 個別 タイル 差替 (aspect が 近い 写真 を pool から 選び、 同じ タイル 枠 の まま fade
//   swap)、 一定 間隔 (~60 秒) で 全面 reflow (scene change)。 pool は 事前 に 縦横比
//   ロード 済 の 写真 を 溜めて おき、 対象 タイル の aspect に **一番近い** もの を 使う
//   → タイル 枠 (幅×高さ) は 変わらず、 画像 の 縦横比 も 完全 一致 で crop なし。

async function _pfEnsureMosaicPool(minSize) {
  if (!_pfState) return;
  if (!_pfState.mosaicPool) _pfState.mosaicPool = [];
  const alreadyInPool = new Set(_pfState.mosaicPool.map(x => x.photo.asset_id));
  let safety = 8;
  let themeRetries = 2;   // v1248 テーマ 尽きたら 別 テーマ に 切替 (URL ロック 除く)
  while (_pfState.mosaicPool.length < minSize && safety-- > 0) {
    const excl = Array.from(_pfState.seen || []).slice(-80);
    const f = _pfState.currentFilter || {};
    const items = await fetchRandomPhotos({
      count: 12,
      album_id: f.album_id,
      person_id: f.person_id,
      year: f.year,
      exclude_ids: excl,
    }).catch(e => { console.warn('[pf] pool fetch failed', e); return []; });
    const fresh = items.filter(p =>
      p && p.asset_id && !_pfState.seen.has(p.asset_id) && !alreadyInPool.has(p.asset_id)
    );
    if (!fresh.length) {
      // v1248 テーマ が 尽きた (or API から 空 が 返って きた) → 別テーマ を 試す。
      //   ただし URL ?album=X / ?person=X で ロック されて いる 場合 は 諦める。
      if (_pfState.albumId || _pfState.personLockId || themeRetries-- <= 0) break;
      await _pfNewTheme();
      _pfState.seen = new Set();   // 別 テーマ は 別 プール として seen リセット
      continue;
    }
    // 縦横比 を 並列 取得
    const dims = await Promise.all(fresh.map(p => _loadImgDims(assetMediaUrl(p.asset_id, 'medium'))));
    if (!_pfState) return;
    for (let i = 0; i < fresh.length; i++) {
      _pfState.seen.add(fresh[i].asset_id);
      alreadyInPool.add(fresh[i].asset_id);
      let a = dims[i].w / dims[i].h;
      if (!isFinite(a) || a <= 0) a = 1.5;
      a = Math.max(0.5, Math.min(3.0, a));
      _pfState.mosaicPool.push({ photo: fresh[i], aspect: a });
    }
  }
}

async function _pfStartMosaic() {
  if (!_pfState) return;
  const slide = document.getElementById('pf-slide');
  if (!slide) return;
  const W = slide.clientWidth || window.innerWidth;
  const H = slide.clientHeight || window.innerHeight;
  _pfState.layout = { cols: W > H ? 'ML' : 'MP', rows: '' };
  // Pool を 事前 に 満たす (初期 12 枚 + swap 用 12 枚 の 余裕)
  slide.innerHTML = `<div id="pf-mosaic-loading" style="color:#666; font-size:12px; position:absolute; inset:0; display:flex; align-items:center; justify-content:center">組み立て中…</div>`;
  await _pfEnsureMosaicPool(24);
  if (!_pfState) return;
  if (!_pfState.mosaicPool || _pfState.mosaicPool.length < 1) {
    slide.innerHTML = `<div style="color:#999; font-size:14px; position:absolute; inset:0; display:flex; align-items:center; justify-content:center">写真 が 見つかりません<br>(全 テーマ を 試しました)</div>`;
    return;
  }
  // 初期 表示 用 に 12 枚 pop (無ければ ある だけ)、 スワップ 用 に 少なくとも 6 は 残す
  const takeInitial = Math.min(12, Math.max(1, _pfState.mosaicPool.length - 6));
  const initial = _pfState.mosaicPool.splice(0, takeInitial);
  // 初期 が 極少 (< 3) なら 見た目 を 補強 する ため に pool を 借りて 埋める
  if (initial.length < 3) {
    while (initial.length < 3 && _pfState.mosaicPool.length > 0) {
      initial.push(_pfState.mosaicPool.shift());
    }
    // それ でも 1〜2 枚 しか ない 場合 は そのまま (少ない タイル で 表示)
  }
  // Justified rows レイアウト (v1249 pick-best-N、 W と H を 完全 に 埋める)
  const rows = _pfBuildRowsFromItems(initial, W, H);
  // 描画: 各 タイル の 幅 は row 側 で 事前計算 済み の it.width を 使う (W フル 保証)
  slide.innerHTML = `
    <div id="pf-mosaic"
         style="position:absolute; inset:0; display:flex; flex-direction:column; background:#000; opacity:0; transition:opacity 0.7s">
      ${rows.map(row => `
        <div style="display:flex; height:${row.height.toFixed(2)}px; gap:0">
          ${row.items.map(it => `
            <div class="pf-mtile" data-asset="${escapeHtml(String(it.photo.asset_id))}"
                 style="width:${it.width.toFixed(2)}px; height:100%; overflow:hidden; background:#111">
              <img src="${escapeHtml(assetMediaUrl(it.photo.asset_id, 'medium'))}"
                   alt="" loading="lazy"
                   style="width:100%; height:100%; object-fit:cover; display:block; transition:opacity 0.6s"
                   onerror="this.style.opacity=0.15">
            </div>`).join('')}
        </div>`).join('')}
    </div>`;
  requestAnimationFrame(() => {
    const el = document.getElementById('pf-mosaic');
    if (el) el.style.opacity = '1';
  });
  _pfSetCaption(initial[0].photo);
  // タイル 情報: **タイル 縦横比** (width/height) を 記録 → swap 時 に photo aspect が
  // 近い もの を 選ぶ (crop を 最小化)。 photo aspect ≠ tile aspect の 場合 は cover crop。
  _pfState.mosaicTiles = [];
  const tileEls = Array.from(document.querySelectorAll('#pf-mosaic .pf-mtile'));
  let flat = [];
  for (const row of rows) for (const it of row.items) flat.push({ tileAspect: it.width / row.height, photo: it.photo });
  for (let i = 0; i < tileEls.length && i < flat.length; i++) {
    _pfState.mosaicTiles.push({ el: tileEls[i], aspect: flat[i].tileAspect, photo: flat[i].photo });
  }
  // 個別 タイル 差替 スケジューラ を 起動 (scene 60 秒 は _pfScheduleMosaicSwap 内 で 判定)
  _pfState.rotationsUntilScene = _pfMosaicScenesPerRotation();
  _pfScheduleMosaicSwap();
  // resize / rotate で 全面 rebuild (画面 サイズ 変わったら 再計算 必須)
  if (!_pfState.resizeHandler) {
    _pfState.resizeHandler = () => {
      if (!_pfState) return;
      if (_pfState.mode === 'tile') _pfStartMosaic();
      else {
        const next = _pfComputeLayout();
        const cur = _pfState.layout;
        if (!cur || cur.cols !== next.cols || cur.rows !== next.rows) _pfStartTile();
      }
    };
    window.addEventListener('resize', _pfState.resizeHandler);
    window.addEventListener('orientationchange', _pfState.resizeHandler);
  }
}

// scene change の 目安 = 60 秒。 tileSec (=個別 swap 間隔、 既定 4 秒) で 割った 回数。
function _pfMosaicScenesPerRotation() {
  const sec = _pfState?.tileSec || 4;
  return Math.max(4, Math.round(60 / sec));   // 60秒 に 近づく ように
}

function _pfScheduleMosaicSwap() {
  if (!_pfState) return;
  clearTimeout(_pfState.timer);
  if (_pfState.paused) return;
  _pfState.timer = setTimeout(async () => {
    if (!_pfState) return;
    // 一定 回数 に 一度、 完全 reflow (テーマ + レイアウト + 全 タイル)
    _pfState.rotationsUntilScene = (_pfState.rotationsUntilScene ?? _pfMosaicScenesPerRotation()) - 1;
    if (_pfState.rotationsUntilScene <= 0) {
      _pfState.rotationsUntilScene = _pfMosaicScenesPerRotation();
      await _pfSceneChange();   // 新 theme + 新 mosaic (pool も reset される)
      return;
    }
    // 個別 タイル 差替
    _pfSwapOneMosaicTile();
    _pfScheduleMosaicSwap();
  }, (_pfState.tileSec || 4) * 1000);
}

function _pfSwapOneMosaicTile() {
  if (!_pfState || !_pfState.mosaicTiles || _pfState.mosaicTiles.length === 0) return;
  // pool が 少なく なったら 裏 で 補充 (await しない)
  if (!_pfState.mosaicPool || _pfState.mosaicPool.length < 6) {
    _pfEnsureMosaicPool(12);
  }
  if (!_pfState.mosaicPool || _pfState.mosaicPool.length === 0) return;
  // 対象 タイル を ランダム、 pool から aspect が **一番近い** 1 枚 を 選ぶ (完全一致 に 近ければ crop ゼロ)
  const tileIdx = Math.floor(Math.random() * _pfState.mosaicTiles.length);
  const tile = _pfState.mosaicTiles[tileIdx];
  if (!tile || !tile.el || !tile.el.isConnected) return;
  const target = tile.aspect;
  let bestI = 0, bestDiff = Infinity;
  for (let i = 0; i < _pfState.mosaicPool.length; i++) {
    const d = Math.abs(_pfState.mosaicPool[i].aspect - target) / target;
    if (d < bestDiff) { bestDiff = d; bestI = i; }
  }
  const next = _pfState.mosaicPool.splice(bestI, 1)[0];
  if (!next) return;
  // Fade replace (タイル 枠 は 変えない、 aspect が 近い ので object-fit:cover で 実質 crop ゼロ)
  const img = tile.el.querySelector('img');
  if (!img) return;
  img.style.opacity = '0';
  setTimeout(() => {
    if (!_pfState || !tile.el.isConnected) return;
    img.onload = () => { img.style.opacity = '1'; };
    img.onerror = () => { img.style.opacity = '0.15'; };
    img.src = assetMediaUrl(next.photo.asset_id, 'medium');
    tile.photo = next.photo;
    tile.el.dataset.asset = String(next.photo.asset_id);
  }, 350);
  _pfSetCaption(next.photo);
}

// v1249 中村さん報告 3 件 (「5+5+2 で 右3分の1 黒」+「写真足りません」+「枚数少ない
//   場合 は もっと 大きく」)。 前 版 の rescale が 「W フル」不変条件 を 壊して いた の が
//   根本原因 なので、 レイアウト アルゴ を **pick-best-N** に 差替:
//     (1) 幾何 的 に 最適 な 行数 N を `sqrt(H × totalAspect / W)` から 推定
//     (2) minN..maxN で 「均等 aspect 分割」→ 「totalH が H に 近い + 行高 の ばらつき 小」を
//         スコア で 選ぶ
//     (3) タイル 幅 = `W × (item.aspect / row.aspectSum)` で 各 行 が **常 に W フル**
//     (4) 行高 は H / N (均等) で 縦 も 完全 に 埋める、 タイル 縦横比 と 写真 縦横比 の 微差
//         は object-fit:cover の 軽い crop で 吸収
//     (5) items 数 が 少ない (< 3 枚) → 自動 で N=1 に、 タイル が 大きく なる (「少ない
//         なら 大きく」)。 12 枚 なら N=3 (typical)。
function _packInNRows(items, N) {
  if (N <= 0) N = 1;
  const total = items.reduce((s, i) => s + i.aspect, 0);
  const target = total / N;
  const rows = [{ items: [], aspectSum: 0 }];
  for (const it of items) {
    const cur = rows[rows.length - 1];
    const canNew = rows.length < N && cur.items.length > 0;
    if (canNew && cur.aspectSum + it.aspect > target) {
      rows.push({ items: [it], aspectSum: it.aspect });
    } else {
      cur.items.push(it);
      cur.aspectSum += it.aspect;
    }
  }
  return rows;
}

function _pfBuildRowsFromItems(items, containerW, containerH) {
  if (!items.length) return [];
  const totalAspect = items.reduce((s, i) => s + i.aspect, 0);
  // 幾何 的 に 最適 な 行数 (等 aspect 分割 + 各 行 W フル で totalH ≈ H に なる N)
  const idealNRaw = Math.sqrt(Math.max(1, containerH * totalAspect / Math.max(containerW, 1)));
  const idealN = Math.max(1, Math.round(idealNRaw));
  // 少ない 枚数 は 少ない 行 に (「大きく 表示」)
  const cap = Math.min(items.length, 6);
  const minN = Math.max(1, idealN - 1);
  const maxN = Math.min(cap, idealN + 2);

  let best = null;
  for (let N = minN; N <= maxN; N++) {
    if (N > items.length) break;
    const rows = _packInNRows(items, N);
    if (rows.length < 1 || rows.some(r => r.items.length === 0)) continue;
    // 各 行 が W を フル に する 場合 の 自然 行高 = W / sum(aspect)
    const heights = rows.map(r => containerW / Math.max(r.aspectSum, 0.5));
    const totalH = heights.reduce((a, b) => a + b, 0);
    const mean = totalH / rows.length;
    const range = Math.max(...heights) - Math.min(...heights);
    const evenness = range / (mean || 1);              // 行高 の ばらつき (小さい ほど 良い)
    const fitDelta = Math.abs(totalH - containerH) / containerH;   // 縦 の フィット 誤差
    const score = fitDelta * 3 + evenness;             // fit を 重視、 evenness も 少し
    if (!best || score < best.score) best = { rows, heights, totalH, score };
  }
  if (!best) return [];

  // 行高 を 「均等 (containerH / rows.length)」に 揃える → 縦 完全 に H を 埋める
  const eqH = containerH / best.rows.length;
  const finalRows = best.rows.map((r) => ({
    height: eqH,
    aspectSum: r.aspectSum,
    // タイル 幅 は aspect 按分 で W を 完全 に 埋める (widths.sum = W)
    items: r.items.map((it) => ({
      photo: it.photo,
      aspect: it.aspect,
      width: containerW * (it.aspect / Math.max(r.aspectSum, 0.001)),
    })),
  }));
  return finalRows;
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
  const wrap = _pfState.tileWraps[i];
  if (!wrap) return;
  const fg = wrap.querySelector('.pf-fg');
  const bg = wrap.querySelector('.pf-bg');
  if (!fg || !bg) return;
  // v1244 face モード は face.php 経由 の 顔 crop、 通常 モード は media.php の medium
  const src = photo._face
    ? `${PHOTO_ORIGIN}/face.php?id=${encodeURIComponent(photo.face_id)}`
    : assetMediaUrl(photo.asset_id, 'medium');
  // v1244 face タイル は 名前 ラベル を 表示 (常時 、 淡い グラデ)、 通常 タイル は 隠す
  const label = wrap.querySelector('.pf-tile-label');
  if (label) {
    if (photo._face && photo.people && photo.people[0]?.name) {
      label.textContent = photo.people[0].name;
      label.style.opacity = '1';
    } else {
      label.textContent = '';
      label.style.opacity = '0';
    }
  }
  // v1243 フェード: 前景 と 背景 (blur) の 両方 を 同時 に アニメ
  fg.style.opacity = '0';
  bg.style.opacity = '0';
  const swap = () => {
    if (!_pfState || !_pfState.tileWraps[i]) return;
    fg.onload = () => { fg.style.opacity = '1'; bg.style.opacity = '1'; };
    fg.onerror = () => { fg.style.opacity = '0'; bg.style.opacity = '0'; };
    // 背景 は 別 img で 同 URL (ブラウザ が キャッシュ 一致 する ので 二重 fetch に は ならない)
    bg.src = src;
    fg.src = src;
    _pfState.tilePhotos[i] = photo;
  };
  // 初期 (opacity 既に 0) は 即 swap、 差替 時 は 0.4s 待って swap
  if (fg.src) setTimeout(swap, 400);
  else        swap();
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
// v1244 face モード は テーマ 選択 不要 (常 に 「👤 顔 タイル」)、 people の シャッフル 更新 のみ
async function _pfSceneChange() {
  if (!_pfState) return;
  if (_pfState.mode === 'face') {
    _pfState.theme = { type: 'face', label: '👤 顔 タイル' };
    _pfState.currentFilter = null;
  } else {
    await _pfNewTheme();
  }
  _pfState.queue = [];
  _pfState.seen = new Set();
  _pfState.idx = -1;
  // v1247 tile モード の mosaic pool と tile 情報 も リセット (新 テーマ で 再構築)
  _pfState.mosaicPool = [];
  _pfState.mosaicTiles = [];
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
  // v1245 URL ?person=X で 特定 人物 に ロック (人物 プロフィール から の 「この人 で フォトフレーム」)
  if (_pfState.personLockId) {
    _pfState.theme = { type: 'person', label: '👤 選択 人物' };
    _pfState.currentFilter = { person_id: _pfState.personLockId };
    await _pfEnsurePeopleCache();
    const p = (_pfState.peopleCache || []).find(x => Number(x.id) === Number(_pfState.personLockId));
    if (p) _pfState.theme.label = `👤 ${p.name}`;
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
  // v1244 face モード: people 一覧 の 各 cover face_id を シャッフル して queue に 入れる。
  //   photo (アセット) の 代わり に { _face: true, face_id, people:[{id,name}] } を pseudo-photo
  //   として 扱う。 _pfPaintTile 側 で _face フラグ で URL を 切替 (assetMediaUrl → face.php)。
  if (_pfState.mode === 'face') {
    await _pfEnsurePeopleCache();
    const people = _pfState.peopleCache || [];
    const withCover = people.filter(p => p.cover);
    // シャッフル して 追加
    const shuffled = withCover.slice().sort(() => Math.random() - 0.5);
    for (const p of shuffled) {
      const key = 'face:' + p.cover;
      if (_pfState.seen.has(key)) continue;
      _pfState.queue.push({
        _face: true, face_id: p.cover,
        people: [{ id: p.id, name: p.name }],
      });
      _pfState.seen.add(key);
    }
    return;
  }
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
  // v1242 tile モード の 「次」 は シーン 切替 (新 テーマ + 新 レイアウト) に 変更。
  // v1244 face モード も 同様 に シーン 切替 (新 6 人 + 新 レイアウト)。
  //   _pfSceneChange → _pfStartTile が 内部 で _pfScheduleTileRotate まで やる ので 追加 schedule 不要。
  if (_pfState.mode === 'tile' || _pfState.mode === 'face') {
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
  // v1244/v1245 モード 切替 (tile → face → single → tile) を hash で 実現、 現 URL に mode を 差替。
  //   album/person の ロック は 維持 (「この アルバム で フォトフレーム」→ mode 切替 も その アルバム 内)。
  document.getElementById('pf-mode')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const cycle = { tile: 'face', face: 'single', single: 'tile' };
    const nextMode = cycle[_pfState.mode] || 'tile';
    const params = new URLSearchParams();
    if (_pfState.albumId)      params.set('album', String(_pfState.albumId));
    if (_pfState.personLockId) params.set('person', String(_pfState.personLockId));
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

// ================================================================================
// v1245 P3: 人物検索 + プロフィール
// ================================================================================
//   LabPhoto v109 の people?q= + person_profile (expressions/places/coappearances) +
//   person_photos が 揃った の で、 「この人 って どんな人?」 を LabPay 内 で 見られる ように。
//
// route:
//   #/photo/people             — 一覧 + 検索 (people?q=)
//   #/photo/people/:id         — プロフィール (person_profile → 表情バー / 共写り / 場所 / サンプル + 写真無限スクロール)

const _FACE_URL = (faceId) => `${PHOTO_ORIGIN}/face.php?id=${encodeURIComponent(faceId)}`;

// 表情 の 日本語 ラベル + 絵文字 (FER+ の kind)
const _EXPRESSION_LABEL = {
  happiness: { emoji: '😀', ja: '笑顔',   color: '#f59e0b' },
  neutral:   { emoji: '😐', ja: 'ふつう', color: '#6b7280' },
  surprise:  { emoji: '😲', ja: '驚き',   color: '#8b5cf6' },
  sadness:   { emoji: '😢', ja: '悲しみ', color: '#3b82f6' },
  anger:     { emoji: '😠', ja: '怒り',   color: '#dc2626' },
  disgust:   { emoji: '🤢', ja: '嫌悪',   color: '#65a30d' },
  fear:      { emoji: '😨', ja: '怯え',   color: '#0891b2' },
  contempt:  { emoji: '😒', ja: '軽蔑',   color: '#a16207' },
};

// ---------------- 一覧 (#/photo/people) ----------------

export async function renderPhotoPeople({ query } = {}) {
  const app = document.getElementById('app');
  const q0 = (query && query.q) || '';
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">👤 人物 一覧</h2>
        <a href="#/photo" class="hint" style="margin-left:auto; font-size:12px">← アルバム へ</a>
      </div>
      <div class="hint-sm" style="margin-top:4px">photo.nkmr.io の 顔識別 データ から、 ラボメン の 一覧 + プロフィール を 見る。</div>
    </div>
    <div class="card">
      <input type="search" id="pp-q" placeholder="🔍 名前 で 検索 (中村 / なかむら / Nakamura)"
             maxlength="80" value="${escapeHtml(q0)}"
             style="width:100%; box-sizing:border-box; padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:14px">
      <div class="hint-sm" style="margin-top:4px" id="pp-count">読み込み中…</div>
    </div>
    <div id="pp-grid"
         style="display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:8px; margin-top:8px"></div>
  `;
  const qEl = document.getElementById('pp-q');
  const gridEl = document.getElementById('pp-grid');
  const countEl = document.getElementById('pp-count');

  const doSearch = async (q) => {
    countEl.textContent = '読み込み中…';
    try {
      const params = q ? { q } : {};
      const d = await photoApi('people', params);
      const people = Array.isArray(d.people) ? d.people : [];
      countEl.textContent = `${people.length} 人${q ? ` (「${q}」で 検索)` : ''}`;
      if (!people.length) {
        gridEl.innerHTML = `<div class="empty" style="grid-column:1/-1">該当 なし</div>`;
        return;
      }
      gridEl.innerHTML = people.map(_personCardHtml).join('');
      gridEl.querySelectorAll('[data-person-id]').forEach(el => {
        el.addEventListener('click', () => {
          navigate('#/photo/people/' + encodeURIComponent(el.dataset.personId));
        });
      });
    } catch (e) {
      countEl.innerHTML = `<span style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</span>`;
      gridEl.innerHTML = '';
    }
  };

  await doSearch(q0);

  let qt = null;
  qEl.addEventListener('input', () => {
    clearTimeout(qt);
    qt = setTimeout(() => doSearch(qEl.value.trim()), 250);
  });
}

function _personCardHtml(p) {
  const cover = p.cover
    ? `<img src="${escapeHtml(_FACE_URL(p.cover))}" loading="lazy" alt=""
             style="width:100%; aspect-ratio:1/1; object-fit:cover; display:block; background:#f3f4f6"
             onerror="this.style.opacity=0.2">`
    : `<div style="width:100%; aspect-ratio:1/1; background:linear-gradient(135deg, #ede4f3, #d4b8e8); display:flex; align-items:center; justify-content:center; font-size:34px">👤</div>`;
  const tags = (p.tags || []).slice(0, 2).map(t =>
    `<span style="display:inline-block; font-size:10px; padding:1px 6px; margin:2px 2px 0 0; background:#e5e7eb; color:#374151; border-radius:8px">${escapeHtml(t)}</span>`
  ).join('');
  return `
    <div class="card" data-person-id="${escapeHtml(String(p.id))}"
         style="cursor:pointer; padding:0; overflow:hidden; border:1px solid #e5e7eb">
      ${cover}
      <div style="padding:6px 8px">
        <div style="font-weight:600; font-size:13px; line-height:1.3; word-break:break-word">${escapeHtml(p.name || '(名前 未設定)')}</div>
        <div class="hint-sm" style="font-size:11px; margin-top:2px; color:#6b7280">
          📷 ${p.photos || p.count || 0} 枚
        </div>
        ${tags ? `<div style="margin-top:3px">${tags}</div>` : ''}
      </div>
    </div>`;
}

// ---------------- プロフィール (#/photo/people/:id) ----------------

export async function renderPhotoPerson({ params, query } = {}) {
  const app = document.getElementById('app');
  const id = Number(params.id);
  app.innerHTML = `
    <div class="card page-header">
      <div><a href="#/photo/people" class="hint" style="font-size:12px">← 人物 一覧 に 戻る</a></div>
      <div id="pp-detail-hdr" style="margin-top:6px">読み込み中…</div>
    </div>
    <div id="pp-detail-body"></div>
  `;
  try {
    const d = await photoApi('person_profile', { id });
    const person = d.person;
    if (!person) throw new Error('person 情報 が 取得 できません');
    _renderPersonHeader(person);
    _renderPersonBody(person);
    // 写真 一覧 (無限 スクロール) は 別 fetch
    _loadPersonPhotos(id, null, null, /*append=*/false);
  } catch (e) {
    document.getElementById('pp-detail-hdr').innerHTML =
      `<span style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</span>`;
  }
}

function _renderPersonHeader(person) {
  const el = document.getElementById('pp-detail-hdr');
  if (!el) return;
  const tags = (person.tags || []).map(t =>
    `<span style="display:inline-block; font-size:11px; padding:1px 6px; margin:0 3px 0 0; background:#e5e7eb; color:#374151; border-radius:8px">${escapeHtml(t)}</span>`
  ).join('');
  const cover = person.cover_face_id
    ? `<img src="${escapeHtml(_FACE_URL(person.cover_face_id))}" alt=""
             style="width:80px; height:80px; border-radius:50%; object-fit:cover; background:#f3f4f6; border:3px solid #fff; box-shadow:0 2px 8px rgba(0,0,0,0.15)">`
    : `<div style="width:80px; height:80px; border-radius:50%; background:linear-gradient(135deg, #ede4f3, #d4b8e8); display:flex; align-items:center; justify-content:center; font-size:36px">👤</div>`;
  const period = (person.first_seen && person.last_seen)
    ? `${_fmtYmd(person.first_seen)} 〜 ${_fmtYmd(person.last_seen)}`
    : (person.first_seen ? `${_fmtYmd(person.first_seen)} 〜` : '');
  el.innerHTML = `
    <div class="row" style="align-items:center; gap:14px">
      ${cover}
      <div style="flex:1; min-width:0">
        <h2 style="margin:0; font-size:20px; word-break:break-word">${escapeHtml(person.name || '(名前 未設定)')}</h2>
        <div class="hint-sm" style="margin-top:4px">📷 ${person.photos_count || 0} 枚${period ? ` · 📅 ${escapeHtml(period)}` : ''}</div>
        ${tags ? `<div style="margin-top:4px">${tags}</div>` : ''}
      </div>
      <!-- v1258 フォトフレーム ボタン 撤去 (完成度 低い) -->
    </div>
  `;
}

function _renderPersonBody(person) {
  const body = document.getElementById('pp-detail-body');
  if (!body) return;

  // サンプル 写真 (直近 12 枚)
  const samples = Array.isArray(person.sample_photos) ? person.sample_photos : [];
  const samplesHtml = samples.length ? `
    <div class="card">
      <h3 style="margin:0 0 8px; font-size:15px">📸 サンプル 写真</h3>
      <div id="pp-samples"
           style="display:grid; grid-template-columns:repeat(auto-fill, minmax(90px, 1fr)); gap:4px">
        ${samples.map((s, i) => `
          <div data-pp-sample-idx="${i}" style="position:relative; cursor:pointer; aspect-ratio:1/1; overflow:hidden; background:#f3f4f6; border-radius:2px">
            <img src="${escapeHtml(_absUrl(s.thumb_url) || assetMediaUrl(s.asset_id, 'thumb'))}" loading="lazy" alt=""
                 style="width:100%; height:100%; object-fit:cover; display:block"
                 onerror="this.style.opacity=0.2">
          </div>`).join('')}
      </div>
    </div>
  ` : '';

  // 表情 分布
  const exprs = Array.isArray(person.top_expressions) ? person.top_expressions : [];
  const exprsHtml = exprs.length ? `
    <div class="card">
      <h3 style="margin:0 0 8px; font-size:15px">😀 表情 の 分布 (上位)</h3>
      ${exprs.map(e => {
        const meta = _EXPRESSION_LABEL[e.kind] || { emoji: '❓', ja: e.kind, color: '#9ca3af' };
        const pct = Math.round((Number(e.score) || 0) * 100);
        return `
          <div style="margin:6px 0">
            <div class="row" style="font-size:12px; align-items:center; gap:6px">
              <span style="width:22px">${meta.emoji}</span>
              <span style="flex:1">${escapeHtml(meta.ja)}</span>
              <span style="font-weight:600; min-width:36px; text-align:right">${pct}%</span>
            </div>
            <div style="height:6px; background:#f3f4f6; border-radius:3px; overflow:hidden; margin-top:2px">
              <div style="height:100%; width:${pct}%; background:${meta.color}; transition:width 0.5s"></div>
            </div>
          </div>`;
      }).join('')}
    </div>
  ` : '';

  // 共写り
  const coap = Array.isArray(person.top_coappearances) ? person.top_coappearances : [];
  const coapHtml = coap.length ? `
    <div class="card">
      <h3 style="margin:0 0 8px; font-size:15px">🤝 よく 一緒 に 写る 人 (上位)</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:6px">
        ${coap.map(c => `
          <a href="#/photo/people/${encodeURIComponent(c.person_id)}"
             style="display:block; text-decoration:none; color:inherit; text-align:center; padding:6px; border:1px solid #e5e7eb; border-radius:6px; background:#fff">
            ${c.cover_face_id
              ? `<img src="${escapeHtml(_FACE_URL(c.cover_face_id))}" loading="lazy" alt=""
                       style="width:56px; height:56px; border-radius:50%; object-fit:cover; background:#f3f4f6">`
              : `<div style="width:56px; height:56px; border-radius:50%; margin:0 auto; background:#ede4f3; display:flex; align-items:center; justify-content:center; font-size:24px">👤</div>`}
            <div style="font-size:12px; font-weight:600; margin-top:4px; word-break:break-word">${escapeHtml(c.name || '')}</div>
            <div class="hint-sm" style="font-size:10px; color:#6b7280">${c.count || 0} 枚 一緒</div>
          </a>`).join('')}
      </div>
    </div>
  ` : '';

  // 場所 (GPS)
  const places = Array.isArray(person.top_places) ? person.top_places : [];
  const placesHtml = places.length ? `
    <div class="card">
      <h3 style="margin:0 0 8px; font-size:15px">📍 よく 撮影 される 場所 (上位)</h3>
      <div class="hint-sm" style="font-size:11px; margin-bottom:6px; color:#6b7280">GPS 座標 を 約 100m で 丸めた もの。 タップ で Google Maps で 開く</div>
      ${places.map(p => `
        <a href="https://www.google.com/maps?q=${p.lat},${p.lng}&z=16" target="_blank" rel="noopener noreferrer"
           style="display:block; padding:6px 10px; margin:3px 0; background:#f9fafb; border-radius:4px; text-decoration:none; color:inherit; font-size:13px">
          📍 <b>${escapeHtml(p.label || `${Number(p.lat).toFixed(3)}, ${Number(p.lng).toFixed(3)}`)}</b>
          <span class="hint-sm" style="color:#6b7280"> · ${p.count || 0} 枚</span>
        </a>
      `).join('')}
    </div>
  ` : '';

  // 写真 一覧 (無限 スクロール、 別 fetch)
  const photosHtml = `
    <div class="card">
      <h3 style="margin:0 0 8px; font-size:15px">🖼 この人 の 写真 一覧</h3>
      <div id="pp-person-photos-status" class="hint-sm" style="text-align:center; padding:10px">読み込み中…</div>
      <div id="pp-person-photos-grid"
           style="display:grid; grid-template-columns:repeat(auto-fill, minmax(100px, 1fr)); gap:4px"></div>
      <div id="pp-person-photos-more" style="text-align:center; margin-top:10px"></div>
    </div>
  `;

  body.innerHTML = samplesHtml + exprsHtml + coapHtml + placesHtml + photosHtml;

  // サンプル タップ で ライトボックス
  if (samples.length) {
    const grid = document.getElementById('pp-samples');
    grid?.querySelectorAll('[data-pp-sample-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.ppSampleIdx);
        const images = samples.map(s => assetMediaUrl(s.asset_id, 'full'));
        openImageLightbox(images[idx] || images[0], { images, index: idx });
      });
    });
  }
}

// この 人 の 写真 一覧 (無限 スクロール) - person_photos endpoint
const _ppPersonPhotos = new Map();  // person_id → [{asset_id, taken_at, thumb_url, ...}, ...]

async function _loadPersonPhotos(personId, before, beforeId, append) {
  const status = document.getElementById('pp-person-photos-status');
  const grid   = document.getElementById('pp-person-photos-grid');
  const more   = document.getElementById('pp-person-photos-more');
  if (!status || !grid || !more) return;
  if (!append) status.textContent = '読み込み中…';
  else         more.innerHTML = '<span class="hint-sm">読み込み中…</span>';
  try {
    const params = { id: personId, limit: 100 };
    if (before)   params.before = before;
    if (beforeId) params.before_id = beforeId;
    const d = await photoApi('person_photos', params);
    const items = Array.isArray(d.photos) ? d.photos : [];
    const prev = _ppPersonPhotos.get(personId) || [];
    const merged = append ? prev.concat(items) : items;
    _ppPersonPhotos.set(personId, merged);
    if (!merged.length) {
      status.innerHTML = `<div class="empty">写真 が ありません</div>`;
      more.innerHTML = '';
      return;
    }
    status.textContent = `${merged.length} 枚${d.next ? '+' : ''}`;
    grid.innerHTML = merged.map((it, idx) => `
      <div data-pp-pp-idx="${idx}" style="position:relative; cursor:pointer; aspect-ratio:1/1; overflow:hidden; background:#f3f4f6; border-radius:2px">
        <img src="${escapeHtml(_absUrl(it.thumb_url) || assetMediaUrl(it.asset_id, 'thumb'))}"
             loading="lazy" alt=""
             style="width:100%; height:100%; object-fit:cover; display:block"
             onerror="this.style.opacity=0.2">
        ${it.type === 'video' ? '<div style="position:absolute; left:3px; top:3px; background:rgba(0,0,0,0.6); color:#fff; padding:1px 4px; border-radius:3px; font-size:10px">▶</div>' : ''}
      </div>`).join('');
    // ライトボックス (動画 除く)
    grid.querySelectorAll('[data-pp-pp-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.ppPpIdx);
        const it = merged[idx];
        if (it.type === 'video') {
          window.open(`${PHOTO_ORIGIN}/media.php?id=${encodeURIComponent(it.asset_id)}&k=video720`, '_blank', 'noopener,noreferrer');
          return;
        }
        const imgs = merged.filter(x => x.type !== 'video');
        const urls = imgs.map(x => assetMediaUrl(x.asset_id, 'full'));
        const mIdx = Math.max(0, imgs.findIndex(x => x.asset_id === it.asset_id));
        openImageLightbox(urls[mIdx] || urls[0], { images: urls, index: mIdx });
      });
    });
    if (d.next) {
      more.innerHTML = `<button class="btn primary" id="pp-pp-more-btn" style="font-size:13px">▼ 続き を 読み込む</button>`;
      document.getElementById('pp-pp-more-btn').addEventListener('click', () => {
        _loadPersonPhotos(personId, d.next.before, d.next.before_id, /*append=*/true);
      });
    } else {
      more.innerHTML = `<div class="hint-sm" style="color:#6b7280">— これ で 全部 —</div>`;
    }
  } catch (e) {
    if (!append) status.innerHTML = `<span style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</span>`;
    else         more.innerHTML = `<span style="color:#dc2626">続き 読み込み 失敗: ${escapeHtml(e?.message || String(e))}</span>`;
  }
}

function _absUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return PHOTO_ORIGIN + (u.startsWith('/') ? u : ('/' + u));
}

function _fmtYmd(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : String(s);
}
