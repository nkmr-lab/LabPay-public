// /#/groups — list + create. /#/groups/{id} — detail with feed + ワリカ +
// member-context shortcuts for ルーレット / 飲み会割り勘.

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast, refreshHasGroups } from '../app.js';
import { uploadImage } from '../upload.js';

const GRADE_ORDER = ['D','M2','M1','B4','B3',''];

// ──────────────────────────── LIST + CREATE ────────────────────────────

export async function renderGroups() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <p class="card-subtitle" style="margin:0">
        出張・旅行・連幹事など、短期間だけ使うメンバー枠。フィード (メモ・URL・
        時間) + ワリカ (立替を積み上げ → 精算) を共有しつつ、ルーレットや
        飲み会割り勘をそのメンバーで即起動できます。
      </p>
    </div>

    <details class="card collapsible-form">
      <summary>＋ 新規グループ</summary>
      <div style="margin-top:10px"></div>
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="gr-title" maxlength="200" placeholder="例: 学会 in 神戸">
      </label>
      <label class="field">
        <span class="lbl">URL 用の名前 (任意・英数字/_/- のみ・後から変えられません)</span>
        <input type="text" id="gr-slug" maxlength="64" placeholder="例: avi2026">
      </label>
      <label class="field">
        <span class="lbl">説明 (任意)</span>
        <textarea id="gr-notes" maxlength="2000" rows="2"></textarea>
      </label>
      <label class="field">
        <span class="lbl">表紙画像 (任意・タップで撮影 or アルバム選択)</span>
        <input type="file" id="gr-image-file" accept="image/*">
        <input type="hidden" id="gr-image-url" value="">
        <img id="gr-image-preview" alt="" hidden style="max-width:140px; max-height:140px; margin-top:6px; border-radius:8px; object-fit:contain; display:block">
        <div id="gr-image-status" class="hint-sm"></div>
      </label>
      <div class="field">
        <span class="lbl">メンバー</span>
        <div id="gr-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px"></div>
        <div id="gr-picker" class="row" style="gap:6px; flex-wrap:wrap"></div>
        <div id="gr-count" class="muted" style="font-size:12px; margin-top:6px">0 人選択中</div>
      </div>
      <button id="gr-submit" class="primary">作成</button>
    </details>

    <div class="card">
      <h3>あなたのグループ</h3>
      <div id="gr-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await populatePicker();
  document.getElementById('gr-submit').addEventListener('click', onCreate);
  document.getElementById('gr-image-file').addEventListener('change', onGroupImageFile);
  await loadList();
}

async function onGroupImageFile(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;
  const status = document.getElementById('gr-image-status');
  status.textContent = 'アップロード中…';
  try {
    const data = await uploadImage(f);
    document.getElementById('gr-image-url').value = data.url;
    const prev = document.getElementById('gr-image-preview');
    prev.src = data.url;
    prev.hidden = false;
    status.textContent = '✓ アップロード完了';
  } catch (e) { status.textContent = '失敗: ' + e.message; }
}

const picked = new Set();
let allUsers = [];

async function populatePicker() {
  const u = await get('/api/users');
  picked.clear();
  // Sort: D → M2 → M1 → B4 → B3 → (no grade), 50音順
  allUsers = [...u.items].sort((a, b) => {
    const ga = GRADE_ORDER.indexOf(a.grade || '');
    const gb = GRADE_ORDER.indexOf(b.grade || '');
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) ||
      (a.display_name || '').localeCompare(b.display_name || '', 'ja');
  });

  const grades = [...new Set(allUsers.map(u => u.grade).filter(Boolean))]
    .sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  const bulk = document.getElementById('gr-bulk');
  bulk.innerHTML = `
    <button data-bulk="all"  class="btn">全員</button>
    ${grades.map(g => `<button data-bulk="grade:${g}" class="btn">${g}</button>`).join('')}
    <button data-bulk="gender:M" class="btn">男</button>
    <button data-bulk="gender:F" class="btn">女</button>
    <button data-bulk="clear" class="btn">クリア</button>
  `;
  bulk.querySelectorAll('[data-bulk]').forEach(b => {
    b.addEventListener('click', () => applyBulk(b.dataset.bulk));
  });

  const picker = document.getElementById('gr-picker');
  picker.innerHTML = allUsers.map(x => `
    <span class="rl-chip" data-uid="${x.id}">
      ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
      <span>${escapeHtml(x.display_name)}</span>
      ${x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : ''}
    </span>`).join('');
  picker.querySelectorAll('.rl-chip').forEach(c => {
    c.addEventListener('click', () => togglePick(Number(c.dataset.uid)));
  });
  refreshChips();
}

function memberMatches(user, key) {
  if (key === 'all') return true;
  if (key.startsWith('grade:')) return (user.grade || '') === key.slice(6);
  if (key.startsWith('gender:')) return (user.gender || '') === key.slice(7);
  return false;
}

function applyBulk(key) {
  if (key === 'clear') { picked.clear(); refreshChips(); return; }
  const targets = allUsers.filter(u => memberMatches(u, key));
  // Two-state toggle: if all targets are already on → turn them off; else add all.
  const allOn = targets.every(u => picked.has(u.id));
  if (allOn) targets.forEach(u => picked.delete(u.id));
  else       targets.forEach(u => picked.add(u.id));
  refreshChips();
}

function togglePick(uid) {
  if (picked.has(uid)) picked.delete(uid);
  else picked.add(uid);
  refreshChips();
}

function refreshChips() {
  document.querySelectorAll('#gr-picker .rl-chip').forEach(c => {
    const on = picked.has(Number(c.dataset.uid));
    c.style.background = on ? 'var(--primary-soft, #efeafa)' : '';
    c.style.borderColor = on ? 'var(--primary)' : '';
  });
  const countEl = document.getElementById('gr-count');
  if (countEl) countEl.textContent = `${picked.size} 人選択中`;
}

async function onCreate() {
  const title = document.getElementById('gr-title').value.trim();
  const description = document.getElementById('gr-notes').value.trim() || null;
  const slug = document.getElementById('gr-slug').value.trim() || null;
  if (!title) { toast('タイトルを入れてください'); return; }
  if (slug && !/^[A-Za-z0-9_-]{1,64}$/.test(slug)) {
    toast('URL 用の名前は英数字・_・- の 1〜64 文字で'); return;
  }
  if (slug && /^\d+$/.test(slug)) {
    toast('URL 用の名前を数字だけにはできません'); return;
  }
  const image_url = document.getElementById('gr-image-url').value || null;
  try {
    const r = await post('/api/groups', {
      title, description, slug, image_url, member_ids: [...picked],
    });
    toast('作成しました');
    refreshHasGroups();
    location.hash = '#/groups/' + (r.slug || r.id);
  } catch (e) { toast('失敗: ' + e.message); }
}

// 共通: 詳細ページの 「表紙画像 + 編集ボタン」 UI を組み立てる。
// idPrefix で複数ページの ID 衝突を避ける ('gd' = groups detail, 'id' = invitation detail)。
export function renderCoverEditor({ imageUrl, canEdit, idPrefix }) {
  const ip = idPrefix;
  // 編集ボタンは hidden file input をトリガする。
  const fileInput = canEdit
    ? `<input type="file" id="${ip}-cover-file" accept="image/*" hidden>` : '';
  if (imageUrl) {
    return `
      <div style="position:relative; margin-bottom:10px; border-radius:12px; overflow:hidden; aspect-ratio:16/9; background:var(--primary-soft); max-height:200px">
        <img src="${escapeHtml(imageUrl)}" alt="" style="width:100%; height:100%; object-fit:cover; display:block">
        ${canEdit ? `
          <div style="position:absolute; right:6px; bottom:6px; display:flex; gap:4px">
            <button id="${ip}-cover-change" class="btn" title="変更" style="padding:4px 8px; font-size:14px; background:rgba(255,255,255,0.92)">✏️</button>
            <button id="${ip}-cover-clear"  class="btn" title="削除" style="padding:4px 8px; font-size:14px; background:rgba(255,255,255,0.92)">🗑️</button>
          </div>` : ''}
      </div>
      ${fileInput}
    `;
  }
  if (canEdit) {
    return `
      <div style="margin-bottom:10px">
        <button id="${ip}-cover-change" class="btn">📷 表紙画像を追加</button>
        <span id="${ip}-cover-status" class="hint-sm" style="margin-left:8px"></span>
      </div>
      ${fileInput}
    `;
  }
  return '';
}

// 上の renderCoverEditor に対応する click / change ハンドラ配線。
export function wireCoverEditor({ idPrefix, onChange }) {
  const ip = idPrefix;
  const fileEl = document.getElementById(`${ip}-cover-file`);
  if (!fileEl) return;
  document.getElementById(`${ip}-cover-change`)?.addEventListener('click', () => fileEl.click());
  document.getElementById(`${ip}-cover-clear`)?.addEventListener('click', async () => {
    if (!confirm('表紙画像を削除しますか?')) return;
    await onChange(null);
  });
  fileEl.addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const status = document.getElementById(`${ip}-cover-status`);
    if (status) status.textContent = 'アップロード中…';
    try {
      const data = await uploadImage(f);
      await onChange(data.url);
    } catch (e) {
      if (status) status.textContent = '失敗: ' + e.message;
    }
  });
}

