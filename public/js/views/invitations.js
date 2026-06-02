// /#/invitations — 募集 board. Light-weight hang-out invitations (no pt, no escrow).

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

export async function renderInvitations() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0">募集</h2>
      <p class="muted" style="font-size:13px; margin:6px 0 0">
        「お昼ご飯食べに行こう」「ビアガーデン」「ポケモン GO」「スキー」など、
        誰でも参加表明できるカジュアルな募集です。pt のやり取りはありません。
      </p>
    </div>

    <div class="card">
      <h3>新しく募集</h3>
      <label class="field">
        <span class="lbl">タイトル (必須)</span>
        <input type="text" id="inv-title" maxlength="200" placeholder="例: お昼ご飯食べに行こう">
      </label>
      <label class="field">
        <span class="lbl">日時 (任意)</span>
        <input type="datetime-local" id="inv-when">
      </label>
      <label class="field">
        <span class="lbl">場所 (任意)</span>
        <input type="text" id="inv-where" maxlength="200" placeholder="例: 大学前のラーメン屋">
      </label>
      <label class="field">
        <span class="lbl">上限人数 (任意・空欄なら制限なし)</span>
        <input type="number" id="inv-cap" min="1" max="1000" placeholder="例: 4">
      </label>
      <label class="field">
        <span class="lbl">詳細 (任意)</span>
        <textarea id="inv-desc" maxlength="5000" rows="3" placeholder="集合場所・予算・装備など"></textarea>
      </label>
      <button id="inv-add" class="primary">募集する</button>
    </div>

    <div class="card">
      <div class="row" style="align-items:center">
        <h3 style="flex:1; margin:0">募集一覧</h3>
        <label class="muted" style="font-size:13px; display:inline-flex; gap:6px; align-items:center">
          <input type="checkbox" id="inv-show-closed"> 終了も表示
        </label>
      </div>
      <div id="inv-list" class="list" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('inv-add').addEventListener('click', onCreate);
  document.getElementById('inv-show-closed').addEventListener('change', loadList);
  await loadList();
}

async function loadList() {
  const root = document.getElementById('inv-list');
  const showClosed = document.getElementById('inv-show-closed').checked;
  try {
    const d = await get('/api/invitations', { status: showClosed ? 'all' : 'open' });
    if (!d.items.length) {
      root.innerHTML = `<div class="empty">${showClosed ? '募集はありません' : '募集中のものはありません'}</div>`;
      return;
    }
    root.innerHTML = d.items.map(renderRow).join('');
    // 行は <a>。中の参加/取消ボタンは click を握り潰してナビゲートさせない。
    root.querySelectorAll('[data-join]').forEach(b => {
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onJoin(Number(b.dataset.join)); });
    });
    root.querySelectorAll('[data-leave]').forEach(b => {
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onLeave(Number(b.dataset.leave)); });
    });
    root.querySelectorAll('[data-cancel]').forEach(b => {
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onCancel(Number(b.dataset.cancel)); });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderRow(i) {
  const meId = state.me?.id;
  const isMine = meId === Number(i.creator_user_id);
  const isClosed = !!i.closed_at;
  const iJoined = Number(i.i_joined) === 1;
  const whenLine = i.starts_at ? `<div class="meta">🕒 ${escapeHtml(i.starts_at)}</div>` : '';
  const whereLine = i.location ? `<div class="meta">📍 ${escapeHtml(i.location)}</div>` : '';
  const capLine = i.capacity
    ? `<div class="meta">参加 ${i.join_count} / 上限 ${i.capacity}</div>`
    : `<div class="meta">参加 ${i.join_count} 人</div>`;
  const statusTag = isClosed
    ? `<span class="tag muted">終了</span>`
    : (iJoined
      ? `<span class="tag" style="background:#eaf5ef; color:#0e7c63">✓ 参加表明済</span>`
      : `<span class="tag" style="background:#fff3df; color:#b54708">募集中</span>`);

  let actions = '';
  if (!isClosed) {
    if (iJoined) {
      actions = `<button data-leave="${i.id}">取消</button>`;
    } else {
      actions = `<button class="primary" data-join="${i.id}">参加表明</button>`;
    }
    if (isMine) {
      actions += ` <button class="danger" data-cancel="${i.id}">募集取消</button>`;
    }
  }

  const descBlock = i.description
    ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px">${escapeHtml(i.description)}</div>`
    : '';

  return `
    <a class="list-item" href="#/invitations/${i.id}" style="text-decoration:none; color:inherit">
      <div style="flex:1">
        <div class="bold">${escapeHtml(i.title)} ${statusTag}</div>
        ${whenLine}${whereLine}${capLine}
        ${descBlock}
        <div class="meta" style="display:flex; align-items:center; gap:6px; margin-top:4px">
          ${avatarHtml(i.creator_name, i.creator_avatar_url, 'sm')}
          ${escapeHtml(i.creator_name)} · ${escapeHtml(i.created_at)}
        </div>
      </div>
      ${actions ? `<div style="display:flex; flex-direction:column; gap:4px">${actions}</div>` : ''}
    </a>`;
}

