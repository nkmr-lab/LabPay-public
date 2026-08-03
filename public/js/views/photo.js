// /#/photo, /#/photo/album/:slug, /#/photo/frame, /#/photo/people[/:id]
//   v1268 中村さん指示「もう直接 photo.nkmr.io に飛ばしたほうが良い」に伴い、
//   LabPay 内の アルバム閲覧 UI (photo.js 1740行) を全面撤去し、案内画面のみに刷新。
//   旧 UI (アルバム一覧 / タイル / ライトボックス / フォトフレーム /
//   人物一覧 / 人物プロフィール) は全て photo.nkmr.io に移行。
//
//   ただし home の「🎲 今日のラボフォト」widget が photo.js から
//   fetchRandomPhotos / absolutePhotoUrl / assetMediaUrl を import して
//   photo.nkmr.io の /api.php?action=random_photos を叩くので、
//   これら 3 helper は 残す。
//
// route → render 対応 (すべて 同じ案内画面 を出す):
//   /#/photo               → renderPhotoAlbums
//   /#/photo/album/:slug   → renderPhotoAlbumDetail
//   /#/photo/frame         → renderPhotoFrame
//   /#/photo/people        → renderPhotoPeople
//   /#/photo/people/:id    → renderPhotoPerson

const PHOTO_ORIGIN = 'https://photo.nkmr.io';

// ---------------- photo.nkmr.io API helper (widget用) ----------------

async function photoApi(action, params = {}) {
  const url = new URL(PHOTO_ORIGIN + '/api.php');
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), { credentials: 'include' });
  let j = null;
  try { j = await r.json(); } catch {}
  if (!j || j.ok === false) throw new Error(j?.error || 'photo API エラー');
  return j;
}

function thumbUrl(assetId, size = 'thumb') {
  return `${PHOTO_ORIGIN}/media.php?id=${encodeURIComponent(assetId)}&size=${encodeURIComponent(size)}`;
}

// 「今日 の ラボ フォト」ウィジェット から使う。count: 1-12、seed: 決定論。
export async function fetchRandomPhotos(opts = {}) {
  const params = { count: Math.max(1, Math.min(12, Number(opts.count) || 6)) };
  if (opts.seed !== undefined) params.seed = opts.seed;
  if (opts.album_id)           params.album_id = opts.album_id;
  if (opts.person_id)          params.person_id = opts.person_id;
  if (opts.year)               params.year = opts.year;
  if (opts.tag)                params.tag = opts.tag;
  if (Array.isArray(opts.exclude_ids) && opts.exclude_ids.length) {
    params.exclude_ids = opts.exclude_ids.slice(0, 50).join(',');
  }
  const d = await photoApi('random_photos', params);
  return Array.isArray(d.photos) ? d.photos : [];
}

export function absolutePhotoUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return PHOTO_ORIGIN + (u.startsWith('/') ? u : ('/' + u));
}

export function assetMediaUrl(assetId, size = 'medium') {
  return thumbUrl(assetId, size);
}

// ---------------- 案内画面 (v1268 で LabPay 内 UI 撤去) ----------------

function renderDeprecated(subLabel) {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🖼 フォトアルバム</h2>
      <div class="hint-sm" style="margin-top:4px; color:#92400e">
        LabPay 内での アルバム閲覧 / フォトフレーム / 人物検索 は 一旦停止 しています。
        全機能 (アルバム / 顔識別 / 地図 / 同席グラフ / コラージュ 等) は
        <b>photo.nkmr.io</b> 側でご利用ください。
      </div>
      ${subLabel ? `<div class="hint-sm" style="margin-top:6px; color:#6b7280">${subLabel}</div>` : ''}
    </div>

    <div class="card" style="background:#f0f9ff; border-left:4px solid #0284c7">
      <h3 style="margin:0 0 8px; font-size:15px; color:#0369a1">📷 photo.nkmr.io を開く</h3>
      <div class="hint-sm" style="margin-bottom:10px; line-height:1.7">
        中村研の写真・動画を全部貯める自前フォト基盤 (Google Photos の代替)。
        アルバム / 顔識別 / 表情 / 地図 / 同席グラフ / コラージュ / フォトフレーム
        の全機能をここから利用できます。 nkmr-SSO 保護なのでログインは不要。
      </div>
      <a href="https://photo.nkmr.io" target="_blank" rel="noopener"
         class="btn primary" style="text-decoration:none; padding:10px 18px; font-size:14px">
        📷 photo.nkmr.io を開く →
      </a>
    </div>

    <div class="card" style="margin-top:10px">
      <div class="hint-sm" style="font-size:12px; color:#6b7280">
        ※ ホーム画面の「🎲 今日のラボフォト」ウィジェットは photo.nkmr.io の
        画像を直接表示しているので、そのままお使いいただけます。<br>
        <a href="#/" style="color:#4a106d; text-decoration:none">← ホームに戻る</a>
      </div>
    </div>
  `;
}

export function renderPhotoAlbums()      { renderDeprecated(''); }
export function renderPhotoAlbumDetail() { renderDeprecated('(アルバム詳細)'); }
export function renderPhotoFrame()       { renderDeprecated('(フォトフレーム)'); }
export function renderPhotoPeople()      { renderDeprecated('(人物一覧)'); }
export function renderPhotoPerson()      { renderDeprecated('(人物プロフィール)'); }
