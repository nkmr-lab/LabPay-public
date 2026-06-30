// /#/papers-recent — v809 論文要約 + 全訳を時系列で全件一覧。
//   v840 タイル表示 + ⭐ スター + 並び替え + 「自分のスター付きだけ」フィルタ対応。

import { get } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { starButtonHtml, bindStarButtons, bookmarkButtonHtml, bindBookmarkButtons, viewControlsHtml, bindViewControls } from '../ui_ai_stars.js';

const PAGE_SIZE = 20;
let viewState = { sort: 'new', mineOnly: false };

export async function renderPapersRecent() {
  const app = document.getElementById('app');
  // v856 #441 PC のフルスクリーンだと横幅が広すぎてタイルが巨大化する問題を修正。
  //   max-width:1400px のセンター揃えコンテナで囲んでサイズ感を統一。
  app.innerHTML = `
    <div style="max-width:1400px; margin:0 auto; width:100%; box-sizing:border-box">
      <div class="card page-header">
        <h2 style="margin:0">📑 論文要約 / 全訳 (新着)</h2>
      </div>
      <div class="card">
        <p class="hint" style="font-size:13px; margin:0 0 8px">
          公開中のもの + 自分のものを時系列で表示。タップで各結果ページへ。
        </p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; font-size:12px; margin-bottom:8px">
          <a href="#/paper-summary" class="btn">📑 要約を新規作成</a>
          <a href="#/paper-translate-full" class="btn">📑 全訳を新規作成</a>
        </div>
        <div id="papers-recent-controls"></div>
        <div id="papers-recent-grid"></div>
        <div id="papers-recent-more" style="margin-top:10px; text-align:center"></div>
        <div id="papers-recent-status" class="hint" style="margin-top:6px; text-align:center; font-size:12px"></div>
      </div>
    </div>
  `;
  const ctlRoot = document.getElementById('papers-recent-controls');
  ctlRoot.innerHTML = viewControlsHtml({ id: 'pr-vc', sort: viewState.sort, mineOnly: viewState.mineOnly });
  bindViewControls(ctlRoot, ({ mineOnly, sort }) => {
    viewState.mineOnly = mineOnly;
    viewState.sort = sort;
    reload();
  });
  await reload();
}

let offset = 0;
let acc = [];

async function reload() {
  offset = 0; acc = [];
  document.getElementById('papers-recent-grid').innerHTML = '<div class="hint">読み込み中…</div>';
  document.getElementById('papers-recent-more').innerHTML = '';
  await loadMore();
}

async function loadMore() {
  const gridEl = document.getElementById('papers-recent-grid');
  const moreEl = document.getElementById('papers-recent-more');
  const statusEl = document.getElementById('papers-recent-status');
  moreEl.innerHTML = '<div class="hint">読み込み中…</div>';
  try {
    const params = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (viewState.sort === 'stars') params.push('sort=stars');
    const d = await get(`/api/ai/paper_recent?${params.join('&')}`);
    let items = d.items || [];
    if (offset === 0 && !items.length) {
      gridEl.innerHTML = '<div class="hint" style="font-size:13px">まだ 1 件もありません</div>';
      moreEl.innerHTML = '';
      return;
    }
    acc = acc.concat(items);
    const filtered = viewState.mineOnly ? acc.filter(r => r.my_starred) : acc;
    gridEl.innerHTML = `<div class="ai-tile-grid">${filtered.map(renderTile).join('')}</div>`;
    bindStarButtons(gridEl);
    bindBookmarkButtons(gridEl);
    offset += items.length;
    // 更新 (filtered の場合件数表示は filter 適用後 / 全 acc 中)
    const controls = document.getElementById('papers-recent-controls');
    if (controls) {
      controls.innerHTML = viewControlsHtml({ id: 'pr-vc', sort: viewState.sort, mineOnly: viewState.mineOnly, total: filtered.length });
      bindViewControls(controls, ({ mineOnly, sort }) => {
        viewState.mineOnly = mineOnly;
        viewState.sort = sort;
        reload();
      });
    }
    statusEl.textContent = viewState.mineOnly
      ? `${filtered.length} 件 (スター付き / 全 ${acc.length} 件)`
      : `${acc.length} 件表示中`;
    if (d.has_more) {
      moreEl.innerHTML = '<button class="btn primary" id="papers-recent-more-btn">もっと読み込む (+20)</button>';
      document.getElementById('papers-recent-more-btn')?.addEventListener('click', loadMore);
    } else {
      moreEl.innerHTML = '<div class="hint" style="font-size:12px">— これで全部 —</div>';
    }
  } catch (e) {
    moreEl.innerHTML = `<div class="hint" style="color:#c00">失敗: ${e?.message || e}</div>`;
  }
}

function renderTile(it) {
  const url = `#/${it.url_slug}/r/${escapeHtml(it.share_token)}`;
  const kindLabel = it.kind === 'summary' ? '要約' : '全訳';
  const title = it.title || it.title_original || it.pdf_name || '(無題)';
  const directionMark = it.kind === 'full' && it.direction
    ? (it.direction === 'ja2en' ? '🇯🇵→🇬🇧 ' : '🇬🇧→🇯🇵 ')
    : '';
  const starRefKind = it.star_kind || (it.kind === 'summary' ? 'paper_translate' : 'paper_full_translation');
  return `
    <a class="ai-tile" href="${url}">
      <div class="ai-tile-head">
        ${avatarHtml(it.author_name, it.author_avatar, 'xs')}
        <span style="font-size:11px">${escapeHtml(it.author_name || '')}</span>
        <span style="margin-left:auto; font-size:11px">${directionMark}${escapeHtml(kindLabel)}${it.is_shared ? ' ・ 🌐' : (it.is_mine ? ' ・自分' : '')}</span>
      </div>
      <div class="ai-tile-title">${escapeHtml(title)}</div>
      ${it.title_original && it.title_original !== title ? `<div style="font-size:11.5px; color:#6b7280; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(it.title_original)}</div>` : ''}
      ${it.snippet ? `<div class="ai-tile-snippet">${escapeHtml(it.snippet)}</div>` : ''}
      <div class="ai-tile-foot">
        <span>${escapeHtml(it.created_at || '')}</span>
        <span style="margin-left:auto">
          ${starButtonHtml({ kind: starRefKind, refId: it.id, count: it.star_count, mine: it.my_starred, users: it.star_users })}
          ${bookmarkButtonHtml({ kind: starRefKind, refId: it.id, count: it.bookmark_count, mine: it.my_bookmarked })}
        </span>
      </div>
    </a>`;
}
