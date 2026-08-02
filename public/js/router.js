// Hash-based router. Patterns are simple strings with :param segments.

const routes = [];

export function route(pattern, render) {
  routes.push({ pattern, render, parts: pattern.split('/').filter(Boolean) });
}

function parse(hash) {
  const h = (hash || '#/').replace(/^#/, '');
  const [pathOnly, queryString] = h.split('?');
  const parts = pathOnly.split('/').filter(Boolean);
  const query = {};
  if (queryString) for (const kv of queryString.split('&')) {
    if (!kv) continue;
    const [k, v] = kv.split('=');
    query[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return { parts, query };
}

function match(pattern, parts) {
  if (pattern.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
    else if (p !== parts[i]) return null;
  }
  return params;
}

export function start() {
  window.addEventListener('hashchange', dispatch);
  window.addEventListener('DOMContentLoaded', dispatch);
  // Also dispatch immediately in case DOM is already ready
  if (document.readyState !== 'loading') dispatch();
}

export function navigate(hash) {
  if (location.hash === hash) dispatch();
  else location.hash = hash;
}

function highlightTab() {
  const tabs = document.querySelectorAll('nav#tabs a');
  tabs.forEach(a => {
    if (a.getAttribute('href') === location.hash || (a.getAttribute('href') === '#/' && (!location.hash || location.hash === '#'))) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });
}

// v503 #125 #126 同一 hash の dispatch を 800ms 以内なら重複として skip。 boot 直後の
//   start() で DOMContentLoaded + 即時 dispatch が両方走るレースで renderHome が
//   2回走り「Home load レポートが2回出る」のを抑止。
let lastDispatchHash = null;
let lastDispatchAt = 0;

// v836 「アプリ」と判定されない navigation/系統系ルート。これら以外は全部フルスクリーン化。
const NON_FULLSCREEN_TOP_PARTS = new Set([
  '',                // ホーム
  'groups',          // グループ (タブ)
  // v844 #427 sns (らぼったー) はタブではあるが、投稿スレッドを大きく見たいので fullscreen 化
  'buy', 'sell', 'sellers',
  'requests-hub',
  'auctions',
  'research',        // 研究タブ
  'lab-mgmt',        // 運営タブ
  'shared',          // v999 共有 タブ
  'games',           // 娯楽タブ
  'apps',            // アプリ一覧
  'achievements',
  'settings',
  'notifications',
  'history',
  'admin',
  'feedback', 'feedback-admin',
  'login',
  'users', 'me',
  'dashboard',
  'activity',
  'contacts',
  'widgets',         // ウィジェットセンター
  'my-games',
  'public-timer',
  // v1264 中村さん指摘「一時画像共有 は 横いっぱいの幅で なんかカッコ悪い」
  //   → fullscreen 撤退、 ホームと同じ 720px 幅で表示。
  'screen-shares',
]);

// v842 ✕ で閉じる時の戻り先。 history.back() を使うと、アプリ内部の hash遷移 (例:
//   /#/places → /#/places/123 → ...) が history に積み上がっていて、 1 回押すごとに 1 つ
//   ずつしか戻れず「✕ を何回も押す羽目になる」という問題があった (#places 報告)。
//   代わりに、フルスクリーンに「入った瞬間」の前の hash を覚えておいて、そこに直接戻す。
//   入る前の hash が分からない場合は /#/apps (アプリ一覧) に戻す。
let fsEntryHash = null;
// v1003 中村さん指摘「本当は、 その前のページに戻ってほしい」→ history.back() ベースに。
//   v842 は「食べある記 で ✕ を何回も押す羽目」 を 理由 に history.back を 捨てた が、
//   多くのケース (研究タブ→論文→アイテム→著者→✕) では history.back の方が自然。
//   fsEntryHash より 前 に 戻ら ない よう ガード: fs 突入 後 の hash 遷移 数 を カウント、
//   ✕ 毎 に -1、 0 に なったら 直接 fsEntryHash に jump (それ以上 は 履歴 を 消費しない)。
let fsInnerNavCount = 0;
let fsBackFlag = false;    // v1003 我々 が 発行 した history.back() の フラグ
// v1211 ビュー側で 「✕ 1 発 で 直行 で 閉じたい」場合 に 使う (例: chat-rooms、
//   チャンネル切替 で fsInnerNavCount が 積まれて ✕ が 効かない と 感じる 問題対応)
export function resetFsInnerNav() { fsInnerNavCount = 0; }
function closeFullscreen() {
  if (fsInnerNavCount > 0) {
    fsInnerNavCount--;
    fsBackFlag = true;
    history.back();
    return;
  }
  if (fsEntryHash && fsEntryHash !== location.hash) {
    location.hash = fsEntryHash;
  } else {
    location.hash = '#/apps';
  }
}

// v840 アプリフルモードの間だけ、 Escape キーでも閉じられるようにする (PC キーボード)。
//   keydown は capture せず、 textarea/input にフォーカスが当たっていて IME 変換確定で Esc が
//   来た場合などは無視 (入力欄で困らないように)。
let fsEscBound = false;
function ensureFullscreenEscHandler() {
  if (fsEscBound) return;
  fsEscBound = true;
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!document.body.classList.contains('app-fullscreen')) return;
    const t = ev.target;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
    ev.preventDefault();
    closeFullscreen();
  });
}