// 共通: 画像つきリストアイテム。image_url が無い場合は従来の text-only
// レイアウトに fallback (.list-item の素の見た目)。
export function coverListItem({ href, image_url, title, meta = '', rightExtra = '', members = null }) {
  // メンバ行: avatar + 名前のチップを 8 人まで並べて、 末尾に (N人)。
  // 9 人以上いれば 「+N」 を入れる。 メタ行 (発起人/日時) は呼び出し側が
  // 空にすれば省略される。
  const memberRow = (Array.isArray(members) && members.length)
    ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; align-items:center">
         ${members.slice(0, 8).map(m =>
           `<span style="display:inline-flex; align-items:center; gap:3px; font-size:12px">
              ${avatarHtml(m.display_name, m.avatar_url, 'xs')}
              <span>${escapeHtml(m.display_name)}</span>
            </span>`).join('')}
         ${members.length > 8 ? `<span class="muted" style="font-size:11px">+${members.length - 8}</span>` : ''}
         <span class="muted" style="font-size:11px; margin-left:auto">(${members.length}人)</span>
       </div>`
    : '';
  const metaBlock = meta ? `<div class="meta">${meta}</div>` : '';
  if (image_url) {
    return `
      <a class="list-item with-cover" href="${href}">
        <div class="cover-img" style="background-image:url('${escapeHtml(image_url)}')"></div>
        <div class="grow">
          <div class="bold">${title}</div>
          ${metaBlock}
          ${memberRow}
        </div>
        ${rightExtra}
      </a>`;
  }
  return `
    <a class="list-item" href="${href}">
      <div class="grow">
        <div class="bold">${title}</div>
        ${metaBlock}
        ${memberRow}
      </div>
      <div class="hint">→</div>
      ${rightExtra}
    </a>`;
}

async function loadList() {
  try {
    const d = await get('/api/groups');
    const root = document.getElementById('gr-list');
    if (!d.items.length) {
      root.innerHTML = `<div class="empty">まだ参加グループはありません</div>`;
      return;
    }
    root.innerHTML = d.items.map(g => coverListItem({
      href: '#/groups/' + escapeHtml(g.slug || g.id),
      image_url: g.image_url,
      title: escapeHtml(g.title) + (g.closed_at ? ' <span class="tag muted">終了</span>' : ''),
      // meta は avatar 行が代わりに伝えるので省略 (発起人 / 日時 は重複情報)。
      members: g.members || [],
    })).join('');
  } catch (e) {
    document.getElementById('gr-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ──────────────────────────── DETAIL ───────────────────────────────────

export async function renderGroupDetail({ params }) {
  // params.id は数字 or slug。サーバ側 resolve_group_id() で両方解決するので
  // ここでは文字列のまま回す。loadDetail で取得した実 id (g.id) を
  // ボタンの POST 先など内部 API 呼び出しでは使う。
  const id = String(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/groups" class="hint">← グループ一覧</a>
      <div id="gd-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card">
      <h3 style="margin:0">フィード</h3>
      <details class="collapsible-sub" style="margin-top:8px">
        <summary>＋ 新規投稿</summary>
        <div style="margin-top:8px">
          <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px">
            <button data-kind="memo" class="btn primary">📝 メモ</button>
            <button data-kind="url"  class="btn">🔗 URL</button>
            <button data-kind="time" class="btn">🕒 時間</button>
          </div>
          <div id="gd-post-fields"></div>
          <button id="gd-post" class="primary" style="margin-top:6px">投稿</button>
        </div>
      </details>
      <div id="gd-feed" class="list" style="margin-top:8px"></div>
    </div>

    <div class="card" id="gd-sched-card" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">スケジュール</h3>
        <button id="gd-sched-editmode" class="btn" style="padding:2px 10px; font-size:12px">編集モード</button>
        <button id="gd-sched-range" class="btn" style="padding:2px 10px; font-size:12px">日程設定</button>
      </div>
      <div id="gd-sched-body" class="muted" style="font-size:13px">読み込み中…</div>
    </div>
    <div id="gd-sched-modal" hidden></div>

    <div class="card" id="gd-wari-card">
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">ワリカ</h3>
        <button id="gd-settle" class="primary">精算する</button>
      </div>
      <p class="muted" style="font-size:13px; margin:6px 0">
        立替えた支出を積み上げて、最後にまとめて精算 (貸し借り) します。
      </p>
      <details id="gd-wari-form-card" class="collapsible-sub" style="margin-top:6px">
        <summary>＋ 支払い登録</summary>
        <div id="gd-wari-form" style="margin-top:8px"></div>
      </details>
      <h4 style="margin:10px 0 4px">支払いの記録</h4>
      <div id="gd-wari-summary" class="muted" style="font-size:13px">読み込み中…</div>
      <div id="gd-wari-list" class="list" style="margin-top:8px"></div>
    </div>

    <div class="card" id="gd-spend-card" hidden>
      <h3 style="margin:0">支出情報 (個々人)</h3>
      <p class="muted" style="font-size:13px; margin:6px 0">
        各人が「使った額」(参加した支出の自分の取り分) と「立替えた額」 (払った合計)。
      </p>
      <div id="gd-spend-list" class="list"></div>
    </div>

    <div class="card" id="gd-danger-card" hidden>
      <p class="muted" style="font-size:13px; margin:0 0 8px">
        閉じてもデータは残ります。新規投稿・ワリカ追加ができなくなるだけ。
      </p>
      <button id="gd-close" class="danger">グループを閉じる</button>
    </div>

    <div id="gd-settle-modal" hidden></div>
  `;
  document.querySelectorAll('[data-kind]').forEach(b => {
    b.addEventListener('click', () => switchKind(b));
  });
  // Default kind: memo.
  switchKind(document.querySelector('[data-kind="memo"]'));
  document.getElementById('gd-post').addEventListener('click', () => onPost(id));
  // 精算 ボタンは card header に常設 (支払いがゼロの時は openSettleModal 側で toast)。
  document.getElementById('gd-settle')?.addEventListener('click', () => openSettleModal(id));
  // スケジュールの日程設定 + 編集モード + 一覧
  document.getElementById('gd-sched-range')?.addEventListener('click', () => openSchedRangeModal(id));
  document.getElementById('gd-sched-editmode')?.addEventListener('click', () => {
    schedEditMode = !schedEditMode;
    loadSchedule(id);
  });
  loadSchedule(id);
  await loadDetail(id);
  await loadWari(id);
}

let currentKind = 'memo';
function switchKind(btn) {
  currentKind = btn.dataset.kind;
  document.querySelectorAll('[data-kind]').forEach(b => {
    b.classList.toggle('primary', b === btn);
  });
  const root = document.getElementById('gd-post-fields');
  if (currentKind === 'memo') {
    root.innerHTML = `<textarea id="gd-body" maxlength="5000" rows="3" placeholder="メモ"></textarea>`;
  } else if (currentKind === 'url') {
    root.innerHTML = `
      <input type="url" id="gd-url" placeholder="https://…" style="margin-bottom:6px">
      <textarea id="gd-body" maxlength="2000" rows="2" placeholder="メモ (任意)"></textarea>`;
  } else {
    root.innerHTML = `
      <input type="datetime-local" id="gd-time" style="margin-bottom:6px">
      <textarea id="gd-body" maxlength="2000" rows="2" placeholder="例: 駅前ホテルに集合"></textarea>`;
  }
}

// URL 用の名前を後から設定/変更/解除。サーバ側で creator/admin チェック。
// 変更後は新しい URL にナビゲートし直す (古い numeric id でも引き続き解決
// するが、表示を最新の slug に合わせる)。
async function onEditSlug(g) {
  const cur = g.slug || '';
  const ans = prompt('URL 用の名前を入力してください\n英数字・_・- の 1〜64 文字 / 数字だけは不可', cur);
  if (ans === null) return;
  const s = ans.trim();
  if (s === cur) return;
  if (s !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(s)) { toast('英数字・_・- の 1〜64 文字で'); return; }
  if (s !== '' && /^\d+$/.test(s)) { toast('数字だけにはできません'); return; }
  try {
    const r = await patch('/api/groups/' + g.id, { slug: s === '' ? null : s });
    toast('更新しました');
    location.hash = '#/groups/' + (r.slug || g.id);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onClearSlug(g) {
  if (!confirm(`URL 用の名前『${g.slug}』を解除しますか? (このリンクは無効になります)`)) return;
  try {
    await patch('/api/groups/' + g.id, { slug: null });
    toast('解除しました');
    location.hash = '#/groups/' + g.id;
  } catch (e) { toast('失敗: ' + e.message); }
}

async function loadDetail(id) {
  try {
    const g = await get('/api/groups/' + id);
    const isCreator = state.me?.id === Number(g.creator_user_id);
    const memberIds = g.members.map(m => m.id).join(',');
    setWariMembers(g.members);
    const slugRow = isCreator
      ? `<div class="meta" style="margin-top:4px">URL 用の名前: <span class="mono">${g.slug ? '/#/groups/' + escapeHtml(g.slug) : '(未設定)'}</span>
           <button id="gd-edit-slug" class="btn" style="padding:2px 6px; font-size:11px; margin-left:6px">${g.slug ? '変更' : '設定'}</button>
           ${g.slug ? `<button id="gd-clear-slug" class="btn" style="padding:2px 6px; font-size:11px">解除</button>` : ''}
         </div>`
      : (g.slug ? `<div class="meta" style="margin-top:4px">URL 用の名前: <span class="mono">/#/groups/${escapeHtml(g.slug)}</span></div>` : '');
    // 表紙画像: 設定済みなら 16:9 ヒーロー、creator なら 「変更/削除」 ボタン付き。
    // 未設定 + creator なら 「📷 表紙画像を追加」 ボタンだけ表示。
    const imgBlock = renderCoverEditor({
      imageUrl: g.image_url,
      canEdit:  isCreator,
      idPrefix: 'gd',
    });
    document.getElementById('gd-head').innerHTML = `
      ${imgBlock}
      <div class="bold" style="font-size:18px">${escapeHtml(g.title)} ${g.closed_at ? '<span class="tag muted">close</span>' : ''}</div>
      <div class="meta">${escapeHtml(g.creator_name)} · ${escapeHtml((g.created_at || '').slice(0, 16))}</div>
      ${slugRow}
      ${g.description ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px">${escapeHtml(g.description)}</div>` : ''}
      <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; align-items:center">
        ${g.members.map(m => `
          <span class="presence-pill">
            ${avatarHtml(m.display_name, m.avatar_url, 'sm')}
            <span class="presence-pill-name">${escapeHtml(m.display_name)}</span>
          </span>`).join('')}
      </div>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button class="btn primary" id="gd-snap-receipt">レシート</button>
        <a class="btn" href="#/roulette?members=${memberIds}&title=${encodeURIComponent(g.title)}">ルーレット</a>
        <a class="btn" href="#/nomikai?members=${memberIds}">割り勘</a>
        <input type="file" id="gd-receipt-file" accept="image/*" capture="environment" hidden>
      </div>`;
    // 閉じるボタンは滅多に使わないので 「グループ閉じる」 カードをページ最下部
    // にぶら下げる。表示は creator かつ未 close の時だけ。
    const dangerCard = document.getElementById('gd-danger-card');
    if (dangerCard) dangerCard.hidden = !(isCreator && !g.closed_at);
    wireCoverEditor({
      idPrefix: 'gd',
      onChange: async (url) => {
        try { await patch('/api/groups/' + id, { image_url: url }); toast(url ? '画像を保存しました' : '画像を削除しました'); await loadDetail(id); }
        catch (e) { toast('失敗: ' + e.message); }
      },
    });
    document.getElementById('gd-snap-receipt')?.addEventListener('click', () => {
      document.getElementById('gd-receipt-file').click();
    });
    document.getElementById('gd-receipt-file')?.addEventListener('change', (ev) => onReceiptFile(ev, id));
    // 受け皿は loadWari に統合済み (確定支出と未確定レシートを一覧にまとめる)。
    document.getElementById('gd-close')?.addEventListener('click', async () => {
      if (!confirm('このグループを閉じますか?')) return;
      try {
        await del('/api/groups/' + id);
        toast('閉じました');
        location.hash = '#/groups';
      } catch (e) { toast('失敗: ' + e.message); }
    });
    document.getElementById('gd-edit-slug')?.addEventListener('click', () => onEditSlug(g));
    document.getElementById('gd-clear-slug')?.addEventListener('click', () => onClearSlug(g));

    const root = document.getElementById('gd-feed');
    if (!g.items.length) {
      root.innerHTML = `<div class="empty">まだ投稿はありません</div>`;
    } else {
      root.innerHTML = g.items.map(it => renderItem(it, id)).join('');
      root.querySelectorAll('[data-rm]').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('削除しますか?')) return;
          try {
            await del(`/api/groups/${id}/items/${b.dataset.rm}`);
            toast('削除しました');
            await loadDetail(id);
          } catch (e) { toast('失敗: ' + e.message); }
        });
      });
    }
  } catch (e) {
    document.getElementById('gd-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderItem(it, gid) {
  const meId = state.me?.id;
  const canDelete = Number(it.created_by_user_id) === Number(meId);
  const kindBadge = ({ memo: '📝', url: '🔗', time: '🕒' })[it.kind] || '';
  // URL + メモ両方 → メモをリンク化、URL は表示しない。
  // URL のみ          → URL をそのままリンク表示。
  // メモのみ          → プレーン表示。
  const when = it.scheduled_at ? `<div class="meta">🕒 ${escapeHtml(it.scheduled_at)}</div>` : '';
  let middle = '';
  if (it.url && it.body) {
    middle = `<div><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" style="color:var(--primary); white-space:pre-wrap">${escapeHtml(it.body)} ↗</a></div>`;
  } else if (it.url) {
    middle = `<div><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" style="color:var(--primary); word-break:break-all">${escapeHtml(it.url)} ↗</a></div>`;
  } else if (it.body) {
    middle = `<div style="white-space:pre-wrap">${escapeHtml(it.body)}</div>`;
  }
  // 「アバター: 投稿内容 / 日付」 形式。投稿者名は冗長なので出さない (タップ
  // すれば avatar の title 属性で確認できる)。
  return `
    <div class="list-item" style="gap:10px; align-items:flex-start">
      <span title="${escapeHtml(it.author_name)}">${avatarHtml(it.author_name, it.author_avatar_url, 'sm')}</span>
      <div class="grow">
        <div>${middle}</div>
        ${when}
        <div class="meta" style="margin-top:4px">${escapeHtml(it.created_at)}</div>
      </div>
      ${canDelete ? `<button data-rm="${it.id}" class="btn" style="padding:2px 8px; font-size:14px; color:var(--muted); border-color:var(--line)">×</button>` : ''}
    </div>`;
}

// ──────────────────────────── WARI (ワリカ) ────────────────────────────

// 通貨候補。表示順だけ持てばよい — レートは /api/fx で取得 (登録時点を snapshot)。
const CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'CNY', 'KRW', 'TWD', 'AUD'];

