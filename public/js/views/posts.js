// /#/sns — シンプル SNS (旧 Twitter 風)。
// フォロー なし、 全員 が 全投稿 を 見る。 テキスト + 画像 + 位置 + @メンション。
// 返信 (parent_id)、 いいね (toggle) のみ。 リポスト なし。

import { get, post, del } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { loadLeaflet } from './group_map.js';

function fmtRelative(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const diff = Date.now() - dt.getTime();
  if (diff < 60_000) return 'たった今';
  if (diff < 3600_000) return `${Math.floor(diff/60000)} 分前`;
  if (diff < 86400_000) return `${Math.floor(diff/3600000)} 時間前`;
  if (diff < 7*86400_000) return `${Math.floor(diff/86400_000)} 日前`;
  return dt.toLocaleDateString();
}

function renderBodyHtml(body) {
  // @mention は 色付け、 URL は リンク化
  let s = escapeHtml(body || '');
  s = s.replace(/@([\p{L}\p{N}_\-\.]{1,40})/gu, '<span style="color:var(--primary); font-weight:600">@$1</span>');
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\n/g, '<br>');
}

function postCard(p, opts = {}) {
  const meId = Number(state.me?.id);
  const isMine = p.user_id === meId;
  const canDelete = isMine || state.me?.role === 'admin';
  const liked = p.liked_by_me;
  const replyHash = opts.skipReplyHash ? '' : `#/sns/${p.id}`;
  const loc = (p.lat !== null && p.lng !== null)
    ? `<a href="https://maps.google.com/?q=${p.lat},${p.lng}" target="_blank" rel="noopener" class="hint" style="font-size:11px">📍 地図</a>`
    : '';
  return `
    <div class="list-item" style="align-items:flex-start; gap:8px" data-post-id="${p.id}">
      ${avatarHtml(p.display_name, p.avatar_url, 'sm')}
      <div class="grow" style="min-width:0">
        <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
          <span class="bold">${escapeHtml(p.display_name)}</span>
          <span class="hint" style="font-size:11px">${fmtRelative(p.created_at)}</span>
          ${loc}
          ${canDelete ? `<button class="btn" data-del-post="${p.id}" style="margin-left:auto; font-size:11px; padding:2px 6px">削除</button>` : ''}
        </div>
        ${p.body ? `<div style="font-size:14px; line-height:1.5; margin-top:2px">${renderBodyHtml(p.body)}</div>` : ''}
        ${p.image_url ? `<a href="${escapeHtml(p.image_url)}" target="_blank"><img src="${escapeHtml(p.image_url)}" style="max-width:100%; max-height:300px; border-radius:8px; margin-top:6px"></a>` : ''}
        <div class="row" style="gap:14px; margin-top:6px; font-size:12px">
          <a class="hint" data-like-post="${p.id}" style="cursor:pointer; ${liked ? 'color:#e11d48' : ''}">${liked ? '❤️' : '🤍'} ${p.like_count}</a>
          ${replyHash ? `<a class="hint" href="${replyHash}">💬 ${p.reply_count}</a>` : ''}
        </div>
      </div>
    </div>`;
}

let postsState = { items: [], beforeId: 0, loading: false, atEnd: false };

