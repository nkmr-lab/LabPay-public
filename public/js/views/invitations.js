// /#/invitations — 募集 board. Light-weight hang-out invitations (no pt, no escrow).

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast, refreshHasGroups } from '../app.js';
import { uploadImage } from '../upload.js';
import { renderCoverEditor, wireCoverEditor } from './groups.js';
import { fmtDate, fmtDateTime, fmtLocalInput, tag } from '../format.js';
import { openModal } from '../modal.js';
import { createMemberPicker } from '../member_picker.js';
import { isAppVisible } from './apps.js';
import { shareToSns } from '../share_to_sns.js';

// v396 募集 詳細の 「ショートカット」 アプリ群。 groups の GROUP_ACTIONS と
// 同じ規約。 i.feat_actions が null/undefined なら 「全 ON」、 配列なら その中
// の ID のみ ON。
const INV_ACTIONS = [
  { id: 'meetups',   label: '🤝 待ち合わせを作る', primary: true },
  { id: 'roulette',  label: '🎰 ルーレット' },
  { id: 'nomikai',   label: '🍻 割り勘' },
  { id: 'polls',     label: '📊 投票・アンケート' },
  { id: 'rollcalls', label: '📣 点呼' },
  { id: 'timers',    label: '⏱️ タイマー' },
];
function invActionEnabled(inv, id) {
  const list = inv?.feat_actions;
  if (list === null || list === undefined) return true; // 後方互換 (= 全 ON)
  return Array.isArray(list) && list.includes(id);
}