let wariMembers = []; // populated by loadDetail() via setWariMembers()
// セッション内 fetch キャッシュ: currency → {rate, fetched_at}
const fxCache = new Map();

async function fetchFxRate(ccy) {
  if (ccy === 'JPY') return { rate: 1, source: 'identity' };
  if (fxCache.has(ccy)) return fxCache.get(ccy);
  const d = await get('/api/fx', { currency: ccy });
  const entry = { rate: Number(d.rate_to_jpy), source: d.source };
  fxCache.set(ccy, entry);
  return entry;
}
// Set of user_ids the next expense applies to. Initialized to all current
// members when setWariMembers() runs; user deselects chips to exclude people.
let wariFor = new Set();

function renderWariForm() {
  const root = document.getElementById('gd-wari-form');
  if (!root) return;
  // OTHER は最後の sentinel。選ぶと自由入力欄が現れる。
  const ccyOpts = [...CURRENCIES, 'OTHER'].map(c =>
    `<option value="${c}">${c === 'OTHER' ? 'その他…' : c}</option>`).join('');
  root.innerHTML = `
    <div style="display:grid; grid-template-columns: minmax(0,1fr) 110px; gap:6px; margin-bottom:6px">
      <input type="number" id="ex-amt" min="0" step="0.01" placeholder="金額" inputmode="decimal">
      <select id="ex-ccy">${ccyOpts}</select>
    </div>
    <div id="ex-custom-row" hidden style="display:grid; grid-template-columns: 110px minmax(0,1fr); gap:6px; margin-bottom:6px">
      <input type="text" id="ex-ccy-custom" maxlength="3" placeholder="通貨 (例: THB)" style="text-transform:uppercase">
      <input type="number" id="ex-rate-manual" min="0" step="0.000001" placeholder="1 通貨 = ? JPY">
    </div>
    <div id="ex-rate-row" hidden style="margin-bottom:6px; font-size:12px"></div>
    <label class="muted" style="font-size:12px; display:block; margin-bottom:2px">立て替えた人</label>
    <select id="ex-payer" style="margin-bottom:6px">
      ${wariMembers.map(m => `<option value="${m.id}">${escapeHtml(m.display_name)}</option>`).join('')}
    </select>
    <div id="ex-for" style="margin-bottom:6px"></div>
    <input type="text" id="ex-memo" maxlength="500" placeholder="メモ (例: ランチ, タクシー)" style="margin-bottom:6px">
    <label class="hint-sm" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px">
      <span>📸 レシート (任意)</span>
      <input type="file" id="ex-image-file" accept="image/*" style="font-size:11px">
      <span id="ex-image-status"></span>
    </label>
    <input type="hidden" id="ex-image-url" value="">
    <img id="ex-image-preview" alt="" hidden style="max-width:140px; max-height:140px; margin:0 0 6px; border-radius:6px; object-fit:contain; display:block; border:1px solid var(--line)">
    <div class="row" style="gap:6px">
      <button id="ex-submit" class="primary">支出を記録</button>
    </div>
  `;
  const ccyEl = document.getElementById('ex-ccy');
  ccyEl.addEventListener('change', () => syncFxPreview());
  // For OTHER: try auto-fetch when user finishes typing a 3-letter code.
  document.getElementById('ex-ccy-custom').addEventListener('blur', () => tryFetchCustomRate());
  document.getElementById('ex-ccy-custom').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  });
  syncFxPreview();
  // Default payer to me if present in the group, else first member.
  const sel = document.getElementById('ex-payer');
  if (state.me?.id && wariMembers.some(m => m.id === state.me.id)) {
    sel.value = String(state.me.id);
  }
  wariFor = new Set(wariMembers.map(m => m.id));
  renderForPicker();
  document.getElementById('ex-submit').addEventListener('click', () => onAddExpense());
  document.getElementById('ex-image-file').addEventListener('change', onExImageFile);
}

async function onExImageFile(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;
  const status = document.getElementById('ex-image-status');
  status.textContent = 'アップロード中…';
  try {
    const data = await uploadImage(f);
    document.getElementById('ex-image-url').value = data.url;
    const prev = document.getElementById('ex-image-preview');
    prev.src = data.url;
    prev.hidden = false;
    status.textContent = '✓ 完了';
  } catch (e) { status.textContent = '失敗: ' + e.message; }
}

// ─── RECEIPTS (撮影ストック → 後でワリカに転用) ─────────────────────