export async function renderPosts() {
  postsState = { items: [], beforeId: 0, loading: false, atEnd: false };
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">💬 ラボSNS</h2>
      <p class="card-subtitle" style="margin:6px 0 0">
        ラボメンバー の つぶやき。 テキスト + 画像 + 位置 + @メンション + ❤ いいね + 返信。
        フォロー なし — 全員 の 投稿 が 見える。
      </p>
    </div>
    ${composerHtml(null)}
    <div id="po-list" class="list"></div>
    <div id="po-more" class="row center" style="gap:6px; margin-top:12px"></div>
  `;
  bindComposer(null);
  await loadMore();
  document.getElementById('po-more').addEventListener('click', loadMore);
}

export async function renderPostDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/sns" class="hint">← タイムライン</a>
    </div>
    <div id="po-parent"><div class="muted">読み込み中…</div></div>
    ${composerHtml(id)}
    <div class="card" style="margin-top:12px">
      <h3 style="margin:0 0 6px">💬 返信 (<span id="po-reply-count">0</span>)</h3>
      <div id="po-replies" class="list"></div>
    </div>
  `;
  bindComposer(id);
  try {
    const d = await get('/api/posts/' + id);
    const parent = d.post;
    document.getElementById('po-parent').innerHTML = `
      <div class="card">${postCard(parent, { skipReplyHash: true })}</div>`;
    document.getElementById('po-reply-count').textContent = d.replies.length;
    document.getElementById('po-replies').innerHTML = d.replies.map(r => postCard(r, { skipReplyHash: true })).join('') || '<div class="empty">まだ 返信 なし</div>';
    bindRowHandlers();
  } catch (e) {
    document.getElementById('po-parent').innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`;
  }
}

function composerHtml(parentId) {
  const placeholder = parentId ? '返信を 書く…' : 'いま どうしてる?  @display_name で メンション、 自由に投稿。';
  return `
    <div class="card">
      <textarea id="po-body" maxlength="2000" rows="3" placeholder="${escapeHtml(placeholder)}"></textarea>
      <div class="row" style="gap:6px; margin-top:6px; align-items:center; flex-wrap:wrap">
        <input type="file" id="po-img" accept="image/*" style="flex:1; min-width:140px">
        <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px">
          <input type="checkbox" id="po-loc"> 📍 現在地 を 添付
        </label>
        <button id="po-submit" class="primary" style="margin-left:auto" data-parent="${parentId || ''}">投稿</button>
      </div>
      <div class="hint-sm" id="po-img-status"></div>
    </div>`;
}

let composerImageUrl = null;
let composerCoords = null;
function bindComposer(parentId) {
  composerImageUrl = null;
  composerCoords = null;
  const imgInput = document.getElementById('po-img');
  const imgStatus = document.getElementById('po-img-status');
  imgInput?.addEventListener('change', async () => {
    const f = imgInput.files[0];
    if (!f) { composerImageUrl = null; imgStatus.textContent = ''; return; }
    imgStatus.textContent = 'アップロード中…';
    const fd = new FormData();
    fd.append('file', f);
    try {
      const resp = await fetch('/api/uploads/image', { method: 'POST', body: fd });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error || 'upload failed');
      composerImageUrl = j.url || j.path;
      imgStatus.innerHTML = `<span style="color:#0e7c63">✓ アップロード 完了</span>`;
    } catch (e) { imgStatus.textContent = '失敗: ' + e.message; }
  });
  document.getElementById('po-loc')?.addEventListener('change', (ev) => {
    if (!ev.target.checked) { composerCoords = null; return; }
    if (!navigator.geolocation) { toast('位置情報 未対応'); ev.target.checked = false; return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { composerCoords = { lat: p.coords.latitude, lng: p.coords.longitude };
               toast(`📍 位置 を 添付 (±${Math.round(p.coords.accuracy)}m)`); },
      (e) => { toast('位置 取得 失敗'); ev.target.checked = false; composerCoords = null; },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  });
  document.getElementById('po-submit')?.addEventListener('click', async () => {
    const body = document.getElementById('po-body').value.trim();
    if (!body && !composerImageUrl) { toast('本文 か 画像 が 必要 です'); return; }
    const payload = {
      body,
      image_url: composerImageUrl || '',
      parent_id: parentId || null,
      lat: composerCoords?.lat ?? null,
      lng: composerCoords?.lng ?? null,
    };
    try {
      const r = await post('/api/posts', payload);
      toast('投稿しました');
      document.getElementById('po-body').value = '';
      document.getElementById('po-img').value = '';
      const locChk = document.getElementById('po-loc');
      if (locChk) locChk.checked = false;
      composerImageUrl = null; composerCoords = null;
      if (parentId) navigate(`#/sns/${parentId}`);
      else { postsState = { items: [], beforeId: 0, loading: false, atEnd: false }; await loadMore(true); }
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

async function loadMore(reset = false) {
  if (postsState.loading || (postsState.atEnd && !reset)) return;
  postsState.loading = true;
  if (reset) postsState.beforeId = 0;
  try {
    const q = postsState.beforeId > 0 ? { before_id: postsState.beforeId, limit: 30 } : { limit: 30 };
    const d = await get('/api/posts', q);
    const items = d.items || [];
    if (reset) {
      postsState.items = items;
      document.getElementById('po-list').innerHTML = items.map(p => postCard(p)).join('') || '<div class="empty">まだ 投稿 なし</div>';
    } else {
      postsState.items.push(...items);
      const html = items.map(p => postCard(p)).join('');
      document.getElementById('po-list').insertAdjacentHTML('beforeend', html);
    }
    if (items.length) postsState.beforeId = items[items.length - 1].id;
    if (items.length < 30) {
      postsState.atEnd = true;
      document.getElementById('po-more').innerHTML = '<span class="muted">これ で 全部 です</span>';
    } else {
      document.getElementById('po-more').innerHTML = '<button class="btn" id="po-load-next">もっと 見る</button>';
      document.getElementById('po-load-next').addEventListener('click', () => loadMore());
    }
    bindRowHandlers();
  } catch (e) { document.getElementById('po-list').insertAdjacentHTML('beforeend', `<div class="muted">${escapeHtml(e.message)}</div>`); }
  postsState.loading = false;
}

function bindRowHandlers() {
  document.querySelectorAll('[data-like-post]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', async () => {
      const id = el.dataset.likePost;
      const currentlyLiked = el.textContent.includes('❤');
      const method = currentlyLiked ? 'del' : 'post';
      try {
        const r = method === 'post'
          ? await post(`/api/posts/${id}/like`, {})
          : await del(`/api/posts/${id}/like`);
        const newLiked = !currentlyLiked;
        el.textContent = `${newLiked ? '❤️' : '🤍'} ${r.like_count}`;
        el.style.color = newLiked ? '#e11d48' : '';
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
  document.querySelectorAll('[data-del-post]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', async () => {
      if (!confirm('この 投稿 を 削除 しますか?')) return;
      try {
        await del(`/api/posts/${el.dataset.delPost}`);
        toast('削除しました');
        const row = el.closest('[data-post-id]');
        if (row) row.remove();
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
}
