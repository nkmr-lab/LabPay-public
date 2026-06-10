// /#/wishlist — "これ欲しい" board. Anyone can post (free-text product name +
// optional JAN + note). Others see the list and can bring something in to
// fulfill it. Requester can close their own; admin can close any.

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

export async function renderWishlist() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0">これ欲しい!</h2>
    </div>

    <div class="card">
      <h3>新しくリクエスト</h3>
      <label class="field">
        <span class="lbl">商品名 (必須)</span>
        <input type="text" id="wl-name" maxlength="200" placeholder="例: マルチビタミングミ">
      </label>
      <label class="field">
        <span class="lbl">JAN コード (任意)</span>
        <input type="text" id="wl-jan" maxlength="14" placeholder="4901234567890" inputmode="numeric">
      </label>
      <label class="field">
        <span class="lbl">メモ (任意)</span>
        <textarea id="wl-note" maxlength="500" rows="2" placeholder="味の好み・銘柄・予算など"></textarea>
      </label>
      <button id="wl-add" class="primary">リクエスト</button>
    </div>

    <div class="card">
      <div class="row center">
        <h3 class="row-title">募集中</h3>
        <label class="muted" style="font-size:13px; display:inline-flex; align-items:center; gap:6px">
          <input type="checkbox" id="wl-show-closed"> 達成済も表示
        </label>
      </div>
      <div id="wl-list" class="list" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('wl-add').addEventListener('click', onAdd);
  document.getElementById('wl-show-closed').addEventListener('change', loadList);
  await loadList();
}

async function loadList() {
  const showClosed = document.getElementById('wl-show-closed').checked;
  const root = document.getElementById('wl-list');
  try {
    const d = await get('/api/wishlist', { status: showClosed ? 'all' : 'open' });
    if (!d.items.length) {
      root.innerHTML = `<div class="empty">${showClosed ? 'リクエストはありません' : '募集中のリクエストはありません'}</div>`;
      return;
    }
    root.innerHTML = d.items.map(renderRow).join('');
    root.querySelectorAll('[data-fulfill]').forEach(b => {
      b.addEventListener('click', () => onFulfill(Number(b.dataset.fulfill)));
    });
    root.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', () => onDelete(Number(b.dataset.del)));
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderRow(w) {
  const meId = state.me?.id;
  const isMine = meId === Number(w.requester_user_id);
  const isClosed = !!w.fulfilled_at;
  const janLine = w.jan ? `<div class="meta">JAN: ${escapeHtml(w.jan)}</div>` : '';
  const noteLine = w.note ? `<div class="meta" style="white-space:pre-wrap">${escapeHtml(w.note)}</div>` : '';
  const statusTag = isClosed
    ? `<span class="tag muted">✓ 達成</span>`
    : `<span class="tag ok">募集中</span>`;
  const actions = isClosed ? '' : (isMine
    ? `<button data-del="${w.id}" class="danger">取消</button>`
    : `<button class="primary" data-fulfill="${w.id}">出ました!</button>`);
  return `
    <div class="list-item">
      <div class="grow">
        <div class="bold">${escapeHtml(w.product_name)} ${statusTag}</div>
        ${janLine}${noteLine}
        <div class="meta" style="display:flex; align-items:center; gap:6px; margin-top:4px">
          ${avatarHtml(w.requester_name, w.requester_avatar_url, 'sm')}
          ${escapeHtml(w.requester_name)} · ${escapeHtml(w.created_at)}
        </div>
      </div>
      ${actions ? `<div>${actions}</div>` : ''}
    </div>`;
}

async function onAdd() {
  const product_name = document.getElementById('wl-name').value.trim();
  const jan = document.getElementById('wl-jan').value.trim();
  const note = document.getElementById('wl-note').value.trim();
  if (!product_name) { toast('商品名を入れてください'); return; }
  try {
    await post('/api/wishlist', { product_name, jan: jan || null, note: note || null });
    document.getElementById('wl-name').value = '';
    document.getElementById('wl-jan').value = '';
    document.getElementById('wl-note').value = '';
    toast('リクエストしました');
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onFulfill(id) {
  if (!confirm('これは出品されたのでこのリクエストを完了にしますか?')) return;
  try {
    await post(`/api/wishlist/${id}/fulfill`, {});
    toast('達成扱いにしました');
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onDelete(id) {
  if (!confirm('リクエストを取り消しますか?')) return;
  try {
    await del(`/api/wishlist/${id}`);
    toast('取消しました');
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
}
