// v1004 著者ページ /#/authors/{name} (中村さん指摘「著者で選択したら、
//   著者ページに移動して、 その著者の情報が見えつつ、 辿れるようにして欲しい」
//   「名前の表記揺れがあることがあるので、 複数の表記を受け付ける仕組みも
//   必要かもしれない」)。

import { escapeHtml } from '../router.js';
import { get } from '../api.js';
import { renderAuthorAvatar, mountAuthorAvatars, initLabUsersCache } from '../author_avatar.js';

export async function renderAuthor({ params }) {
  const app = document.getElementById('app');
  const name = decodeURIComponent(params.name || '');
  if (!name) { app.innerHTML = `<div class="card">著者名がありません</div>`; return; }
  app.innerHTML = `<div class="card">🔍 「${escapeHtml(name)}」 の 論文 を 検索中…</div>`;
  await initLabUsersCache();
  let d;
  try {
    d = await get('/api/authors/' + encodeURIComponent(name));
  } catch (e) {
    app.innerHTML = `<div class="card">⚠ ${escapeHtml(e.message || String(e))}</div>`;
    return;
  }
  const papers = d.papers || [];
  const variants = (d.name_variants || []).filter(v => v && v !== name);
  const affil = (d.affiliations || [])[0] || null;
  const email = (d.emails || [])[0] || null;
  const scholarUrl = 'https://scholar.google.com/scholar?q=' + encodeURIComponent('author:"' + name + '"');
  const dblpUrl    = 'https://dblp.org/search?q=' + encodeURIComponent(name);
  const semanticUrl = 'https://www.semanticscholar.org/search?q=' + encodeURIComponent(name) + '&sort=relevance';

  app.innerHTML = `
    <div class="card page-header">
      <div style="display:flex; gap:14px; align-items:center">
        ${renderAuthorAvatar({ name, email }, { size: 72 })}
        <div style="flex:1; min-width:0">
          <h2 style="margin:0; font-size:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(name)}</h2>
          ${affil ? `<div class="meta" style="font-size:12.5px; margin-top:2px; color:#6b7280">${escapeHtml(affil)}</div>` : ''}
          ${email ? `<div class="meta" style="font-size:12px; margin-top:2px"><a href="mailto:${escapeHtml(email)}" style="color:#7b3fa0; text-decoration:none">✉ ${escapeHtml(email)}</a></div>` : ''}
        </div>
      </div>
      ${variants.length ? `
        <div class="hint-sm" style="margin-top:8px">
          別表記: ${variants.map(v => `<span style="background:#faf5ff; padding:1px 6px; border-radius:8px; margin-right:4px">${escapeHtml(v)}</span>`).join('')}
        </div>` : ''}
      <div class="row no-print" style="gap:6px; margin-top:10px; flex-wrap:wrap">
        <a class="btn" href="${escapeHtml(scholarUrl)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">🎓 Google Scholar</a>
        <a class="btn" href="${escapeHtml(dblpUrl)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">📚 DBLP</a>
        <a class="btn" href="${escapeHtml(semanticUrl)}" target="_blank" rel="noopener" style="font-size:12px; padding:3px 10px">🔬 Semantic Scholar</a>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px; font-size:14px">📄 LabPay 内 の 論文 (${papers.length} 件)</h3>
      ${papers.length ? `
        <div style="display:flex; flex-direction:column; gap:6px">
          ${papers.map(renderPaperRow).join('')}
        </div>` : `
        <div class="hint-sm">LabPay 内 で この 著者 の 要約 / 全訳 は 見つかり ませ ん でした。
          上 の Google Scholar / DBLP から 探せます。</div>`}
    </div>
  `;
  mountAuthorAvatars(app);
}

function renderPaperRow(p) {
  const url = p.kind === 'summary'
    ? '#/paper-summary/r/' + encodeURIComponent(p.share_token)
    : '#/paper-translate-full/r/' + encodeURIComponent(p.share_token);
  const kindLabel = p.kind === 'summary' ? '📑 要約' : '📑 全訳';
  const kindColor = p.kind === 'summary' ? '#7b3fa0' : '#4a106d';
  const date = (p.date || '').slice(0, 10);
  return `
    <a href="${escapeHtml(url)}" style="display:block; padding:8px 10px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; text-decoration:none; color:inherit">
      <div style="display:flex; gap:6px; align-items:baseline; flex-wrap:wrap">
        <span style="font-size:10.5px; padding:1px 6px; border-radius:4px; background:${kindColor}; color:#fff">${kindLabel}</span>
        <div style="flex:1; min-width:0; font-size:13.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(p.title || '(タイトル 不明)')}</div>
        <span class="hint-sm" style="font-size:10.5px">${escapeHtml(date)}</span>
      </div>
      ${p.venue    ? `<div style="margin-top:2px; font-size:11.5px; color:#6b7280; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">📍 ${escapeHtml(p.venue)}</div>` : ''}
      ${p.matched_name && p.matched_name !== '' ? `<div style="margin-top:2px; font-size:10.5px; color:#9ca3af">この論文での表記: ${escapeHtml(p.matched_name)}</div>` : ''}
    </a>`;
}