// JPEG の EXIF から DateTimeOriginal (tag 0x9003) を読む。 戻り値は
// 「YYYY-MM-DD HH:MM:SS」 形式 (server 期待) または null。 ライブラリ不要、
// 自前で TIFF を辿る最小実装。 EXIF が無い / HEIC / 解析失敗 で null。
//
// EXIF 仕様: JPEG (FFD8) → APP1 マーカー (FFE1) + "Exif\0\0" + TIFF。
// TIFF は "II" (little-endian) または "MM" (big-endian) + 0x002A magic +
// IFD0 offset。 IFD0 の中に ExifIFD pointer (tag 0x8769) があり、 その先に
// DateTimeOriginal (tag 0x9003、 ASCII 20 byte 「YYYY:MM:DD HH:MM:SS\0」)。
async function readExifDateTime(file) {
  if (!file || !/^image\/jpe?g$/i.test(file.type)) return null;
  const buf = await file.slice(0, 128 * 1024).arrayBuffer(); // EXIF はだいたい先頭
  const dv = new DataView(buf);
  if (dv.getUint16(0) !== 0xFFD8) return null;
  let off = 2;
  while (off + 4 < dv.byteLength) {
    const marker = dv.getUint16(off);
    if ((marker & 0xFF00) !== 0xFF00) return null;
    const segLen = dv.getUint16(off + 2);
    if (marker === 0xFFE1
        && off + 10 < dv.byteLength
        && dv.getUint32(off + 4) === 0x45786966   // "Exif"
        && dv.getUint16(off + 8) === 0x0000) {
      const tiff = off + 10;
      const le = dv.getUint16(tiff) === 0x4949;
      const u16 = o => dv.getUint16(o, le);
      const u32 = o => dv.getUint32(o, le);
      if (u16(tiff + 2) !== 0x002A) return null;
      const ifd0 = tiff + u32(tiff + 4);
      const n0 = u16(ifd0);
      let exifIfd = 0;
      for (let i = 0; i < n0; i++) {
        const e = ifd0 + 2 + i * 12;
        if (u16(e) === 0x8769) { exifIfd = tiff + u32(e + 8); break; }
      }
      if (!exifIfd) return null;
      const nE = u16(exifIfd);
      for (let i = 0; i < nE; i++) {
        const e = exifIfd + 2 + i * 12;
        if (u16(e) === 0x9003) {
          const dataOff = tiff + u32(e + 8);
          if (dataOff + 19 > dv.byteLength) return null;
          const bytes = new Uint8Array(buf, dataOff, 19);
          const s = String.fromCharCode(...bytes);
          // "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DD HH:MM:SS"
          if (!/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return null;
          return s.replace(':', '-').replace(':', '-');
        }
      }
      return null;
    }
    off += 2 + segLen;
  }
  return null;
}

// 撮影 1 タップ運用: file picker (capture=environment) でカメラ起動 →
// 並行で GPS を取り (許可されてれば) アップロード時に taken_at + lat/lng を送る。
// 失敗 / 拒否されても GPS なしで普通に保存される。
async function onReceiptFile(ev, gid) {
  const f = ev.target.files?.[0];
  ev.target.value = ''; // 同じファイルを連続選択できるよう reset
  if (!f) return;
  // 撮影時刻の決め方:
  //   (1) JPEG なら EXIF の DateTimeOriginal を優先 (= カメラがその場で
  //       記録した時刻、 後でアルバムから古い写真を選んだ時も正しい)
  //   (2) 取れなければブラウザの 「今」 ローカル時刻 (= 今その場で撮った想定)
  // 規約は MTG 入力と同じく 「YYYY-MM-DD HH:MM:SS」 のローカル時刻文字列。
  let takenAt = await readExifDateTime(f);
  if (!takenAt) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    takenAt = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} `
            + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  let lat = null, lng = null;
  if (navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject,
          { timeout: 8000, maximumAge: 60000 });
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch (_) { /* user denied or timeout — OK */ }
  }
  toast('アップロード中…');
  try {
    const data = await uploadImage(f);
    await post(`/api/groups/${gid}/receipts`,
      { image_url: data.url, taken_at: takenAt, lat, lng });
    toast(`レシートを保存しました${lat !== null ? ' (📍位置付き)' : ''}`);
    await loadWari(gid);
  } catch (e) { toast('失敗: ' + e.message); }
}

// 未確定レシート (draft) 1 行を確定支出と同じ list-item 形式でレンダリング。
// 視覚的に区別しすぎず、 「立替: ?」 で 「まだ修正が必要」 と促す。
// loadWari の中で expense と一緒にソートされて出る。
let cachedReceipts = [];
function renderReceiptRow(r) {
  const time     = r.taken_at || r.created_at || '';
  const timeShort = (time || '').slice(0, 16);
  const hasGps   = r.lat !== null && r.lng !== null;
  const gpsLink  = hasGps
    ? ` · <a href="https://maps.google.com/?q=${r.lat},${r.lng}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--primary)">📍地図</a>`
    : '';
  const thumb = `
    <a href="${escapeHtml(r.image_url)}" target="_blank" rel="noopener" style="flex-shrink:0" onclick="event.stopPropagation()">
      <img src="${escapeHtml(r.image_url)}" alt="" style="width:54px; height:54px; object-fit:cover; border-radius:6px; border:1px solid var(--line); display:block">
    </a>`;
  return `
    <div class="list-item" style="gap:10px">
      ${thumb}
      <div class="grow" style="min-width:0">
        <div class="bold">${escapeHtml(r.uploaded_by_name || '誰か')} 立替: <span class="muted">?</span></div>
        <div class="meta">${escapeHtml(timeShort)}${gpsLink}</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px">
        <button data-edit-receipt="${r.id}" class="btn primary" style="padding:2px 8px; font-size:11px">編集</button>
        <button data-rm-receipt="${r.id}" class="btn" style="padding:2px 6px; font-size:14px; color:var(--muted); border-color:var(--line)">×</button>
      </div>
    </div>`;
}

// Last-fetched rate for the preset dropdown path. Cleared on currency change.
let pendingFxRate = null;

async function syncFxPreview() {
  const ccy = document.getElementById('ex-ccy').value;
  const row = document.getElementById('ex-rate-row');
  const customRow = document.getElementById('ex-custom-row');
  pendingFxRate = null;
  if (ccy === 'OTHER') {
    customRow.hidden = false;
    row.hidden = false;
    row.innerHTML = `<span class="muted">通貨コード (3文字) と 1通貨=?円 を入れてください。コードが対応していれば自動取得します。</span>`;
    return;
  }
  customRow.hidden = true;
  if (ccy === 'JPY') { row.hidden = true; row.innerHTML = ''; return; }
  row.hidden = false;
  row.innerHTML = `<span class="muted">レート取得中…</span>`;
  try {
    const entry = await fetchFxRate(ccy);
    pendingFxRate = entry.rate;
    row.innerHTML = `<span class="muted">登録時点のレート: 1 ${escapeHtml(ccy)} = ${entry.rate.toFixed(4)} JPY <span style="font-size:11px">(${escapeHtml(entry.source)})</span></span>`;
  } catch (e) {
    pendingFxRate = null;
    row.innerHTML = `<span style="color:var(--warn)">レート取得失敗 (${escapeHtml(e.message)}) — 送信時にサーバー側で再取得します</span>`;
  }
}

async function tryFetchCustomRate() {
  const code = document.getElementById('ex-ccy-custom').value.trim();
  const rateEl = document.getElementById('ex-rate-manual');
  const row = document.getElementById('ex-rate-row');
  if (code.length !== 3) return;
  if (rateEl.value && Number(rateEl.value) > 0) return; // user already typed → don't overwrite
  row.innerHTML = `<span class="muted">${escapeHtml(code)} のレートを取得中…</span>`;
  try {
    const entry = await fetchFxRate(code);
    rateEl.value = entry.rate.toFixed(6);
    row.innerHTML = `<span class="muted">登録時点のレート: 1 ${escapeHtml(code)} = ${entry.rate.toFixed(4)} JPY <span style="font-size:11px">(${escapeHtml(entry.source)})</span></span>`;
  } catch (e) {
    row.innerHTML = `<span class="muted">${escapeHtml(code)} は自動取得できませんでした。手動でレートを入れてください。</span>`;
  }
}

// 「誰の分?」 picker. Chip row with everyone pre-selected; tap a chip to
// exclude that person from this expense.
// 個別固定額。 uid → 円。 wariFor から外れた人は自動で消える。
let wariFixed = new Map();
function renderForPicker() {
  const root = document.getElementById('ex-for');
  if (!root) return;
  const n = wariFor.size;
  const summary = n === 0
    ? `<span style="color:var(--warn)">対象者を 1 人以上選んでください</span>`
    : (n === wariMembers.length
        ? `全員 (${n}人)`
        : `${n}人で割る`);
  // 各メンバ行: チップ全体タップで in/out 切替、 右の input に円を入れると 固定額。
  // 空欄 = 等分。 in/out は visually opacity & border で表す。
  root.innerHTML = `
    <label class="hint-sm">誰の分? <span style="margin-left:6px">${summary}</span></label>
    <div class="hint-sm" style="margin:2px 0 4px">タップで in/out。 右に金額を入れると 「その人だけ固定」 (= 残りを等分)。</div>
    <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px">
      ${wariMembers.map(m => {
        const on = wariFor.has(m.id);
        const fx = wariFixed.get(m.id);
        return `
          <div class="row" data-for-uid="${m.id}" style="gap:6px; align-items:center; padding:4px 6px; border:1px solid ${on ? 'var(--primary)' : 'var(--line)'}; border-radius:6px; ${on ? '' : 'opacity:.4'}; background:${on ? 'var(--primary-soft, #efeafa)' : 'transparent'}">
            <span class="wari-toggle" style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; flex:1; min-width:0">
              ${avatarHtml(m.display_name, m.avatar_url, 'sm')}
              <span class="bold" style="white-space:nowrap">${escapeHtml(m.display_name)}</span>
            </span>
            <input type="number" class="wari-fixed-input" data-fixed-uid="${m.id}"
                   value="${fx != null ? fx : ''}"
                   min="0" step="1" placeholder="等分"
                   style="width:80px; text-align:right; font-size:13px"
                   ${on ? '' : 'disabled'}>
            <span class="muted" style="font-size:11px">円</span>
          </div>`;
      }).join('')}
    </div>
  `;
  // チップ全体タップ (input 以外) で in/out 切替。 input は別途固定額入力。
  root.querySelectorAll('[data-for-uid]').forEach(row => {
    const uid = Number(row.dataset.forUid);
    row.querySelector('.wari-toggle').addEventListener('click', () => {
      if (wariFor.has(uid)) { wariFor.delete(uid); wariFixed.delete(uid); }
      else                  wariFor.add(uid);
      renderForPicker();
    });
  });
  root.querySelectorAll('.wari-fixed-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const uid = Number(inp.dataset.fixedUid);
      const v = Number(inp.value);
      if (Number.isFinite(v) && v > 0) wariFixed.set(uid, Math.floor(v));
      else wariFixed.delete(uid);
    });
  });
}

async function onAddExpense() {
  const gid = currentGroupId;
  const amount = Number(document.getElementById('ex-amt').value);
  let currency = document.getElementById('ex-ccy').value;
  const payer_user_id = Number(document.getElementById('ex-payer').value);
  const memo = document.getElementById('ex-memo').value.trim() || null;
  const image_url = document.getElementById('ex-image-url').value || null;
  if (!(amount > 0)) { toast('金額を入れてください'); return; }
  const body = { amount, payer_user_id, memo, image_url };
  if (currency === 'OTHER') {
    const code = document.getElementById('ex-ccy-custom').value.trim();
    const manualRate = Number(document.getElementById('ex-rate-manual').value);
    if (!/^[A-Z]{3}$/.test(code))   { toast('通貨コード (3文字) を入れてください'); return; }
    if (!(manualRate > 0))           { toast('レートを入れてください'); return; }
    currency = code;
    body.rate_to_jpy = manualRate;
  } else if (currency !== 'JPY' && pendingFxRate) {
    // Use the previewed rate if we have one; otherwise let the server fetch.
    body.rate_to_jpy = pendingFxRate;
  }
  body.currency = currency;
  if (wariFor.size === 0) { toast('対象者を 1 人以上選んでください'); return; }
  // 固定額がある人がいれば rich format で送る。 無ければ legacy で。
  const hasFixed = [...wariFor].some(uid => wariFixed.has(uid));
  if (hasFixed) {
    // 検算: 固定額合計が total を超えてないか、 全員固定で合計 != total など。
    const fixedTotal = [...wariFor]
      .filter(uid => wariFixed.has(uid))
      .reduce((s, uid) => s + wariFixed.get(uid), 0);
    if (currency === 'JPY' && fixedTotal > amount) {
      toast('固定額の合計が支払金額を超えています'); return;
    }
    body.participants = [...wariFor].map(uid => {
      const f = wariFixed.get(uid);
      return f != null ? { user_id: uid, fixed: f } : { user_id: uid };
    });
  } else if (wariFor.size !== wariMembers.length) {
    body.participant_ids = [...wariFor];
  }
  try {
    await post(`/api/groups/${gid}/expenses`, body);
    document.getElementById('ex-amt').value = '';
    document.getElementById('ex-memo').value = '';
    document.getElementById('ex-image-file').value = '';
    document.getElementById('ex-image-url').value = '';
    document.getElementById('ex-image-preview').hidden = true;
    document.getElementById('ex-image-status').textContent = '';
    wariFor = new Set(wariMembers.map(m => m.id));
    wariFixed.clear();
    renderForPicker();
    // 登録後は支払い登録フォームを畳む (記録画面に戻る感じ)。
    const det = document.getElementById('gd-wari-form-card');
    if (det) det.open = false;
    toast('記録しました');
    await loadWari(gid);
  } catch (e) { toast('失敗: ' + e.message); }
}

let currentGroupId = 0;

async function loadWari(id) {
  currentGroupId = id;
  if (!wariMembers.length) renderWariForm();
  const root = document.getElementById('gd-wari-list');
  const summary = document.getElementById('gd-wari-summary');
  if (!root || !summary) return;
  try {
    // 確定済み支出 + 下書きレシート を時系列で混ぜて並べる。
    // (支出と receipt は同じ adhoc_group_expenses 表だが、 API は分かれてる)
    const [d, recd] = await Promise.all([
      get(`/api/groups/${id}/expenses`),
      get(`/api/groups/${id}/receipts`).catch(() => ({ items: [] })),
    ]);
    cachedReceipts = recd.items || [];
    summary.innerHTML = d.count
      ? `${d.count} 件 (確定) / 合計 ¥${d.total_jpy.toLocaleString()}`
      + (cachedReceipts.length ? ` + 未確定 ${cachedReceipts.length} 件` : '')
      : (cachedReceipts.length
          ? `<span class="muted">確定支出はまだなし (未確定レシート ${cachedReceipts.length} 件)</span>`
          : '<span class="muted">まだ支出はありません</span>');
    // 各 row に sort 用キー (created_at desc) を付けて 一覧 を組む。
    const expRows = (d.expenses || []).map(e => ({
      _ts: e.created_at || '',
      _draft: false,
      data: e,
      html: renderExpense(e, id),
    }));
    const recRows = cachedReceipts.map(r => ({
      _ts: r.taken_at || r.created_at || '',
      _draft: true,
      data: r,
      html: renderReceiptRow(r),
    }));
    const merged = [...expRows, ...recRows]
      .sort((a, b) => (b._ts || '').localeCompare(a._ts || ''));
    if (!merged.length) { root.innerHTML = ''; lastWariData = d; renderSpendCard(d.balances || []); return; }
    root.innerHTML = merged.map(r => r.html).join('');
    // 確定支出の編集/削除
    root.querySelectorAll('[data-edit-ex]').forEach(b => {
      b.addEventListener('click', () => {
        const exp = (d.expenses || []).find(x => Number(x.id) === Number(b.dataset.editEx));
        if (exp) openExpenseEdit(id, exp);
      });
    });
    root.querySelectorAll('[data-rm-ex]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この支出を削除しますか?')) return;
        try {
          await del(`/api/groups/${id}/expenses/${b.dataset.rmEx}`);
          toast('削除しました');
          await loadWari(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
    // 未確定 (receipt) の編集/破棄。 編集は openExpenseEdit を draft 用 default で。
    root.querySelectorAll('[data-edit-receipt]').forEach(b => {
      b.addEventListener('click', () => {
        const r = cachedReceipts.find(x => Number(x.id) === Number(b.dataset.editReceipt));
        if (!r) return;
        openExpenseEdit(id, {
          id: r.id,
          amount_jpy: 0,
          amount_original: null,
          currency: 'JPY',
          rate_to_jpy: null,
          payer_user_id: r.uploaded_by_user_id || null,
          memo: '',
          image_url: r.image_url,
          taken_at: r.taken_at,
          lat: r.lat,
          lng: r.lng,
          participants: wariMembers.map(m => m.id),
          is_draft: 1,
        });
      });
    });
    root.querySelectorAll('[data-rm-receipt]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('このレシートを破棄しますか? (元には戻せません)')) return;
        try {
          await del(`/api/groups/${id}/receipts/${b.dataset.rmReceipt}`);
          await loadWari(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
    // Stash latest data for the settle modal.
    lastWariData = d;
    // Render per-person spent / paid summary.
    renderSpendCard(d.balances || []);
  } catch (e) {
    summary.innerHTML = `<span class="muted">${escapeHtml(e.message)}</span>`;
  }
}

let lastWariData = null;

function renderSpendCard(balances) {
  const card = document.getElementById('gd-spend-card');
  const root = document.getElementById('gd-spend-list');
  if (!card || !root) return;
  const meaningful = balances.filter(b => (b.spent_jpy || 0) > 0 || (b.paid_jpy || 0) > 0);
  if (!meaningful.length) { card.hidden = true; return; }
  card.hidden = false;
  // 使った額の大きい順
  const sorted = [...meaningful].sort((a, b) => (b.spent_jpy || 0) - (a.spent_jpy || 0));
  root.innerHTML = sorted.map(b => {
    const spent = b.spent_jpy || 0;
    const paid  = b.paid_jpy  || 0;
    const diff  = paid - spent;
    const diffTxt = diff === 0
      ? `<span class="muted">±0</span>`
      : diff > 0
        ? `<span style="color:#0e7c63" class="bold">+¥${diff.toLocaleString()}</span>`
        : `<span style="color:#b54708" class="bold">-¥${Math.abs(diff).toLocaleString()}</span>`;
    return `
      <div class="list-item">
        <div style="flex:1; display:flex; align-items:center; gap:8px">
          ${avatarHtml(b.display_name, b.avatar_url, 'sm')}
          <div class="bold">${escapeHtml(b.display_name)}</div>
        </div>
        <div style="text-align:right; font-size:13px">
          <div>使った <span class="bold">¥${spent.toLocaleString()}</span></div>
          <div class="muted">立替 ¥${paid.toLocaleString()} · 差引 ${diffTxt}</div>
        </div>
      </div>`;
  }).join('');
}

// 既存の支出を編集するモーダル。金額 / 通貨 / 立替人 / 対象者 / メモを
// 個別に変更可能。レートは通貨変更時のみ再取得 (JPY なら null)。
function openExpenseEdit(gid, e) {
  const existing = document.getElementById('ex-edit-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ex-edit-modal';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px';

  const ccyOpts = [...CURRENCIES, 'OTHER'].map(c =>
    `<option value="${c}" ${c === e.currency ? 'selected' : ''}>${c === 'OTHER' ? 'その他…' : c}</option>`).join('');
  const initSet = new Set((e.participants || []).map(Number));
  const initialAmount = e.currency === 'JPY' ? e.amount_jpy : (e.amount_original || e.amount_jpy);

  // 画像 (レシート) があれば上部にプレビュー + 撮影時刻 + Google Maps リンク (GPS あり時)。
  const hasGps = e.lat !== null && e.lat !== undefined && e.lng !== null && e.lng !== undefined;
  const imageBlock = e.image_url ? `
    <div style="margin-top:8px; padding:8px; background:var(--bg); border-radius:6px">
      <a href="${escapeHtml(e.image_url)}" target="_blank" rel="noopener" style="display:block">
        <img src="${escapeHtml(e.image_url)}" alt="" style="max-width:100%; max-height:220px; object-fit:contain; border-radius:4px; display:block; margin:0 auto">
      </a>
      <div class="muted" style="font-size:11px; margin-top:6px; text-align:center">
        ${e.taken_at ? `📅 ${escapeHtml(e.taken_at)}` : ''}
        ${hasGps ? ` · <a href="https://maps.google.com/?q=${e.lat},${e.lng}" target="_blank" rel="noopener" style="color:var(--primary)">📍 地図で見る</a>` : ''}
      </div>
    </div>` : '';

  overlay.innerHTML = `
    <div style="background:#fff; border-radius:14px; max-width:520px; width:100%; max-height:85vh; display:flex; flex-direction:column; padding:20px; overflow:auto">
      <div class="row center">
        <h3 class="row-title">${e.is_draft ? 'レシートを支出に' : '支出を編集'}</h3>
        <button id="ex-edit-close">×</button>
      </div>
      ${imageBlock}
      <label class="field" style="margin-top:8px">
        <span class="lbl">金額</span>
        <div class="row" style="gap:6px">
          <input type="number" id="ex-edit-amt" min="0" step="0.01" value="${initialAmount || ''}" class="grow">
          <select id="ex-edit-ccy" style="width:90px">${ccyOpts}</select>
        </div>
      </label>
      <div id="ex-edit-rate-row" class="muted" style="font-size:12px; margin-bottom:6px"></div>
      <label class="field">
        <span class="lbl">立替えた人</span>
        <select id="ex-edit-payer">
          <option value="">— 未選択 —</option>
          ${wariMembers.map(m => `<option value="${m.id}" ${m.id === Number(e.payer_user_id) ? 'selected' : ''}>${escapeHtml(m.display_name)}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span class="lbl">メモ</span>
        <input type="text" id="ex-edit-memo" maxlength="500" value="${escapeHtml(e.memo || '')}">
      </label>
      <div class="muted" style="font-size:12px; margin:4px 0 2px">対象者 (チップタップで除外)</div>
      <div id="ex-edit-for" class="row" style="gap:6px; flex-wrap:wrap"></div>
      <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end">
        <button id="ex-edit-cancel" class="btn">キャンセル</button>
        <button id="ex-edit-save"   class="primary">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // for picker
  const renderFor = () => {
    const root = overlay.querySelector('#ex-edit-for');
    root.innerHTML = wariMembers.map(m => {
      const on = initSet.has(m.id);
      return `
        <span class="rl-chip" data-eduid="${m.id}" style="${on ? 'background:var(--primary-soft,#efeafa); border-color:var(--primary)' : 'opacity:.5'}">
          ${avatarHtml(m.display_name, m.avatar_url, 'sm')}
          <span>${escapeHtml(m.display_name)}</span>
        </span>`;
    }).join('');
    root.querySelectorAll('[data-eduid]').forEach(c => {
      c.addEventListener('click', () => {
        const uid = Number(c.dataset.eduid);
        if (initSet.has(uid)) initSet.delete(uid);
        else initSet.add(uid);
        renderFor();
      });
    });
  };
  renderFor();

  // rate hint (read-only): re-fetch when currency changes
  let liveRate = e.currency === 'JPY' ? null : Number(e.rate_to_jpy) || null;
  const rateRow = overlay.querySelector('#ex-edit-rate-row');
  const setRateHint = (txt) => { rateRow.textContent = txt; };
  if (e.currency !== 'JPY' && liveRate) {
    setRateHint(`現在のレート: 1 ${e.currency} = ${liveRate.toFixed(4)} JPY (元の値、保存時に再取得します)`);
  }
  overlay.querySelector('#ex-edit-ccy').addEventListener('change', async (ev) => {
    const c = ev.target.value;
    if (c === 'JPY' || c === 'OTHER') { liveRate = null; setRateHint(c === 'OTHER' ? 'OTHER は v1 では未対応 — JPY か USD/EUR 等を選んでください' : ''); return; }
    setRateHint(`${c} レートを取得中…`);
    try {
      const r = await fetchFxRate(c);
      liveRate = r.rate;
      setRateHint(`登録時点のレート: 1 ${c} = ${r.rate.toFixed(4)} JPY (${r.source})`);
    } catch (_) {
      liveRate = null;
      setRateHint(`レート取得失敗。送信時にサーバ側で再取得します。`);
    }
  });

  const close = () => overlay.remove();
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  overlay.querySelector('#ex-edit-close') .addEventListener('click', close);
  overlay.querySelector('#ex-edit-cancel').addEventListener('click', close);
  overlay.querySelector('#ex-edit-save')  .addEventListener('click', async () => {
    const amount = Number(overlay.querySelector('#ex-edit-amt').value);
    const currency = overlay.querySelector('#ex-edit-ccy').value;
    const payerRaw = overlay.querySelector('#ex-edit-payer').value;
    const payer_user_id = payerRaw === '' ? null : Number(payerRaw);
    const memo = overlay.querySelector('#ex-edit-memo').value.trim() || null;
    if (currency === 'OTHER') { toast('「その他」通貨での編集は未対応'); return; }
    // draft は amount=0 でも保存可 (途中保存 OK)。 通常支出 は >0 必須。
    if (!e.is_draft && !(amount > 0)) { toast('金額を入れてください'); return; }
    if (!e.is_draft && !initSet.size) { toast('対象者を 1 人以上選んでください'); return; }
    const body = { amount: isNaN(amount) ? 0 : amount, currency, payer_user_id, memo, participant_ids: [...initSet] };
    if (currency !== 'JPY' && liveRate) body.rate_to_jpy = liveRate;
    try {
      await patch(`/api/groups/${gid}/expenses/${e.id}`, body);
      toast(e.is_draft && amount > 0 ? '支出として登録しました' : '保存しました');
      close();
      await loadWari(gid);
    } catch (err) { toast('失敗: ' + err.message); }
  });
}

function renderExpense(e, gid) {
  const meId = state.me?.id;
  // グループメンバーなら誰でも編集/削除可 (入力ミスをみんなで直せる)。
  // wariMembers は loadDetail で全 group member セット済みなので、me がそこに
  // いれば canManage = true とみなす。
  const canManage = !!meId && wariMembers.some(m => Number(m.id) === Number(meId));
  const orig = (e.currency !== 'JPY' && e.amount_original)
    ? ` <span class="muted" style="font-size:11px">(${Number(e.amount_original).toLocaleString()} ${escapeHtml(e.currency)} × ${Number(e.rate_to_jpy).toFixed(2)})</span>` : '';
  const names = e.participants.map(uid => {
    const m = wariMembers.find(x => x.id === uid);
    return m ? m.display_name : `#${uid}`;
  });
  const isAll = e.participants.length === wariMembers.length
    && e.participants.every(uid => wariMembers.some(m => m.id === uid));
  const forText = isAll
    ? `全員 (${e.participants.length}人)`
    : `対象: ${names.join(', ')}`;
  const actions = canManage ? `
    <div style="display:flex; flex-direction:column; gap:4px">
      <button data-edit-ex="${e.id}" class="btn" style="padding:2px 6px; font-size:11px">編集</button>
      <button data-rm-ex="${e.id}" class="btn" style="padding:2px 6px; font-size:14px; color:var(--muted); border-color:var(--line)">×</button>
    </div>` : '';
  // レシート写真があれば左にサムネイル (タップで拡大表示は OS に任せる)。
  const thumb = e.image_url
    ? `<a href="${escapeHtml(e.image_url)}" target="_blank" rel="noopener" style="flex-shrink:0">
         <img src="${escapeHtml(e.image_url)}" alt="" style="width:54px; height:54px; object-fit:cover; border-radius:6px; border:1px solid var(--line); display:block">
       </a>`
    : '';
  return `
    <div class="list-item" style="gap:10px">
      ${thumb}
      <div class="grow">
        <div class="bold">${escapeHtml(e.payer_name)} 立替: ¥${e.amount_jpy.toLocaleString()}${orig}</div>
        ${e.memo ? `<div class="meta">${escapeHtml(e.memo)}</div>` : ''}
        <div class="meta">${escapeHtml((e.created_at || '').slice(0, 16))} · ${escapeHtml(forText)}</div>
      </div>
      ${actions}
    </div>`;
}

