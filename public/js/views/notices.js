// /#/notices — 重要連絡 + 学会情報。 シンプルなリスト (タイトル + 本文 + URL)。
// カテゴリ切替タブ。 ピン留めしたものは上に。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { fmtDateTime } from '../format.js';

const CATEGORIES = [
  { key: 'important',  label: '📢 重要連絡', icon: '📢' },
  { key: 'conference', label: '🎓 学会情報', icon: '🎓' },
];

export async function renderNotices({ query } = {}) {
  const currentCat = String(query?.category || 'important');
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">情報リスト</h2>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:8px">
        ${CATEGORIES.map(c => `
          <a class="btn ${c.key === currentCat ? 'primary' : ''}" href="#/notices?category=${c.key}">${escapeHtml(c.label)}</a>
        `).join('')}
        <span style="flex:1"></span>
        <a class="btn primary" href="#/notices/new?category=${currentCat}">＋ 新規投稿</a>
      </div>
    </div>
    <div id="nt-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/notices', { category: currentCat });
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('nt-list').innerHTML =
        '<div class="empty">投稿はまだありません</div>';
      return;
    }
    document.getElementById('nt-list').innerHTML = items.map(n => renderNoticeRow(n)).join('');
    bindNoticeRowEvents(currentCat);
  } catch (e) {
    document.getElementById('nt-list').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderNoticeRow(n) {
  const isMine = Number(n.posted_by_user_id) === Number(state.me?.id);
  const isAdmin = state.me?.role === 'admin';
  const canEdit = isMine || isAdmin;
  const urlPart = n.url
    ? `<div class="meta" style="margin-top:4px"><a href="${escapeHtml(n.url)}" target="_blank" rel="noopener" style="color:var(--primary)">🔗 ${escapeHtml(n.url)}</a></div>`
    : '';
  const bodyPart = n.body
    ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px">${escapeHtml(n.body)}</div>`
    : '';
  const pinBadge = n.pinned ? '<span class="tag" style="background:#fff3e0; color:#e65100">📌 ピン</span>' : '';
  const actions = canEdit
    ? `<div class="row" style="gap:6px; margin-top:6px; justify-content:flex-end">
         <button data-pin-id="${n.id}" data-pinned="${n.pinned}" class="btn" style="padding:2px 8px; font-size:11px">${n.pinned ? '📌 ピン解除' : '📌 ピン留め'}</button>
         <button data-edit-id="${n.id}" class="btn" style="padding:2px 8px; font-size:11px">編集</button>
         <button data-del-id="${n.id}" class="btn" style="padding:2px 8px; font-size:11px; color:var(--muted)">削除</button>
       </div>`
    : '';
  return `
    <div class="list-item" data-notice-id="${n.id}" style="flex-direction:column; align-items:stretch; gap:4px; padding:10px 12px; ${n.pinned ? 'background:#fffaeb; border-left:4px solid #ffb300' : ''}">
      <div class="bold" style="font-size:15px">${pinBadge} ${escapeHtml(n.title)}</div>
      ${bodyPart}
      ${urlPart}
      <div class="meta">${escapeHtml(n.posted_by_name)} · ${escapeHtml(fmtDateTime(n.created_at))}${n.updated_at ? ` (更新 ${escapeHtml(fmtDateTime(n.updated_at))})` : ''}</div>
      ${actions}
    </div>`;
}

function bindNoticeRowEvents(currentCat) {
  document.querySelectorAll('[data-pin-id]').forEach(b => {
    b.addEventListener('click', async () => {
      const pinned = b.dataset.pinned === '1' ? 0 : 1;
      try { await patch('/api/notices/' + b.dataset.pinId, { pinned }); }
      catch (e) { toast('失敗: ' + e.message); return; }
      await renderNotices({ query: { category: currentCat } });
    });
  });
  document.querySelectorAll('[data-edit-id]').forEach(b => {
    b.addEventListener('click', () => navigate('#/notices/' + b.dataset.editId + '/edit'));
  });
  document.querySelectorAll('[data-del-id]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('この連絡を削除しますか?')) return;
      try { await del('/api/notices/' + b.dataset.delId); }
      catch (e) { toast('失敗: ' + e.message); return; }
      await renderNotices({ query: { category: currentCat } });
    });
  });
}

export async function renderNoticeForm({ params, query } = {}) {
  const editId = params?.id ? Number(params.id) : null;
  let initial = {
    category: String(query?.category || 'important'),
    title: '', body: '', url: '', pinned: false,
  };
  if (editId) {
    try {
      // detail GET が無いので list を category なしで取って該当 id をピックアップ。
      const d = await get('/api/notices');
      const found = (d.items || []).find(x => Number(x.id) === editId);
      if (found) {
        initial = {
          category: found.category,
          title: found.title,
          body: found.body || '',
          url: found.url || '',
          pinned: !!found.pinned,
        };
      }
    } catch (_) {}
  }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/notices?category=${initial.category}" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">${editId ? '連絡を編集' : '新規投稿'}</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">カテゴリ</span>
        <select id="nf-cat">
          ${CATEGORIES.map(c => `<option value="${c.key}" ${c.key === initial.category ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span class="lbl">タイトル</span>
        <input type="text" id="nf-title" maxlength="200" value="${escapeHtml(initial.title)}" autofocus>
      </label>
      <label class="field"><span class="lbl">本文 (任意)</span>
        <textarea id="nf-body" rows="5" maxlength="4000">${escapeHtml(initial.body)}</textarea>
      </label>
      <label class="field"><span class="lbl">URL (任意)</span>
        <input type="url" id="nf-url" maxlength="2000" placeholder="https://..." value="${escapeHtml(initial.url)}">
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0">
        <span class="switch"><input type="checkbox" id="nf-pinned" ${initial.pinned ? 'checked' : ''}><span class="slider"></span></span>
        <span>📌 ピン留めする (一覧の上に出る)</span>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/notices?category=${initial.category}" class="btn">キャンセル</a>
        <button id="nf-save" class="primary">${editId ? '保存' : '投稿'}</button>
      </div>
    </div>
  `;
  document.getElementById('nf-save').addEventListener('click', async () => {
    const body = {
      category: document.getElementById('nf-cat').value,
      title:    document.getElementById('nf-title').value.trim(),
      body:     document.getElementById('nf-body').value.trim() || null,
      url:      document.getElementById('nf-url').value.trim() || null,
      pinned:   document.getElementById('nf-pinned').checked,
    };
    if (!body.title) { toast('タイトル必須'); return; }
    try {
      if (editId) await patch('/api/notices/' + editId, body);
      else        await post('/api/notices', body);
      toast(editId ? '保存しました' : '投稿しました');
      navigate('#/notices?category=' + body.category);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