function applyFullscreenMode(topPart, prevHash) {
  const wasFs = document.body.classList.contains('app-fullscreen');
  const fs = !NON_FULLSCREEN_TOP_PARTS.has(topPart);
  // v842 フルスクリーンに「入った瞬間」だけ entryHash を更新する。既にフルスクリーン
  //   状態で内部 hash 遷移しただけの時は entryHash を上書きしない (= 元の戻り先を保つ)。
  if (fs && !wasFs) {
    fsEntryHash = (prevHash && prevHash !== location.hash) ? prevHash : null;
    fsInnerNavCount = 0;    // v1003 fs 突入時 は カウント リセット
  } else if (!fs) {
    fsEntryHash = null;
    fsInnerNavCount = 0;
  } else if (fs && wasFs) {
    // fs 継続中 の 内部 遷移 → カウント +1、 ただし 我々 の history.back() 直後 は skip
    if (fsBackFlag) fsBackFlag = false;
    else {
      // v1228 中村さん指摘「✕ で なかなか 戻らない」の 根本対策:
      //   fullscreen 内 の nav でも 「別 の topPart への 遷移 (兄弟 アプリ 移動、 例: paper-summary → paper-translate-full)」
      //   の 時 は カウント しない。 count は 「同じ アプリ の 中 で 深く 潜る (list → detail 等)」 の 時 だけ 積む。
      //   → 兄弟 アプリ 間 の 切替 は ✕ 一発 で entry へ 戻る、 同一 アプリ 内 の 潜り は 段階 back。
      const prevTop = String(prevHash || '#/').replace(/^#\/?/, '').split(/[/?]/)[0] || '';
      if (prevTop === topPart) fsInnerNavCount++;
      else fsInnerNavCount = 0;
    }
  }
  document.body.classList.toggle('app-fullscreen', fs);
  // 閉じる ✕ ボタンを動的に生成 / 撤去
  let closeBtn = document.getElementById('fs-close-btn');
  if (fs) {
    if (!closeBtn) {
      closeBtn = document.createElement('button');
      closeBtn.id = 'fs-close-btn';
      closeBtn.type = 'button';
      closeBtn.title = '閉じる (Esc)';
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'position:fixed; top:8px; right:8px; z-index:1001; width:36px; height:36px; border-radius:18px; border:none; background:rgba(0,0,0,0.6); color:#fff; font-size:18px; line-height:36px; cursor:pointer; padding:0; box-shadow:0 2px 8px rgba(0,0,0,0.3)';
      closeBtn.addEventListener('click', closeFullscreen);
      document.body.appendChild(closeBtn);
    }
    ensureFullscreenEscHandler();
  } else if (closeBtn) {
    closeBtn.remove();
  }
}

async function dispatch() {
  const now = performance.now();
  const hashKey = location.hash || '';
  if (hashKey === lastDispatchHash && (now - lastDispatchAt) < 800) return;
  const prevHash = lastDispatchHash;  // v842 ✕ 戻り先計算用 (上書き前にスナップ)
  lastDispatchHash = hashKey;
  lastDispatchAt = now;
  const { parts, query } = parse(location.hash);
  const target = parts.length === 0 ? [''] : parts;
  // Expose the active view as a body data attribute so per-view CSS
  // (e.g. body[data-view="home"] for the fill-bottom layout) can target it.
  document.body.dataset.view = (target.filter(Boolean).join('-') || 'home');
  // v836 アプリ系の画面は基本的にフルスクリーンモード (上部バー・タブを隠す + ✕で戻る)。
  //   タブナビ + 設定 + 通知 + 履歴 + 管理 + ログイン等の navigation/系統系は除外。
  applyFullscreenMode(target[0] || '', prevHash);
  // v515 #142 タブ切替直後に「読み込み中」プレースホルダ + nav ハイライトを即更新
  //   する (= ユーザがタップした瞬間に画面が反応する)。各 view の renderer が
  //   app.innerHTML を上書きすればプレースホルダは消える。 dynamic import の
  //   完了を待たずに画面が動くので「反応が遅い」感覚が大幅に減る。
  highlightTab();
  const appPlaceholder = document.getElementById('app');
  if (appPlaceholder) {
    appPlaceholder.innerHTML = `
      <div class="card" style="margin-top:12px">
        <div class="home-skel-bars"></div>
      </div>
      <div class="card">
        <div class="home-skel-bars"></div>
      </div>`;
  }
  // 直近 hash を保存 (個別 view の renderer から「自分が古い hash の render か」を
  //   判定したい場合に使える)。
  window.__labpay_dispatch_hash = hashKey;
  for (const r of routes) {
    const params = match(r.parts.length === 0 ? [''] : r.parts, target);
    if (params) {
      try { await r.render({ params, query }); }
      catch (e) {
        console.error(e);
        const app = document.getElementById('app');
        app.innerHTML = `<div class="card"><h2>エラー</h2><p>${escapeHtml(e.message || String(e))}</p></div>`;
      }
      highlightTab();
      return;
    }
  }
  document.getElementById('app').innerHTML = `<div class="card"><h2>404</h2><p>そのページはありません: ${escapeHtml(location.hash)}</p></div>`;
  highlightTab();
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
}

// Defense-in-depth href guard. Server already rejects non-http(s) URLs (tasks_validate_url),
// but if a bad URL ever lands in the DB (manual edit, future migration, etc.) we still refuse
// to emit it as a clickable href. Returns null if the URL is not safe to use in an <a href>.
export function safeHttpUrl(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  // Anything starting with whitespace/control chars or known dangerous schemes is rejected.
  // Browsers tolerate "javascript:" with leading spaces/control chars, so normalize first.
  const lower = s.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')
      || lower.startsWith('vbscript:') || lower.startsWith('file:')) return null;
  if (!(lower.startsWith('http://') || lower.startsWith('https://'))) return null;
  return s;
}

// Render either an <img class="avatar"> when avatar_url is set, or a colored
// circle with the first character of display_name as a fallback.
// v507 loading=lazy + decoding=async + fetchpriority=low をデフォルトで付ける。
//   アバターは大量に並ぶがどれもクリティカルではないので、ビューポート到達まで
//   遅延ロードして OK。ホームの 5 秒スタートアップが大幅に減る。
export function avatarHtml(displayName, avatarUrl, size = 'sm') {
  const cls = 'avatar-' + size;
  if (avatarUrl) return `<img class="avatar ${cls}" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`;
  const ch = (displayName || '?').trim().charAt(0).toUpperCase();
  const fontSize = size === 'lg' ? '28px' : size === 'md' ? '16px' : size === 'xs' ? '10px' : '12px';
  return `<span class="avatar-fallback ${cls}" style="font-size:${fontSize}">${escapeHtml(ch)}</span>`;
}