function openSettleModal(gid) {
  const d = lastWariData;
  if (!d || !d.expenses.length) { toast('支出がまだありません'); return; }
  const root = document.getElementById('gd-settle-modal');
  root.hidden = false;
  const meId = Number(state.me?.id) || 0;
  const mineStyle = 'background:#fff8e6; border-left:3px solid var(--primary)';

  // 推奨送金プラン。自分が from/to のどちらかなら黄色背景でハイライト。
  const planRows = d.settlements.length
    ? d.settlements.map(s => {
        const mine = Number(s.from_user_id) === meId || Number(s.to_user_id) === meId;
        return `
          <div class="list-item" style="${mine ? mineStyle : ''}">
            <div class="grow">
              <span class="bold">${escapeHtml(s.from_name)}</span> →
              <span class="bold">${escapeHtml(s.to_name)}</span>
              ${mine ? '<span class="muted" style="font-size:10px; margin-left:4px">(あなた)</span>' : ''}
            </div>
            <div class="bold" style="color:var(--primary); font-size:16px">¥${s.amount_jpy.toLocaleString()}</div>
          </div>`;
      }).join('')
    : `<div class="muted">送金不要 (全員ぴったり)</div>`;

  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px">
      <div style="background:#fff; border-radius:14px; max-width:520px; width:100%; max-height:85vh; display:flex; flex-direction:column; padding:20px">
        <div class="row center">
          <h3 class="row-title">精算サマリ</h3>
          <button id="gd-settle-close">×</button>
        </div>
        <p class="card-subtitle">合計 ¥${d.total_jpy.toLocaleString()} / ${d.expenses.length} 件</p>
        <div style="margin-top:10px; overflow:auto; flex:1; min-height:0">
          <h4 style="margin:0 0 6px">推奨送金プラン</h4>
          <div class="list">${planRows}</div>
        </div>
        ${d.settlements.length ? `
          <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end; flex-wrap:wrap">
            <button id="gd-settle-notify" class="btn">全員に通知</button>
            <button id="gd-settle-asreq"  class="primary">請求一括生成</button>
          </div>` : ''}
        <p class="muted" style="font-size:11px; margin-top:8px">
          ※ 実際の送金は外 (現金 / PayPay / 銀行) でやり取りしてください。
        </p>
      </div>
    </div>`;
  // 私あての送金プラン分を「請求」フォーマットで発射する。各 from_user が
  // 私 (creator=me) に支払うべき額を recipient として登録した money_request
  // を新規作成。受取人はその後 PayPay/銀行 等で「支払い済」をチェックできる。
  // 推奨送金プランの各 to_user_id (受取側) を creator にして、対応する
  // from_user_id 群を recipients にした money_request を一斉に作成する。
  // 1 creditor = 1 請求。タイトルは全件共通で prompt 編集可能 (デフォルト
  // グループ名)。
  root.querySelector('#gd-settle-asreq')?.addEventListener('click', async (ev) => {
    // ev.currentTarget は async の await を跨いだ後 null になるので、最初に
    // 参照を捕まえておく (caching pattern)。これがないと後で disabled を
    // 戻すときに 「Cannot set properties of null」 で吹き飛ぶ。
    const btn = ev.currentTarget;
    try {
      if (!d.settlements.length) { toast('送金プランがありません'); return; }
      const g = await get('/api/groups/' + currentGroupId);
      const defaultTitle = g?.title || '精算';
      // creditor → [{user_id, amount_yen}, ...]
      const grouped = new Map();
      for (const s of d.settlements) {
        const to = Number(s.to_user_id);
        if (!grouped.has(to)) grouped.set(to, []);
        grouped.get(to).push({ user_id: Number(s.from_user_id), amount_yen: Number(s.amount_jpy) });
      }
      const ans = prompt(
        `${grouped.size} 件の請求を一斉に作成します (${d.settlements.length} 件の送金プラン)。\nタイトルを入力してください:`,
        defaultTitle
      );
      if (ans === null) return;
      const title = ans.trim();
      if (!title) { toast('タイトルを入れてください'); return; }
      if (btn) btn.disabled = true;
      let firstId = null;
      let ok = 0, fail = 0;
      const errs = [];
      for (const [creatorId, recipients] of grouped) {
        try {
          const created = await post('/api/money-requests', {
            title,
            memo: null,
            creator_user_id: creatorId,
            recipients,
          });
          if (firstId === null) firstId = created.id;
          ok++;
        } catch (e) { fail++; errs.push(e.message || String(e)); }
      }
      toast(`${ok} 件の請求を作成しました${fail ? ` (${fail} 件失敗: ${errs[0]})` : ''}`);
      root.hidden = true; root.innerHTML = '';
      // 一覧に飛ぶ (詳細だと creator 以外で recipient でもない自分が
      // 見えない請求もあるため。一覧は created_by=me でも拾われる)
      location.hash = '#/requests';
    } catch (e) {
      toast('失敗: ' + (e?.message || e));
      if (btn) btn.disabled = false;
    }
  });
  root.querySelector('#gd-settle-close').addEventListener('click', () => { root.hidden = true; root.innerHTML = ''; });
  // 推奨送金プラン: 全員に通知 (kind=transfer)
  root.querySelector('#gd-settle-notify')?.addEventListener('click', async (ev) => {
    if (!confirm('参加者全員に「誰が誰に送る」通知を送信します。よろしいですか?')) return;
    ev.currentTarget.disabled = true;
    try {
      const r = await post(`/api/groups/${gid}/settle`, { kind: 'transfer' });
      toast(`${r.sent} 人に通知しました`);
      root.hidden = true; root.innerHTML = '';
    } catch (e) { toast('失敗: ' + e.message); ev.currentTarget.disabled = false; }
  });
}

// Called from loadDetail() after members are known.
function setWariMembers(members) {
  wariMembers = members;
  wariFor = new Set(members.map(m => m.id));
  renderWariForm();
}

async function onPost(gid) {
  const body = document.getElementById('gd-body')?.value.trim() || null;
  const url  = document.getElementById('gd-url')?.value.trim() || null;
  const time = document.getElementById('gd-time')?.value || null;
  const payload = { kind: currentKind, body };
  if (currentKind === 'url')  payload.url = url;
  if (currentKind === 'time') payload.scheduled_at = time;
  if (currentKind === 'memo' && !body)               { toast('メモを入力してください'); return; }
  if (currentKind === 'url'  && !url)                { toast('URL を入力してください'); return; }
  if (currentKind === 'time' && !time)               { toast('時間を入力してください'); return; }
  try {
    await post(`/api/groups/${gid}/items`, payload);
    if (document.getElementById('gd-body'))  document.getElementById('gd-body').value = '';
    if (document.getElementById('gd-url'))   document.getElementById('gd-url').value  = '';
    if (document.getElementById('gd-time'))  document.getElementById('gd-time').value = '';
    toast('投稿しました');
    await loadDetail(gid);
  } catch (e) { toast('失敗: ' + e.message); }
}

// ─── スケジュール / 行程 ─────────────────────────────────────────────
// 日程範囲 (開始日 〜 終了日) を持ち、 範囲内の各日に時刻付きアイテムを並べる。
// 種類は ✈️ 移動 / 🏨 宿 / 🎓 学会 / 👥 会議 / 🍽 食事 / 🎢 観光 / 📝 その他。

// 種類順は dropdown 並び順とも兼ねる。 移動系は同じ 「移動」 グループとして
// 上のかたまりで表示。 旧 'move' は後方互換のため表示時のみハンドリング。
let schedEditMode = false;
let schedPairSlots = {};
let schedPairMaxSlot = -1;
const SCHED_KINDS = {
  flight:  { label: '飛行機', icon: '✈️' },
  train:   { label: '電車',   icon: '🚆' },
  bus:     { label: 'バス',   icon: '🚌' },
  taxi:    { label: 'タクシー', icon: '🚖' },
  car:     { label: '車',     icon: '🚗' },
  walk:    { label: '徒歩',   icon: '🚶' },
  hotel:   { label: '宿',     icon: '🏨' },
  conf:    { label: '学会',   icon: '🎓' },
  meeting: { label: '会議',   icon: '👥' },
  food:    { label: '食事',   icon: '🍽' },
  fun:     { label: '観光',   icon: '🎢' },
  other:   { label: 'その他', icon: '📝' },
  move:    { label: '移動',   icon: '🚐' }, // legacy fallback
};

async function loadSchedule(gid) {
  const card = document.getElementById('gd-sched-card');
  const body = document.getElementById('gd-sched-body');
  if (!card || !body) return;
  // 編集モード ボタンの label を現在状態に同期。
  const emBtn = document.getElementById('gd-sched-editmode');
  if (emBtn) {
    emBtn.textContent = schedEditMode ? '完了' : '編集モード';
    emBtn.classList.toggle('primary', schedEditMode);
  }
  let d;
  try { d = await get(`/api/groups/${gid}/schedule`); }
  catch (e) { card.hidden = false; body.textContent = '取得失敗: ' + e.message; return; }
  card.hidden = false;
  if (!d.start_date || !d.end_date) {
    body.innerHTML = `<div class="empty" style="padding:8px">日程未設定。 右上 「日程設定」 から 開始日〜終了日 を入れると 各日のカードが並びます。</div>`;
    return;
  }
  // 日付範囲を 1 日ずつ展開。 toISOString は UTC に変換してしまい JST 環境で
  // 1 日前にズレるバグの元。 文字列のまま素直に +1 する。
  const addOneDay = (s) => {
    const [y, m, dd] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, dd);
    dt.setDate(dt.getDate() + 1);
    const p = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  };
  const days = [];
  let cur = d.start_date;
  while (cur <= d.end_date) {
    days.push(cur);
    cur = addOneDay(cur);
  }
  // end_date がある (= 複数日に渡る) アイテムは、 当日・終了日・(宿泊の中間日)
  // に展開して each day に並べる。 元の id をそのまま保持し、 _occ で
  // 「'start' / 'mid' / 'end'」 のロールを付ける (描画時に label を出し分け)。
  const byDay = {};
  for (const it of (d.items || [])) {
    const start = it.day_date;
    const end   = it.end_date;
    if (!end || end === start) {
      (byDay[start] ||= []).push({ ...it, _occ: 'single' });
      continue;
    }
    // 範囲展開
    const addOne = (s) => {
      const [y, m, dd] = s.split('-').map(Number);
      const dt = new Date(y, m - 1, dd); dt.setDate(dt.getDate() + 1);
      const p = (n) => String(n).padStart(2, '0');
      return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}`;
    };
    let cur = start;
    while (cur <= end) {
      const occ = cur === start ? 'start' : (cur === end ? 'end' : 'mid');
      (byDay[cur] ||= []).push({ ...it, _occ: occ });
      cur = addOne(cur);
    }
  }
  // ペア id ごとに 「上 / 下」 のタグを付ける (描画時に 🔗 + 相手の日付/時刻 を出す)。
  const pairs = {};
  for (const it of (d.items || [])) {
    if (it.link_pair_id) (pairs[it.link_pair_id] ||= []).push(it);
  }
  const pairPartner = {};
  Object.values(pairs).forEach(arr => {
    if (arr.length !== 2) return; // 2 つペアでだけ機能 (3 つ以上は無視)
    arr.sort((a, b) => (a.day_date + (a.start_time || '99:99')).localeCompare(
                       b.day_date + (b.start_time || '99:99')));
    pairPartner[arr[0].id] = { partner: arr[1], side: 'first' };
    pairPartner[arr[1].id] = { partner: arr[0], side: 'second' };
  });
  // 帯の被り対策: 各 pair_id を 「最初に出現する日 + 開始時刻」 順に sort
  // してスロット番号 (0, 1, 2, ...) を割り振る。 同時刻が重なる時は別の
  // pair_id でも 右側にズレて描かれるので帯が混ざらない。
  const pairSlots = {};
  Object.entries(pairs)
    .filter(([, arr]) => arr.length === 2)
    .sort(([, a], [, b]) => {
      const aKey = a[0].day_date + (a[0].start_time || '99:99');
      const bKey = b[0].day_date + (b[0].start_time || '99:99');
      return aKey.localeCompare(bKey);
    })
    .forEach(([pid], idx) => { pairSlots[pid] = idx; });
  schedPairSlots = pairSlots;
  schedPairMaxSlot = Math.max(-1, ...Object.values(pairSlots));
  const dayLabels = ['日','月','火','水','木','金','土'];
  body.innerHTML = `
    <div class="hint-sm" style="margin-bottom:6px">${escapeHtml(d.start_date)} 〜 ${escapeHtml(d.end_date)} (${days.length} 日)</div>
    ${days.map(date => {
      const dow = dayLabels[new Date(date + 'T00:00:00').getDay()];
      const md  = date.slice(5).replace('-', '/');
      const items = byDay[date] || [];
      return `
        <details class="card collapsible-sub" data-day="${date}" open style="margin:6px 0; padding:8px 10px">
          <summary style="font-weight:700">${md} (${dow}) <span class="hint-sm">— ${items.length} 件</span></summary>
          <div class="schedule-items" style="margin-top:6px">
            ${items.map(it => renderSchedItem(it, pairPartner[it.id])).join('') || '<div class="empty" style="padding:6px">アイテム無し</div>'}
          </div>
          <button class="btn primary" data-add-sched-day="${date}" style="margin-top:6px; padding:4px 10px; font-size:12px">＋ 追加</button>
        </details>`;
    }).join('')}
  `;
  // 「+ 追加」 ボタン
  body.querySelectorAll('[data-add-sched-day]').forEach(b => {
    b.addEventListener('click', () => openSchedItemModal(gid, { day_date: b.dataset.addSchedDay }));
  });
  // タップ全体で編集 (リンクや内蔵ボタンは別途 stopPropagation)
  body.querySelectorAll('[data-sched-item]').forEach(el => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.schedItem);
      const it = (d.items || []).find(x => Number(x.id) === id);
      if (it) openSchedItemModal(gid, it);
    });
  });
  // 編集モード ON の時だけ ↑ ↓ × ボタンが出る。
  body.querySelectorAll('[data-sched-rm]').forEach(b => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm('この予定を削除しますか?')) return;
      try { await del(`/api/groups/${gid}/schedule/${b.dataset.schedRm}`); await loadSchedule(gid); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  });
  body.querySelectorAll('[data-sched-move]').forEach(b => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        await patch(`/api/groups/${gid}/schedule/${b.dataset.schedMove}/move`, { dir: b.dataset.dir });
        await loadSchedule(gid);
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
}

