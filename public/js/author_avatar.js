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
//   email が あって 未解決 の 場合 は data-avatar-email 属性 に メール を 埋め、
//   mountAuthorAvatars() が 後で Gravatar を fetch して 差し替える。
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
  if (email) {
    // Gravatar を 試す ; onerror で initials に fallback
    return `<span class="avatar-au" data-au-email="${escapeHtml(email)}"
              style="${commonStyle}; color:#fff; font-weight:700; font-size:${Math.round(size * 0.4)}px; font-family:system-ui, sans-serif; background:${spec.color}">${escapeHtml(spec.initials)}</span>`;
  }
  return `<span class="avatar-au"
            style="${commonStyle}; color:#fff; font-weight:700; font-size:${Math.round(size * 0.4)}px; font-family:system-ui, sans-serif; background:${spec.color}">${escapeHtml(spec.initials)}</span>`;
}

// DOM 挿入後に呼ぶ: data-au-email 付き の initials avatar を Gravatar に 差し替え (成功時のみ)。
export async function mountAuthorAvatars(root = document) {
  const nodes = root.querySelectorAll('[data-au-email]');
  for (const n of nodes) {
    const email = n.getAttribute('data-au-email');
    if (!email) continue;
    const url = await gravatarUrl(email, 80);
    if (!url) continue;
    // ロード テスト (404 なら 差し替え しない)
    const ok = await new Promise((res) => {
      const im = new Image();
      im.onload  = () => res(true);
      im.onerror = () => res(false);
      im.src = url;
    });
    if (!ok) continue;
    // 差し替え
    const size = parseInt(n.style.width, 10) || 38;
    const bg   = n.style.background || '';
    const img = document.createElement('img');
    img.className = 'avatar-au';
    img.src = url;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.style.cssText = `width:${size}px; height:${size}px; border-radius:50%; flex:none; object-fit:cover; background:${bg}`;
    n.replaceWith(img);
  }
}