export async function renderInvitations() {
  const app = document.getElementById('app');
  app.innerHTML = `

    <details class="card collapsible-form">
      <summary>＋ 新しく募集</summary>
      <div style="margin-top:10px"></div>
      <label class="field">
        <span class="lbl">タイトル (必須)</span>
        <input type="text" id="inv-title" maxlength="200" placeholder="例: お昼ご飯食べに行こう">
      </label>
      <label class="field">
        <span class="lbl">開催日 (任意)</span>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <input type="date" id="inv-date" style="flex:1; min-width:130px">
          <input type="time" id="inv-time" style="flex:1; min-width:90px">
        </div>
        <span class="hint-sm">時刻は任意。 日付だけなら 終日扱い (当日いっぱい募集)。</span>
      </label>
      <label class="field">
        <span class="lbl">募集締切 (任意・これ以降は参加表明を受け付けない)</span>
        <input type="datetime-local" id="inv-signup-deadline">
        <span class="hint-sm">空欄 = 開催時刻まで募集。 例: 「19:00 開始だけど 17:00 まで」 → ここに 17:00 を入れる。</span>
      </label>
      <label class="field">
        <span class="lbl">場所 (任意)</span>
        <input type="text" id="inv-where" maxlength="200" placeholder="例: 大学前のラーメン屋">
      </label>
      <label class="field">
        <span class="lbl">募集 人数 (任意・空欄なら 制限なし)</span>
        <input type="number" id="inv-cap" min="1" max="1000" placeholder="例: 4 (自分 を 除いて)">
        <span class="hint-sm">既定: 自分 (発起人) は 含まない 「集めたい 他 人数」。</span>
        <label class="row" style="gap:6px; font-size:12px; margin-top:4px; align-items:center">
          <input type="checkbox" id="inv-cap-include-self">
          <span>この 人数 に 自分 も 含める (= 上限 = この 値)</span>
        </label>
      </label>
      <label class="field">
        <span class="lbl">詳細 (任意)</span>
        <textarea id="inv-desc" maxlength="5000" rows="3" placeholder="集合場所・予算・装備など"></textarea>
      </label>
      <details class="field">
        <summary class="hint" style="cursor:pointer">👥 事前参加者を登録 (任意)</summary>
        <div style="margin-top:6px">
          <div class="hint-sm" style="margin-bottom:4px">選んだ人を 作成時に 「参加表明済」 として登録 + 通知。 発起人 (自分) は 自動で +1 されます。</div>
          <div id="inv-pre-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
          <div id="inv-pre-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
        </div>
      </details>
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
  await populateInvPreMembers();
  await loadList();
}

// v383 共有 member_picker。 発起人 (自分) は picker から除外、 作成時 backend が 自動 join。
let invPrePicker = null;
async function populateInvPreMembers() {
  const root = document.getElementById('inv-pre-members');
  const bulk = document.getElementById('inv-pre-bulk');
  if (!root || !bulk) return;
  try {
    invPrePicker = await createMemberPicker({
      bulkContainer: bulk,
      chipsContainer: root,
      excludeIds: state.me?.id ? [Number(state.me.id)] : [],
      showGenderBulk: false,
    });
  } catch (_) { /* swallow */ }
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
  // 秒は表示しない。 starts_at_has_time=0 (日付だけ) なら YYYY-MM-DD で切る。
  const fmtStarts = (s) => Number(i.starts_at_has_time) === 0 ? fmtDate(s) : fmtDateTime(s);
  // 場所 (集合時間) を 1 行にまとめる: あるものだけ繋ぐ。
  let placeLine = '';
  if (i.location && i.starts_at) {
    placeLine = `<div class="meta">📍 ${escapeHtml(i.location)} (🕒 ${escapeHtml(fmtStarts(i.starts_at))})</div>`;
  } else if (i.location) {
    placeLine = `<div class="meta">📍 ${escapeHtml(i.location)}</div>`;
  } else if (i.starts_at) {
    placeLine = `<div class="meta">🕒 ${escapeHtml(fmtStarts(i.starts_at))}</div>`;
  }
  // v368 一覧でも 締切が近い時だけ tag で 強調
  let deadlineHint = '';
  if (!isClosed && i.signup_closes_at) {
    const t = new Date(String(i.signup_closes_at).replace(' ', 'T'));
    const diff = t - new Date();
    if (diff > 0 && diff < 6 * 3600 * 1000) {
      const min = Math.floor(diff / 60000);
      const lbl = min < 60 ? `${min}分` : `${Math.floor(min/60)}時間${min%60}分`;
      deadlineHint = `<div class="meta"><span class="tag warn">⏰ 締切まで ${escapeHtml(lbl)}</span></div>`;
    } else if (diff <= 0) {
      deadlineHint = `<div class="meta">${tag('danger', '⏰ 募集締切超過')}</div>`;
    }
  }
  // 参加者数 / 募集人数。 終了時は人数 をピープル行右端に出すので、 ここでは
  // 募集中の時だけ出す。
  // v708 capacity_excludes_creator=1 なら 「他 N 人 募集」 と 表示 (発起人 別)。
  const capLine = !isClosed
    ? (i.capacity
        ? (Number(i.capacity_excludes_creator)
            ? `<div class="meta">${i.join_count} 人 参加 / 募集 ${i.capacity} 人 (発起人 別)</div>`
            : `<div class="meta">${i.join_count} / ${i.capacity} 人</div>`)
        : `<div class="meta">${i.join_count} 人</div>`)
    : '';
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

  // 発起人｜参加者リスト 行。 発起人を左、 参加者を | の後ろに。
  // 終了時は 「発起人を含めた合計人数」 を右端に。
  const joins = Array.isArray(i.joins) ? i.joins : [];
  const creatorJoined = joins.some(j => Number(j.id) === Number(i.creator_user_id));
  const totalCount = joins.length + (creatorJoined ? 0 : 1);
  const closedCount = isClosed
    ? `<span class="muted" style="font-size:11px; margin-left:auto">${totalCount} 人</span>` : '';
  const peopleRow = `
    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; align-items:center; font-size:12px">
      <span style="display:inline-flex; align-items:center; gap:3px; font-weight:600">
        ${avatarHtml(i.creator_name, i.creator_avatar_url, 'xs')}
        <span>${escapeHtml(i.creator_name)}</span>
      </span>
      ${joins.length ? `
        <span class="muted">｜</span>
        ${joins.slice(0, 8).map(j =>
          `<span style="display:inline-flex; align-items:center; gap:3px">
             ${avatarHtml(j.display_name, j.avatar_url, 'xs')}
             <span>${escapeHtml(j.display_name)}</span>
           </span>`).join('')}
        ${joins.length > 8 ? `<span class="muted">+${joins.length - 8}</span>` : ''}` : ''}
      ${closedCount}
    </div>`;

  return `
    <a class="list-item" href="#/invitations/${i.id}">
      <div class="grow">
        <div class="bold">${escapeHtml(i.title)} ${statusTag}</div>
        ${placeLine}${capLine}${deadlineHint}
        ${descBlock}
        ${peopleRow}
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

// v381 fmtDateTime (= 16 文字) を共有ヘルパに統一

async function loadDetail(id) {
  try {
    const i = await get('/api/invitations/' + id);
    const meId = state.me?.id;
    const isMine = meId === Number(i.creator_user_id);
    const isClosed = !!i.closed_at;
    const iJoined = (i.joins || []).some(j => Number(j.id) === Number(meId));
    // v370: starts_at_has_time=0 (日付だけ) のとき は YYYY-MM-DD で表示。
    const fmtStarts = (s) => Number(i.starts_at_has_time) === 0 ? fmtDate(s) : fmtDateTime(s);
    const whenLine = i.starts_at ? `<div class="meta">🕒 ${escapeHtml(fmtStarts(i.starts_at))}${Number(i.starts_at_has_time)===0 ? ' <span class="hint-sm">(終日)</span>' : ''}</div>` : '';
    // v368 募集締切。 過ぎてれば 赤、 まだなら 残り時間 を 緑で。
    let deadlineLine = '';
    if (i.signup_closes_at) {
      const t = new Date(String(i.signup_closes_at).replace(' ', 'T'));
      const diff = t - new Date();
      let remStr = '';
      if (diff <= 0) { remStr = ' ' + tag('danger', '締切超過'); }
      else {
        const min = Math.floor(diff / 60000);
        const lbl = min < 60 ? `あと ${min}分`
                  : min < 60 * 24 ? `あと ${Math.floor(min/60)}時間${min%60}分`
                  : `あと ${Math.floor(min/(60*24))}日`;
        remStr = ' ' + tag('ok', lbl);
      }
      deadlineLine = `<div class="meta">⏰ 募集締切 ${escapeHtml(fmtDateTime(i.signup_closes_at))}${remStr}</div>`;
    }
    const whereLine = i.location ? `<div class="meta">📍 ${escapeHtml(i.location)}</div>` : '';
    // v708 #300 capacity_excludes_creator=1 (新 既定) なら 「発起人 + 募集 X 人」 表示。
    const capLine = i.capacity
      ? (Number(i.capacity_excludes_creator)
          ? `<div class="meta">参加 ${(i.joins || []).length} 人 (発起人 含む) / 募集 ${i.capacity} 人 (発起人 別)</div>`
          : `<div class="meta">参加 ${(i.joins || []).length} / 上限 ${i.capacity}</div>`)
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
      if (isMine)  actions += ` <button id="inv-detail-edit" class="btn">✏️ 編集</button>`;
      if (isMine)  actions += ` <button id="inv-detail-close" class="btn">✋ 募集を終了</button>`;
      if (isMine)  actions += ` <button id="inv-detail-cancel" class="danger">募集を取消</button>`;
    } else if (isMine) {
      // 終了済みなら発起人だけが「再募集」できる。新しい starts_at を入れて
      // closed_at を NULL に戻す。
      actions += `<button id="inv-detail-reopen" class="primary">再募集する</button>`;
    }
    actions += ` <button id="inv-detail-share" class="btn">💬 共有</button>`;
    const imgBlock = renderCoverEditor({
      imageUrl: i.image_url,
      canEdit:  isMine,
      idPrefix: 'id',
    });
    document.getElementById('inv-head').innerHTML = `
      ${imgBlock}
      <div class="bold" style="font-size:18px">${escapeHtml(i.title)} ${statusTag}</div>
      ${whenLine}${deadlineLine}${whereLine}${capLine}
      ${i.description ? `<div class="meta" style="white-space:pre-wrap; margin-top:6px">${escapeHtml(i.description)}</div>` : ''}
      <div class="meta" style="display:flex; align-items:center; gap:6px; margin-top:6px">
        ${avatarHtml(i.creator_name, i.creator_avatar_url, 'sm')}
        ${escapeHtml(i.creator_name)} · ${escapeHtml(fmtDateTime(i.created_at))}
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
    document.getElementById('inv-detail-share')?.addEventListener('click', () => {
      const cap = i.capacity ? ` (${(i.joins || []).length}/${i.capacity})` : '';
      shareToSns(`🙌 募集 「${i.title}」${cap}`, `#/invitations/${i.id}`);
    });
    document.getElementById('inv-detail-join')  ?.addEventListener('click', async () => { await onJoin(id);   await loadDetail(id); });
    document.getElementById('inv-detail-leave') ?.addEventListener('click', async () => { await onLeave(id);  await loadDetail(id); });
    document.getElementById('inv-detail-cancel')?.addEventListener('click', async () => { await onCancel(id); /* may navigate away on success */ });
    document.getElementById('inv-detail-edit')  ?.addEventListener('click', () => openInvEditModal(i));
    document.getElementById('inv-detail-reopen')?.addEventListener('click', async () => { await onReopen(id); await loadDetail(id); });
    document.getElementById('inv-detail-close') ?.addEventListener('click', async () => {
      if (!confirm('募集 を 終了 しますか? (= 新規 参加表明 は 受付けません。 既参加者は そのまま、 イベントは 続行)')) return;
      try { await post('/api/invitations/' + id + '/close', {}); await loadDetail(id); }
      catch (e) { toast('失敗: ' + (e?.message || e)); }
    });

    // Shortcuts for using this set elsewhere. Creator is always included
    // (organizer is assumed to be in the gathering too) — dedupe in case they
    // also tapped 参加表明.
    const creatorId = Number(i.creator_user_id);
    const memberIds = [...new Set([creatorId, ...(i.joins || []).map(j => Number(j.id))])];
    const shortcuts = document.getElementById('inv-shortcuts');
    if (shortcuts) {
      const ids = memberIds.join(',');
      // 待ち合わせの URL は 募集の starts_at + location をプリセット (どちらも任意)。
      // starts_at は "YYYY-MM-DD HH:MM:SS" 想定 → datetime-local 用に T で接続。
      const muParams = new URLSearchParams();
      muParams.set('members', ids);
      muParams.set('title', '[' + (i.title || '') + ']');
      if (i.location) muParams.set('location', i.location);
      if (i.starts_at) muParams.set('when', fmtLocalInput(i.starts_at));
      // v385 ユーザの アプリ表示設定 で 隠れているものは ショートカットも 出さない。
      // v396 募集側 (i.feat_actions) と ユーザー側 両方 ON のものだけ 表示。
      const hrefFor = (id) => {
        switch (id) {
          case 'meetups':   return `#/meetups/new?${muParams.toString()}`;
          case 'roulette':  return `#/roulette?members=${ids}`;
          case 'nomikai':   return `#/nomikai?members=${ids}`;
          case 'polls':     return `#/polls/new?members=${ids}&title=${encodeURIComponent('[' + (i.title || '') + '] ')}`;
          case 'rollcalls': return `#/rollcalls/new?members=${ids}&title=${encodeURIComponent('[' + (i.title || '') + '] ')}`;
          case 'timers':    return `#/timers/new?members=${ids}&title=${encodeURIComponent('[' + (i.title || '') + '] ')}`;
          default: return '#/apps';
        }
      };
      const btnsHtml = INV_ACTIONS
        .filter(a => invActionEnabled(i, a.id) && isAppVisible(a.id))
        .map(a => `<a class="btn${a.primary ? ' primary' : ''}" href="${hrefFor(a.id)}">${escapeHtml(a.label)}</a>`)
        .join('');
      shortcuts.innerHTML = `
        <div class="muted" style="font-size:12px; width:100%; margin-bottom:4px">募集者 + 参加表明者 (${memberIds.length}人) で:</div>
        ${btnsHtml}
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
  // v370 開催日 (date) + 時刻 (time) を 別々に受け取る。
  //   時刻あり → "YYYY-MM-DDTHH:MM" を送る (バックエンドが has_time=1 に)
  //   時刻なし → "YYYY-MM-DD" を送る (バックエンドが has_time=0 に)
  //   日付なし → null
  const dateVal = document.getElementById('inv-date').value;
  const timeVal = document.getElementById('inv-time').value;
  const starts_at = dateVal ? (timeVal ? `${dateVal}T${timeVal}` : dateVal) : null;
  const signup_closes_at = document.getElementById('inv-signup-deadline').value || null;
  const pre_join_user_ids = invPrePicker ? [...invPrePicker.getSelected()] : [];
  const location = document.getElementById('inv-where').value.trim() || null;
  const capacity = document.getElementById('inv-cap').value;
  const capacity_excludes_creator = !document.getElementById('inv-cap-include-self').checked;
  const description = document.getElementById('inv-desc').value.trim() || null;
  const image_url = document.getElementById('inv-image-url').value || null;
  try {
    await post('/api/invitations', {
      title, starts_at, signup_closes_at, location, description, image_url,
      capacity: capacity ? Number(capacity) : null,
      capacity_excludes_creator,
      pre_join_user_ids,
    });
    document.getElementById('inv-title').value = '';
    document.getElementById('inv-date').value = '';
    document.getElementById('inv-time').value = '';
    document.getElementById('inv-signup-deadline').value = '';
    document.getElementById('inv-where').value = '';
    document.getElementById('inv-cap').value = '';
    document.getElementById('inv-cap-include-self').checked = false;
    document.getElementById('inv-desc').value = '';
    if (invPrePicker) invPrePicker.setSelected([]);
    // picker.setSelected([]) で reset 済
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
    await patch(`/api/invitations/${id}`, { starts_at: raw, reopen: true });
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

// v388 modal.js + format.fmtLocalInput を 利用。 旧版の自作 overlay + close 配線を撤去。
// 画像は 既存の renderCoverEditor で 別途編集可なので ここでは扱わない。
function openInvEditModal(i) {
  const id = Number(i.id);
  const startsDate = i.starts_at ? String(i.starts_at).slice(0, 10) : '';
  const startsTime = (i.starts_at && Number(i.starts_at_has_time) !== 0)
    ? String(i.starts_at).slice(11, 16) : '';
  const bodyHtml = `
    <label class="field"><span class="lbl">タイトル</span>
      <input type="text" id="ied-title" maxlength="200" value="${escapeHtml(i.title || '')}">
    </label>
    <label class="field"><span class="lbl">開催日 (任意・時刻は空欄なら 終日)</span>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <input type="date" id="ied-date" value="${escapeHtml(startsDate)}" style="flex:1; min-width:130px">
        <input type="time" id="ied-time" value="${escapeHtml(startsTime)}" style="flex:1; min-width:90px">
      </div>
    </label>
    <label class="field"><span class="lbl">募集締切 (任意)</span>
      <input type="datetime-local" id="ied-deadline" value="${escapeHtml(fmtLocalInput(i.signup_closes_at))}">
      <span class="hint-sm">これ以降は 参加表明を受け付けない時刻。</span>
    </label>
    <label class="field"><span class="lbl">場所 (任意)</span>
      <input type="text" id="ied-where" maxlength="200" value="${escapeHtml(i.location || '')}">
    </label>
    <label class="field"><span class="lbl">募集 人数 (任意・空欄 なら 制限 なし)</span>
      <input type="number" id="ied-cap" min="1" max="1000" value="${i.capacity != null ? i.capacity : ''}">
      <span class="hint-sm">既定: 自分 (発起人) は 含まない 「集めたい 他 人数」。</span>
      <label class="row" style="gap:6px; font-size:12px; margin-top:4px; align-items:center">
        <input type="checkbox" id="ied-cap-include-self" ${Number(i.capacity_excludes_creator) === 0 ? 'checked' : ''}>
        <span>この 人数 に 自分 も 含める (= 上限 = この 値)</span>
      </label>
    </label>
    <label class="field"><span class="lbl">詳細 (任意)</span>
      <textarea id="ied-desc" maxlength="5000" rows="3">${escapeHtml(i.description || '')}</textarea>
    </label>
    <div class="field">
      <span class="lbl">アプリ ショートカット</span>
      <div class="hint-sm" style="margin-bottom:6px">この募集ページに出す アプリ ボタン。 全 OFF も可。</div>
      <div id="ied-feat-actions" class="row" style="gap:4px 12px; flex-wrap:wrap">
        ${INV_ACTIONS.map(a => {
          const on = invActionEnabled(i, a.id);
          return `<label style="display:inline-flex; align-items:center; gap:4px; min-width:140px">
            <input type="checkbox" data-act="${a.id}" ${on ? 'checked' : ''}>
            <span>${escapeHtml(a.label.replace(/^[^\s]+\s/, ''))}</span>
          </label>`;
        }).join('')}
      </div>
    </div>`;
  const m = openModal({
    title: '✏️ 募集を編集',
    bodyHtml,
    buttons: [
      { label: 'キャンセル', kind: 'btn',     onClick: () => m.close() },
      { label: '保存',       kind: 'primary', onClick: async () => {
        const dv = document.getElementById('ied-date').value;
        const tv = document.getElementById('ied-time').value;
        const feat_actions = [...document.querySelectorAll('#ied-feat-actions input[data-act]')]
          .filter(cb => cb.checked).map(cb => cb.dataset.act);
        const body = {
          title:            document.getElementById('ied-title').value.trim(),
          starts_at:        dv ? (tv ? `${dv}T${tv}` : dv) : null,
          signup_closes_at: document.getElementById('ied-deadline').value || null,
          location:         document.getElementById('ied-where').value.trim() || null,
          capacity:         document.getElementById('ied-cap').value ? Number(document.getElementById('ied-cap').value) : null,
          capacity_excludes_creator: !document.getElementById('ied-cap-include-self').checked,
          description:      document.getElementById('ied-desc').value.trim() || null,
          feat_actions,
        };
        if (!body.title) { toast('タイトル必須'); return; }
        m.setBusy(true);
        try {
          await patch('/api/invitations/' + id, body);
          toast('保存しました');
          m.close();
          await loadDetail(id);
        } catch (e) { toast('失敗: ' + e.message); m.setBusy(false); }
      }},
    ],
  });
}
