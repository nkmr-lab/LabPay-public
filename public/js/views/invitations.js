// /#/invitations — 募集 board. Light-weight hang-out invitations (no pt, no escrow).

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast, refreshHasGroups } from '../app.js';
import { uploadImage } from '../upload.js';
import { renderCoverEditor, wireCoverEditor } from './groups.js';

export async function renderInvitations() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <p class="card-subtitle" style="margin:0">
        「お昼ご飯食べに行こう」「ビアガーデン」「ポケモン GO」「スキー」など、
        誰でも参加表明できるカジュアルな募集です。pt のやり取りはありません。
      </p>
    </div>

    <details class="card collapsible-form">
      <summary>＋ 新しく募集</summary>
      <div style="margin-top:10px"></div>
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
      <label class="field">
        <span class="lbl">表紙画像 (任意・タップで撮影 or アルバム選択)</span>
        <input type="file" id="inv-image-file" accept="image/*">
        <input type="hidden" id="inv-image-url" value="">
        <img id="inv-image-preview" alt="" hidden style="max-width:140px; max-height:140px; margin-top:6px; border-radius:8px; object-fit:contain; display:block">
        <div id="inv-image-status" class="hint-sm"></div>
      </label>
      <button id="inv-add" class="primary">募集する</button>
    </details>

    <div class="card">
      <div class="row center">
        <h3 class="row-title">募集一覧</h3>
        <label class="muted" style="font-size:13px; display:inline-flex; gap:6px; align-items:center">
          <input type="checkbox" id="inv-show-closed"> 終了も表示
        </label>
      </div>
      <div id="inv-list" class="list" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('inv-add').addEventListener('click', onCreate);
  document.getElementById('inv-show-closed').addEventListener('change', loadList);
  document.getElementById('inv-image-file').addEventListener('change', onInvImageFile);
  await loadList();
}

