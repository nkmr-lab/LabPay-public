// /#/sns — シンプル SNS (旧 Twitter 風)。
// フォロー なし、 全員 が 全投稿 を 見る。 テキスト + 画像 + 位置 + @メンション。
// 返信 (parent_id)、 いいね (toggle) のみ。 リポスト なし。

import { get, post, del, invalidateContentCache } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { loadLeaflet } from './group_map.js';
import { openImageLightbox as openSharedLightbox } from '../lightbox.js';  // v785 #383 回転 付き lightbox

function fmtRelative(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const diff = Date.now() - dt.getTime();
  if (diff < 60_000) return 'たった今';
  if (diff < 3600_000) return `${Math.floor(diff/60000)} 分前`;
  if (diff < 86400_000) return `${Math.floor(diff/3600000)} 時間前`;
  if (diff < 7*86400_000) return `${Math.floor(diff/86400_000)} 日前`;
  return dt.toLocaleDateString();
}

// v498 #107 JPEG の EXIF から GPS (緯度/経度) を読む小型パーサ。 ライブラリ不要。
//   返り値: {lat, lng} (10 進度) または null。 HEIC/PNG/解析失敗で null。
//   EXIF: JPEG → APP1 (FFE1) + "Exif\0\0" + TIFF → IFD0 → GPS IFD (tag 0x8825) →
//     0x0001 LatitudeRef ('N'/'S'), 0x0002 Latitude (3 rational = 度分秒),
//     0x0003 LongitudeRef ('E'/'W'), 0x0004 Longitude (3 rational)。
async function readExifGps(file) {
  if (!file || !/^image\/jpe?g$/i.test(file.type)) return null;
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const dv = new DataView(buf);
    if (dv.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 < dv.byteLength) {
      const marker = dv.getUint16(off);
      if ((marker & 0xFF00) !== 0xFF00) return null;
      const segLen = dv.getUint16(off + 2);
      if (marker === 0xFFE1
          && off + 10 < dv.byteLength
          && dv.getUint32(off + 4) === 0x45786966
          && dv.getUint16(off + 8) === 0x0000) {
        const tiff = off + 10;
        const le = dv.getUint16(tiff) === 0x4949;
        const u16 = o => dv.getUint16(o, le);
        const u32 = o => dv.getUint32(o, le);
        if (u16(tiff + 2) !== 0x002A) return null;
        const ifd0 = tiff + u32(tiff + 4);
        const n0 = u16(ifd0);
        let gpsIfd = 0;
        for (let i = 0; i < n0; i++) {
          const e = ifd0 + 2 + i * 12;
          if (u16(e) === 0x8825) { gpsIfd = tiff + u32(e + 8); break; }
        }
        if (!gpsIfd) return null;
        let latRef = null, lat = null, lngRef = null, lng = null;
        const readRationalTriple = (dataOff) => {
          // 各 rational = 2 uint32 (numerator, denominator)
          const triple = [];
          for (let k = 0; k < 3; k++) {
            const o = dataOff + k * 8;
            const num = u32(o), den = u32(o + 4);
            triple.push(den ? num / den : 0);
          }
          return triple;
        };
        const dmsToDeg = ([d, m, s]) => d + m / 60 + s / 3600;
        const nG = u16(gpsIfd);
        for (let i = 0; i < nG; i++) {
          const e = gpsIfd + 2 + i * 12;
          const tag = u16(e);
          if (tag === 0x0001) latRef = String.fromCharCode(dv.getUint8(e + 8));
          else if (tag === 0x0003) lngRef = String.fromCharCode(dv.getUint8(e + 8));
          else if (tag === 0x0002) {
            const dataOff = tiff + u32(e + 8);
            if (dataOff + 24 <= dv.byteLength) lat = dmsToDeg(readRationalTriple(dataOff));
          } else if (tag === 0x0004) {
            const dataOff = tiff + u32(e + 8);
            if (dataOff + 24 <= dv.byteLength) lng = dmsToDeg(readRationalTriple(dataOff));
          }
        }
        if (lat == null || lng == null) return null;
        if (latRef === 'S') lat = -lat;
        if (lngRef === 'W') lng = -lng;
        if (!isFinite(lat) || !isFinite(lng)) return null;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
        return { lat, lng };
      }
      off += 2 + segLen;
    }
    return null;
  } catch { return null; }
}

