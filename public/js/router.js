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

async function dispatch() {
  const { parts, query } = parse(location.hash);
  const target = parts.length === 0 ? [''] : parts;
  // Expose the active view as a body data attribute so per-view CSS
  // (e.g. body[data-view="home"] for the fill-bottom layout) can target it.
  document.body.dataset.view = (target.filter(Boolean).join('-') || 'home');
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
export function avatarHtml(displayName, avatarUrl, size = 'sm') {
  const cls = 'avatar-' + size;
  if (avatarUrl) return `<img class="avatar ${cls}" src="${escapeHtml(avatarUrl)}" alt="">`;
  const ch = (displayName || '?').trim().charAt(0).toUpperCase();
  const fontSize = size === 'lg' ? '28px' : size === 'md' ? '16px' : size === 'xs' ? '10px' : '12px';
  return `<span class="avatar-fallback ${cls}" style="font-size:${fontSize}">${escapeHtml(ch)}</span>`;
}
