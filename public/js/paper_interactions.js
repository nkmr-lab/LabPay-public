// v789 #389 論文要約 / 全訳詳細ページの反応 + コメントパネル。
// v841 #424 ❤ → ⭐ に統合、 一覧と同じ ai_result_stars / ai_result_bookmarks を読む。
//
// 使い方:
//   container.innerHTML = renderInteractionsCard({ apiBase: '/api/ai/paper_translate', refId, reactions });
//   mountInteractionsCard({ apiBase: '/api/ai/paper_translate', refId });

import { get, post, del } from './api.js';
import { escapeHtml, avatarHtml } from './router.js';
import { state, toast } from './app.js';
import { starButtonHtml, bindStarButtons, bookmarkButtonHtml, bindBookmarkButtons } from './ui_ai_stars.js';

// apiBase → kind (= ai_result_stars / ai_result_bookmarks の kind 列、 list endpoint と同じ)
function apiBaseToKind(apiBase) {
  if (apiBase.includes('paper_full_translate')) return 'paper_full_translation';
  if (apiBase.includes('paper_translate')) return 'paper_translate';
  if (apiBase.includes('deep_research')) return 'deep_research';
  return 'paper_translate';
}

export function renderInteractionsCard({ apiBase, refId, reactions }) {
  const r = reactions || {};
  const kind = apiBaseToKind(apiBase);
  return `
    <div class="card" id="pi-card" data-api-base="${escapeHtml(apiBase)}" data-ref-id="${refId}">
      <div class="row" style="gap:6px; align-items:center">
        ${starButtonHtml({ kind, refId, count: r.star_count ?? r.like ?? 0, mine: !!(r.my_starred ?? r.my_like), users: r.star_users || [] })}
        ${bookmarkButtonHtml({ kind, refId, count: r.bookmark_count ?? r.bookmark ?? 0, mine: !!(r.my_bookmarked ?? r.my_bookmark) })}
        <div class="grow"></div>
        <div class="meta" style="font-size:12px">💬 ${r.comment_count || 0} コメント</div>
      </div>
      <div class="sep" style="margin:10px 0"></div>
      <div class="bold" style="font-size:14px; margin-bottom:6px">💬 コメント</div>
      <div id="pi-comments"><div class="muted">読み込み中…</div></div>
      <div style="margin-top:8px">
        <textarea id="pi-comment-input" rows="2" maxlength="2000" placeholder="コメントを書く…" style="width:100%; box-sizing:border-box"></textarea>
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:4px">
          <button id="pi-comment-send" class="primary">投稿</button>
        </div>
      </div>
    </div>`;
}

export function mountInteractionsCard({ apiBase, refId }) {
  const card = document.getElementById('pi-card');
  if (!card) return;
  // ⭐ + 🔖 ボタンは ui_ai_stars.js の handler が wire up する
  bindStarButtons(card);
  bindBookmarkButtons(card);
  document.getElementById('pi-comment-send')?.addEventListener('click', () => sendComment(apiBase, refId));
  loadComments(apiBase, refId);
}

async function loadComments(apiBase, refId) {
  const root = document.getElementById('pi-comments');
  if (!root) return;
  try {
    const d = await get(`${apiBase}/${refId}/comments`);
    if (!d.items || !d.items.length) { root.innerHTML = '<div class="muted">まだコメントなし</div>'; return; }
    root.innerHTML = d.items.map(c => `
      <div style="padding:8px 10px; border-left:3px solid var(--primary); background:#fafafa; border-radius:0 6px 6px 0; margin-bottom:6px">
        <div style="display:flex; align-items:center; gap:6px; font-size:12px">
          ${avatarHtml(c.display_name, c.avatar_url, 'xs')}
          <span class="bold">${escapeHtml(c.display_name || '')}</span>
          <span class="meta" style="margin-left:auto">${escapeHtml(c.created_at || '')}</span>
          ${c.mine ? `<button class="ghost" data-pi-del="${c.id}" style="padding:1px 6px; font-size:11px">🗑</button>` : ''}
        </div>
        <div style="font-size:13.5px; line-height:1.7; margin-top:4px; white-space:pre-wrap">${escapeHtml(c.body)}</div>
      </div>`).join('');
    root.querySelectorAll('[data-pi-del]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('コメントを削除しますか?')) return;
        try { await del(`${apiBase}/${refId}/comments/${b.dataset.piDel}`); loadComments(apiBase, refId); }
        catch (e) { toast('削除失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function sendComment(apiBase, refId) {
  const ta = document.getElementById('pi-comment-input');
  const body = (ta?.value || '').trim();
  if (!body) return;
  try {
    await post(`${apiBase}/${refId}/comments`, { body });
    ta.value = '';
    loadComments(apiBase, refId);
  } catch (e) { toast('投稿失敗: ' + e.message); }
}