// v548 #207 JPEG クライアント縮小 + EXIF 保持。 ファイルが閾値超えなら canvas で
//   リサイズ → toBlob (JPEG q=0.85) → 元の APP1 EXIF ブロックを 再注入。 オリジナル
//   EXIF (Orientation / GPS / 撮影日時 等) を全部保持しつつ サイズだけ落とす。
//   閾値: 3 MB 超 OR 長辺 3000px 超。 縮小後の長辺は 2400px。
//   非 JPEG (PNG/WebP/HEIC) はそのまま (resize する場合 EXIF は元から無い or 失われる
//   ので 不可逆になりリスク)、 ユーザーのオリジナルを尊重して passthrough。
const RESIZE_BYTE_THRESHOLD = 3 * 1024 * 1024;
const RESIZE_MAX_DIM = 2400;
async function maybeResizeJpegPreserveExif(file) {
  if (!file || !/^image\/jpe?g$/i.test(file.type)) return file;
  if (file.size < RESIZE_BYTE_THRESHOLD) return file;
  // 寸法を実際に読まないと判断できないので image を作る
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('image decode failed'));
      im.src = blobUrl;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    const maxDim = Math.max(w, h);
    // サイズも寸法も小さければそのまま
    if (file.size < RESIZE_BYTE_THRESHOLD && maxDim <= 3000) return file;
    const ratio = maxDim > RESIZE_MAX_DIM ? RESIZE_MAX_DIM / maxDim : 1;
    const nw = Math.max(1, Math.round(w * ratio));
    const nh = Math.max(1, Math.round(h * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = nw; canvas.height = nh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, nw, nh);
    const resizedBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!resizedBlob) return file;
    // EXIF (APP1) を抽出して 縮小 JPEG の SOI 直後に注入
    const merged = await injectExifAppBlock(file, resizedBlob);
    return new File([merged || resizedBlob], file.name.replace(/(\.[^.]*)?$/, '_resized.jpg'), { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
async function injectExifAppBlock(originalFile, resizedBlob) {
  try {
    const orig = new Uint8Array(await originalFile.arrayBuffer());
    if (orig.length < 4 || orig[0] !== 0xFF || orig[1] !== 0xD8) return null;
    let i = 2;
    let app1 = null;
    while (i + 4 < orig.length) {
      if (orig[i] !== 0xFF) break;
      const marker = orig[i + 1];
      if (marker === 0xDA || marker === 0xD9) break; // SOS / EOI に到達
      const segLen = (orig[i + 2] << 8) | orig[i + 3];
      if (marker === 0xE1 && i + 10 < orig.length
          && orig[i + 4] === 0x45 && orig[i + 5] === 0x78
          && orig[i + 6] === 0x69 && orig[i + 7] === 0x66
          && orig[i + 8] === 0x00 && orig[i + 9] === 0x00) {
        app1 = orig.slice(i, i + 2 + segLen); break;
      }
      i += 2 + segLen;
    }
    if (!app1) return null;
    const res = new Uint8Array(await resizedBlob.arrayBuffer());
    if (res.length < 2 || res[0] !== 0xFF || res[1] !== 0xD8) return null;
    const out = new Uint8Array(2 + app1.length + (res.length - 2));
    out[0] = 0xFF; out[1] = 0xD8;
    out.set(app1, 2);
    out.set(res.slice(2), 2 + app1.length);
    return new Blob([out], { type: 'image/jpeg' });
  } catch { return null; }
}

function renderBodyHtml(body) {
  // v467→v468 @mention は SNS 検索 / @LabPay 案内 へ リンク 化。 URL は 新タブ。
  let s = escapeHtml(body || '');
  s = s.replace(/@([\p{L}\p{N}_\-\.]{1,40})/gu, (_, name) =>
    `<a href="#/sns" class="hint" style="color:var(--primary); font-weight:600; text-decoration:none">@${escapeHtml(name)}</a>`);
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  // v571 LabPay 内ハッシュリンク (/#/ito など) をクリック可能化。 すでに http リンク化
  //   された後なので 純粋な /#/ or #/ で始まる URL のみマッチ。
  s = s.replace(/(^|[\s])(\/?#\/[A-Za-z0-9_\-\/:?=&%\.]+)/g, (_, pre, url) =>
    `${pre}<a href="${url.replace(/^\//, '')}" style="color:var(--primary); font-weight:600">${url}</a>`);
  return s.replace(/\n/g, '<br>');
}

// v480 リアクション 3 種。 押し てる / 押し てない の 配色 だけ 変える。
const REACTIONS = [
  { kind: 'thumb', icon: '👍', activeColor: '#2563eb' },
  { kind: 'heart', icon: '❤️', activeColor: '#e11d48' },
  { kind: 'star',  icon: '⭐', activeColor: '#f59e0b' },
];

function reactionsHtml(p) {
  const mine = new Set(p.my_reactions || (p.liked_by_me ? ['heart'] : []));
  const counts = p.reaction_counts || { thumb: 0, heart: p.like_count || 0, star: 0 };
  return REACTIONS.map(r => {
    const on = mine.has(r.kind);
    const n = counts[r.kind] || 0;
    return `<a class="hint" data-react-post="${p.id}" data-react-kind="${r.kind}" style="cursor:pointer; ${on ? 'color:' + r.activeColor + '; font-weight:600' : 'opacity:0.7'}">${r.icon} ${n}</a>`;
  }).join('');
}

function postCard(p, opts = {}) {
  const meId = Number(state.me?.id);
  const isMine = p.user_id === meId;
  // v524 #182 削除権限: 投稿者本人は常に OK / admin は LabPay (system) 投稿のみ削除可。
  //   他人の人間投稿は admin でも削除不可 (= 個人の発言は本人だけ消せる)。
  const isAdmin = state.me?.role === 'admin';
  const authorIsSystem = p.author_kind === 'system';
  const canDelete = isMine || (isAdmin && authorIsSystem);
  // v785 #383 投稿 画像 を 90° 回転 する 権限 (投稿者 or admin)
  const canRotImage = !!p.image_url && (isMine || isAdmin);
  const replyHash = opts.skipReplyHash ? '' : `#/sns/${p.id}`;
  // v736 #346 投稿者本人 / admin は位置情報だけを削除できる
  const canClearLoc = isMine || isAdmin;
  const loc = (p.lat !== null && p.lng !== null)
    ? `<a href="https://maps.google.com/?q=${p.lat},${p.lng}" target="_blank" rel="noopener" class="hint" style="font-size:11px">📍 地図</a>${canClearLoc ? `<button class="btn" data-clear-loc="${p.id}" title="位置情報だけを削除" style="font-size:10px; padding:0 5px; line-height:1.6">📍✕</button>` : ''}`
    : '';
  // v525 #180 アバター + 投稿者名を タップ で その人のだけに絞り込み (?user=ID)
  return `
    <div class="list-item" style="align-items:flex-start; gap:8px" data-post-id="${p.id}">
      <a href="#/sns?user=${p.user_id}" style="text-decoration:none; flex:none">${avatarHtml(p.display_name, p.avatar_url, 'sm')}</a>
      <div class="grow" style="min-width:0">
        <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
          <a href="#/sns?user=${p.user_id}" class="bold" style="text-decoration:none; color:inherit">${escapeHtml(p.display_name)}</a>
          <span class="hint" style="font-size:11px">${fmtRelative(p.created_at_iso || p.created_at)}</span>
          ${loc}
          ${canDelete ? `<button class="btn" data-del-post="${p.id}" style="margin-left:auto; font-size:11px; padding:2px 6px">削除</button>` : ''}
        </div>
        ${p.body ? `<div style="font-size:14px; line-height:1.5; margin-top:2px; overflow-wrap:anywhere; word-break:break-word; min-width:0">${renderBodyHtml(p.body)}</div>` : ''}
        ${p.image_url ? `<img data-zoom-src="${escapeHtml(p.image_url)}"${canRotImage ? ` data-rot-post-id="${p.id}"` : ''} src="${escapeHtml(p.image_thumb_url || p.image_url)}" loading="lazy" decoding="async" style="max-width:100%; max-height:300px; border-radius:8px; margin-top:6px; cursor:zoom-in">` : ''}
        <div class="row" style="gap:14px; margin-top:6px; font-size:12px">
          ${reactionsHtml(p)}
          ${replyHash ? `<a class="hint" href="${replyHash}">💬 ${p.reply_count}</a>` : ''}
        </div>
      </div>
    </div>`;
}

let postsState = { items: [], beforeId: 0, loading: false, atEnd: false };
let postsPollTimer = null;
let postsKnownLatestId = 0;

// v598 fix: 旧版は 'labpay-content-v1' を 直 open していたが 実際の SW キャッシュは v3。
//   invalidateContentCache (api.js) で labpay-content-* を 全部 invalidate する 方式に変更。
async function invalidatePostsCache() {
  await invalidateContentCache('/api/posts');
}

// v480 自動 更新: 10 秒 ごと に /api/posts/latest_id だけ 叩いて、 値 が
//   大きくなって たら 一覧 を 取り直す。 タブ 非アクティブ 時 は 停止。
function startPostsPolling() {
  stopPostsPolling();
  postsPollTimer = setInterval(async () => {
    if (document.hidden) return;
    if (!document.getElementById('po-list')) { stopPostsPolling(); return; }
    try {
      const r = await get('/api/posts/latest_id');
      const lid = Number(r.latest_id || 0);
      if (lid > postsKnownLatestId && postsKnownLatestId > 0) {
        postsKnownLatestId = lid;
        await invalidatePostsCache();
        postsState = { items: [], beforeId: 0, loading: false, atEnd: false };
        await loadMore(true);
      } else if (postsKnownLatestId === 0) {
        postsKnownLatestId = lid;
      }
    } catch (_) {}
  }, 10000);
}
function stopPostsPolling() {
  if (postsPollTimer) { clearInterval(postsPollTimer); postsPollTimer = null; }
}
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/sns')) stopPostsPolling();
});

export async function renderPosts({ query } = {}) {
  // v598 SNS ページを開いた瞬間に SW SWR キャッシュを 明示的に invalidate。
  //   これがないと 「らぼったーが古い」 (= 前回キャッシュ表示 → 裏で fetch → 次回反映)
  //   になりがち。 invalidate しておけば 初回 get がそのままネットへ抜けて 必ず最新。
  await invalidatePostsCache();
  // v525 #180 user パラメータで投稿者絞り込み (?user=ID)。 絞り込み中は composer 非表示
  //   + 解除ボタン + 「@name の投稿のみ」 ヘッダ。
  const filterUserId = (query?.user && /^\d+$/.test(query.user)) ? Number(query.user) : null;
  postsState = { items: [], beforeId: 0, loading: false, atEnd: false, filterUserId };
  const app = document.getElementById('app');
  if (filterUserId) {
    app.innerHTML = `
      <div class="card">
        <div class="row center" style="gap:6px">
          <a href="#/sns" class="hint">← タイムライン全体</a>
          <span style="flex:1"></span>
          <span class="muted" id="po-filter-label" style="font-size:13px">読み込み中…</span>
          <a href="#/sns" class="btn" style="font-size:11px; padding:2px 8px">解除</a>
        </div>
      </div>
      <div id="po-list" class="list"></div>
      <div id="po-more" class="row center" style="gap:6px; margin-top:12px"></div>
    `;
  } else {
    app.innerHTML = `
      ${composerHtml(null)}
      <div class="row center" style="margin:6px 0; font-size:12px">
        <span style="flex:1"></span>
        <a href="#/sns/map" class="hint">📍 自分の投稿マップ →</a>
      </div>
      <div id="po-list" class="list"></div>
      <div id="po-more" class="row center" style="gap:6px; margin-top:12px"></div>
    `;
    bindComposer(null);
  }
  await loadMore();
  // ラベル更新 (絞り込み時の表示名)
  if (filterUserId) {
    const first = postsState.items[0];
    const label = document.getElementById('po-filter-label');
    if (label) label.textContent = first ? `@${first.display_name} の投稿のみ` : `(投稿なし)`;
  }
  document.getElementById('po-more').addEventListener('click', loadMore);
  // v525 #167 下スワイプで明示リロード (pull-to-refresh)
  setupPullToRefresh();
  // ポーリングは全体タイムライン時のみ (絞り込みは静的表示)
  if (!filterUserId) {
    postsKnownLatestId = postsState.items[0]?.id || 0;
    startPostsPolling();
  }
}

// v525 #167 タイムラインで下方向スワイプ (touchstart→touchmove) で 明示再読込。
//   ページ上部 (scrollTop === 0) からの 60px 以上の下スワイプで トリガ。
function setupPullToRefresh() {
  const list = document.getElementById('po-list');
  if (!list) return;
  let startY = null;
  let triggered = false;
  let indicator = null;
  const showIndicator = (pct) => {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.style.cssText = 'text-align:center; font-size:13px; padding:8px; color:var(--primary); transition:opacity 0.2s';
      indicator.textContent = '↓ 引っ張って 更新';
      list.parentNode.insertBefore(indicator, list);
    }
    indicator.style.opacity = Math.min(1, pct);
    indicator.textContent = pct >= 1 ? '↻ 離して 更新' : '↓ 引っ張って 更新';
  };
  const hideIndicator = () => { if (indicator) { indicator.remove(); indicator = null; } };
  list.addEventListener('touchstart', (ev) => {
    if (window.scrollY > 0) { startY = null; return; }
    startY = ev.touches[0].clientY;
    triggered = false;
  }, { passive: true });
  list.addEventListener('touchmove', (ev) => {
    if (startY === null) return;
    const dy = ev.touches[0].clientY - startY;
    if (dy > 0 && window.scrollY === 0) {
      showIndicator(dy / 60);
      if (dy >= 60) triggered = true;
    }
  }, { passive: true });
  list.addEventListener('touchend', async () => {
    if (triggered) {
      hideIndicator();
      // ヘッダの 「読み込み中…」 を 表示してから 全件 reset
      const tmp = document.createElement('div');
      tmp.className = 'muted';
      tmp.style.cssText = 'text-align:center; padding:8px';
      tmp.textContent = '↻ 更新中…';
      list.parentNode.insertBefore(tmp, list);
      await loadMore(true);
      tmp.remove();
    } else {
      hideIndicator();
    }
    startY = null;
    triggered = false;
  });
}

