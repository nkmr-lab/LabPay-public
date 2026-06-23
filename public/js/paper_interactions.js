// v789 #389 論文 要約 / 全訳 で 共通 で 使う 反応 + コメント パネル。
//
// 使い方:
//   import { renderInteractionsCard, mountInteractionsCard } from '../paper_interactions.js';
//   ...
//   container.innerHTML = renderInteractionsCard({ apiBase: '/api/ai/paper_translate', refId, reactions });
//   mountInteractionsCard({ apiBase: '/api/ai/paper_translate', refId, urlSlug: 'paper-summary' });
//
// renderInteractionsCard は カード の HTML 文字列 を 返し、 mount 系 で イベント を 結ぶ。

import { get, post, del } from './api.js';
import { escapeHtml, avatarHtml } from './router.js';
import { state, toast } from './app.js';

export function renderInteractionsCard({ apiBase, refId, reactions }) {
  const r = reactions || {};
  return `
    <div class="card" id="pi-card" data-api-base="${escapeHtml(apiBase)}" data-ref-id="${refId}">
      <div class="row" style="gap:8px; align-items:center">
        <button class="btn" id="pi-like" style="font-size:14px; padding:6px 12px; ${r.my_like ? 'background:#fef3c7; border-color:#f59e0b' : ''}">
          ${r.my_like ? '❤️' : '🤍'} <span id="pi-like-n">${r.like || 0}</span>
        </button>
        <button class="btn" id="pi-bookmark" style="font-size:14px; padding:6px 12px; ${r.my_bookmark ? 'background:#dbeafe; border-color:#3b82f6' : ''}">
          ${r.my_bookmark ? '🔖' : '📑'} <span id="pi-bm-n">${r.bookmark || 0}</span>
        </button>
        <div class="grow"></div>
        <div class="meta" style="font-size:12px">💬 ${r.comment_count || 0} コメント</div>
      </div>
      <div class="sep" style="margin:10px 0"></div>
      <div class="bold" style="font-size:14px; margin-bottom:6px">💬 コメント</div>
      <div id="pi-comments"><div class="muted">読み込み 中…</div></div>
      <div style="margin-top:8px">
        <textarea id="pi-comment-input" rows="2" maxlength="2000" placeholder="コメント を 書く…" style="width:100%; box-sizing:border-box"></textarea>
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:4px">
          <button id="pi-comment-send" class="primary">投稿</button>
        </div>
      </div>
    </div>`;
}

export function mountInteractionsCard({ apiBase, refId }) {
  const card = document.getElementById('pi-card');
  if (!card) return;
  const likeBtn = document.getElementById('pi-like');
  const bmBtn   = document.getElementById('pi-bookmark');
  const likeN   = document.getElementById('pi-like-n');
  const bmN     = document.getElementById('pi-bm-n');
  async function toggleReaction(kind) {
    try {
      const r = await post(`${apiBase}/${refId}/react`, { kind });
      const c = r.counts || {};
      if (likeN) likeN.textContent = c.like || 0;
      if (bmN)   bmN.textContent   = c.bookmark || 0;
      if (kind === 'like') {
        likeBtn.innerHTML = `${r.on ? '❤️' : '🤍'} <span id="pi-like-n">${c.like || 0}</span>`;
        likeBtn.style.cssText = `font-size:14px; padding:6px 12px; ${r.on ? 'background:#fef3c7; border-color:#f59e0b' : ''}`;
      } else {
        bmBtn.innerHTML = `${r.on ? '🔖' : '📑'} <span id="pi-bm-n">${c.bookmark || 0}</span>`;
        bmBtn.style.cssText = `font-size:14px; padding:6px 12px; ${r.on ? 'background:#dbeafe; border-color:#3b82f6' : ''}`;
      }
    } catch (e) { toast('失敗: ' + e.message); }
  }
  likeBtn?.addEventListener('click', () => toggleReaction('like'));
  bmBtn?.addEventListener('click',   () => toggleReaction('bookmark'));
  document.getElementById('pi-comment-send')?.addEventListener('click', () => sendComment(apiBase, refId));
  loadComments(apiBase, refId);
}

async function loadComments(apiBase, refId) {
  const root = document.getElementById('pi-comments');
  if (!root) return;
  try {
    const d = await get(`${apiBase}/${refId}/comments`);
    if (!d.items || !d.items.length) { root.innerHTML = '<div class="muted">まだ コメント なし</div>'; return; }
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
        if (!confirm('コメント を 削除 しますか?')) return;
        try { await del(`${apiBase}/${refId}/comments/${b.dataset.piDel}`); loadComments(apiBase, refId); }
        catch (e) { toast('削除 失敗: ' + e.message); }
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
  } catch (e) { toast('投稿 失敗: ' + e.message); }
}