// ─── DETAIL ───────────────────────────────────────────────────────────

export async function renderInvitationDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/invitations" class="muted" style="font-size:13px">← 募集一覧</a>
      <div id="inv-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card">
      <h3>参加表明している人</h3>
      <div id="inv-joins" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await loadDetail(id);
}

async function loadDetail(id) {
  try {
    const i = await get('/api/invitations/' + id);
    const meId = state.me?.id;
    const isMine = meId === Number(i.creator_user_id);
    const isClosed = !!i.closed_at;
    const iJoined = (i.joins || []).some(j => Number(j.id) === Number(meId));
    const whenLine = i.starts_at ? `<div class="meta">🕒 ${escapeHtml(i.starts_at)}</div>` : '';
    const whereLine = i.location ? `<div class="meta">📍 ${escapeHtml(i.location)}</div>` : '';
    const capLine = i.capacity
      ? `<div class="meta">参加 ${(i.joins || []).length} / 上限 ${i.capacity}</div>`
      : `<div class="meta">参加 ${(i.joins || []).length} 人</div>`;
    const statusTag = isClosed
      ? `<span class="tag muted">終了</span>`
      : (iJoined
          ? `<span class="tag" style="background:#eaf5ef; color:#0e7c63">✓ 参加表明済</span>`
          : `<span class="tag" style="background:#fff3df; color:#b54708">募集中</span>`);
    let actions = '';
    if (!isClosed) {
      if (iJoined) actions += `<button id="inv-detail-leave">参加表明を取消</button>`;
      else         actions += `<button id="inv-detail-join" class="primary">参加表明する</button>`;
      if (isMine)  actions += ` <button id="inv-detail-cancel" class="danger">募集を取消</button>`;
    }
    document.getElementById('inv-head').innerHTML = `
      <div class="bold" style="font-size:18px">${escapeHtml(i.title)} ${statusTag}</div>
      ${whenLine}${whereLine}${capLine}
      ${i.description ? `<div class="meta" style="white-space:pre-wrap; margin-top:6px">${escapeHtml(i.description)}</div>` : ''}
      <div class="meta" style="display:flex; align-items:center; gap:6px; margin-top:6px">
        ${avatarHtml(i.creator_name, i.creator_avatar_url, 'sm')}
        ${escapeHtml(i.creator_name)} · ${escapeHtml(i.created_at)}
      </div>
      ${actions ? `<div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">${actions}</div>` : ''}
    `;
    document.getElementById('inv-detail-join')  ?.addEventListener('click', async () => { await onJoin(id);   await loadDetail(id); });
    document.getElementById('inv-detail-leave') ?.addEventListener('click', async () => { await onLeave(id);  await loadDetail(id); });
    document.getElementById('inv-detail-cancel')?.addEventListener('click', async () => { await onCancel(id); /* may navigate away on success */ });
    const root = document.getElementById('inv-joins');
    if (!(i.joins || []).length) {
      root.innerHTML = `<div class="empty">まだ参加表明している人はいません</div>`;
    } else {
      root.innerHTML = i.joins.map(j => `
        <div class="list-item">
          <div style="flex:1; display:flex; align-items:center; gap:8px">
            ${avatarHtml(j.display_name, j.avatar_url, 'sm')}
            <div class="bold">${escapeHtml(j.display_name)}</div>
          </div>
          <div class="meta">${escapeHtml(j.joined_at)}</div>
        </div>`).join('');
    }
  } catch (e) {
    document.getElementById('inv-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    document.getElementById('inv-joins').innerHTML = '';
  }
}

async function onCreate() {
  const title = document.getElementById('inv-title').value.trim();
  if (!title) { toast('タイトルを入れてください'); return; }
  const starts_at = document.getElementById('inv-when').value || null;
  const location = document.getElementById('inv-where').value.trim() || null;
  const capacity = document.getElementById('inv-cap').value;
  const description = document.getElementById('inv-desc').value.trim() || null;
  try {
    await post('/api/invitations', {
      title, starts_at, location, description,
      capacity: capacity ? Number(capacity) : null,
    });
    document.getElementById('inv-title').value = '';
    document.getElementById('inv-when').value = '';
    document.getElementById('inv-where').value = '';
    document.getElementById('inv-cap').value = '';
    document.getElementById('inv-desc').value = '';
    toast('募集しました');
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onJoin(id) {
  try {
    await post(`/api/invitations/${id}/join`, {});
    toast('参加表明しました');
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onLeave(id) {
  if (!confirm('参加表明を取り消しますか?')) return;
  try {
    await post(`/api/invitations/${id}/leave`, {});
    toast('取消しました');
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onCancel(id) {
  if (!confirm('この募集自体を取消しますか? (参加表明した人に通知されます)')) return;
  try {
    await del(`/api/invitations/${id}`);
    toast('募集を取消しました');
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
}