export async function renderPostDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  // v539 #196 返信 0 件時は 「💬 返信 (0)」 ヘッダごと隠す + 返信入力 UI (composer)
  //   を 返信一覧の下 に配置 (= 返信を読んでから返事を書く 自然な順序)。
  app.innerHTML = `
    <div class="card">
      <a href="#/sns" class="hint">← タイムライン</a>
    </div>
    <div id="po-parent"><div class="muted">読み込み中…</div></div>
    <div id="po-reactors" class="card" style="margin-top:8px" hidden></div>
    <div id="po-replies-card" class="card" style="margin-top:12px" hidden>
      <h3 style="margin:0 0 6px">💬 返信 (<span id="po-reply-count">0</span>)</h3>
      <div id="po-replies" class="list"></div>
    </div>
    <div id="po-composer-wrap" style="margin-top:8px">${composerHtml(id)}</div>
  `;
  bindComposer(id);
  try {
    const d = await get('/api/posts/' + id);
    const parent = d.post;
    document.getElementById('po-parent').innerHTML = `
      <div class="card">${postCard(parent, { skipReplyHash: true })}</div>`;
    renderReactors(d.reactors || []);
    const replyCount = d.replies.length;
    const card = document.getElementById('po-replies-card');
    if (replyCount > 0) {
      card.hidden = false;
      document.getElementById('po-reply-count').textContent = replyCount;
      document.getElementById('po-replies').innerHTML = d.replies.map(r => postCard(r, { skipReplyHash: true })).join('');
    } else {
      card.hidden = true; // 「💬 返信 (0)」 + 「まだ 返信 なし」 は出さない
    }
    bindRowHandlers();
  } catch (e) {
    document.getElementById('po-parent').innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`;
  }
}

function renderReactors(reactors) {
  const box = document.getElementById('po-reactors');
  if (!box) return;
  if (!reactors.length) { box.hidden = true; return; }
  box.hidden = false;
  const order = ['thumb', 'heart', 'star'];
  const meta = { thumb: { icon: '👍', label: 'いいね' }, heart: { icon: '❤️', label: 'ハート' }, star: { icon: '⭐', label: '星' } };
  const byKind = {};
  for (const r of reactors) (byKind[r.kind] ||= []).push(r);
  const sections = order.filter(k => byKind[k]?.length).map(k => {
    const m = meta[k];
    const rows = byKind[k].map(r => `
      <a href="#/users/${r.user_id}" class="rl-chip" style="text-decoration:none; color:inherit; gap:4px">
        ${r.avatar_url
          ? `<img src="${escapeHtml(r.avatar_url)}" alt="" style="width:18px; height:18px; border-radius:50%; object-fit:cover">`
          : `<div style="width:18px; height:18px; border-radius:50%; background:#ede4f3; color:#4a106d; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:10px">${escapeHtml((r.display_name || '?').trim().charAt(0).toUpperCase())}</div>`}
        <span style="font-size:12px">${escapeHtml(r.display_name)}</span>
      </a>`).join('');
    return `<div style="margin:6px 0">
      <div class="bold" style="font-size:12px; margin-bottom:4px">${m.icon} ${m.label} (${byKind[k].length})</div>
      <div class="row" style="gap:4px; flex-wrap:wrap">${rows}</div>
    </div>`;
  }).join('');
  box.innerHTML = `<div class="meta" style="font-size:11px">リアクションしてくれた人</div>${sections}`;
}

function composerHtml(parentId) {
  const placeholder = parentId ? '返信を 書く…' : 'いま どうしてる?  @ で メンション (補完あり)。 LabPay へ 機能要望 / バグ報告 する 時は @LabPay 付けてね';
  return `
    <div class="card" style="position:relative">
      <textarea id="po-body" maxlength="2000" rows="3" placeholder="${escapeHtml(placeholder)}"></textarea>
      <div id="po-mention-pop" style="display:none; position:absolute; left:14px; right:14px; top:auto; z-index:50; background:#fff; border:1px solid #ddd; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.12); max-height:240px; overflow:auto"></div>
      <div class="row" style="gap:6px; margin-top:6px; align-items:center; flex-wrap:wrap">
        <input type="file" id="po-img" accept="image/*" style="flex:1; min-width:140px">
        <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px">
          <input type="checkbox" id="po-loc"> 📍 現在地 を 添付
        </label>
        <button id="po-submit" class="primary" style="margin-left:auto" data-parent="${parentId || ''}">投稿</button>
      </div>
      <div class="hint-sm" id="po-img-status"></div>
    </div>`;
}

// v467 @ 補完 用 メンバー キャッシュ (タブ ライフタイム)。
let mentionCandidates = null;
async function loadMentionCandidates() {
  if (mentionCandidates) return mentionCandidates;
  try {
    const d = await get('/api/users');
    const users = (d.items || d) || [];
    mentionCandidates = users
      .filter(u => u.display_name)
      .map(u => ({ id: u.id, name: u.display_name, avatar: u.avatar_url }));
    // LabPay 公式 アカウント が API 上に いない 場合 でも 候補 に 出す
    if (!mentionCandidates.some(u => u.name === 'LabPay')) {
      mentionCandidates.unshift({ id: 0, name: 'LabPay', avatar: null });
    }
  } catch (_) { mentionCandidates = [{ id: 0, name: 'LabPay', avatar: null }]; }
  return mentionCandidates;
}

function bindMentionAutocomplete() {
  const ta  = document.getElementById('po-body');
  const pop = document.getElementById('po-mention-pop');
  if (!ta || !pop) return;
  let candidates = [];
  loadMentionCandidates().then(c => candidates = c);
  let selected = 0, matched = [];
  const close = () => { pop.style.display = 'none'; matched = []; };
  const refresh = () => {
    const v = ta.value;
    const pos = ta.selectionStart;
    // カーソル 前 の 直近 「@xxx」 を 拾う (空白 で 区切られる)
    const head = v.slice(0, pos);
    const m = head.match(/(?:^|\s)@([\p{L}\p{N}_\-\.]{0,40})$/u);
    if (!m) { close(); return; }
    if (!candidates.length) { close(); return; }
    const q = m[1].toLowerCase();
    matched = candidates.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6);
    if (!matched.length) { close(); return; }
    selected = Math.min(selected, matched.length - 1);
    pop.innerHTML = matched.map((c, i) => `
      <div data-mi="${i}" style="padding:8px 10px; cursor:pointer; ${i === selected ? 'background:#f5f3f7' : ''}; display:flex; align-items:center; gap:8px">
        ${c.avatar
          ? `<img src="${escapeHtml(c.avatar)}" alt="" style="flex:none; width:20px; height:20px; border-radius:50%; object-fit:cover">`
          : `<div style="flex:none; width:20px; height:20px; border-radius:50%; background:#ede4f3; color:#4a106d; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:11px">${escapeHtml((c.name || '?').charAt(0).toUpperCase())}</div>`}
        <span style="font-size:13px">@${escapeHtml(c.name)}</span>
      </div>`).join('');
    // v468 textarea の 直下 に 出す。 height を 動的 に。
    pop.style.top = (ta.offsetTop + ta.offsetHeight + 2) + 'px';
    pop.style.display = 'block';
    pop.querySelectorAll('[data-mi]').forEach(el => {
      el.addEventListener('mousedown', (ev) => { ev.preventDefault(); commit(Number(el.dataset.mi)); });
    });
  };
  const commit = (idx) => {
    const c = matched[idx];
    if (!c) return;
    const v = ta.value;
    const pos = ta.selectionStart;
    const head = v.slice(0, pos);
    const tail = v.slice(pos);
    const newHead = head.replace(/(^|\s)@[\p{L}\p{N}_\-\.]*$/u, (_, pre) => `${pre}@${c.name} `);
    ta.value = newHead + tail;
    const newPos = newHead.length;
    ta.setSelectionRange(newPos, newPos);
    close();
    ta.focus();
  };
  ta.addEventListener('input', refresh);
  ta.addEventListener('keydown', (ev) => {
    if (pop.style.display !== 'block' || !matched.length) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); selected = (selected + 1) % matched.length; refresh(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); selected = (selected - 1 + matched.length) % matched.length; refresh(); }
    else if (ev.key === 'Enter' || ev.key === 'Tab') {
      if (ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      commit(selected);
    } else if (ev.key === 'Escape') { close(); }
  });
  document.addEventListener('click', (ev) => {
    if (!pop.contains(ev.target) && ev.target !== ta) close();
  }, { capture: true });
}

let composerImageUrl = null;
let composerCoords = null;
// v537 #195 画像 EXIF GPS は 「現在地」 (geolocation) より優先。 画像から取得した GPS は
//   別変数で保持し、 submit 時に EXIF があれば そちらを採用 (= 後から locChk を ON にして
//   geolocation で composerCoords が入っても 上書きされない)。
let composerImageExifCoords = null;
// v482 #69 位置情報 ON/OFF を 永続化 (一度 ON にしたら 以降 ON、 OFF にしたら 以降 OFF)。
const PO_LOC_PREF_KEY = 'labpay-sns-loc-pref';
function readLocPref() {
  try { return localStorage.getItem(PO_LOC_PREF_KEY) === 'on'; } catch { return false; }
}
function writeLocPref(on) {
  try { localStorage.setItem(PO_LOC_PREF_KEY, on ? 'on' : 'off'); } catch {}
}
function bindComposer(parentId) {
  composerImageUrl = null;
  composerCoords = null;
  composerImageExifCoords = null;
  bindMentionAutocomplete();  // v467 @ 補完
  const imgInput = document.getElementById('po-img');
  const imgStatus = document.getElementById('po-img-status');
  // v485 #79 アップロード 中 は 投稿 ボタン を disable する (待たず 押すと 画像 が
  //   付与 されない 問題 を 防ぐ)。 完了 か 失敗 で 元に 戻す。
  const submitBtn = document.getElementById('po-submit');
  // v860 #446 file input change と クリップボード paste 双方 から 同じ アップロード
  //   フロー を 呼べる よう に 共通 関数 化。
  const uploadComposerImage = async (f) => {
    if (!f) { composerImageUrl = null; imgStatus.textContent = ''; return; }
    imgStatus.textContent = '⏳ アップロード 中…';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.uploading = '1'; }
    composerImageExifCoords = null;
    readExifGps(f).then(gps => {
      if (gps) {
        composerImageExifCoords = { lat: gps.lat, lng: gps.lng };
        toast(`📍 写真のEXIFから位置取得 (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})`);
      }
    }).catch(() => {});
    let uploadFile = f;
    try {
      const resized = await maybeResizeJpegPreserveExif(f);
      if (resized !== f) {
        uploadFile = resized;
        imgStatus.textContent = `⏳ 縮小して アップロード中… (${(f.size / 1024 / 1024).toFixed(1)} MB → ${(resized.size / 1024 / 1024).toFixed(1)} MB)`;
      }
    } catch (_) {}
    const fd = new FormData();
    fd.append('file', uploadFile);
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
      composerImageUrl = j.url || j.path;
      imgStatus.innerHTML = `<span style="color:#0e7c63">✓ アップロード 完了</span>`;
    } catch (e) {
      imgStatus.textContent = '失敗: ' + (e?.message || e);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; delete submitBtn.dataset.uploading; }
    }
  };
  imgInput?.addEventListener('change', () => uploadComposerImage(imgInput.files[0]));
  // v860 #446 クリップボード (画像) を textarea に paste で アップロード。
  //   Win の 「Print Screen + Snipping Tool」 や Mac の ⌘+Shift+4 で 撮った
  //   スクショ を 直接 貼り 付けら れる。 画像 type で 拾えれば preventDefault して
  //   テキスト として は 入れない。 ファイル名 は clipboard-<ts>.<ext> で 仮 命名。
  const taBody = document.getElementById('po-body');
  taBody?.addEventListener('paste', async (ev) => {
    const items = ev.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
        const blob = it.getAsFile();
        if (!blob) continue;
        ev.preventDefault();
        const ext = ((blob.type.split('/')[1] || 'png').toLowerCase()).replace('jpeg', 'jpg');
        const file = new File([blob], `clipboard-${Date.now()}.${ext}`, { type: blob.type });
        toast('📋 クリップボード 画像 を アップロード 中…');
        await uploadComposerImage(file);
        return;
      }
    }
  });
  // v482 #69 起動時 に 前回 の 設定 を 復元。 ON だった なら 自動 で 位置 取得。
  const locChk = document.getElementById('po-loc');
  if (locChk && readLocPref()) {
    locChk.checked = true;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => { composerCoords = { lat: p.coords.latitude, lng: p.coords.longitude }; },
        () => { composerCoords = null; },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    }
  }
  document.getElementById('po-loc')?.addEventListener('change', (ev) => {
    writeLocPref(ev.target.checked);
    if (!ev.target.checked) { composerCoords = null; return; }
    if (!navigator.geolocation) { toast('位置情報 未対応'); ev.target.checked = false; return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { composerCoords = { lat: p.coords.latitude, lng: p.coords.longitude };
               toast(`📍 位置 を 添付 (±${Math.round(p.coords.accuracy)}m)`); },
      (e) => { toast('位置 取得 失敗'); ev.target.checked = false; composerCoords = null; },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  });
  document.getElementById('po-submit')?.addEventListener('click', async () => {
    const body = document.getElementById('po-body').value.trim();
    if (!body && !composerImageUrl) { toast('本文 か 画像 が 必要 です'); return; }
    // v537 #195 EXIF GPS が画像にあれば 必ず優先 (geolocation で composerCoords が
    //   設定されていても上書き)。 写真の位置 = 撮影地 を 投稿位置として正確に。
    const finalCoords = composerImageExifCoords || composerCoords;
    const payload = {
      body,
      image_url: composerImageUrl || '',
      parent_id: parentId || null,
      lat: finalCoords?.lat ?? null,
      lng: finalCoords?.lng ?? null,
    };
    try {
      const r = await post('/api/posts', payload);
      toast('投稿しました');
      // v480 SW の SWR キャッシュ に 古い /api/posts が 残ってる と 次回 ホーム 等で
      //   1 拍 遅れる ので、 自分 が 投稿した タイミング で 強制 削除。
      await invalidatePostsCache();
      document.getElementById('po-body').value = '';
      document.getElementById('po-img').value = '';
      // v482 #69 位置情報 ON/OFF は 永続 設定 なので、 投稿後 も リセット しない。
      //   ただし 添付 された 座標 は 新しい 投稿 では 取り直し たい ので、 ON なら
      //   再 取得 する。
      composerImageUrl = null; composerCoords = null;
      const locChk = document.getElementById('po-loc');
      if (locChk && locChk.checked && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => { composerCoords = { lat: p.coords.latitude, lng: p.coords.longitude }; },
          () => {},
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
      }
      if (parentId) navigate(`#/sns/${parentId}`);
      else { postsState = { items: [], beforeId: 0, loading: false, atEnd: false }; await loadMore(true); }
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