// ペア id を hash 化して安定した色相を返す。 同じ pair_id = 同じ色 → 上下
// 離れた日にあっても 「これは繋がってる」 と一目で分かる薄い帯。
function schedPairColor(pid) {
  let h = 0;
  for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsla(${hue}, 70%, 50%, 0.35)`;
}

function renderSchedItem(it, pairInfo) {
  const k = SCHED_KINDS[it.kind] || SCHED_KINDS.other;
  // 複数日展開: start / mid / end によって 時刻と接尾語を変える。
  const isHotel = (it.kind === 'hotel');
  let timeStr = '';
  let roleSuffix = '';
  if (it._occ === 'start') {
    if (it.start_time) timeStr = it.start_time.slice(0, 5);
    if (it.end_date && it.end_date !== it.day_date) {
      roleSuffix = isHotel ? ' チェックイン' : ' 出発';
    }
  } else if (it._occ === 'end') {
    if (it.end_time) timeStr = it.end_time.slice(0, 5);
    roleSuffix = isHotel ? ' チェックアウト' : ' 到着';
  } else if (it._occ === 'mid') {
    roleSuffix = ' (滞在中)';
  } else {
    // single
    if (it.start_time) {
      const t = it.start_time.slice(0, 5);
      if (it.end_time) {
        timeStr = `${t}〜${it.end_time.slice(0, 5)}`;
      } else if (it.duration_minutes) {
        const startMs = Date.parse(`2000-01-01T${it.start_time}`);
        const endDt = new Date(startMs + it.duration_minutes * 60000);
        const eh = String(endDt.getHours()).padStart(2, '0');
        const em = String(endDt.getMinutes()).padStart(2, '0');
        timeStr = `${t}〜${eh}:${em}`;
      } else {
        timeStr = t;
      }
    }
  }
  const isMid = it._occ === 'mid';
  // ペア表示: 🔗 アイコンと相手の 「日付・時刻」 を出す。
  let pairBadge = '';
  if (pairInfo && pairInfo.partner) {
    const p = pairInfo.partner;
    const pTime = (p.start_time || '').slice(0, 5);
    const arrow = pairInfo.side === 'first' ? '→' : '←';
    pairBadge = `<span class="muted" style="font-size:10px; margin-left:4px">🔗 ${arrow} ${escapeHtml(p.day_date.slice(5).replace('-', '/'))}${pTime ? ' ' + pTime : ''}</span>`;
  }
  // 画像があれば左に 60px 角でかっこよく出す。 タップは行全体に乗ってる
  // ので画像クリックも編集を開く (拡大表示したい時は edit modal から飛ぶ)。
  const thumb = it.image_url
    ? `<div style="width:60px; height:60px; flex-shrink:0; background:#f1f1f4 center/cover no-repeat url('${escapeHtml(it.image_url)}'); border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.08)"></div>`
    : `<span style="font-size:22px; line-height:1; width:32px; text-align:center; flex-shrink:0">${k.icon}</span>`;
  const urlIcon = it.url
    ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--primary); margin-left:4px">🔗</a>`
    : '';
  // 1 行目: アイコン + タイトル + 時刻
  // 2 行目: 場所 / メモ / URL (溢れたら 1 行で切る)
  const line2bits = [];
  if (it.location) line2bits.push(`📍 ${escapeHtml(it.location)}`);
  if (it.memo)     line2bits.push(escapeHtml(it.memo).replace(/\n/g, ' '));
  const line2 = line2bits.length
    ? `<div class="meta" style="font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${line2bits.join(' · ')}${urlIcon}</div>`
    : (urlIcon ? `<div class="meta">${urlIcon}</div>` : '');
  // 編集モード ON だけ ボタンを出す。 OFF 時は完全に隠す (アイテム自体が
  // タップ可能で edit modal が開く)。
  const editControls = schedEditMode ? `
    <div style="display:flex; flex-direction:column; gap:2px; align-items:center; margin-left:4px">
      <button data-sched-move="${it.id}" data-dir="up"   class="btn" style="padding:0 6px; font-size:11px">↑</button>
      <button data-sched-move="${it.id}" data-dir="down" class="btn" style="padding:0 6px; font-size:11px">↓</button>
      <button data-sched-rm="${it.id}" class="btn" style="padding:0 6px; font-size:12px; color:var(--muted)">×</button>
    </div>` : '';
  // ペア帯: link_pair_id があれば 行の右端 30px 内側に 10px 幅の半透明縦
  // ストリップを敷く。 ペアが複数ある時 (slot N) は 30 + N*14 px に
  // ずらして 縦に並ぶ別ペアの帯と被らないように。
  const pairSlot = it.link_pair_id ? (schedPairSlots[it.link_pair_id] ?? 0) : 0;
  const pairRight = 30 + pairSlot * 14;
  const pairStrip = it.link_pair_id
    ? `<div aria-hidden="true" style="position:absolute; right:${pairRight}px; top:0; bottom:0; width:10px; background:${schedPairColor(it.link_pair_id)}; border-radius:5px; pointer-events:none"></div>`
    : '';
  // 縦幅 2 行分で固定 (画像 56px + 上下 padding でだいたい 68px)。 1 行で
  // 済むアイテムも空きスペースに揃って並ぶので見た目がきれい。
  // 2 行目 (line2) は空でも HTML 上は存在させる。
  const line2Slot = line2 || '<div class="meta" style="height:14px"></div>';
  // ペア帯のぶん右側に余白を確保。 ペアが無いアイテムも 帯がある列が
  // 揃うよう、 同じグループの最大スロットぶんだけ余白を取る。
  const rightPad = schedPairMaxSlot >= 0
    ? `padding-right:${30 + (schedPairMaxSlot + 1) * 14 + 8}px;`
    : '';
  return `
    <div class="list-item" data-sched-item="${it.id}"
         style="gap:8px; padding:6px 8px; ${rightPad} align-items:center; cursor:pointer; min-height:68px; position:relative; ${isMid ? 'opacity:0.55' : ''}">
      ${thumb}
      <div class="grow" style="min-width:0; overflow:hidden">
        <div class="bold" style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
          ${escapeHtml(it.title)}${roleSuffix ? `<span class="muted" style="font-weight:400">${roleSuffix}</span>` : ''}${timeStr ? ` <span class="muted" style="font-weight:400">${timeStr}</span>` : ''}${pairBadge}
        </div>
        ${line2Slot}
      </div>
      ${editControls}
      ${pairStrip}
    </div>`;
}