async function onInvImageFile(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;
  const status = document.getElementById('inv-image-status');
  status.textContent = 'アップロード中…';
  try {
    const data = await uploadImage(f);
    document.getElementById('inv-image-url').value = data.url;
    const prev = document.getElementById('inv-image-preview');
    prev.src = data.url;
    prev.hidden = false;
    status.textContent = '✓ アップロード完了';
  } catch (e) { status.textContent = '失敗: ' + e.message; }
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
      ? `<span class="tag ok">✓ 参加表明済</span>`
      : `<span class="tag warn">募集中</span>`);

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

  // 参加表明している人の avatar 列。 8 人まで、 残りは +N。
  const joins = Array.isArray(i.joins) ? i.joins : [];
  const joinAvatars = joins.length
    ? `<div class="meta" style="display:flex; flex-wrap:wrap; gap:2px; margin-top:4px; align-items:center">
         ${joins.slice(0, 8).map(j =>
           `<span title="${escapeHtml(j.display_name || '')}">${avatarHtml(j.display_name, j.avatar_url, 'xs')}</span>`).join('')}
         ${joins.length > 8 ? `<span class="muted" style="font-size:11px; margin-left:2px">+${joins.length - 8}</span>` : ''}
       </div>`
    : '';

  return `
    <a class="list-item" href="#/invitations/${i.id}">
      <div class="grow">
        <div class="bold">${escapeHtml(i.title)} ${statusTag}</div>
        ${whenLine}${whereLine}${capLine}
        ${descBlock}
        ${joinAvatars}
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
      <a href="#/invitations" class="hint">← 募集一覧</a>
      <div id="inv-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card">
      <h3>参加表明している人で…</h3>
      <div id="inv-shortcuts" class="row" style="gap:6px; flex-wrap:wrap; margin-top:4px">
        <span class="hint">読み込み中…</span>
      </div>
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
          ? `<span class="tag ok">✓ 参加表明済</span>`
          : `<span class="tag warn">募集中</span>`);
    let actions = '';
    if (!isClosed) {
      if (iJoined) actions += `<button id="inv-detail-leave">参加表明を取消</button>`;
      else         actions += `<button id="inv-detail-join" class="primary">参加表明する</button>`;
      if (isMine)  actions += ` <button id="inv-detail-cancel" class="danger">募集を取消</button>`;
    } else if (isMine) {
      // 終了済みなら発起人だけが「再募集」できる。新しい starts_at を入れて
      // closed_at を NULL に戻す。
      actions += `<button id="inv-detail-reopen" class="primary">再募集する</button>`;
    }
    const imgBlock = renderCoverEditor({
      imageUrl: i.image_url,
      canEdit:  isMine,
      idPrefix: 'id',
    });
    document.getElementById('inv-head').innerHTML = `
      ${imgBlock}
      <div class="bold" style="font-size:18px">${escapeHtml(i.title)} ${statusTag}</div>
      ${whenLine}${whereLine}${capLine}
      ${i.description ? `<div class="meta" style="white-space:pre-wrap; margin-top:6px">${escapeHtml(i.description)}</div>` : ''}
      <div class="meta" style="display:flex; align-items:center; gap:6px; margin-top:6px">
        ${avatarHtml(i.creator_name, i.creator_avatar_url, 'sm')}
        ${escapeHtml(i.creator_name)} · ${escapeHtml(i.created_at)}
      </div>
      ${actions ? `<div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">${actions}</div>` : ''}
    `;
    wireCoverEditor({
      idPrefix: 'id',
      onChange: async (url) => {
        try { await patch('/api/invitations/' + id, { image_url: url }); toast(url ? '画像を保存しました' : '画像を削除しました'); await loadDetail(id); }
        catch (e) { toast('失敗: ' + e.message); }
      },
    });
    document.getElementById('inv-detail-join')  ?.addEventListener('click', async () => { await onJoin(id);   await loadDetail(id); });
    document.getElementById('inv-detail-leave') ?.addEventListener('click', async () => { await onLeave(id);  await loadDetail(id); });
    document.getElementById('inv-detail-cancel')?.addEventListener('click', async () => { await onCancel(id); /* may navigate away on success */ });
    document.getElementById('inv-detail-reopen')?.addEventListener('click', async () => { await onReopen(id); await loadDetail(id); });

    // Shortcuts for using this set elsewhere. Creator is always included
    // (organizer is assumed to be in the gathering too) — dedupe in case they
    // also tapped 参加表明.
    const creatorId = Number(i.creator_user_id);
    const memberIds = [...new Set([creatorId, ...(i.joins || []).map(j => Number(j.id))])];
    const shortcuts = document.getElementById('inv-shortcuts');
    if (shortcuts) {
      const ids = memberIds.join(',');
      shortcuts.innerHTML = `
        <div class="muted" style="font-size:12px; width:100%; margin-bottom:4px">募集者 + 参加表明者 (${memberIds.length}人) で:</div>
        <a class="btn primary" href="#/roulette?members=${ids}">🎰 ルーレット</a>
        <a class="btn" href="#/nomikai?members=${ids}">🍻 割り勘</a>
        <button id="inv-mkgroup" class="btn">👥 グループ作成</button>
      `;
      document.getElementById('inv-mkgroup').addEventListener('click', () => onCreateGroupFromInv(i, memberIds));
    }

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
  const image_url = document.getElementById('inv-image-url').value || null;
  try {
    await post('/api/invitations', {
      title, starts_at, location, description, image_url,
      capacity: capacity ? Number(capacity) : null,
    });
    document.getElementById('inv-title').value = '';
    document.getElementById('inv-when').value = '';
    document.getElementById('inv-where').value = '';
    document.getElementById('inv-cap').value = '';
    document.getElementById('inv-desc').value = '';
    document.getElementById('inv-image-url').value = '';
    document.getElementById('inv-image-preview').hidden = true;
    document.getElementById('inv-image-status').textContent = '';
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

// 募集の参加メンバーで一発グループ作成 → そのグループ詳細 (ワリカ可) に遷移。
async function onCreateGroupFromInv(inv, memberIds) {
  const title = inv.title || 'グループ';
  if (!confirm(`「${title}」グループを ${memberIds.length}人で作成します。よろしいですか?`)) return;
  try {
    const r = await post('/api/groups', { title, member_ids: memberIds });
    toast('グループを作成しました');
    refreshHasGroups();
    location.hash = '#/groups/' + (r.slug || r.id);
  } catch (e) { toast('失敗: ' + e.message); }
}

// 再募集: 新しい開催日時を datetime-local で受け取って PATCH。
async function onReopen(id) {
  const def = (() => {
    const d = new Date(Date.now() + 86400 * 1000); // tomorrow same time as default
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const ans = prompt('新しい開催日時を入れてください (YYYY-MM-DD HH:MM)', def);
  if (!ans) return;
  const raw = ans.replace('T', ' ').trim();
  try {
    await patch(`/api/invitations/${id}`, { starts_at: raw });
    toast('再募集しました');
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