async function loadMore(reset = false) {
  if (postsState.loading || (postsState.atEnd && !reset)) return;
  postsState.loading = true;
  if (reset) postsState.beforeId = 0;
  try {
    const q = postsState.beforeId > 0 ? { before_id: postsState.beforeId, limit: 30 } : { limit: 30 };
    // v525 #180 投稿者フィルタ
    if (postsState.filterUserId) q.user_id = postsState.filterUserId;
    const d = await get('/api/posts', q);
    const items = d.items || [];
    if (reset) {
      postsState.items = items;
      document.getElementById('po-list').innerHTML = items.map(p => postCard(p)).join('') || '<div class="empty">まだ 投稿 なし</div>';
    } else {
      postsState.items.push(...items);
      const html = items.map(p => postCard(p)).join('');
      document.getElementById('po-list').insertAdjacentHTML('beforeend', html);
    }
    if (items.length) postsState.beforeId = items[items.length - 1].id;
    if (items.length < 30) {
      postsState.atEnd = true;
      document.getElementById('po-more').innerHTML = '<span class="muted">これ で 全部 です</span>';
    } else {
      document.getElementById('po-more').innerHTML = '<button class="btn" id="po-load-next">もっと 見る</button>';
      document.getElementById('po-load-next').addEventListener('click', () => loadMore());
    }
    bindRowHandlers();
  } catch (e) { document.getElementById('po-list').insertAdjacentHTML('beforeend', `<div class="muted">${escapeHtml(e.message)}</div>`); }
  postsState.loading = false;
}