function openSchedRangeModal(gid) {
  const root = document.getElementById('gd-sched-modal');
  if (!root) return;
  // 既存値は loadSchedule で表示済みだが、 modal を出す時もう一度取りに行く。
  root.hidden = false;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" id="srm-overlay">
      <div style="background:#fff; border-radius:14px; max-width:420px; width:100%; padding:20px">
        <div class="row center">
          <h3 class="row-title">日程設定</h3>
          <button id="srm-close">×</button>
        </div>
        <label class="field"><span class="lbl">開始日</span><input type="date" id="srm-start"></label>
        <label class="field"><span class="lbl">終了日</span><input type="date" id="srm-end"></label>
        <div class="hint-sm" style="margin:4px 0 8px">空欄で保存すると日程をクリア (アイテムは残ります)</div>
        <div class="row" style="gap:6px; justify-content:flex-end">
          <button id="srm-cancel">キャンセル</button>
          <button id="srm-save" class="primary">保存</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  document.getElementById('srm-close') .addEventListener('click', close);
  document.getElementById('srm-cancel').addEventListener('click', close);
  document.getElementById('srm-overlay').addEventListener('click', e => { if (e.target.id === 'srm-overlay') close(); });
  // 現在値を流し込む
  (async () => {
    try {
      const d = await get(`/api/groups/${gid}/schedule`);
      if (d.start_date) document.getElementById('srm-start').value = d.start_date;
      if (d.end_date)   document.getElementById('srm-end')  .value = d.end_date;
    } catch (_) {}
  })();
  document.getElementById('srm-save').addEventListener('click', async () => {
    const s = document.getElementById('srm-start').value || null;
    const e = document.getElementById('srm-end')  .value || null;
    if (s && e && e < s) { toast('終了日が開始日より前です'); return; }
    try {
      await patch(`/api/groups/${gid}`, { schedule_start_date: s, schedule_end_date: e });
      toast('保存しました');
      close();
      await loadSchedule(gid);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

function openSchedItemModal(gid, it) {
  const root = document.getElementById('gd-sched-modal');
  if (!root) return;
  const isNew = !it.id;
  const kindOpts = Object.entries(SCHED_KINDS)
    // legacy move は新規 dropdown には出さない (互換表示専用)。
    .filter(([k]) => k !== 'move' || it.kind === 'move')
    .map(([k, v]) => `<option value="${k}" ${it.kind === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('');
  // 現在の image_url を staged 値として持ち回す (アップロードで書き換わる)。
  let stagedImage = it.image_url || '';
  root.hidden = false;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" id="sim-overlay">
      <div style="background:#fff; border-radius:14px; max-width:480px; width:100%; padding:20px">
        <div class="row center">
          <h3 class="row-title">${isNew ? '予定を追加' : '予定を編集'}</h3>
          <button id="sim-close">×</button>
        </div>
        <label class="field"><span class="lbl">日付</span>
          <input type="date" id="sim-date" value="${escapeHtml(it.day_date || '')}">
        </label>
        <label class="field"><span class="lbl">タイトル</span>
          <input type="text" id="sim-title" maxlength="200" value="${escapeHtml(it.title || '')}" autofocus>
        </label>
        <label class="field"><span class="lbl">種類</span>
          <select id="sim-kind">${kindOpts}</select>
        </label>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:120px"><span class="lbl">開始時刻 (任意)</span>
            <input type="time" id="sim-start" value="${escapeHtml((it.start_time || '').slice(0, 5))}">
          </label>
          <label class="field" style="flex:1; min-width:120px"><span class="lbl">長さ (分・任意)</span>
            <input type="number" id="sim-dur" min="0" step="15" value="${it.duration_minutes || ''}">
          </label>
        </div>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:120px"><span class="lbl">終了日 (任意・宿泊や夜行便)</span>
            <input type="date" id="sim-end-date" value="${escapeHtml(it.end_date || '')}">
          </label>
          <label class="field" style="flex:1; min-width:120px"><span class="lbl">終了時刻 (任意)</span>
            <input type="time" id="sim-end-time" value="${escapeHtml((it.end_time || '').slice(0, 5))}">
          </label>
        </div>
        <label class="field"><span class="lbl">場所 (任意)</span>
          <input type="text" id="sim-loc" maxlength="500" value="${escapeHtml(it.location || '')}">
        </label>
        <label class="field"><span class="lbl">URL (任意)</span>
          <input type="url" id="sim-url" maxlength="2000" placeholder="https://..." value="${escapeHtml(it.url || '')}">
        </label>
        <label class="field"><span class="lbl">画像 (任意)</span>
          <div class="row" style="gap:6px; flex-wrap:wrap; align-items:center">
            <input type="file" id="sim-img-file" accept="image/*" style="font-size:12px">
            <button id="sim-img-clear" type="button" class="btn" style="padding:2px 8px; font-size:11px" ${stagedImage ? '' : 'hidden'}>削除</button>
            <span id="sim-img-status" class="hint-sm"></span>
          </div>
          <img id="sim-img-preview" alt="" ${stagedImage ? `src="${escapeHtml(stagedImage)}"` : 'hidden'}
               style="max-width:140px; max-height:140px; margin-top:6px; border-radius:8px; object-fit:cover; display:${stagedImage ? 'block' : 'none'}; border:1px solid var(--line)">
        </label>
        <label class="field"><span class="lbl">メモ (任意)</span>
          <textarea id="sim-memo" maxlength="2000" rows="3">${escapeHtml(it.memo || '')}</textarea>
        </label>
        <div class="hint-sm" style="margin:6px 0">
          ${it.link_pair_id ? '🔗 別の予定とリンク済 (片方を消すとリンクが切れます)' : '保存後 「🔗 リンクペアを追加」 ボタンで 出発便 → 到着便 など 2 つの予定を連結できます。'}
        </div>
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px; flex-wrap:wrap">
          ${!isNew ? `<button id="sim-pair-add" type="button" class="btn">🔗 リンクペアを追加</button>` : ''}
          ${(!isNew && it.link_pair_id) ? `<button id="sim-pair-clear" type="button" class="btn">リンク解除</button>` : ''}
          <button id="sim-cancel">キャンセル</button>
          <button id="sim-save" class="primary">保存</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  document.getElementById('sim-close') .addEventListener('click', close);
  document.getElementById('sim-cancel').addEventListener('click', close);
  document.getElementById('sim-overlay').addEventListener('click', e => { if (e.target.id === 'sim-overlay') close(); });
  // 画像アップロード / クリア
  document.getElementById('sim-img-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const st = document.getElementById('sim-img-status');
    st.textContent = 'アップロード中…';
    try {
      const data = await uploadImage(f);
      stagedImage = data.url;
      const pv = document.getElementById('sim-img-preview');
      pv.src = data.url; pv.hidden = false; pv.style.display = 'block';
      document.getElementById('sim-img-clear').hidden = false;
      st.textContent = '✓';
    } catch (e) { st.textContent = '失敗: ' + e.message; }
  });
  document.getElementById('sim-img-clear').addEventListener('click', () => {
    stagedImage = '';
    const pv = document.getElementById('sim-img-preview');
    pv.src = ''; pv.hidden = true; pv.style.display = 'none';
    document.getElementById('sim-img-file').value = '';
    document.getElementById('sim-img-clear').hidden = true;
  });
  document.getElementById('sim-save').addEventListener('click', async () => {
    const body = {
      day_date:        document.getElementById('sim-date').value,
      title:           document.getElementById('sim-title').value.trim(),
      kind:            document.getElementById('sim-kind').value,
      start_time:      document.getElementById('sim-start').value || null,
      end_time:        document.getElementById('sim-end-time').value || null,
      end_date:        document.getElementById('sim-end-date').value || null,
      duration_minutes: document.getElementById('sim-dur').value || null,
      location:        document.getElementById('sim-loc').value.trim() || null,
      url:             document.getElementById('sim-url').value.trim() || null,
      image_url:       stagedImage || null,
      memo:            document.getElementById('sim-memo').value.trim() || null,
    };
    if (!body.title)    { toast('タイトルを入れてください'); return; }
    if (!body.day_date) { toast('日付を入れてください'); return; }
    try {
      if (isNew) await post(`/api/groups/${gid}/schedule`, body);
      else       await patch(`/api/groups/${gid}/schedule/${it.id}`, body);
      toast('保存しました');
      close();
      await loadSchedule(gid);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  // 🔗 リンクペアを追加: 既存アイテムに pair_id を割り振り (無ければ生成)、
  // その pair_id を持つ 新規アイテムを 「もう片方」 として作成 → modal を
  // その新規アイテム編集モードに切り替え。
  document.getElementById('sim-pair-add')?.addEventListener('click', async () => {
    let pid = it.link_pair_id;
    try {
      if (!pid) {
        pid = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        await patch(`/api/groups/${gid}/schedule/${it.id}`, { link_pair_id: pid });
      }
      const newBody = {
        day_date:   it.day_date,
        title:      it.title,
        kind:       it.kind,
        link_pair_id: pid,
      };
      const r = await post(`/api/groups/${gid}/schedule`, newBody);
      close();
      await loadSchedule(gid);
      // 新規アイテムを編集 modal で開く (時刻 / 日付などを埋めてもらう)。
      openSchedItemModal(gid, { ...newBody, id: r.id });
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('sim-pair-clear')?.addEventListener('click', async () => {
    if (!confirm('リンクを解除しますか? (アイテムは残ります)')) return;
    try {
      await patch(`/api/groups/${gid}/schedule/${it.id}`, { link_pair_id: null });
      close();
      await loadSchedule(gid);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
