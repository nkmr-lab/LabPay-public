// v840 Deep Research / 論文要約 / 論文全訳 / papers-recent 共通の ⭐ スター UI ヘルパ。
//   各 view は starButtonHtml() でタイル内に星ボタンを置き、 bindStarButtons() でクリックを束ね、
//   viewControlsHtml() + bindViewControls() で 「スター付きだけ」 + 並び順を出す。
//
//   star kind 一覧 (server と一致):
//     'deep_research' / 'paper_translate' / 'paper_full_translation'

import { escapeHtml } from './router.js';

export function starButtonHtml({ kind, refId, count = 0, mine = false, users = [] }) {
  const tip = users && users.length
    ? users.map(u => u.name).join(', ') + (users.length < count ? ' …' : '')
    : '';
  return `<button type="button" class="ai-star-btn${mine ? ' on' : ''}"
    data-star-kind="${escapeHtml(kind)}" data-star-ref="${Number(refId)}"
    title="${escapeHtml(tip)}"
    onclick="event.preventDefault(); event.stopPropagation();">
    <span class="ai-star-icon">${mine ? '⭐' : '☆'}</span>
    <span class="ai-star-count">${Number(count) || 0}</span>
  </button>`;
}

export async function toggleStar(kind, refId, currentlyOn) {
  const method = currentlyOn ? 'DELETE' : 'POST';
  const resp = await fetch('/api/ai/stars', {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ kind, ref_id: Number(refId) }),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.json();
}

export function bindStarButtons(root, onChange) {
  if (!root) return;
  root.querySelectorAll('.ai-star-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const kind = btn.dataset.starKind;
      const refId = Number(btn.dataset.starRef);
      const wasOn = btn.classList.contains('on');
      btn.disabled = true;
      try {
        const r = await toggleStar(kind, refId, wasOn);
        btn.classList.toggle('on', !!r.my_starred);
        const ic = btn.querySelector('.ai-star-icon');
        if (ic) ic.textContent = r.my_starred ? '⭐' : '☆';
        const cn = btn.querySelector('.ai-star-count');
        if (cn) cn.textContent = String(r.star_count || 0);
        if (typeof onChange === 'function') onChange({ kind, refId, my_starred: !!r.my_starred, star_count: r.star_count });
      } catch (e) {
        // 失敗時は元に戻す
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// v841 🔖 ブックマーク (star と同型 + 別エンドポイント)。 タイル / 詳細 / リストで共通。
export function bookmarkButtonHtml({ kind, refId, count = 0, mine = false }) {
  return `<button type="button" class="ai-bookmark-btn${mine ? ' on' : ''}"
    data-bm-kind="${escapeHtml(kind)}" data-bm-ref="${Number(refId)}"
    title="🔖 ブックマーク"
    onclick="event.preventDefault(); event.stopPropagation();">
    <span class="ai-bm-icon">${mine ? '🔖' : '📑'}</span>
    <span class="ai-bm-count">${Number(count) || 0}</span>
  </button>`;
}

export async function toggleBookmark(kind, refId, currentlyOn) {
  const method = currentlyOn ? 'DELETE' : 'POST';
  const resp = await fetch('/api/ai/bookmarks', {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ kind, ref_id: Number(refId) }),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.json();
}

export function bindBookmarkButtons(root, onChange) {
  if (!root) return;
  root.querySelectorAll('.ai-bookmark-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const kind = btn.dataset.bmKind;
      const refId = Number(btn.dataset.bmRef);
      const wasOn = btn.classList.contains('on');
      btn.disabled = true;
      try {
        const r = await toggleBookmark(kind, refId, wasOn);
        btn.classList.toggle('on', !!r.my_bookmarked);
        const ic = btn.querySelector('.ai-bm-icon');
        if (ic) ic.textContent = r.my_bookmarked ? '🔖' : '📑';
        const cn = btn.querySelector('.ai-bm-count');
        if (cn) cn.textContent = String(r.bookmark_count || 0);
        if (typeof onChange === 'function') onChange({ kind, refId, my_bookmarked: !!r.my_bookmarked, bookmark_count: r.bookmark_count });
      } catch (e) {
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// 並び順 + 「自分のスターのみ」 トグルの共通 UI。
//   options.id   : 一意なID (CSS衝突避け)
//   options.sort : 'new' | 'stars' (現在値)
//   options.mineOnly : boolean (自分のスター付きだけ表示するかの現在値)
//   options.total : 表示中件数 (任意)
//   options.extra : 右端に並べる任意HTML
export function viewControlsHtml(opts) {
  const id = opts.id || 'ai-view-controls';
  const sort = opts.sort || 'new';
  const mineOnly = !!opts.mineOnly;
  const total = opts.total;
  return `<div id="${escapeHtml(id)}" class="ai-view-controls">
    <label class="ai-vc-item">
      <input type="checkbox" data-vc-mine ${mineOnly ? 'checked' : ''}>
      <span>⭐ 自分のスターのみ</span>
    </label>
    <label class="ai-vc-item">並び順:
      <select data-vc-sort>
        <option value="new" ${sort === 'new' ? 'selected' : ''}>新しい順</option>
        <option value="stars" ${sort === 'stars' ? 'selected' : ''}>スター多い順</option>
      </select>
    </label>
    ${opts.extra || ''}
    ${total != null ? `<span class="ai-vc-total">${Number(total) || 0} 件</span>` : ''}
  </div>`;
}

export function bindViewControls(rootEl, onChange) {
  if (!rootEl) return;
  const mineEl = rootEl.querySelector('[data-vc-mine]');
  const sortEl = rootEl.querySelector('[data-vc-sort]');
  mineEl?.addEventListener('change', () => onChange({ mineOnly: mineEl.checked, sort: sortEl?.value || 'new' }));
  sortEl?.addEventListener('change', () => onChange({ mineOnly: !!mineEl?.checked, sort: sortEl.value }));
}

// アプリ起動時にデフォルト閉、 ボタンで開く、 投稿後また閉じるが出来るフォーム折りたたみの helper。
//   <details id="..."> ... </details> の open 属性をプログラム的に切替えるだけ。
export function setFormOpen(detailsId, open) {
  const el = document.getElementById(detailsId);
  if (el) el.open = !!open;
}