// v492 #92 画像 タップ で 全画面 ライトボックス を 開く。 別タブ で 開いて 戻れない
//   問題 を 回避。 × ボタン / 背景 タップ / Esc で 閉じる。 body スクロール ロック。
function openImageLightbox(src) {
  const old = document.getElementById('po-lightbox');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'po-lightbox';
  box.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; cursor:zoom-out';
  // v526 #179 画像が大きい場合 lightbox 表示までに 体感数秒空くので、 ローディング
  //   表示 + 進行率 (XMLHttpRequest progress) を仕込む。 オリジナル画像を XHR で取って
  //   blob → object URL に。 fetch でもいいが progress 取れる XHR を採用。
  box.innerHTML = `
    <button id="po-lb-close" aria-label="閉じる"
            style="position:absolute; top:12px; right:12px; width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.92); border:none; font-size:22px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center">×</button>
    <div id="po-lb-loading" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:10px; color:#fff; font-size:14px">
      <div style="width:36px; height:36px; border:3px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:lb-spin 1s linear infinite"></div>
      <div id="po-lb-pct">読み込み中…</div>
    </div>
    <img id="po-lb-img" alt="" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:6px; visibility:hidden">
    <style>@keyframes lb-spin { to { transform: rotate(360deg); } }</style>`;
  document.body.appendChild(box);
  // 画像を progress 付きでロード
  const imgEl = box.querySelector('#po-lb-img');
  const loadEl = box.querySelector('#po-lb-loading');
  const pctEl = box.querySelector('#po-lb-pct');
  const xhr = new XMLHttpRequest();
  xhr.open('GET', src, true);
  xhr.responseType = 'blob';
  xhr.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.floor(e.loaded * 100 / e.total);
      const mb = (e.total / 1048576).toFixed(1);
      if (pctEl) pctEl.textContent = `${pct}%  (${mb} MB)`;
    } else if (pctEl) {
      pctEl.textContent = `${(e.loaded / 1048576).toFixed(1)} MB 読込中…`;
    }
  };
  xhr.onload = () => {
    if (xhr.status === 200 && xhr.response) {
      const objUrl = URL.createObjectURL(xhr.response);
      imgEl.src = objUrl;
      imgEl.onload = () => {
        if (loadEl) loadEl.remove();
        imgEl.style.visibility = 'visible';
      };
    } else {
      if (pctEl) pctEl.textContent = '読み込み失敗';
    }
  };
  xhr.onerror = () => { if (pctEl) pctEl.textContent = '読み込み失敗'; };
  xhr.send();
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const close = () => {
    box.remove();
    document.body.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.getElementById('po-lb-close').addEventListener('click', (ev) => {
    ev.stopPropagation();
    close();
  });
  box.addEventListener('click', (ev) => {
    // 画像 自体 を タップ し ても 閉じる (拡大 オーバーレイ の 通例)。
    if (ev.target.id !== 'po-lb-close') close();
  });
}

