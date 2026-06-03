// /#/scrapbox — read-only feed over #scrapbox. Filters to 研究ノート and
// collapses consecutive same-author edits, latest first. Each row links out
// to the corresponding Scrapbox page.

import { get } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { toast } from '../app.js';

// 範囲は 「今日 / 昨日 / 今週」 の 3 択。 1 ヶ月だと量が多すぎて読めなくなるので
// 廃止。 サーバ側は range キーで oldest/latest を切り出して Slack を叩く。
const RANGES = [
  { key: 'today',     label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'this_week', label: '今週' },
];

export async function renderScrapboxFeed() {
  const app = document.getElementById('app');
  // 旧 'labpay-scrapbox-days' は廃止し、新しいキーに切替。
  let saved = localStorage.getItem('labpay-scrapbox-range') || 'today';
  if (!RANGES.some(r => r.key === saved)) saved = 'today';
  app.innerHTML = `
    <div class="card">
      <a href="#/apps" class="hint">← アプリ</a>
      <div class="row center">
        <h2 class="row-title">Scrapbox 研究ノート フィード</h2>
        <select id="sb-feed-range" style="max-width:120px">
          ${RANGES.map(r => `<option value="${r.key}" ${r.key === saved ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </div>
      <p class="card-subtitle">
        #scrapbox の通知のうち「研究ノート」を含むものだけ表示。同じ人の連続編集はまとめて、最新が上です。タイトルをタップで Scrapbox のページへ。
      </p>
    </div>
    <div id="sb-feed-body" class="list"><div class="muted">読み込み中…</div></div>
  `;
  document.getElementById('sb-feed-range').addEventListener('change', e => {
    localStorage.setItem('labpay-scrapbox-range', e.target.value);
    load();
  });
  await load();
}

async function load() {
  const range = document.getElementById('sb-feed-range').value;
  const root = document.getElementById('sb-feed-body');
  root.innerHTML = `<div class="muted">読み込み中…</div>`;
  try {
    const d = await get('/api/scrapbox/feed', { range });
    if (!d.groups.length) {
      root.innerHTML = `<div class="empty">期間中に該当する編集はありません</div>`;
      return;
    }
    root.innerHTML = d.groups.map(renderGroup).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    toast('取得失敗: ' + e.message);
  }
}

function renderGroup(g) {
  const who = g.mapped
    ? `${avatarHtml(g.mapped.display_name, g.mapped.avatar_url, 'sm')} <span class="bold">${escapeHtml(g.mapped.display_name)}</span> <span class="muted" style="font-size:11px">(${escapeHtml(g.author)})</span>`
    : `<span class="bold">${escapeHtml(g.author)}</span> <span class="muted" style="font-size:11px">(未マッピング)</span>`;
  const pages = g.pages.map(p => `
    <li style="margin:2px 0">
      <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener" style="color:var(--primary); word-break:break-all">
        📄 ${escapeHtml(p.title)} ↗
      </a>
    </li>`).join('');
  const preview = g.preview
    ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px; max-height:60px; overflow:hidden">${escapeHtml(g.preview)}</div>`
    : '';
  return `
    <div class="list-item" style="align-items:flex-start">
      <div class="grow">
        <div style="display:flex; align-items:center; gap:6px">${who}</div>
        <div class="meta">${escapeHtml(g.first_at)}${g.edit_count > 1 ? ` · ${g.edit_count} 回編集` : ''}</div>
        <ul style="margin:4px 0 0; padding-left:18px; font-size:14px">${pages}</ul>
        ${preview}
      </div>
    </div>`;
}
