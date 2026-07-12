// v1004 著者顔画像取得ヘルパ (中村さん要望「著者の顔画像が取れる場合はほしい」)。
//   優先順位:
//     1. ラボメンバー (display_name 一致 or email 一致) → LabPay の users.avatar_url
//     2. email が ある → Gravatar (SHA-256、 d=404 で 無ければ 404 → onerror で fallback)
//     3. Initials avatar (既存)
//   全て 失敗 でも 表示 は 崩れない (initials は同期 で 描画)。
//
//   使い方:
//     import { renderAuthorAvatar, initLabUsersCache } from '../author_avatar.js';
//     await initLabUsersCache();   // 起動時に 1 回
//     const html = renderAuthorAvatar({name, email}, {size: 38});
//     // html には data-avatar-slot="..." が入って いて、 mountAuthorAvatars() が
//     // 動的 に img を 差し込む。

import { get } from './api.js';
import { escapeHtml } from './router.js';

let labUsersByName = new Map();
let labUsersByEmail = new Map();
let inited = false;

// ラボメンバー一覧 を キャッシュ (display_name / email → avatar_url)。 1 プロセス 1 回。
export async function initLabUsersCache() {
  if (inited) return;
  inited = true;
  try {
    const d = await get('/api/users');
    for (const u of (d?.items || d || [])) {
      const name = String(u.display_name || u.name || '').trim();
      const email = String(u.email || '').trim().toLowerCase();
      const av = u.avatar_url || u.avatar || null;
      if (name && av) labUsersByName.set(normalizeName(name), av);
      if (email && av) labUsersByEmail.set(email, av);
    }
  } catch (_) { /* silent */ }
}

// Kelly Mack、 K. Mack 等の 表記揺れ を 吸収 する 正規化。
//   姓 名 の 順序 は そのまま (英名 First Last、 日本語は 姓 名)、 空白 / 大小文字 を 標準化。
function normalizeName(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\s　]+/g, ' ')
    .trim()
    .toLowerCase();
}

// (name, email) から avatar URL 候補 を 得る 同期 関数。 ラボメンバー が 見つかれば それ を 返す。
export function labMemberAvatar(name, email) {
  const em = String(email || '').trim().toLowerCase();
  if (em && labUsersByEmail.has(em)) return labUsersByEmail.get(em);
  const nm = normalizeName(name);
  if (nm && labUsersByName.has(nm)) return labUsersByName.get(nm);
  return null;
}

// Gravatar URL を 返す (email 必須)。 d=404 で ヒット 無し は 404、 img onerror で fallback。
export async function gravatarUrl(email, size = 80) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return null;
  // SHA-256 は SubtleCrypto で 標準対応 (browser built-in)
  const buf = new TextEncoder().encode(em);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `https://gravatar.com/avatar/${hex}?d=404&s=${size}`;
}

// 決定的 な 色 + イニシャル (name → 一意 な HSL カラー)。
function initialsAvatarSpec(name) {
  const clean = String(name || '').trim() || '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] || '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : '')).toUpperCase().slice(0, 2) || '?';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  return { initials, color: `hsl(${hash % 360}, 55%, 55%)` };
}

// 同期 render: まず ラボメンバー 一致 を 試して 見つかれば <img> で 出す、 無ければ initials。
//   email or name を data-au-* 属性 に 埋めて、 mountAuthorAvatars() が
//   (1) 手動 アップロード 済 の author photo (v1006) → (2) Gravatar の順で 試す。
export function renderAuthorAvatar(author, opts = {}) {
  const size = opts.size ?? 38;
  const name = author?.name || '';
  const email = author?.email || '';
  const labAv = labMemberAvatar(name, email);
  const spec = initialsAvatarSpec(name);
  const commonStyle = `width:${size}px; height:${size}px; border-radius:50%; flex:none; display:inline-flex; align-items:center; justify-content:center; overflow:hidden`;
  if (labAv) {
    return `<img class="avatar-au" src="${escapeHtml(labAv)}" alt="" loading="lazy" decoding="async"
              style="${commonStyle}; object-fit:cover; background:${spec.color}">`;
  }
  // initials に data-au-name (+ email) を 添えて、 mount 時に 手動 photo / Gravatar を 試す
  const nameAttr  = name  ? ` data-au-name="${escapeHtml(name)}"`   : '';
  const emailAttr = email ? ` data-au-email="${escapeHtml(email)}"` : '';
  return `<span class="avatar-au"${nameAttr}${emailAttr}
            style="${commonStyle}; color:#fff; font-weight:700; font-size:${Math.round(size * 0.4)}px; font-family:system-ui, sans-serif; background:${spec.color}">${escapeHtml(spec.initials)}</span>`;
}

// v1006 手動 アップロード 済 の 顔画像 を bulk lookup で 一気に 取る (per-name request 回避)。
async function fetchManualPhotos(names) {
  const uniq = Array.from(new Set(names.filter(Boolean))).slice(0, 200);
  if (!uniq.length) return {};
  try {
    // API は カンマ 区切り name リストを 受ける。 name 自体 は encodeURIComponent 済。
    const q = uniq.map(n => encodeURIComponent(n)).join(',');
    const r = await fetch('/api/authors/photos?names=' + q, { credentials: 'same-origin' });
    if (!r.ok) return {};
    const d = await r.json();
    return d?.photos || {};
  } catch (_) { return {}; }
}

// swap する helper (initials span → img)。 URL が 有効 なら 差し替え。
function swapToImg(node, url) {
  if (!url || !node.isConnected) return false;
  const size = parseInt(node.style.width, 10) || 38;
  const bg   = node.style.background || '';
  const img = document.createElement('img');
  img.className = 'avatar-au';
  img.src = url;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.style.cssText = `width:${size}px; height:${size}px; border-radius:50%; flex:none; object-fit:cover; background:${bg}`;
  node.replaceWith(img);
  return true;
}

// URL が 実際 に ロード できるか テスト
function testImageLoad(url) {
  return new Promise((res) => {
    const im = new Image();
    im.onload  = () => res(true);
    im.onerror = () => res(false);
    im.src = url;
  });
}

// DOM 挿入後に呼ぶ: initials avatar に 埋まった name/email から (1) 手動photo → (2) Gravatar を 試して 差し替え。
export async function mountAuthorAvatars(root = document) {
  const nodes = Array.from(root.querySelectorAll('.avatar-au[data-au-name], .avatar-au[data-au-email]'))
    .filter(n => n.tagName === 'SPAN');   // 既に img に なった もの は 除外
  if (!nodes.length) return;

  const names = nodes.map(n => n.getAttribute('data-au-name') || '').filter(Boolean);
  const photoMap = await fetchManualPhotos(names);

  for (const n of nodes) {
    const name  = n.getAttribute('data-au-name')  || '';
    const email = n.getAttribute('data-au-email') || '';
    // (1) 手動 アップロード 済
    if (name && photoMap[name]) {
      const ok = await testImageLoad(photoMap[name]);
      if (ok) { swapToImg(n, photoMap[name]); continue; }
    }
    // (2) Gravatar (email がある 場合のみ)
    if (email) {
      const url = await gravatarUrl(email, 80);
      if (url && await testImageLoad(url)) {
        swapToImg(n, url);
        continue;
      }
    }
    // (3) fallback: initials のまま
  }
}