function bindRowHandlers() {
  // v541 #197 投稿カードの「余白」をタップしたら 返信モード (= 詳細ページへ遷移)
  //   インタラクティブな要素 (a / button / data-zoom-src / data-react-post) は除外。
  document.querySelectorAll('[data-post-id]').forEach(row => {
    if (row.dataset.boundReply) return;
    row.dataset.boundReply = '1';
    row.addEventListener('click', (ev) => {
      // a / button / 既にハンドラを持つ要素は素通し
      if (ev.target.closest('a, button, [data-zoom-src], [data-react-post]')) return;
      const id = row.dataset.postId;
      if (id) location.hash = '#/sns/' + id;
    });
    row.style.cursor = 'pointer';
  });
  document.querySelectorAll('[data-zoom-src]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // v785 #383 投稿者 / admin なら 共有 lightbox の onRotate を 渡す (サーバ で 画像 上書き 保存)
      const postId = el.dataset.rotPostId;
      if (postId) {
        openSharedLightbox(el.dataset.zoomSrc, {
          onRotate: (degrees) => post(`/api/posts/${postId}/rotate-image`, { degrees }),
        });
      } else {
        openSharedLightbox(el.dataset.zoomSrc);
      }
    });
  });
  document.querySelectorAll('[data-react-post]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', async () => {
      const id = el.dataset.reactPost;
      const kind = el.dataset.reactKind;
      const on = parseFloat(el.style.fontWeight || '0') >= 600;
      const method = on ? 'del' : 'post';
      try {
        const r = method === 'post'
          ? await post(`/api/posts/${id}/reaction?kind=${kind}`, {})
          : await del(`/api/posts/${id}/reaction?kind=${kind}`);
        // 押し てる kind の セット を 受け取って 該当 行 の 3 ボタン を 全部 再描画。
        const row = el.closest('[data-post-id]');
        if (!row) return;
        const mine = new Set(r.my_reactions || []);
        const counts = r.reaction_counts || {};
        row.querySelectorAll('[data-react-post="' + id + '"]').forEach(b => {
          const k = b.dataset.reactKind;
          const def = REACTIONS.find(x => x.kind === k);
          const isOn = mine.has(k);
          const n = counts[k] || 0;
          b.textContent = `${def.icon} ${n}`;
          b.style.cssText = `cursor:pointer; ${isOn ? 'color:' + def.activeColor + '; font-weight:600' : 'opacity:0.7'}`;
        });
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
  document.querySelectorAll('[data-del-post]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', async () => {
      if (!confirm('この 投稿 を 削除 しますか?')) return;
      try {
        await del(`/api/posts/${el.dataset.delPost}`);
        // v499 #110 SW の content cache (/api/posts*) に消したはずの行が残ると
        //   再来訪時に復活して見えるので、 削除直後に invalidate しておく。
        await invalidatePostsCache();
        toast('削除しました');
        const row = el.closest('[data-post-id]');
        if (row) row.remove();
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
  // v736 #346 位置情報だけを削除
  document.querySelectorAll('[data-clear-loc]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', async () => {
      if (!confirm('この投稿の位置情報だけを削除しますか? (本文は残ります)')) return;
      try {
        await del(`/api/posts/${el.dataset.clearLoc}/location`);
        await invalidatePostsCache();
        toast('位置情報を削除しました');
        // 該当行の loc 部分を消す: 「📍 地図」 と 自身を non-render
        const row = el.closest('[data-post-id]');
        if (row) {
          row.querySelectorAll('a[href^="https://maps.google.com"]').forEach(a => a.remove());
          el.remove();
        }
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
}
