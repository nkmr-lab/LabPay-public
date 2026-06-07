// /#/groups — list + create. /#/groups/{id} — detail with feed + ワリカ +
// member-context shortcuts for ルーレット / 飲み会割り勘.

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast, refreshHasGroups } from '../app.js';
import { uploadImage } from '../upload.js';
import { fmtDateTime, participantPill } from '../format.js';
import { isAppVisible } from './apps.js';
import { createMemberPicker } from '../member_picker.js';

const GRADE_ORDER = ['D','M2','M1','B4','B3',''];

// v340 グループ詳細ヘッダの アクションボタン 8 個の定義 (順番もここの並びを保持)。
// feat_actions JSON 配列の値はこの id。 receipt / expense は wari に依存するので
// feat_wari が OFF なら 強制的に hidden。
const GROUP_ACTIONS = [
  { id: 'receipt',   label: '📷 レシート',       wariDep: true  },
  { id: 'expense',   label: '＋ 支出を記録',     wariDep: true  },
  { id: 'roulette',  label: '🎰 ルーレット',     wariDep: false },
  { id: 'nomikai',   label: '🍶 飲み会割り勘',   wariDep: false },
  { id: 'polls',     label: '📊 投票・アンケート', wariDep: false },
  { id: 'rollcalls', label: '📣 点呼',           wariDep: false },
  { id: 'timers',    label: '⏱️ タイマー',       wariDep: false },
  { id: 'meetups',   label: '🤝 待ち合わせ',     wariDep: false },
  { id: 'translate', label: '🌐 画像翻訳',       wariDep: false },
];
// アクションが有効か (g.feat_actions が null = 「全 ON」、 配列ならその中に含まれる物)
function actionEnabled(g, id) {
  const list = g?.feat_actions;
  if (list === null || list === undefined) return true; // 後方互換
  return Array.isArray(list) && list.includes(id);
}
// v385 ユーザの アプリ表示設定 とも 重ね合わせる (apps id と groups action id が一致するもの)。
// receipt / expense は アプリ メニューに無いので 常に true。
function actionShownForUser(id) {
  const APP_LINKED = ['roulette','nomikai','polls','rollcalls','timers','meetups','translate'];
  if (!APP_LINKED.includes(id)) return true;
  return isAppVisible(id);
}

// v475 招待URL 経由 で 参加 (= /#/groups/join/{token})。 POST 一発 で 参加 して
// グループ詳細 に 遷移。 失効済 / 404 は エラー カード を 表示。
export async function renderGroupJoin({ params }) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">🔗 グループ に 参加</h2>
      <div id="gj-body" class="hint">参加処理中…</div>
    </div>`;
  try {
    const r = await post(`/api/groups/join/${encodeURIComponent(params.token)}`, {});
    toast(`グループ「${r.title || ''}」 に 参加しました`);
    navigate('#/groups/' + r.group_id);
  } catch (e) {
    document.getElementById('gj-body').innerHTML =
      `<div class="muted">${escapeHtml(e.message || '失敗')}</div>` +
      `<div style="margin-top:10px"><a href="#/groups" class="btn">← グループ 一覧 へ</a></div>`;
  }
}

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
      <div class="field">
        <span class="lbl">使う機能 (後から ON/OFF 可)</span>
        <div class="hint-sm" style="margin-bottom:4px">必要なものだけ ON に。 OFF にしても 既に登録したデータは残ります。</div>
        <label style="display:flex; align-items:center; gap:8px; margin:4px 0">
          <span class="switch"><input type="checkbox" id="gr-feat-sched"><span class="slider"></span></span>
          <span>📅 スケジュール (学会・出張など)</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin:4px 0">
          <span class="switch"><input type="checkbox" id="gr-feat-lodging"><span class="slider"></span></span>
          <span>🏨 宿泊地</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin:4px 0">
          <span class="switch"><input type="checkbox" id="gr-feat-flight"><span class="slider"></span></span>
          <span>✈️ 航空券</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin:4px 0">
          <span class="switch"><input type="checkbox" id="gr-feat-wari" checked><span class="slider"></span></span>
          <span>💴 ワリカ (立替を積み上げ → 精算)</span>
        </label>
        <div class="hint" style="margin-top:6px; margin-bottom:4px">アクションボタンの 表示</div>
        <div id="gr-feat-actions"></div>
      </div>
      <button id="gr-submit" class="primary">作成</button>
    </details>

    <div class="card">
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">あなたのグループ</h3>
        <label class="hint-sm" style="display:inline-flex; align-items:center; gap:4px; font-size:12px">
          <input type="checkbox" id="gr-show-closed"> 終了も表示
        </label>
      </div>
      <div id="gr-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  // 終了表示トグル: localStorage に保存
  const showClosedCb = document.getElementById('gr-show-closed');
  showClosedCb.checked = localStorage.getItem('labpay-gr-show-closed') === '1';
  showClosedCb.addEventListener('change', () => {
    localStorage.setItem('labpay-gr-show-closed', showClosedCb.checked ? '1' : '0');
    loadList();
  });
  await populatePicker();
  // アクション 8 個のチェックボックスを並べる (デフォルト全 ON)
  const actBox = document.getElementById('gr-feat-actions');
  if (actBox) {
    actBox.innerHTML = GROUP_ACTIONS.map(a => `
      <label style="display:flex; align-items:center; gap:8px; margin:2px 0">
        <span class="switch"><input type="checkbox" data-act="${a.id}" checked><span class="slider"></span></span>
        <span>${a.label}</span>
      </label>`).join('');
  }
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

// v385 共有 member_picker。 createMemberPicker が selected を 内部で持つので、
// onCreate から picker.getSelected() で吸い上げる形に。
let grPicker = null;

async function populatePicker() {
  grPicker = await createMemberPicker({
    bulkContainer: document.getElementById('gr-bulk'),
    chipsContainer: document.getElementById('gr-picker'),
    countLabel:    document.getElementById('gr-count'),
    showGenderBulk: true,
  });
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
  const feat_schedule = document.getElementById('gr-feat-sched').checked;
  const feat_lodging  = document.getElementById('gr-feat-lodging').checked;
  const feat_flight   = document.getElementById('gr-feat-flight').checked;
  const feat_wari     = document.getElementById('gr-feat-wari').checked;
  const feat_actions = [...document.querySelectorAll('#gr-feat-actions input[data-act]')]
    .filter(cb => cb.checked).map(cb => cb.dataset.act);
  try {
    const r = await post('/api/groups', {
      title, description, slug, image_url, member_ids: grPicker ? [...grPicker.getSelected()] : [],
      feat_schedule, feat_lodging, feat_flight, feat_wari, feat_actions,
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
export function coverListItem({ href, image_url, title, meta = '', rightExtra = '', members = null, chipSize = 'xs' }) {
  // v374 メンバ行: 名前は出さず avatar のみ 並べる (狭いリスト幅を 圧迫しない)。
  // 8 人まで並べて、 9 人以上は 「+N」 / 末尾に (N人)。
  // v396 ホーム用に chipSize='sm' を 受けられるよう 引数化 (デフォは 従来の xs)。
  const memberRow = (Array.isArray(members) && members.length)
    ? `<div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:4px; align-items:center">
         ${members.slice(0, 8).map(m =>
           `<span title="${escapeHtml(m.display_name)}" style="display:inline-flex">
              ${avatarHtml(m.display_name, m.avatar_url, chipSize)}
            </span>`).join('')}
         ${members.length > 8 ? `<span class="muted" style="font-size:11px">+${members.length - 8}</span>` : ''}
         <span class="muted" style="font-size:11px; margin-left:auto">(${members.length}人)</span>
       </div>`
    : '';
  const metaBlock = meta ? `<div class="meta">${meta}</div>` : '';
  if (image_url) {
    // v372 グループ / 募集は hero 修飾を付けて 64% 表紙 + 斜めカット に。
    return `
      <a class="list-item with-cover hero" href="${href}">
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
    const showClosed = localStorage.getItem('labpay-gr-show-closed') === '1';
    const items = showClosed ? d.items : d.items.filter(g => !g.closed_at);
    if (!items.length) {
      root.innerHTML = showClosed
        ? `<div class="empty">グループはありません</div>`
        : `<div class="empty">進行中のグループはありません${d.items.length ? ' (終了したものは 「終了も表示」 で見られます)' : ''}</div>`;
      return;
    }
    root.innerHTML = items.map(g => coverListItem({
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

    <details class="card" id="gd-lodging-card" hidden>
      <summary style="font-weight:700; cursor:pointer">🏨 宿泊地 <span id="gd-lodging-count" class="hint-sm"></span></summary>
      <div id="gd-lodging-list" style="margin-top:8px"></div>
      <button id="gd-lodging-add" class="btn primary" style="margin-top:6px; padding:4px 10px; font-size:12px">＋ 宿泊地を追加</button>
    </details>
    <details class="card" id="gd-flight-card" hidden>
      <summary style="font-weight:700; cursor:pointer">✈️ 航空券 <span id="gd-flight-count" class="hint-sm"></span></summary>
      <div id="gd-flight-list" style="margin-top:8px"></div>
      <button id="gd-flight-add" class="btn primary" style="margin-top:6px; padding:4px 10px; font-size:12px">＋ 航空券を追加</button>
    </details>
    <div id="gd-lodging-modal" hidden></div>
    <div id="gd-flight-modal" hidden></div>

    <details class="card" id="gd-sched-card" hidden open>
      <summary style="cursor:pointer; list-style:none">
        <div class="row center" style="margin-bottom:6px">
          <h3 class="row-title" style="margin:0">📅 スケジュール</h3>
          <div class="row" style="gap:6px">
            <button id="gd-sched-editmode" class="btn" style="padding:2px 10px; font-size:12px" onclick="event.stopPropagation()">編集モード</button>
            <button id="gd-sched-range" class="btn" style="padding:2px 10px; font-size:12px" onclick="event.stopPropagation()">日程設定</button>
          </div>
        </div>
      </summary>
      <div id="gd-sched-body" class="muted" style="font-size:13px">読み込み中…</div>
    </details>
    <div id="gd-sched-modal" hidden></div>

    <div class="card" id="gd-wari-card">
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">ワリカ</h3>
        <div class="row" style="gap:6px">
          <button id="gd-settle" class="primary">精算する</button>
        </div>
      </div>
      <p class="muted" style="font-size:13px; margin:6px 0">
        立替えた支出を積み上げて、 最後にまとめて精算 (貸し借り) します。
      </p>
      <h4 style="margin:8px 0 4px">支払いの記録</h4>
      <div id="gd-wari-summary" class="muted" style="font-size:13px">読み込み中…</div>
      <div id="gd-wari-list" class="list" style="margin-top:4px"></div>
    </div>
    <div id="gd-wari-form-modal" hidden></div>

    <div class="card" id="gd-spend-card" hidden>
      <h3 style="margin:0">支出情報 (個々人)</h3>
      <p class="muted" style="font-size:13px; margin:6px 0">
        各人が「使った額」(参加した支出の自分の取り分) と「立替えた額」 (払った合計)。
      </p>
      <div id="gd-spend-list" class="list"></div>
    </div>

    <details class="card" id="gd-tr-card">
      <summary style="font-weight:700; cursor:pointer">📚 翻訳ログ <span id="gd-tr-count" class="hint-sm"></span></summary>
      <p class="hint-sm" style="margin:6px 0 4px">出張先などで メニュー / 看板を 撮って 全員で 共有。</p>
      <div class="row" style="gap:6px; margin:6px 0; flex-wrap:wrap">
        <a id="gd-tr-add" class="btn primary" style="padding:2px 10px; font-size:12px">🌐 このグループで 新規 翻訳</a>
      </div>
      <div id="gd-tr-list" class="list"></div>
    </details>

    <details class="card" id="gd-chat-card">
      <summary style="font-weight:700; cursor:pointer">💬 チャット <span id="gd-chat-status" class="hint-sm"></span></summary>
      <div id="gd-chat-list" style="max-height:280px; min-height:140px; overflow-y:auto; padding:6px; background:#f6f6f9; border-radius:8px; display:flex; flex-direction:column; gap:6px; margin-top:6px">
        <div class="muted" style="text-align:center; padding:20px 0">読み込み中…</div>
      </div>
      <div class="row" style="gap:6px; margin-top:6px; align-items:flex-end">
        <textarea id="gd-chat-input" rows="1" maxlength="2000" placeholder="メッセージを送る (Enter で送信、 Shift+Enter で改行)"
                  style="flex:1; resize:none; min-height:36px; max-height:120px; font-size:14px"></textarea>
        <button id="gd-chat-send" class="primary" style="padding:6px 14px">送信</button>
      </div>
    </details>

    <details class="card" id="gd-feat-card" hidden>
      <summary style="font-weight:700; cursor:pointer">⚙ 使う機能の設定</summary>
      <p class="hint" style="margin:8px 0 8px">
        必要なものだけ ON に。 OFF にしても 既に登録したデータは残ります。
      </p>
      <label style="display:flex; align-items:center; gap:8px; margin:4px 0">
        <span class="switch"><input type="checkbox" id="gd-feat-sched"><span class="slider"></span></span>
        <span>📅 スケジュール</span>
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin:4px 0">
        <span class="switch"><input type="checkbox" id="gd-feat-lodging"><span class="slider"></span></span>
        <span>🏨 宿泊地</span>
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin:4px 0">
        <span class="switch"><input type="checkbox" id="gd-feat-flight"><span class="slider"></span></span>
        <span>✈️ 航空券</span>
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin:4px 0">
        <span class="switch"><input type="checkbox" id="gd-feat-wari"><span class="slider"></span></span>
        <span>💴 ワリカ</span>
      </label>
      <div class="hint" style="margin-top:10px; margin-bottom:4px">アクションボタンの 表示</div>
      <div id="gd-feat-actions"></div>
    </details>

    <div class="card" id="gd-danger-card" hidden>
      <p class="muted" style="font-size:13px; margin:0 0 8px">
        閉鎖してもデータは残ります。 新規投稿・ワリカ追加ができなくなるだけ。
      </p>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="gd-close" class="danger">グループを閉鎖する</button>
        <button id="gd-hard-delete" class="danger" hidden>🗑 完全削除</button>
      </div>
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
  // v491 #91 gd-snap-expense は loadDetail で gd-head に注入 される ので、 ここで
  //   bind すると 要素 が まだ 無く no-op に なる (= 「支出を 記録 で 入力 画面 が
  //   出ない」 バグ)。 bind は loadDetail 内 (receipt と 同じ 場所) で 行う。
  // スケジュールの日程設定 + 編集モード + 一覧
  document.getElementById('gd-sched-range')?.addEventListener('click', () => openSchedRangeModal(id));
  document.getElementById('gd-sched-editmode')?.addEventListener('click', () => {
    schedEditMode = !schedEditMode;
    loadSchedule(id);
  });
  await loadDetail(id);   // ← 機能フラグを取ってから 関連 loader を判断
  await loadWari(id);
  document.getElementById('gd-lodging-add')?.addEventListener('click', () => openLodgingModal(id, {}));
  document.getElementById('gd-flight-add')?.addEventListener('click', () => openFlightModal(id, {}));
  // v426 グループ 翻訳ログ
  document.getElementById('gd-tr-add')?.setAttribute('href', '#/translate?group_id=' + id);
  await loadGroupTranslations(id);
  startChatLoop(id);
}

async function loadGroupTranslations(gid) {
  const card = document.getElementById('gd-tr-card');
  const root = document.getElementById('gd-tr-list');
  const cnt  = document.getElementById('gd-tr-count');
  if (!card || !root) return;
  try {
    const d = await get('/api/ai/translations', { group_id: gid });
    const items = d.items || [];
    if (cnt) cnt.textContent = '(' + items.length + ')';
    if (!items.length) {
      root.innerHTML = '<div class="empty" style="padding:6px">まだ 翻訳は ありません</div>';
      return;
    }
    // v488 #83 翻訳結果 が 切れて 全文 見えない 問題 → <details> で 折り畳み、
    //   タップ で 全文 展開。 画像 も タップ で 拡大 (新タブ で 原寸)。
    root.innerHTML = items.map(t => {
      const full = String(t.result_text || '');
      const isLong = full.length > 120;
      const snippet = isLong ? full.slice(0, 120) + '…' : full;
      return `
        <div class="list-item" style="align-items:flex-start; gap:8px">
          <a href="${escapeHtml(t.image_url)}" target="_blank" rel="noopener" style="flex-shrink:0">
            <img src="${escapeHtml(t.image_url)}" alt="" style="width:56px; height:56px; object-fit:cover; border-radius:6px">
          </a>
          <div class="grow" style="min-width:0">
            <div class="meta" style="font-size:11px">${escapeHtml(t.user_name || '')} · ${escapeHtml(String(t.created_at || '').slice(5, 16).replace(' ', ' '))}</div>
            ${t.hint ? `<div class="meta" style="font-size:11px">💭 ${escapeHtml(t.hint)}</div>` : ''}
            ${isLong
              ? `<details style="margin-top:2px">
                   <summary style="font-size:12px; white-space:pre-wrap; line-height:1.4; cursor:pointer; list-style:revert">${escapeHtml(snippet)}</summary>
                   <div style="font-size:12px; white-space:pre-wrap; line-height:1.4; margin-top:4px; padding-top:4px; border-top:1px dashed var(--line)">${escapeHtml(full)}</div>
                 </details>`
              : `<div style="font-size:12px; white-space:pre-wrap; line-height:1.4; margin-top:2px">${escapeHtml(full)}</div>`}
          </div>
        </div>`;
    }).join('');
  } catch (_) {
    root.innerHTML = '<div class="muted" style="padding:6px; font-size:12px">取得 失敗</div>';
  }
}

// グループの 「使う機能」 フラグに応じて 関連カードの表示 + データロードを制御。
// loadDetail から呼ぶ。 後で feature を ON/OFF した時も呼び直せばよい。
function applyGroupFeatures(g) {
  const groupId = g.id;
  const schedCard = document.getElementById('gd-sched-card');
  const lodCard = document.getElementById('gd-lodging-card');
  const fltCard = document.getElementById('gd-flight-card');
  const wariCard = document.getElementById('gd-wari-card');
  if (schedCard) schedCard.hidden = !g.feat_schedule;
  if (lodCard)   lodCard.hidden   = !g.feat_lodging;
  if (fltCard)   fltCard.hidden   = !g.feat_flight;
  if (wariCard)  wariCard.hidden  = !g.feat_wari;
  if (g.feat_schedule) loadSchedule(groupId);
  if (g.feat_lodging)  loadLodgings(groupId);
  if (g.feat_flight)   loadFlights(groupId);
  // ヘッダの 「地図」 ボタンも スケジュール機能と連動 (lat/lng はスケジュールに乗るため)。
  const mapBtn = document.querySelector(`a[href="#/groups/${groupId}/map"]`);
  if (mapBtn) mapBtn.hidden = !g.feat_schedule;
  // 8 個のアクションボタン: feat_actions の null/配列に従って表示制御。 receipt と
  // expense は ワリカ依存なので feat_wari OFF なら強制 hidden。
  for (const a of GROUP_ACTIONS) {
    const el = document.querySelector(`[data-gd-act="${a.id}"]`);
    if (!el) continue;
    const allowed = actionEnabled(g, a.id) && (!a.wariDep || g.feat_wari);
    el.hidden = !allowed;
  }
  // 機能設定カード (作成者のみ表示)。 トグル変更で PATCH + 即時反映。
  const featCard = document.getElementById('gd-feat-card');
  const isCreator = state.me?.id === Number(g.creator_user_id);
  if (featCard) {
    featCard.hidden = !isCreator;
    if (isCreator) {
      document.getElementById('gd-feat-sched').checked   = !!g.feat_schedule;
      document.getElementById('gd-feat-lodging').checked = !!g.feat_lodging;
      document.getElementById('gd-feat-flight').checked  = !!g.feat_flight;
      document.getElementById('gd-feat-wari').checked    = !!g.feat_wari;
      const wire = (id, key) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.wired) return;
        el.dataset.wired = '1';
        el.addEventListener('change', async () => {
          try {
            await patch('/api/groups/' + groupId, { [key]: el.checked });
            toast('設定を更新しました');
            await loadDetail(groupId);
          } catch (e) {
            toast('失敗: ' + e.message);
            el.checked = !el.checked;
          }
        });
      };
      wire('gd-feat-sched', 'feat_schedule');
      wire('gd-feat-lodging', 'feat_lodging');
      wire('gd-feat-flight', 'feat_flight');
      wire('gd-feat-wari', 'feat_wari');
      // アクションボタンの設定 UI を作成 (初回のみ)、 トグル変更で feat_actions PATCH
      const actBox = document.getElementById('gd-feat-actions');
      if (actBox && !actBox.dataset.wired) {
        actBox.dataset.wired = '1';
        actBox.innerHTML = GROUP_ACTIONS.map(a => `
          <label style="display:flex; align-items:center; gap:8px; margin:2px 0">
            <span class="switch"><input type="checkbox" data-act="${a.id}"><span class="slider"></span></span>
            <span>${a.label}${a.wariDep ? ' <span class="muted" style="font-size:11px">(ワリカ要)</span>' : ''}</span>
          </label>`).join('');
        actBox.querySelectorAll('input[data-act]').forEach(cb => {
          cb.addEventListener('change', async () => {
            const enabled = [...actBox.querySelectorAll('input[data-act]')]
              .filter(x => x.checked).map(x => x.dataset.act);
            try {
              await patch('/api/groups/' + groupId, { feat_actions: enabled });
              toast('アクションボタンの設定を更新しました');
              await loadDetail(groupId);
            } catch (e) {
              toast('失敗: ' + e.message);
              cb.checked = !cb.checked;
            }
          });
        });
      }
      // 現在の有効状態を反映 (feat_actions=null は 全 ON)
      if (actBox) {
        actBox.querySelectorAll('input[data-act]').forEach(cb => {
          cb.checked = actionEnabled(g, cb.dataset.act);
        });
      }
    }
  }
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
    // 機能の ON/OFF。 ここで関連カードを表示制御 + 関連 loader 呼び出し。
    applyGroupFeatures(g);
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
      <div class="bold" style="font-size:18px">${escapeHtml(g.title)} ${g.closed_at ? '<span class="tag muted">終了</span>' : ''}</div>
      <div class="meta">${escapeHtml(g.creator_name)} · ${escapeHtml(fmtDateTime(g.created_at))}</div>
      ${slugRow}
      ${g.description ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px">${escapeHtml(g.description)}</div>` : ''}
      <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; align-items:center" id="gd-members-list">
        ${g.members.map(m => `<span data-gd-mem="${m.id}" style="position:relative">${participantPill(m)}</span>`).join('')}
        <button class="btn" id="gd-add-mem-btn" style="font-size:11px; padding:2px 8px">＋ メンバー追加</button>
        <button class="btn" id="gd-invite-btn"  style="font-size:11px; padding:2px 8px">🔗 招待リンク</button>
      </div>
      <div id="gd-mem-form" hidden style="margin-top:8px"></div>
      <div id="gd-invite-form" hidden style="margin-top:8px"></div>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <!-- v490 #90 レシート ボタン は 1 つ に 統合。 capture 属性 を 外して
             カメラ / フォト ライブラリ / ファイル の どれ から も 選べる ように -->
        <button class="btn primary" id="gd-snap-receipt" data-gd-act="receipt" ${actionEnabled(g, 'receipt') && g.feat_wari ? '' : 'hidden'}>📷 レシート</button>
        <button class="btn primary" id="gd-snap-expense" data-gd-act="expense" ${actionEnabled(g, 'expense') && g.feat_wari ? '' : 'hidden'}>＋ 支出を記録</button>
        <a class="btn" data-gd-act="roulette"  ${actionEnabled(g, 'roulette')  && actionShownForUser('roulette')  ? '' : 'hidden'} href="#/roulette?members=${memberIds}&title=${encodeURIComponent(g.title)}">🎰 ルーレット</a>
        <a class="btn" data-gd-act="nomikai"   ${actionEnabled(g, 'nomikai')   && actionShownForUser('nomikai')   ? '' : 'hidden'} href="#/nomikai?members=${memberIds}">🍶 割り勘</a>
        <a class="btn" data-gd-act="polls"     ${actionEnabled(g, 'polls')     && actionShownForUser('polls')     ? '' : 'hidden'} href="#/polls/new?members=${memberIds}&title=${encodeURIComponent('[' + g.title + '] ')}">📊 投票・アンケート</a>
        <a class="btn" data-gd-act="rollcalls" ${actionEnabled(g, 'rollcalls') && actionShownForUser('rollcalls') ? '' : 'hidden'} href="#/rollcalls/new?members=${memberIds}&title=${encodeURIComponent('[' + g.title + '] ')}">📣 点呼</a>
        <a class="btn" data-gd-act="timers"    ${actionEnabled(g, 'timers')    && actionShownForUser('timers')    ? '' : 'hidden'} href="#/timers/new?members=${memberIds}&title=${encodeURIComponent('[' + g.title + '] ')}">⏱️ タイマー</a>
        <a class="btn" data-gd-act="meetups"   ${actionEnabled(g, 'meetups')   && actionShownForUser('meetups')   ? '' : 'hidden'} href="#/meetups/new?members=${memberIds}&title=${encodeURIComponent('[' + g.title + '] ')}">🤝 待ち合わせ</a>
        <a class="btn" data-gd-act="translate" ${actionEnabled(g, 'translate') && actionShownForUser('translate') ? '' : 'hidden'} href="#/translate?group_id=${id}">🌐 画像翻訳</a>
        <a class="btn" ${g.feat_schedule ? '' : 'hidden'} href="#/groups/${escapeHtml(String(g.id))}/map">🗺️ 地図</a>
        <!-- v490 #90 単一 input、 capture 属性 なし → カメラ / フォト / ファイル
             の どれ から でも 選べる (端末 が 標準 で 「撮影 する」 「ライブラリ から
             選ぶ」 「ファイル から 選ぶ」 を 出す)。 -->
        <input type="file" id="gd-receipt-file" accept="image/*" hidden>
      </div>`;
    // v475 メンバー 追加 / 削除 / 招待リンク (起案者 + admin)
    const isAdmin = state.me?.role === 'admin';
    const canManageMembers = (isCreator || isAdmin) && !g.closed_at;
    const addMemBtn = document.getElementById('gd-add-mem-btn');
    const invBtn = document.getElementById('gd-invite-btn');
    if (addMemBtn) addMemBtn.style.display = canManageMembers ? '' : 'none';
    if (invBtn)    invBtn.style.display    = canManageMembers ? '' : 'none';
    if (canManageMembers) {
      // 既存メンバー pill に × ボタン を 重ねて 起案者以外 を 削除可能 に
      const memList = document.getElementById('gd-members-list');
      if (memList) {
        memList.querySelectorAll('[data-gd-mem]').forEach(span => {
          const uid = Number(span.dataset.gdMem);
          if (uid === Number(g.creator_user_id)) return;  // 起案者 は 削除 不可
          const x = document.createElement('button');
          x.textContent = '×';
          x.title = '外す';
          x.className = 'btn';
          x.style.cssText = 'position:absolute; right:-4px; top:-4px; min-width:0; padding:0 4px; font-size:10px; line-height:1; background:#fff; border:1px solid #c62828; color:#c62828; border-radius:50%';
          x.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!confirm('このメンバー を 外しますか?')) return;
            try { await del(`/api/groups/${id}/members/${uid}`); await loadDetail(id); }
            catch (e) { toast('失敗: ' + e.message); }
          });
          span.appendChild(x);
        });
      }
      // 追加 ボタン
      addMemBtn?.addEventListener('click', async () => {
        const form = document.getElementById('gd-mem-form');
        if (!form.hidden) { form.hidden = true; return; }
        form.hidden = false;
        form.innerHTML = `
          <div id="gd-mem-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
          <div id="gd-mem-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
          <div class="row" style="gap:6px; justify-content:flex-end; margin-top:6px">
            <button id="gd-mem-cancel" class="btn">キャンセル</button>
            <button id="gd-mem-save" class="primary">追加</button>
          </div>`;
        const existing = g.members.map(m => Number(m.id));
        let picker = null;
        try {
          picker = await createMemberPicker({
            bulkContainer: document.getElementById('gd-mem-bulk'),
            chipsContainer: document.getElementById('gd-mem-chips'),
            initial: [],
            excludeIds: existing,
            showGenderBulk: false,
          });
        } catch (e) {
          document.getElementById('gd-mem-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
        }
        document.getElementById('gd-mem-cancel').onclick = () => { form.hidden = true; };
        document.getElementById('gd-mem-save').onclick = async () => {
          const ids = picker ? [...picker.getSelected()] : [];
          if (!ids.length) { toast('追加 する メンバー を 選んで ください'); return; }
          let added = 0;
          for (const uid of ids) {
            try { await post(`/api/groups/${id}/members`, { user_id: uid }); added++; }
            catch (e) { toast(`#${uid}: ${e.message}`); }
          }
          toast(`${added} 人 追加しました`);
          await loadDetail(id);
        };
      });
      // 招待 リンク
      invBtn?.addEventListener('click', () => {
        const form = document.getElementById('gd-invite-form');
        if (!form.hidden) { form.hidden = true; return; }
        form.hidden = false;
        const base = location.origin;
        const cur = g.invite_token
          ? `${base}/#/groups/join/${g.invite_token}`
          : '';
        const exp = g.invite_expires_at
          ? new Date(String(g.invite_expires_at).replace(' ', 'T')).toLocaleDateString()
          : '';
        form.innerHTML = `
          ${cur
            ? `<div class="hint-sm" style="margin-bottom:4px">有効期限: ${escapeHtml(exp)}</div>
               <div class="row" style="gap:6px">
                 <input type="text" id="gd-invite-url" value="${escapeHtml(cur)}" readonly style="flex:1; font-size:12px">
                 <button id="gd-invite-copy" class="btn">📋 コピー</button>
                 <button id="gd-invite-revoke" class="btn danger">失効</button>
               </div>`
            : `<div class="hint-sm" style="margin-bottom:4px">まだ 発行 されて いません</div>`
          }
          <div class="row" style="gap:6px; justify-content:flex-end; margin-top:6px">
            <button id="gd-invite-issue" class="primary">${cur ? '更新' : '発行'} (有効期限 30 日)</button>
          </div>`;
        document.getElementById('gd-invite-issue').onclick = async () => {
          try {
            const r = await post(`/api/groups/${id}/invite`, { days: 30 });
            toast('招待リンク を 発行しました');
            await loadDetail(id);
            // 再 描画 後 に もう一度 開く
            document.getElementById('gd-invite-btn')?.click();
          } catch (e) { toast('失敗: ' + e.message); }
        };
        document.getElementById('gd-invite-copy')?.addEventListener('click', () => {
          const inp = document.getElementById('gd-invite-url');
          if (!inp) return;
          inp.select();
          try { document.execCommand('copy'); toast('コピーしました'); }
          catch (_) { navigator.clipboard?.writeText(inp.value).then(() => toast('コピーしました')); }
        });
        document.getElementById('gd-invite-revoke')?.addEventListener('click', async () => {
          if (!confirm('招待リンク を 失効 します。 既存 メンバー は そのまま です。 OK?')) return;
          try { await del(`/api/groups/${id}/invite`); toast('失効しました'); await loadDetail(id); }
          catch (e) { toast('失敗: ' + e.message); }
        });
      });
    }

    // 閉鎖 / 完全削除 カード:
    //   * 「閉鎖する」 は 未閉鎖 かつ creator/admin
    //   * 「完全削除」 は 閉鎖済 かつ creator/admin (admin であっても 閉鎖前は出さない)。
    //     「いきなり完全削除」 にならないよう、 必ず 閉鎖 を 経由するワンクッション。
    const dangerCard = document.getElementById('gd-danger-card');
    const canClose = (isCreator || isAdmin) && !g.closed_at;
    const canHardDel = (isCreator || isAdmin) && !!g.closed_at;
    if (dangerCard) dangerCard.hidden = !(canClose || canHardDel);
    const closeBtn = document.getElementById('gd-close');
    if (closeBtn) closeBtn.hidden = !canClose;
    const hardBtn = document.getElementById('gd-hard-delete');
    if (hardBtn) hardBtn.hidden = !canHardDel;
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
    // v491 #91 支出 ボタン も loadDetail で 注入 さ れる ので ここ で bind。
    document.getElementById('gd-snap-expense')?.addEventListener('click', () => openWariFormModal(id));
    // 受け皿は loadWari に統合済み (確定支出と未確定レシートを一覧にまとめる)。
    document.getElementById('gd-close')?.addEventListener('click', async () => {
      if (!confirm('このグループを閉鎖しますか?')) return;
      try {
        await del('/api/groups/' + id);
        toast('閉じました');
        location.hash = '#/groups';
      } catch (e) { toast('失敗: ' + e.message); }
    });
    document.getElementById('gd-hard-delete')?.addEventListener('click', async () => {
      if (!confirm('完全削除します。 投稿 / ワリカ / 宿泊 / 航空券 / スケジュール / チャット の全データが消えます。 元に戻せません。 良いですか?')) return;
      if (!confirm('本当に削除しますか? (最終確認)')) return;
      try {
        await del('/api/groups/' + id + '/hard_delete');
        toast('完全削除しました');
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
// v488 #84 個別 金額 (user_id → number)。 空 / 0 は 「均等 割」 扱い、 number > 0 は
//   その人 の 固定 金額。 入力 ある と チップ の 横 に 数字 を 表示。
let wariFixed = new Map();
let wariFormOnSubmitted = null;

function openWariFormModal(gid) {
  const root = document.getElementById('gd-wari-form-modal');
  if (!root) return;
  root.hidden = false;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" id="wfm-overlay">
      <div style="background:#fff; border-radius:14px; max-width:420px; width:100%; padding:20px">
        <div class="row center">
          <h3 class="row-title">支出を記録</h3>
          <button id="wfm-close">×</button>
        </div>
        <div id="gd-wari-form"></div>
      </div>
    </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  document.getElementById('wfm-close').addEventListener('click', close);
  document.getElementById('wfm-overlay').addEventListener('click', (e) => { if (e.target.id === 'wfm-overlay') close(); });
  renderWariForm({ onSubmitted: close });
}

function renderWariForm(opts = {}) {
  const root = document.getElementById('gd-wari-form');
  if (!root) return;
  // 提出 success 時に modal を閉じるためのフック。
  wariFormOnSubmitted = opts.onSubmitted || null;
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
  wariFixed = new Map();
  wariCustomMode = false;
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
// v488 #84 「個別 金額」 モード: トグル を ON に する と 各 メンバー の 横 に 数値
//   入力 が 出る。 入れた 人 は その 額 が 固定、 残り を 入って いる 他 メンバー で
//   均等 割り。 空 / 0 は 均等 割 (今 まで と 同じ)。
// v490 #87 chip 全体 を クリック ターゲット に 戻し (data-for-uid を 外側 に)、
//   個別 額 input は stopPropagation で chip トグル を 抑止。
let wariCustomMode = false;
function renderForPicker() {
  const root = document.getElementById('ex-for');
  if (!root) return;
  const n = wariFor.size;
  const fixedSum = [...wariFor].reduce((s, uid) => s + (wariFixed.get(uid) || 0), 0);
  const summary = n === 0
    ? `<span style="color:var(--warn)">対象者を 1 人以上選んでください</span>`
    : (wariCustomMode && fixedSum > 0
        ? `${n}人 中 固定 額 合計 ${fixedSum.toLocaleString()} (残額 は 等分)`
        : (n === wariMembers.length ? `全員 (${n}人)` : `${n}人で割る`));
  root.innerHTML = `
    <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
      <span class="hint-sm" style="flex:1">誰の分? <span style="margin-left:6px">${summary}</span></span>
      <label style="display:inline-flex; align-items:center; gap:4px; font-size:11px; cursor:pointer; flex:none">
        <input type="checkbox" id="ex-custom-toggle" ${wariCustomMode ? 'checked' : ''}>
        🔢 個別 金額
      </label>
    </div>
    <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:4px">
      ${wariMembers.map(m => {
        const on = wariFor.has(m.id);
        const fx = wariFixed.get(m.id) || '';
        return `
        <span class="rl-chip" data-for-uid="${m.id}" style="${on ? 'background:var(--primary-soft,#efeafa); border-color:var(--primary)' : 'opacity:.5'}; gap:4px; cursor:pointer">
          ${avatarHtml(m.display_name, m.avatar_url, 'sm')}
          <span>${escapeHtml(m.display_name)}</span>
          ${wariCustomMode && on
            ? `<input type="number" data-fixed-uid="${m.id}" min="0" step="1" inputmode="numeric"
                      value="${fx}" placeholder="均等"
                      style="width:64px; padding:1px 4px; font-size:11px; margin-left:2px">`
            : ''}
        </span>`;
      }).join('')}
    </div>
  `;
  root.querySelectorAll('[data-for-uid]').forEach(c => {
    c.addEventListener('click', (ev) => {
      // 個別 額 input への クリック / フォーカス は chip トグル を 抑止。
      if (ev.target.closest('[data-fixed-uid]')) return;
      const uid = Number(c.dataset.forUid);
      if (wariFor.has(uid)) { wariFor.delete(uid); wariFixed.delete(uid); }
      else                  wariFor.add(uid);
      renderForPicker();
    });
  });
  root.querySelectorAll('[data-fixed-uid]').forEach(inp => {
    inp.addEventListener('click', (ev) => ev.stopPropagation());
    inp.addEventListener('input', (ev) => {
      ev.stopPropagation();
      const uid = Number(inp.dataset.fixedUid);
      const v = parseInt(ev.target.value, 10);
      if (isFinite(v) && v > 0) wariFixed.set(uid, v);
      else                       wariFixed.delete(uid);
    });
  });
  const toggle = document.getElementById('ex-custom-toggle');
  if (toggle) toggle.addEventListener('change', (ev) => {
    wariCustomMode = ev.target.checked;
    if (!wariCustomMode) wariFixed = new Map();
    renderForPicker();
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
  // v488 #84 個別 金額 が 1 件 でも あれば rich 形式 で 送る (backend は
  //   participants: [{user_id, fixed}] を 受け取る)。
  const anyFixed = [...wariFor].some(uid => (wariFixed.get(uid) || 0) > 0);
  if (anyFixed) {
    body.participants = [...wariFor].map(uid => {
      const fx = wariFixed.get(uid) || 0;
      return fx > 0 ? { user_id: uid, fixed: fx } : { user_id: uid };
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
    renderForPicker();
    toast('記録しました');
    await loadWari(gid);
    if (typeof wariFormOnSubmitted === 'function') {
      const cb = wariFormOnSubmitted;
      wariFormOnSubmitted = null;
      cb();
    }
  } catch (e) { toast('失敗: ' + e.message); }
}

let currentGroupId = 0;

async function loadWari(id) {
  currentGroupId = id;
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

  // v394: source_group_id 経由で この グループに 紐づく money_request 群が
  // settlement_charges に入っているので、 (from_user_id, to_user_id) で
  // マッチングして 各プラン行に 「✅ 支払い済」 / 「💸 請求済 (未払い)」 を
  // 上乗せ表示。 同じ ペアの 請求が 複数あったら 最新の paid 状態を 採用。
  const chargesByPair = new Map();
  for (const c of (d.settlement_charges || [])) {
    const key = `${c.from_user_id}-${c.to_user_id}`;
    // 後勝ち = 同 (from, to) で 新しい請求 ほど 優先 (settlement_charges は
    // mr.id ASC で 来るので 最後が 最新)
    chargesByPair.set(key, c);
  }
  const planRows = d.settlements.length
    ? d.settlements.map(s => {
        const mine = Number(s.from_user_id) === meId || Number(s.to_user_id) === meId;
        const charge = chargesByPair.get(`${Number(s.from_user_id)}-${Number(s.to_user_id)}`);
        const paid = charge?.is_paid === true;
        const reqStatus = paid
          ? `<span class="tag ok" style="font-size:10px; margin-left:6px">✅ 支払い済</span>`
          : charge
            ? `<a class="tag warn" style="font-size:10px; margin-left:6px; text-decoration:none" href="#/requests/${charge.request_id}">💸 請求済 (未払い)</a>`
            : '';
        const rowStyle = [
          mine ? mineStyle : '',
          paid ? 'opacity:.5; filter:grayscale(50%)' : '',
        ].filter(Boolean).join(';');
        return `
          <div class="list-item" style="${rowStyle}">
            <div class="grow">
              <span class="bold">${escapeHtml(s.from_name)}</span> →
              <span class="bold">${escapeHtml(s.to_name)}</span>
              ${mine ? '<span class="muted" style="font-size:10px; margin-left:4px">(あなた)</span>' : ''}
              ${reqStatus}
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
            // v394: source_group_id を 渡すと、 精算サマリ モーダルが 「この
            // プランは もう 支払い済」 を 後で 反映できるようになる。
            source_group_id: Number(currentGroupId),
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
let schedPairFirstIds = new Set();
let schedPairLastIds  = new Set();
// 帯の左右位置 はカテゴリ別の slot で決めて 確実に重ならないようにする。
// hash だけで決めると 「__mdi_31 と __mdi_32」 みたいな 1 文字差 で
// rightPx がほぼ同じになり 帯が重なって見える。
let schedPairCatSlots = { transport: {}, staying: {} };
// modal の 「ペア相手」 dropdown で 同グループの他アイテムを出すために、
// 最新の取得結果を持っておく。
let lastSchedItems = [];
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
  meetup:  { label: '待ち合わせ', icon: '🤝' },
  food:    { label: '食事',   icon: '🍽' },
  fun:     { label: '観光',   icon: '🎢' },
  other:   { label: 'その他', icon: '📝' },
  move:    { label: '移動',   icon: '🚐' }, // legacy fallback
};

async function loadSchedule(gid) {
  const card = document.getElementById('gd-sched-card');
  const body = document.getElementById('gd-sched-body');
  if (!card || !body) return;
  let d;
  try { d = await get(`/api/groups/${gid}/schedule`); }
  catch (e) { card.hidden = false; body.textContent = '取得失敗: ' + e.message; return; }
  card.hidden = false;
  // 日程が無いとき: 「スケジュール編集モード」 は隠して、 「📅 日程設定」 だけ primary 色で出す。
  // 日程あり: 「スケジュール編集モード」 を primary で復活、 「日程設定」 は 「全体日程の修正」 に。
  const emBtn = document.getElementById('gd-sched-editmode');
  const rgBtn = document.getElementById('gd-sched-range');
  const hasDates = d.start_date && d.end_date;
  if (rgBtn) {
    if (hasDates) {
      rgBtn.textContent = '全体日程の修正';
      rgBtn.classList.remove('primary');
    } else {
      rgBtn.textContent = '📅 日程設定';
      rgBtn.classList.add('primary');
    }
  }
  if (emBtn) {
    emBtn.hidden = !hasDates;
    if (hasDates) {
      emBtn.textContent = schedEditMode ? '完了' : '✏️ 編集モード';
      emBtn.classList.add('primary');
    }
  }
  if (!hasDates) {
    body.innerHTML = `<div class="empty" style="padding:8px">日程未設定。 右上 「📅 日程設定」 から 開始日〜終了日 を入れると 各日のカードが並びます。</div>`;
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
  // 最新の生 items を modal の picker のために保持。
  lastSchedItems = d.items || [];
  // day_date 無し = 行きたい場所ストック (別枠で表示)。
  const stockItems = (d.items || []).filter(it => !it.day_date);
  const dayItems = (d.items || []).filter(it => it.day_date);
  // end_date がある (= 複数日に渡る) アイテムは、 当日・終了日・(宿泊の中間日)
  // に展開して each day に並べる。 元の id をそのまま保持し、 _occ で
  // 「'start' / 'mid' / 'end'」 のロールを付ける (描画時に label を出し分け)。
  // multi-day item (end_date が day_date と違う) には link_pair_id が無くても
  // 帯描画のための合成 pair_id を当てる (同じアイテムが byDay で N 個に展開される
  // ので、 下の pair occurrence カウントで N>=2 になり band が引かれる)。
  for (const it of dayItems) {
    if (!it.link_pair_id && it.end_date && it.end_date !== it.day_date) {
      it.link_pair_id = '__mdi_' + it.id;
    }
  }
  const byDay = {};
  for (const it of dayItems) {
    const start = it.day_date;
    const end   = it.end_date;
    if (!end || end === start) {
      (byDay[start] ||= []).push({ ...it, _occ: 'single', _dayKey: start });
      continue;
    }
    const addOne = (s) => {
      const [y, m, dd] = s.split('-').map(Number);
      const dt = new Date(y, m - 1, dd); dt.setDate(dt.getDate() + 1);
      const p = (n) => String(n).padStart(2, '0');
      return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}`;
    };
    let cur = start;
    while (cur <= end) {
      const occ = cur === start ? 'start' : (cur === end ? 'end' : 'mid');
      (byDay[cur] ||= []).push({ ...it, _occ: occ, _dayKey: cur });
      cur = addOne(cur);
    }
  }
  // byDay 内を 「その日の視覚順」 に並べ直す。 サーバ側は ORDER BY で
  // 「start_time あり → start_time 昇順 → NULL は末尾」 を保証してくれているが、
  // 展開された multi-day item の mid 行は その日の文脈で時刻が無い (元アイテムの
  // start_time は チェックイン日のもので、 mid 日の話ではない) ので 末尾に置きたい。
  // end 行は end_time があれば その時刻位置に置く。
  for (const date of Object.keys(byDay)) {
    byDay[date].sort((a, b) => {
      const effTime = (it) => it._occ === 'mid' ? null
                          : it._occ === 'end' ? (it.end_time || null)
                          : (it.start_time || null);
      const aT = effTime(a), bT = effTime(b);
      const aNull = aT ? 0 : 1, bNull = bT ? 0 : 1;
      if (aNull !== bNull) return aNull - bNull;
      if (aT && bT) {
        const c = aT.localeCompare(bT);
        if (c !== 0) return c;
      }
      // 同じ NULL 時刻組内では mid を末尾に。 元アイテムの sort_order が低くても
      // (= push 順で先頭) その日のコンテキストでは 「滞在中なだけ」 なので下に。
      const aMid = a._occ === 'mid' ? 1 : 0;
      const bMid = b._occ === 'mid' ? 1 : 0;
      if (aMid !== bMid) return aMid - bMid;
      const so = (a.sort_order || 0) - (b.sort_order || 0);
      if (so !== 0) return so;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
  }
  // 帯描画のためのペア出現カウント: byDay 全日にわたって同じ pair_id が
  // 「何日」 出るかで判定。 multi-day item は 1 行が N 日に展開されるので
  // この時点で N 回カウントされる。
  const pairOccurrences = {};
  for (const date of days) {
    for (const it of (byDay[date] || [])) {
      if (it.link_pair_id) {
        (pairOccurrences[it.link_pair_id] ||= []).push({ date, it });
      }
    }
  }
  // 連結グループ (N >= 2) を 「最初の日時」 順に slot 番号付け。
  const pairSlots = {};
  Object.entries(pairOccurrences)
    .filter(([, arr]) => arr.length >= 2)
    .map(([pid, arr]) => {
      arr.sort((a, b) => (a.date + (a.it.start_time || '99:99'))
        .localeCompare(b.date + (b.it.start_time || '99:99')));
      return [pid, arr];
    })
    .sort(([, a], [, b]) => {
      const aKey = a[0].date + (a[0].it.start_time || '99:99');
      const bKey = b[0].date + (b[0].it.start_time || '99:99');
      return aKey.localeCompare(bKey);
    })
    .forEach(([pid], idx) => { pairSlots[pid] = idx; });
  schedPairSlots = pairSlots;
  schedPairMaxSlot = Math.max(-1, ...Object.values(pairSlots));
  // カテゴリ別 slot index (左右の位置決め用)。 ペアの代表 kind で振り分け、
  // 同カテゴリ内で 連番を振る → 帯が確実に重ならない。
  const tSlots = {}, sSlots = {};
  let ti = 0, si = 0;
  Object.entries(pairOccurrences)
    .filter(([, arr]) => arr.length >= 2)
    .map(([pid, arr]) => {
      const sorted = [...arr].sort((a, b) =>
        (a.date + (a.it.start_time || '99:99'))
          .localeCompare(b.date + (b.it.start_time || '99:99')));
      return [pid, sorted];
    })
    .sort(([, a], [, b]) => {
      const aKey = a[0].date + (a[0].it.start_time || '99:99');
      const bKey = b[0].date + (b[0].it.start_time || '99:99');
      return aKey.localeCompare(bKey);
    })
    .forEach(([pid, arr]) => {
      const sampleKind = arr[0].it.kind;
      if (SCHED_TRANSPORT_KINDS.has(sampleKind)) tSlots[pid] = ti++;
      else                                       sSlots[pid] = si++;
    });
  schedPairCatSlots = { transport: tSlots, staying: sSlots };
  // 「最初 / 最後」 は (id, day) のペアで判定 (multi-day item は同じ id が複数日に
  // 跨るため、 id だけだと帯の端を上下とも 1 日に集中させてしまう)。
  schedPairFirstIds = new Set();
  schedPairLastIds  = new Set();
  for (const [pid, arr] of Object.entries(pairOccurrences)) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) =>
      (a.date + (a.it.start_time || '99:99'))
        .localeCompare(b.date + (b.it.start_time || '99:99')));
    const first = sorted[0];
    const last  = sorted[sorted.length - 1];
    schedPairFirstIds.add(Number(first.it.id) + ':' + first.date);
    schedPairLastIds.add(Number(last.it.id)   + ':' + last.date);
  }
  const dayLabels = ['日','月','火','水','木','金','土'];
  // v403 ストック (日付未定) は タイル 並び。 件数が多くなりがちな 「行きたい場所
  // 候補」 を 圧縮して 一覧 しやすく。 1 枚あたり 約 140px、 grid auto-fill。
  const stockCard = stockItems.length || schedEditMode ? `
    <details class="card collapsible-sub" open style="margin:6px 0; padding:8px 10px; background:#fffbf0; border-left:4px solid #fcd34d">
      <summary style="font-weight:700">📋 行きたい場所ストック <span class="hint-sm">— ${stockItems.length} 件</span></summary>
      <div class="sched-stock-grid" data-day="stock"
           style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:6px; margin-top:6px">
        ${stockItems.map(it => renderSchedStockTile({ ...it, _occ: 'single' })).join('')
          || '<div class="empty" style="padding:6px; grid-column:1/-1">候補なし。 編集モードで 「＋ 候補を追加」。</div>'}
      </div>
      ${schedEditMode ? `<button class="btn primary" id="gd-sched-add-stock" style="margin-top:6px; padding:4px 10px; font-size:12px">＋ 候補を追加</button>` : ''}
    </details>` : '';

  // v403 1 日 ごとに 背景色 を 周期で振る。 日数 が 多くても 視覚的に 区切れる。
  const DAY_BG_PALETTE = ['#f0f9ff', '#fdf4ff', '#f0fdf4', '#fef3c7', '#fce4ec', '#f1f5f9', '#fff7ed'];
  const DAY_BORDER_PALETTE = ['#7dd3fc', '#e879f9', '#86efac', '#fcd34d', '#f9a8d4', '#94a3b8', '#fdba74'];
  const dayMemos = d.day_memos || {};

  body.innerHTML = `
    <div class="hint-sm" style="margin-bottom:6px">${escapeHtml(d.start_date)} 〜 ${escapeHtml(d.end_date)} (${days.length} 日)</div>
    ${schedEditMode ? '<div class="hint" style="font-size:12px; background:#fff8e6; border-left:3px solid var(--warn); padding:6px 8px; border-radius:6px; margin-bottom:6px">⋮⋮ ハンドルをドラッグで 並び替え (日をまたいでも OK / 行全体タップは編集) · 🔒 は 多日またぎの中間/終了行で 動かせません</div>' : ''}
    ${stockCard}
    ${days.map((date, idx) => {
      const dow = dayLabels[new Date(date + 'T00:00:00').getDay()];
      const md  = date.slice(5).replace('-', '/');
      const items = byDay[date] || [];
      const bg = DAY_BG_PALETTE[idx % DAY_BG_PALETTE.length];
      const bd = DAY_BORDER_PALETTE[idx % DAY_BORDER_PALETTE.length];
      const memo = dayMemos[date] || '';
      // 日 メモ 表示部 (常に show、 タップで 編集に 切替)
      const memoBlock = `
        <div class="gd-day-memo" data-memo-date="${date}" style="margin:6px 0; padding:6px 8px; background:rgba(255,255,255,0.7); border-radius:6px; border:1px dashed ${bd}">
          ${memo
            ? `<div class="gd-day-memo-view" style="white-space:pre-wrap; font-size:13px; cursor:pointer">${escapeHtml(memo)}</div>`
            : `<div class="gd-day-memo-view muted" style="font-size:12px; cursor:pointer">📝 この日のメモを 追加…</div>`}
        </div>`;
      return `
        <details class="card collapsible-sub" data-day="${date}" open
                 style="margin:6px 0; padding:8px 10px; background:${bg}; border-left:4px solid ${bd}">
          <summary style="font-weight:700">${md} (${dow}) <span class="hint-sm">— ${items.length} 件</span></summary>
          ${memoBlock}
          <div class="schedule-items" style="margin-top:6px">
            ${items.map(it => renderSchedItem(it)).join('') || '<div class="empty" style="padding:6px">アイテム無し</div>'}
          </div>
          ${schedEditMode ? `<button class="btn primary" data-add-sched-day="${date}" style="margin-top:6px; padding:4px 10px; font-size:12px">＋ 追加</button>` : ''}
        </details>`;
    }).join('')}
  `;
  // v403 日メモ: タップ → textarea で 編集 → blur or ✓ で 保存
  body.querySelectorAll('.gd-day-memo-view').forEach(el => {
    el.addEventListener('click', () => {
      const wrap = el.closest('.gd-day-memo');
      const date = wrap.dataset.memoDate;
      const current = (dayMemos[date] || '');
      wrap.innerHTML = `
        <textarea class="gd-day-memo-edit" maxlength="5000" rows="3"
          style="width:100%; box-sizing:border-box; font-size:13px; padding:6px; border-radius:4px; border:1px solid #ccc">${escapeHtml(current)}</textarea>
        <div class="row" style="gap:4px; margin-top:4px; justify-content:flex-end">
          <button class="btn gd-day-memo-cancel" style="padding:2px 8px; font-size:11px">キャンセル</button>
          <button class="btn primary gd-day-memo-save" style="padding:2px 8px; font-size:11px">保存</button>
        </div>`;
      const ta = wrap.querySelector('.gd-day-memo-edit');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      wrap.querySelector('.gd-day-memo-cancel').addEventListener('click', () => loadSchedule(gid));
      wrap.querySelector('.gd-day-memo-save').addEventListener('click', async () => {
        const newMemo = ta.value;
        try {
          await patch(`/api/groups/${gid}/schedule/day_memos/${date}`, { memo: newMemo });
          await loadSchedule(gid);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  });
  // 「+ 追加」 ボタン
  body.querySelectorAll('[data-add-sched-day]').forEach(b => {
    b.addEventListener('click', () => openSchedItemModal(gid, { day_date: b.dataset.addSchedDay }));
  });
  // ストックに候補を追加 (day_date = null で作成)
  document.getElementById('gd-sched-add-stock')?.addEventListener('click', () =>
    openSchedItemModal(gid, { day_date: null }));
  // v489 #85 タップ で まず 「内容 確認」 を 表示 → 編集 ボタン で 編集 モーダル へ。
  //   (旧: タップ で 即 編集 モーダル)。 編集 モード では 行 内 の ↑↓× ボタン が
  //   出る ので、 タップ → 内容 確認 で 妥当 な UX。
  body.querySelectorAll('[data-sched-item]').forEach(el => {
    el.addEventListener('click', (ev) => {
      if (suppressNextClick) { suppressNextClick = false; return; }
      if (ev.target.closest('button,a,input,select,[data-drag-handle],[aria-label*="多日"]')) return;
      const id = Number(el.dataset.schedItem);
      const it = (d.items || []).find(x => Number(x.id) === id);
      if (it) openSchedItemViewModal(gid, it);
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
  // v428 ❤️ 「行った」 トグル
  body.querySelectorAll('[data-heart-it]').forEach(b => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        const r = await post(`/api/groups/${gid}/schedule/${b.dataset.heartIt}/heart`, {});
        b.innerHTML = `${r.hearted ? '❤️' : '🤍'}${r.count > 0 ? ' ' + r.count : ''}`;
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
  // ── v362 ドラッグアンドドロップで 並び替え (日またぎ可) ──
  // - 並び替え可能 (canEdit) なアイテムの「⋮⋮ハンドル」 だけ draggable。
  //   ハンドル以外のクリックは そのまま編集 modal を開く。
  // - 同日内ドロップ → 既存 /move を chain swap で距離分呼び出し (start_time 含め swap)。
  // - 別日ドロップ → /relocate で day_date + sort_order を更新 (start_time は維持)。
  // - 日の <details> ヘッダや 「+ 追加」 ボタン エリアに ドロップしたら その日の末尾に。
  let dragSrcId = null, dragSrcDay = null;
  // v484 #77 ステップ 計算 用: 同日 の 全行 (canedit + ロック)。 サーバ の swap は
  //   ロック 行 も 含めた 並び で 1 ステップ 進む ので、 DOM の DnD index も
  //   全行 で 数える 必要 が ある。
  const itemsSameDay = (day) =>
    [...body.querySelectorAll(`[data-sched-item][data-sched-day="${CSS.escape(day)}"]`)];
  // 後方互換: 同名 を 残しつつ ステップ 計算 は 全行 ベース に。
  const editableSameDay = itemsSameDay;

  body.querySelectorAll('[data-drag-handle="1"]').forEach(h => {
    h.addEventListener('dragstart', (ev) => {
      dragSrcId = Number(h.dataset.schedSrc);
      dragSrcDay = h.dataset.schedSrcday || 'stock';
      const parentItem = h.closest('[data-sched-item]');
      if (parentItem) parentItem.style.opacity = '0.4';
      try {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', String(dragSrcId));
      } catch (_) {}
    });
    h.addEventListener('dragend', () => {
      body.querySelectorAll('[data-sched-item]').forEach(x => x.style.opacity = '');
      body.querySelectorAll('.gd-sched-drop-over').forEach(x => x.classList.remove('gd-sched-drop-over'));
      dragSrcId = null; dragSrcDay = null;
    });
  });

  // ドロップ先: canEdit な list-item (= before_id を指定して 直前に挿入)
  body.querySelectorAll('[data-sched-canedit="1"]').forEach(el => {
    el.addEventListener('dragover', (ev) => {
      if (dragSrcId === null) return;
      if (Number(el.dataset.schedItem) === dragSrcId) return;
      ev.preventDefault();
      try { ev.dataTransfer.dropEffect = 'move'; } catch (_) {}
      el.classList.add('gd-sched-drop-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('gd-sched-drop-over'));
    el.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      el.classList.remove('gd-sched-drop-over');
      if (dragSrcId === null) return;
      const tid = Number(el.dataset.schedItem);
      const targetDay = el.dataset.schedDay || 'stock';
      if (tid === dragSrcId) return;
      const savedSrc = dragSrcId, savedSrcDay = dragSrcDay;
      dragSrcId = null; dragSrcDay = null;
      try {
        // v402: バックエンド ORDER は start_time 主導に 戻したので、 同日 DnD は
        // 隣接 N ステップ 分 ↑↓ swap (時刻 + sort_order を 連鎖 swap) で 並びを
        // 変える。 これにより 時刻つき アイテム も 視覚的に 並び替えできる。
        // 別日 DnD は そのまま /relocate (day_date 移動)。
        if (targetDay === savedSrcDay) {
          const editable = editableSameDay(savedSrcDay);
          const srcIdx = editable.findIndex(e => Number(e.dataset.schedItem) === savedSrc);
          const dstIdx = editable.findIndex(e => Number(e.dataset.schedItem) === tid);
          if (srcIdx < 0 || dstIdx < 0 || srcIdx === dstIdx) return;
          const steps = Math.abs(dstIdx - srcIdx);
          const dir = srcIdx < dstIdx ? 'down' : 'up';
          for (let i = 0; i < steps; i++) {
            const r = await patch(`/api/groups/${gid}/schedule/${savedSrc}/move`, { dir });
            if (!r.moved) break;
          }
        } else {
          await patch(`/api/groups/${gid}/schedule/${savedSrc}/relocate`, { before_id: tid });
        }
        await loadSchedule(gid);
      } catch (e) {
        toast('並び替え失敗: ' + e.message);
        await loadSchedule(gid);
      }
    });
  });

  // 日のコンテナ <details data-day="YYYY-MM-DD"> 自体を ドロップ先に
  // (空の日や 末尾追加 用): その日の最後に relocate。
  body.querySelectorAll('[data-day]').forEach(dayEl => {
    dayEl.addEventListener('dragover', (ev) => {
      if (dragSrcId === null) return;
      const targetDay = dayEl.dataset.day;
      if (targetDay === dragSrcDay) return; // 同日は item 単位で処理
      ev.preventDefault();
      try { ev.dataTransfer.dropEffect = 'move'; } catch (_) {}
      dayEl.classList.add('gd-sched-drop-over');
    });
    dayEl.addEventListener('dragleave', (ev) => {
      // 子要素 経由の dragleave で 親 highlight が点滅するのを 抑える
      if (!dayEl.contains(ev.relatedTarget)) dayEl.classList.remove('gd-sched-drop-over');
    });
    dayEl.addEventListener('drop', async (ev) => {
      if (dragSrcId === null) return;
      const targetDay = dayEl.dataset.day;
      if (targetDay === dragSrcDay) return;
      ev.preventDefault();
      dayEl.classList.remove('gd-sched-drop-over');
      const savedSrc = dragSrcId;
      dragSrcId = null; dragSrcDay = null;
      try {
        const payload = targetDay === 'stock' ? { day_date: '' } : { day_date: targetDay };
        await patch(`/api/groups/${gid}/schedule/${savedSrc}/relocate`, payload);
        await loadSchedule(gid);
      } catch (e) {
        toast('並び替え失敗: ' + e.message);
        await loadSchedule(gid);
      }
    });
  });

  // ─── v415 タッチ / ポインター ベース DnD ───
  // 左端の ⋮⋮ ハンドル を 掴んだら 即 ドラッグ開始 (待ち無し)。
  // それ以外の 行 内側 を 掴んだら 350ms 長押しで ドラッグ開始 (誤爆 / スクロール
  // 妨害 を 避ける)。 8px 以上 動いたら 長押し 判定 キャンセル (スクロール扱い)。
  // タッチ端末で ネイティブ HTML5 DnD が 効かない 問題 への 対処も 兼ねる。
  let pointerDrag = null;
  const startDrag = (state, parentItem, handleEl) => {
    state.active = true;
    if (parentItem) parentItem.style.opacity = '0.4';
    if (handleEl) handleEl.style.cursor = 'grabbing';
    try { handleEl?.setPointerCapture(state.pointerId); } catch (_) {}
  };
  body.querySelectorAll('[data-sched-canedit="1"]').forEach(rowEl => {
    rowEl.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      const handleEl = ev.target.closest('[data-drag-handle="1"]');
      // ハンドル以外 を 掴んだ時、 button/a/select 等の上 なら ドラッグも しない
      // (各自の click handler に 渡す)
      if (!handleEl && ev.target.closest('button,a,input,select,textarea')) return;
      const handleFromRow = rowEl.querySelector('[data-drag-handle="1"]');
      const srcEl = handleEl || handleFromRow;
      if (!srcEl) return;
      const srcId = Number(srcEl.dataset.schedSrc);
      const srcDay = srcEl.dataset.schedSrcday || 'stock';
      const parentItem = rowEl;
      const state = {
        srcId, srcDay, parentItem,
        startX: ev.clientX, startY: ev.clientY,
        active: false, pointerId: ev.pointerId,
        timer: null, handleEl: srcEl,
      };
      pointerDrag = state;
      if (handleEl) {
        // ハンドル直撃 → 即 開始
        startDrag(state, parentItem, srcEl);
        ev.preventDefault();
      } else {
        // 行 中央 など → 350ms 長押し
        state.timer = setTimeout(() => {
          if (pointerDrag === state) startDrag(state, parentItem, srcEl);
        }, 350);
      }
    });
    rowEl.addEventListener('pointermove', (ev) => {
      if (!pointerDrag || pointerDrag.parentItem !== rowEl) return;
      if (!pointerDrag.active) {
        if (Math.hypot(ev.clientX - pointerDrag.startX, ev.clientY - pointerDrag.startY) > 8) {
          clearTimeout(pointerDrag.timer);
          pointerDrag = null;
        }
        return;
      }
      ev.preventDefault();
      body.querySelectorAll('.gd-sched-drop-over').forEach(x => x.classList.remove('gd-sched-drop-over'));
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el) return;
      const itemT = el.closest('[data-sched-canedit="1"]');
      const dayT = itemT ? null : (el.closest('[data-day]') || el.closest('.sched-stock-grid'));
      if (itemT && Number(itemT.dataset.schedItem) !== pointerDrag.srcId) {
        itemT.classList.add('gd-sched-drop-over');
      } else if (dayT) {
        dayT.classList.add('gd-sched-drop-over');
      }
    });
    const finishPointer = async (ev) => {
      if (!pointerDrag || pointerDrag.parentItem !== rowEl) return;
      const pd = pointerDrag;
      pointerDrag = null;
      clearTimeout(pd.timer);
      if (pd.handleEl) pd.handleEl.style.cursor = 'grab';
      if (pd.parentItem) pd.parentItem.style.opacity = '';
      body.querySelectorAll('.gd-sched-drop-over').forEach(x => x.classList.remove('gd-sched-drop-over'));
      if (!pd.active) return;
      ev.preventDefault();
      // ドラッグ後の click は 編集 modal を 開きたくない → suppressClick で 1 回 だけ ガード
      suppressNextClick = true;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el) return;
      const itemT = el.closest('[data-sched-canedit="1"]');
      const dayT = itemT ? null : (el.closest('[data-day]') || el.closest('.sched-stock-grid'));
      try {
        if (itemT) {
          const tid = Number(itemT.dataset.schedItem);
          if (tid === pd.srcId) return;
          const targetDay = itemT.dataset.schedDay || 'stock';
          if (targetDay === pd.srcDay) {
            const editable = editableSameDay(pd.srcDay);
            const srcIdx = editable.findIndex(e => Number(e.dataset.schedItem) === pd.srcId);
            const dstIdx = editable.findIndex(e => Number(e.dataset.schedItem) === tid);
            if (srcIdx < 0 || dstIdx < 0 || srcIdx === dstIdx) return;
            const steps = Math.abs(dstIdx - srcIdx);
            const dir = srcIdx < dstIdx ? 'down' : 'up';
            for (let i = 0; i < steps; i++) {
              const r = await patch(`/api/groups/${gid}/schedule/${pd.srcId}/move`, { dir });
              if (!r.moved) break;
            }
          } else {
            await patch(`/api/groups/${gid}/schedule/${pd.srcId}/relocate`, { before_id: tid });
          }
        } else if (dayT) {
          const targetDay = dayT.dataset.day || 'stock';
          if (targetDay === pd.srcDay) return;
          const payload = targetDay === 'stock' ? { day_date: '' } : { day_date: targetDay };
          await patch(`/api/groups/${gid}/schedule/${pd.srcId}/relocate`, payload);
        }
        await loadSchedule(gid);
      } catch (e) {
        toast('並び替え失敗: ' + e.message);
        await loadSchedule(gid);
      }
    };
    rowEl.addEventListener('pointerup', finishPointer);
    rowEl.addEventListener('pointercancel', () => {
      if (!pointerDrag || pointerDrag.parentItem !== rowEl) return;
      clearTimeout(pointerDrag.timer);
      if (pointerDrag.handleEl) pointerDrag.handleEl.style.cursor = 'grab';
      if (pointerDrag.parentItem) pointerDrag.parentItem.style.opacity = '';
      body.querySelectorAll('.gd-sched-drop-over').forEach(x => x.classList.remove('gd-sched-drop-over'));
      pointerDrag = null;
    });
  });
}

// v415 ドラッグ完了直後の 余計な click を 1 回だけ 消す
let suppressNextClick = false;

// 移動系 kind は左半分、 それ以外は右半分に帯を出す (ややこしい時の住み分け)。
const SCHED_TRANSPORT_KINDS = new Set(['flight','train','bus','taxi','car','walk','move']);

// 「35.6586, 139.7454」 形式の文字列を {lat, lng} に。 解釈できなければ両方 null。
// Google Maps の右クリック → 「緯度経度をコピー」 がこの形式で取れる。
function parseLatLng(s) {
  if (!s || typeof s !== 'string') return { lat: null, lng: null };
  const parts = s.split(',').map(x => x.trim()).filter(x => x.length);
  if (parts.length < 2) return { lat: null, lng: null };
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { lat: null, lng: null };
  return { lat, lng };
}

// ペア id を 2 つの独立 hash → 色相 + 位置 spread に。 同じ pair_id = 同じ色 /
// 同じ位置 に必ず落ちる (帯が縦に連続)。 カテゴリ別 (移動 / 宿泊 / その他) で
// 色相レンジを区切って 「青系=移動」 「赤系=宿泊」 がぱっと見で分かるように。
function schedPairStyleFromId(pid, isTransport, kind) {
  let h1 = 0, h2 = 0, h3 = 0;
  for (let i = 0; i < pid.length; i++) {
    h1 = (h1 * 31 + pid.charCodeAt(i)) | 0;
    h2 = (h2 * 37 + pid.charCodeAt(i) * 13) | 0;
    h3 = (h3 * 41 + pid.charCodeAt(i) * 7)  | 0;
  }
  // カテゴリ別 hue レンジ (互いに重ならない 3 帯):
  //   宿泊 (hotel)                  → 赤〜ピンク〜橙 (340-50, 70 wide)
  //   移動 (flight/train/...)        → シアン〜青〜紫 (190-290, 100 wide)
  //   その他                         → 黄緑〜緑〜青緑 (70-170, 100 wide)
  let hueBase, hueSpan;
  if (kind === 'hotel') {
    hueBase = -20; hueSpan = 70;   // -20..50 → 340..50
  } else if (isTransport) {
    hueBase = 190; hueSpan = 100;  // 190..290
  } else {
    hueBase = 70;  hueSpan = 100;  // 70..170
  }
  const hue   = ((hueBase + (Math.abs(h1) % hueSpan)) + 360) % 360;
  const sat   = 58 + (Math.abs(h2) % 32);   // 58-90% (前は 60-85)
  const light = 40 + (Math.abs(h3) % 22);   // 40-62% (前は 45-57)
  const color = `hsla(${hue}, ${sat}%, ${light}%, 0.50)`;
  // 端 (最初/最後) 用の濃い色: 明度をぐっと下げて アルファ不透明 に。
  const capColor = `hsla(${hue}, ${sat}%, ${Math.max(15, light - 25)}%, 0.95)`;
  // 位置: 移動形は 左、 滞在形は 右、 に住み分け + カテゴリ内 slot で確実に重ならない
  // ように 30px ステップで離す。 ステップ数を超えたら 再循環 (= ペア数が多い時のみ衝突)。
  const catSlots = isTransport ? schedPairCatSlots.transport : schedPairCatSlots.staying;
  const slot = catSlots[pid] ?? 0;
  const rangeStart = isTransport ? 140 : 16;
  const rangeEnd   = isTransport ? 280 : 126;
  const step = 28;  // 20px 幅の帯同士で 8px 隙間
  const numPositions = Math.max(1, Math.floor((rangeEnd - rangeStart) / step) + 1);
  const rightPx = rangeStart + (slot % numPositions) * step;
  return { color, capColor, rightPx };
}

// v403 ストック専用 タイル レンダラ。 候補が 多くても 一覧で 見えるよう コンパクト。
// 画像 (or 絵文字) + タイトル を 縦に積む。 編集モードなら ⋮⋮ ハンドル + × 付き。
function renderSchedStockTile(it) {
  const k = SCHED_KINDS[it.kind] || SCHED_KINDS.other;
  const hasImage = !!it.image_url;
  const cover = hasImage
    ? `<div style="width:100%; aspect-ratio:4/3; background:#eee center/cover no-repeat url('${escapeHtml(it.image_url)}'); border-radius:6px"></div>`
    : `<div style="width:100%; aspect-ratio:4/3; background:linear-gradient(135deg, #fef3c7, #fde68a); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:28px">${k.icon}</div>`;
  const canEdit = schedEditMode;
  const dragHandle = canEdit ? `
    <span draggable="true" data-drag-handle="1" data-sched-src="${it.id}" data-sched-srcday="stock"
          aria-label="ドラッグして 日付に 移動" title="ドラッグで 日に 投入"
          style="position:absolute; top:4px; left:4px; z-index:2; background:rgba(255,255,255,0.9); color:#666; font-size:13px; cursor:grab; user-select:none; padding:1px 4px; border-radius:4px; touch-action:none">⋮⋮</span>` : '';
  const rmBtn = canEdit ? `
    <button data-sched-rm="${it.id}" class="btn"
            style="position:absolute; top:4px; right:4px; z-index:2; padding:0 5px; font-size:11px; background:rgba(255,255,255,0.9); color:var(--muted); border-radius:4px">×</button>` : '';
  const dndAttrs = canEdit
    ? `data-sched-canedit="1" data-sched-day="stock"`
    : '';
  // v428 ❤️ 「行った / 良いね」 トグル (ダブルタップ or タップ)
  const heartCount = Number(it.hearts_count || 0);
  const myHearted = !!it.my_hearted;
  const heartBtn = `
    <button data-heart-it="${it.id}" title="行った / 良いね (ダブルタップ で トグル)"
            style="position:absolute; bottom:4px; right:4px; z-index:2; padding:1px 6px; font-size:11px; background:rgba(255,255,255,0.92); border-radius:10px; border:1px solid rgba(0,0,0,0.08); cursor:pointer; user-select:none">
      ${myHearted ? '❤️' : '🤍'}${heartCount > 0 ? ' ' + heartCount : ''}
    </button>`;
  return `
    <div class="list-item" data-sched-item="${it.id}" ${dndAttrs}
         style="position:relative; display:flex; flex-direction:column; gap:4px; padding:4px; cursor:pointer; background:#fff; border-radius:6px; box-shadow:0 1px 2px rgba(0,0,0,0.06); min-height:0">
      ${cover}
      ${dragHandle}
      ${rmBtn}
      ${heartBtn}
      <div class="bold" style="font-size:12px; line-height:1.2; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; padding:0 2px">${escapeHtml(it.title)}</div>
      ${it.memo ? `<div class="muted" style="font-size:11px; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 2px">${escapeHtml(it.memo)}</div>` : ''}
    </div>`;
}

function renderSchedItem(it) {
  const k = SCHED_KINDS[it.kind] || SCHED_KINDS.other;
  // 複数日展開: start / mid / end によって 時刻と接尾語を変える。
  let timeStr = '';
  let roleSuffix = '';   // multi-day item でも 全日 同じ見た目 (タイトルのみ) で出す。
  if (it._occ === 'start') {
    if (it.start_time) timeStr = it.start_time.slice(0, 5);
  } else if (it._occ === 'end') {
    if (it.end_time) timeStr = it.end_time.slice(0, 5);
  } else if (it._occ === 'mid') {
    // 中間日は時刻なし、 接尾辞なし。
  } else {
    // single
    if (it.start_time) {
      const t = it.start_time.slice(0, 5);
      if (it.end_time) {
        timeStr = `${t}〜${it.end_time.slice(0, 5)}`;
      } else if (it.duration_minutes) {
        // v485 #78 旅行 中 (時差 異なる 地域) で Date.parse が 端末 ローカル TZ
        //   解釈 → 別 TZ で 開いた とき に 端 時刻 が ずれる 可能性 が ある ため、
        //   純粋 な 分 計算 に 変更。 HH:MM → 分 → +duration → HH:MM。
        const [sh, sm] = it.start_time.slice(0, 5).split(':').map(Number);
        const total = (sh * 60 + sm + Number(it.duration_minutes)) % (24 * 60);
        const eh = String(Math.floor(total / 60)).padStart(2, '0');
        const em = String(total % 60).padStart(2, '0');
        timeStr = `${t}〜${eh}:${em}`;
      } else {
        timeStr = t;
      }
    }
  }
  // 中間日も他の日と同じ濃さ (旧版は opacity 0.55 で薄めていたが、 「同じような予定で大丈夫」)。
  // ペアは 帯 (右側 縦ストリップ) だけで表現する方針。 タイトル横の 🔗 文字は出さない。
  // v366: 画像つきはヒーロー風: 左端から 約 2/3 まで埋め尽くし、 右端に 斜め切れ目。
  //       clip-path で 右下が 22px 内側に切れ、 そこから 斜めに 右上 100% へ。
  //       画像なしは 従来通り 32px 絵文字アイコン。
  const HERO_PCT = 64;        // 画像幅 (行幅に対する %)
  const HERO_SLANT = 22;      // 斜めの傾き量 (px)
  const hasImage = !!it.image_url;
  const heroImage = hasImage ? `
    <div aria-hidden="true" style="position:absolute; left:0; top:0; bottom:0; width:${HERO_PCT}%;
         background:#f1f1f4 center/cover no-repeat url('${escapeHtml(it.image_url)}');
         clip-path:polygon(0 0, 100% 0, calc(100% - ${HERO_SLANT}px) 100%, 0 100%);
         pointer-events:none; z-index:1; box-shadow:inset 0 0 0 1px rgba(0,0,0,0.04)"></div>` : '';
  const thumb = hasImage
    ? '' // ヒーロー が代替
    : `<span style="font-size:22px; line-height:1; width:32px; text-align:center; flex-shrink:0">${k.icon}</span>`;
  const urlIcon = it.url
    ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--primary); margin-left:4px">🔗</a>`
    : '';
  // 1 行目: アイコン + タイトル + 時刻
  // 2 行目: 場所 (Map link) / メモ / URL (溢れたら 1 行で切る)
  const hasGeo = it.lat !== null && it.lng !== null && it.lat !== undefined && it.lng !== undefined;
  const mapUrl = hasGeo
    ? `https://maps.google.com/?q=${it.lat},${it.lng}`
    : (it.location ? `https://maps.google.com/?q=${encodeURIComponent(it.location)}` : null);
  const line2bits = [];
  if (it.location) {
    line2bits.push(mapUrl
      ? `<a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--primary)">📍 ${escapeHtml(it.location)}</a>`
      : `📍 ${escapeHtml(it.location)}`);
  } else if (hasGeo) {
    line2bits.push(`<a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--primary)">📍 地図</a>`);
  }
  if (it.memo)     line2bits.push(escapeHtml(it.memo).replace(/\n/g, ' '));
  if (it.attachment_count > 0) line2bits.push(`📎 ${it.attachment_count}`);
  const line2 = line2bits.length
    ? `<div class="meta" style="font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${line2bits.join(' · ')}${urlIcon}</div>`
    : (urlIcon ? `<div class="meta">${urlIcon}</div>` : '');
  // 編集モード ON だけ ボタンを出す。 OFF 時は完全に隠す (アイテム自体が
  // タップ可能で edit modal が開く)。
  // ↑↓× は 「DB 上の本拠地となる日」 = single / start の行にだけ出す。
  // multi-day 展開の mid / end 行 (= 宿泊の 6/9, 6/10, 6/11 など) で押されても、
  // DB の day_date は start 日なので 表示中の日 (6/9 等) の並び替えにはならない
  // → 押しても無反応に見える、 という混乱を防ぐためボタンを出さない。
  // z-index:2 + 半透明白背景でペア帯より前面に。
  const canEdit = schedEditMode && (it._occ === 'single' || it._occ === 'start');
  // v362 DnD: canEdit 行は draggable, 日またぎ並び替え可能。
  //          mid/end 行は 🔒 アイコンで 「動かせない」 ことを明示。
  // ※ dayKey は dragHandle 内で参照するので 先に定義しておく (TDZ で死なないように)。
  const dayKey = String(it.day_date || 'stock');
  const isLocked = schedEditMode && !canEdit;
  const editControls = canEdit ? `
    <div style="display:flex; flex-direction:column; gap:2px; align-items:center; margin-left:4px; position:relative; z-index:2; background:rgba(255,255,255,0.85); border-radius:6px; padding:2px 0">
      <button data-sched-move="${it.id}" data-dir="up"   class="btn" style="padding:0 6px; font-size:11px">↑</button>
      <button data-sched-move="${it.id}" data-dir="down" class="btn" style="padding:0 6px; font-size:11px">↓</button>
      <button data-sched-rm="${it.id}" class="btn" style="padding:0 6px; font-size:12px; color:var(--muted)">×</button>
    </div>` : '';
  // 画像ありの場合は ロック/ハンドル を 画像の左上に 半透明バッジで オーバーレイ。
  // 画像なし時は 従来通り (lock は absolute、 handle は flex 内)。
  const overlayBg = hasImage ? 'background:rgba(255,255,255,0.88); padding:2px 4px; border-radius:6px;' : '';
  const lockBadge = isLocked ? `
    <span aria-label="多日またぎ項目の中間/終了行: 並び替えは本拠日 (= start 日) でのみ可能" title="多日またぎ項目の中間/終了行は ここでは並び替えできません (本拠日でのみ可)"
          style="position:absolute; top:4px; left:4px; font-size:11px; opacity:0.85; pointer-events:none; z-index:3; ${overlayBg}">🔒</span>` : '';
  const dragHandle = canEdit ? `
    <span draggable="true" data-drag-handle="1" data-sched-src="${it.id}" data-sched-srcday="${escapeHtml(dayKey)}"
          aria-label="ドラッグして並び替え" title="ドラッグで並び替え (日をまたいでも OK)"
          style="${hasImage ? 'position:absolute; top:4px; left:4px; z-index:3;' : ''} ${overlayBg} color:#666; font-size:16px; cursor:grab; user-select:none; padding:2px 6px; touch-action:none">⋮⋮</span>` : '';
  // ペア帯: link_pair_id があれば 行の右端から N px 内側に 20px 幅の縦
  // ストリップ。 移動系 kind は左半分、 それ以外は右半分に出して被りを減らす。
  // 色・位置は pair_id の hash で散らす → 同じグループは同じ位置 / 同じ色。
  const isTransport = SCHED_TRANSPORT_KINDS.has(it.kind);
  const stripStyle = it.link_pair_id
    ? schedPairStyleFromId(it.link_pair_id, isTransport, it.kind)
    : null;
  // 連結グループの 「最初」「最後」 のアイテムは帯の端 5px を濃い同系色で塗って、
  // チェーンの始点 / 終点が一目で分かるようにする (中間はフラット)。
  const occKey = Number(it.id) + ':' + (it._dayKey || it.day_date);
  const isFirst = stripStyle && schedPairFirstIds.has(occKey);
  const isLast  = stripStyle && schedPairLastIds.has(occKey);
  const topCap    = isFirst ? `<div aria-hidden="true" style="position:absolute; right:${stripStyle.rightPx}px; top:0; width:20px; height:5px; background:${stripStyle.capColor}; pointer-events:none"></div>` : '';
  const bottomCap = isLast  ? `<div aria-hidden="true" style="position:absolute; right:${stripStyle.rightPx}px; bottom:0; width:20px; height:5px; background:${stripStyle.capColor}; pointer-events:none"></div>` : '';
  const pairStrip = stripStyle
    ? `<div aria-hidden="true" style="position:absolute; right:${stripStyle.rightPx}px; top:0; bottom:0; width:20px; background:${stripStyle.color}; pointer-events:none"></div>${topCap}${bottomCap}`
    : '';
  // 縦幅 2 行分で固定 (画像 56px + 上下 padding でだいたい 68px)。 1 行で
  // 済むアイテムも空きスペースに揃って並ぶので見た目がきれい。
  // 2 行目 (line2) は空でも HTML 上は存在させる。
  const line2Slot = line2 || '<div class="meta" style="height:14px"></div>';
  // 右側に常に余白を確保 (帯が動いてもサムネや編集ボタンに被らない)。
  // 画像つきは 左 2/3 がヒーロー → コンテンツ (タイトル + メタ) を 右側に逃がす。
  const rightPad = 'padding-right:18px;';
  const leftPad = hasImage ? `padding-left:calc(${HERO_PCT}% + 10px);` : '';
  // v362: draggable は ハンドル span だけに付ける (list-item 全体ではない)。
  //       こうしないと 行クリックが ドラッグ判定に食われて 編集 modal が開かなくなる。
  //       data-sched-day は drop target 判定 + DOM index 計算で使うので list-item に残す。
  // v484 #77 data-sched-day は ロック 行 (🔒 多日 中間 / 終了) にも 必ず 付ける。
  //   同日 swap の ステップ 数 計算 で 「サーバ の 全行 並び」 と DOM の 同日 並び を
  //   一致 させる ため。 ロック 行 を スキップ すると step count が ずれて 別の 場所 に
  //   item が 移動 して しまう ( = 「変な ところ に 移動」 バグ)。 data-sched-canedit
  //   は 引き続き 「ドラッグ 開始 / ドロップ 受け 可」 の フラグ。
  const dndAttrs = canEdit
    ? `data-sched-canedit="1" data-sched-day="${escapeHtml(dayKey)}"`
    : `data-sched-day="${escapeHtml(dayKey)}"`;
  const itemOpacity = isLocked ? 'opacity:0.7;' : '';
  return `
    <div class="list-item" data-sched-item="${it.id}" ${dndAttrs}
         style="gap:8px; padding:6px 8px; ${rightPad} ${leftPad} align-items:center; cursor:pointer; min-height:68px; position:relative; ${itemOpacity}; overflow:hidden">
      ${heroImage}
      ${lockBadge}
      ${dragHandle}
      ${thumb}
      <div class="grow" style="min-width:0; overflow:hidden; position:relative; z-index:2">
        <div class="bold" style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
          ${escapeHtml(it.title)}${roleSuffix ? `<span class="muted" style="font-weight:400">${roleSuffix}</span>` : ''}${timeStr ? ` <span class="muted" style="font-weight:400">${timeStr}</span>` : ''}
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

// リンク picker: このアイテム以外の同グループ全アイテムをチェックボックスで
// 並べる。 複数選択可。 同じ link_pair_id を持つ予定 (= 既に同じグループに
// 居る) はプリセットでチェック済み。
function renderSchedPairPickerHtml(it) {
  // v399 BUGFIX: day_date=null (ストック item) を 「連結対象」 に出すと
  // o.day_date.slice(5) が TypeError → モーダルが壊れて 「2 個目以降が 追加できない」
  // 症状に。 ストック同士を 連結帯で繋ぐ用途は 無いので 候補から 除外。
  const others = lastSchedItems.filter(x =>
    Number(x.id) !== Number(it.id) && x.day_date !== null);
  if (!others.length) return '';
  const linkedIds = it.link_pair_id
    ? new Set(lastSchedItems
        .filter(x => x.link_pair_id === it.link_pair_id && Number(x.id) !== Number(it.id))
        .map(x => Number(x.id)))
    : new Set();
  const rows = others
    .slice()
    .sort((a, b) => (a.day_date + (a.start_time || '99:99'))
      .localeCompare(b.day_date + (b.start_time || '99:99')))
    .map(o => {
      const t = (o.start_time || '').slice(0, 5);
      const label = `${o.day_date.slice(5).replace('-', '/')}${t ? ' ' + t : ''} ${o.title}`;
      const k = SCHED_KINDS[o.kind] || SCHED_KINDS.other;
      const ch = linkedIds.has(Number(o.id)) ? 'checked' : '';
      return `
        <label style="display:flex; align-items:center; gap:6px; padding:3px 0; font-size:13px">
          <input type="checkbox" data-link-item="${o.id}" ${ch}>
          <span>${k.icon}</span>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(label)}</span>
        </label>`;
    }).join('');
  return `
    <details class="field" ${linkedIds.size ? 'open' : ''}>
      <summary style="cursor:pointer; font-size:13px; color:var(--muted)">
        🔗 連結する予定 ${linkedIds.size ? `(${linkedIds.size} 件選択中)` : '(任意・複数選択可)'}
      </summary>
      <div style="display:flex; flex-direction:column; gap:0; max-height:240px; overflow-y:auto; margin-top:4px; padding:4px 6px; border:1px solid var(--line); border-radius:6px">
        ${rows}
      </div>
      <div class="hint-sm">選んだ予定とは同じ色の帯で連結表示されます。 3 つ以上の連結も可。</div>
    </details>`;
}

// v489 #85 タップ で まず 「内容 確認」 を 開く 読み取り 専用 ビュー。 そこから
//   ✏ 編集 で 既存 の 編集 モーダル へ。 新規 追加 や 編集 モード での 内部 ボタン
//   は そのまま 編集 モーダル を 直接 開く。
function openSchedItemViewModal(gid, it) {
  const root = document.getElementById('gd-sched-modal');
  if (!root) return;
  const k = SCHED_KINDS[it.kind] || SCHED_KINDS.other;
  const timeRow = [];
  if (it.day_date) timeRow.push(`📅 ${it.day_date}${it.end_date && it.end_date !== it.day_date ? ' 〜 ' + it.end_date : ''}`);
  if (it.start_time) {
    let t = it.start_time.slice(0, 5);
    if (it.end_time) t += ` 〜 ${it.end_time.slice(0, 5)}`;
    else if (it.duration_minutes) {
      const [sh, sm] = it.start_time.slice(0, 5).split(':').map(Number);
      const total = (sh * 60 + sm + Number(it.duration_minutes)) % (24 * 60);
      const eh = String(Math.floor(total / 60)).padStart(2, '0');
      const em = String(total % 60).padStart(2, '0');
      t += ` 〜 ${eh}:${em}`;
    }
    timeRow.push(`🕒 ${t}`);
  }
  if (it.duration_minutes) timeRow.push(`⏱ ${it.duration_minutes} 分`);
  const mapLink = (it.lat != null && it.lng != null)
    ? ` <a href="https://maps.google.com/?q=${it.lat},${it.lng}" target="_blank" rel="noopener" style="color:var(--primary)">🗺 地図</a>`
    : '';
  const locRow = it.location
    ? `<div class="meta">📍 ${escapeHtml(it.location)}${mapLink}</div>`
    : (mapLink ? `<div class="meta">${mapLink}</div>` : '');
  const urlRow = it.url
    ? `<div class="meta">🔗 <a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" style="color:var(--primary); word-break:break-all">${escapeHtml(it.url)}</a></div>`
    : '';
  const memoRow = it.memo
    ? `<div style="font-size:13px; white-space:pre-wrap; margin-top:6px; padding:6px 8px; background:#f7f5fa; border-radius:6px">${escapeHtml(it.memo)}</div>`
    : '';
  const heroImg = it.image_url
    ? `<a href="${escapeHtml(it.image_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(it.image_url)}" alt="" style="display:block; width:100%; max-height:240px; object-fit:cover; border-radius:8px; margin:6px 0"></a>`
    : '';
  root.hidden = false;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" id="siv-overlay">
      <div style="background:#fff; border-radius:14px; max-width:480px; width:100%; padding:20px">
        <div class="row center">
          <h3 class="row-title" style="margin:0">${k.icon} ${escapeHtml(it.title || '(無題)')}</h3>
          <button id="siv-close">×</button>
        </div>
        <div class="meta" style="font-size:11px; margin-top:2px">${escapeHtml(k.label)}</div>
        ${timeRow.length ? `<div class="meta" style="margin-top:6px">${timeRow.map(t => escapeHtml(t)).join(' · ')}</div>` : ''}
        ${locRow}
        ${urlRow}
        ${heroImg}
        ${memoRow}
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:10px; flex-wrap:wrap">
          <button id="siv-delete" class="btn" style="color:var(--warn); border-color:var(--warn)">× 削除</button>
          ${it.day_date ? `<button id="siv-tostock" class="btn">📦 ストックに戻す</button>` : ''}
          <button id="siv-copy" class="btn">📋 コピー</button>
          <button id="siv-edit" class="primary">✏ 編集</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  document.getElementById('siv-close').addEventListener('click', close);
  document.getElementById('siv-overlay').addEventListener('click', e => { if (e.target.id === 'siv-overlay') close(); });
  document.getElementById('siv-edit').addEventListener('click', () => {
    close();
    openSchedItemModal(gid, it);
  });
  // v493 #97 日付を外して 「行きたい場所」 ストックに 戻す。
  document.getElementById('siv-tostock')?.addEventListener('click', async () => {
    try {
      await patch(`/api/groups/${gid}/schedule/${it.id}/relocate`, { day_date: '' });
      toast('ストックに 戻し ました');
      close();
      await loadSchedule(gid);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('siv-copy').addEventListener('click', async () => {
    const copyBody = {
      title:      (it.title || '') + ' (コピー)',
      day_date:   it.day_date || null,
      kind:       it.kind,
      start_time: it.start_time || null,
      end_date:   null,
      duration_minutes: it.duration_minutes || null,
      location:   it.location || null,
      url:        it.url || null,
      image_url:  it.image_url || null,
      memo:       it.memo || null,
    };
    try {
      const r = await post(`/api/groups/${gid}/schedule`, copyBody);
      toast('コピーしました');
      close();
      await loadSchedule(gid);
      openSchedItemModal(gid, { ...copyBody, id: r.id });
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('siv-delete').addEventListener('click', async () => {
    if (!confirm('この予定 を 削除 します か?')) return;
    try {
      await del(`/api/groups/${gid}/schedule/${it.id}`);
      toast('削除しました');
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
        ${isNew ? `
        <details class="field" style="margin-top:6px; background:#fffbf0; border-left:3px solid #fcd34d; padding:8px 10px; border-radius:6px">
          <summary class="bold" style="font-size:13px; cursor:pointer">✨ フリーテキストから AI で 自動入力</summary>
          <textarea id="sim-ai-text" rows="2" maxlength="2000" placeholder="例: 6/15 12 時から ヤキニク 飲み会、 渋谷駅前 で 2 時間半 / https://example.com" style="width:100%; box-sizing:border-box; margin-top:6px"></textarea>
          <div class="row" style="gap:6px; align-items:center; margin-top:4px">
            <button id="sim-ai-go" class="btn primary" style="padding:2px 12px; font-size:12px">📝 展開して 流し込む</button>
            <span id="sim-ai-status" class="hint-sm"></span>
          </div>
        </details>` : ''}
        <label class="field"><span class="lbl">日付 (空欄 = ストックに保存)</span>
          <input type="date" id="sim-date" value="${escapeHtml(it.day_date || '')}">
        </label>
        <!-- v485 #78 タイトル ラベル 内 の button が input の フォーカス/カーソル
             を 引っ張って 「カーソル 位置 が ずれる」 と 報告 され た。 button を
             label 外 に 出し、 row レイアウト で 並べる ことで 解消。 -->
        <div class="field">
          <div class="row" style="gap:6px; align-items:center; margin:0 0 4px">
            <span class="lbl" style="margin:0; flex:1">タイトル</span>
            <button id="sim-place-go" type="button" class="btn" style="padding:1px 8px; font-size:11px; flex:none" title="入力した 場所名で Wikipedia + OSM を 検索して 緯度経度 / 説明 / 画像 を 自動入力">🔍 場所を検索</button>
          </div>
          <input type="text" id="sim-title" maxlength="200" value="${escapeHtml(it.title || '')}" autofocus>
          <span id="sim-place-st" class="hint-sm"></span>
        </div>
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
        <label class="field"><span class="lbl">場所 (任意)</span>
          <input type="text" id="sim-loc" maxlength="500" value="${escapeHtml(it.location || '')}">
        </label>
        <label class="field"><span class="lbl">緯度,経度 (任意 — Google Maps から右クリック → コピー で貼れる形式)</span>
          <input type="text" id="sim-latlng" placeholder="例: 35.6586, 139.7454" value="${it.lat != null && it.lng != null ? it.lat + ',' + it.lng : ''}">
        </label>
        <div class="hint-sm">緯度経度が入っていれば 📍 タップで Google Maps の正確な位置へ。</div>
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
        ${renderSchedPairPickerHtml(it)}
        ${isNew ? '' : `
        <div class="field">
          <span class="lbl">添付ファイル (PDF / 画像 / 文書 など)</span>
          <div id="sim-att-list" style="display:flex; flex-direction:column; gap:4px; margin-bottom:6px"></div>
          <div class="row" style="gap:6px; align-items:center">
            <input type="file" id="sim-att-file" multiple style="font-size:12px">
            <span id="sim-att-status" class="hint-sm"></span>
          </div>
          <div class="hint-sm">16MB まで。 タップでダウンロード / ブラウザ表示。</div>
        </div>`}
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px; flex-wrap:wrap">
          ${!isNew ? `<button id="sim-copy" type="button" class="btn">📋 コピー</button>` : ''}
          <button id="sim-cancel">キャンセル</button>
          <button id="sim-save" class="primary">保存</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  document.getElementById('sim-close') .addEventListener('click', close);
  document.getElementById('sim-cancel').addEventListener('click', close);
  document.getElementById('sim-overlay').addEventListener('click', e => { if (e.target.id === 'sim-overlay') close(); });
  // v418 🔍 場所名 から 緯度経度 / 説明 / 画像 を 引っ張る (Wikipedia + Nominatim)
  document.getElementById('sim-place-go')?.addEventListener('click', async () => {
    const titleEl = document.getElementById('sim-title');
    const name = titleEl.value.trim();
    const st = document.getElementById('sim-place-st');
    const btn = document.getElementById('sim-place-go');
    if (!name) { st.textContent = '先に タイトルを 入れてください'; return; }
    btn.disabled = true; st.textContent = '検索中…';
    try {
      const r = await post('/api/ai/place_lookup', { name });
      const parts = [];
      // 緯度経度
      if (r.lat !== null && r.lng !== null) {
        const latlngEl = document.getElementById('sim-latlng');
        if (latlngEl && !latlngEl.value) {
          latlngEl.value = `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`;
          parts.push('緯度経度');
        }
      }
      // 場所 (display_name)
      if (r.display_name) {
        const locEl = document.getElementById('sim-loc');
        if (locEl && !locEl.value) {
          locEl.value = r.display_name;
          parts.push('場所名');
        }
      }
      // 説明 → メモ (既存に 追記しない、 空のときだけ 入れる)
      if (r.description) {
        const memoEl = document.getElementById('sim-memo');
        if (memoEl && !memoEl.value) {
          memoEl.value = r.description;
          parts.push('説明');
        }
      }
      // 画像 (既存 image が無い ときだけ プレビュー + URL セット)
      if (r.image_url && !stagedImage) {
        stagedImage = r.image_url;
        const pv = document.getElementById('sim-img-preview');
        if (pv) { pv.src = r.image_url; pv.hidden = false; pv.style.display = 'block'; }
        const clrBtn = document.getElementById('sim-img-clear');
        if (clrBtn) clrBtn.hidden = false;
        parts.push('画像');
      }
      const src = (r.sources || []).join(' + ');
      st.textContent = parts.length
        ? `✓ ${parts.join(' / ')} を 流し込みました (${src})`
        : `(該当 情報なし 〜 ${src})`;
    } catch (e) {
      st.textContent = '失敗: ' + (e.message || e);
    } finally {
      btn.disabled = false;
    }
  });
  // v416 ✨ AI でフリーテキスト → 各入力欄に展開
  document.getElementById('sim-ai-go')?.addEventListener('click', async () => {
    const txt = document.getElementById('sim-ai-text').value.trim();
    const st  = document.getElementById('sim-ai-status');
    const btn = document.getElementById('sim-ai-go');
    if (!txt) { st.textContent = 'テキストを入れてください'; return; }
    btn.disabled = true; st.textContent = '展開中…';
    try {
      const r = await post('/api/ai/expand_schedule', { text: txt });
      const f = r.fields || {};
      const set = (id, v) => { const el = document.getElementById(id); if (el && v !== null && v !== undefined && v !== '') el.value = v; };
      set('sim-title', f.title);
      set('sim-date', f.day_date);
      set('sim-start', f.start_time);
      set('sim-dur', f.duration_minutes);
      set('sim-loc', f.location);
      set('sim-url', f.url);
      set('sim-memo', f.memo);
      if (f.kind) {
        const sel = document.getElementById('sim-kind');
        if (sel && [...sel.options].some(o => o.value === f.kind)) sel.value = f.kind;
      }
      st.textContent = '✓ 流し込み 完了 (内容を 確認して 保存してください)';
    } catch (e) {
      st.textContent = '失敗: ' + (e.message || e);
    } finally {
      btn.disabled = false;
    }
  });
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
  // 添付ファイル (既存アイテムのみ)。 一覧 + アップロード + 削除。
  if (!isNew) {
    const renderAttRow = (a) => {
      const sz = a.size > 1024 * 1024
        ? (a.size / 1024 / 1024).toFixed(1) + ' MB'
        : Math.max(1, Math.round(a.size / 1024)) + ' KB';
      const icon = a.mime?.startsWith('image/') ? '🖼' : (a.mime === 'application/pdf' ? '📕' : '📄');
      return `<div class="list-item" style="gap:6px; padding:4px 6px; font-size:12px">
        <a href="${escapeHtml(a.stored_path)}" target="_blank" rel="noopener" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--primary)">${icon} ${escapeHtml(a.filename)}</a>
        <span class="muted" style="font-size:11px; flex-shrink:0">${sz}</span>
        <button data-att-rm="${a.id}" class="btn" style="padding:0 6px; font-size:11px; color:var(--muted)">×</button>
      </div>`;
    };
    const reloadAtts = async () => {
      const listEl = document.getElementById('sim-att-list');
      try {
        const d = await get(`/api/groups/${gid}/schedule/${it.id}/attachments`);
        const arr = Array.isArray(d?.attachments) ? d.attachments : [];
        listEl.innerHTML = arr.length
          ? arr.map(renderAttRow).join('')
          : '<div class="hint-sm" style="padding:2px 6px">添付ファイル無し</div>';
        listEl.querySelectorAll('[data-att-rm]').forEach(b => {
          b.addEventListener('click', async () => {
            if (!confirm('この添付ファイルを削除しますか?')) return;
            try { await del(`/api/groups/${gid}/schedule/${it.id}/attachments/${b.dataset.attRm}`); await reloadAtts(); }
            catch (e) { toast('失敗: ' + e.message); }
          });
        });
      } catch (e) {
        listEl.innerHTML = `<div class="hint-sm" style="color:var(--danger)">読み込み失敗: ${escapeHtml(e.message)}</div>`;
      }
    };
    reloadAtts();
    document.getElementById('sim-att-file').addEventListener('change', async (ev) => {
      const files = Array.from(ev.target.files || []);
      if (!files.length) return;
      const st = document.getElementById('sim-att-status');
      let okN = 0, errN = 0;
      for (const f of files) {
        st.textContent = `送信中… ${okN + errN + 1}/${files.length}`;
        try {
          const fd = new FormData();
          fd.append('file', f);
          const r = await fetch(`/api/groups/${gid}/schedule/${it.id}/attachments`, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'labpay' } });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error?.message || ('HTTP ' + r.status));
          }
          okN++;
        } catch (e) { errN++; toast('失敗 ' + f.name + ': ' + e.message); }
      }
      ev.target.value = '';
      st.textContent = errN ? `${okN} 件 OK / ${errN} 件失敗` : `${okN} 件追加`;
      await reloadAtts();
    });
  }
  document.getElementById('sim-save').addEventListener('click', async () => {
    const body = {
      day_date:        document.getElementById('sim-date').value || null,
      title:           document.getElementById('sim-title').value.trim(),
      kind:            document.getElementById('sim-kind').value,
      start_time:      document.getElementById('sim-start').value || null,
      duration_minutes: document.getElementById('sim-dur').value || null,
      location:        document.getElementById('sim-loc').value.trim() || null,
      ...parseLatLng(document.getElementById('sim-latlng').value),
      url:             document.getElementById('sim-url').value.trim() || null,
      image_url:       stagedImage || null,
      memo:            document.getElementById('sim-memo').value.trim() || null,
    };
    if (!body.title)    { toast('タイトルを入れてください'); return; }
    // day_date は null OK (= ストック)
    // リンク picker: チェック済み 他アイテムをすべて自分と同じ pair_id に揃える。
    // 自分の現 pair_id (it.link_pair_id) は 「外された人」 を NULL に戻すための比較に使う。
    const linkChecks = Array.from(document.querySelectorAll('[data-link-item]'));
    const selectedIds = linkChecks.filter(c => c.checked).map(c => Number(c.dataset.linkItem));
    try {
      let saveId;
      if (isNew) {
        const r = await post(`/api/groups/${gid}/schedule`, body);
        saveId = r.id;
      } else {
        await patch(`/api/groups/${gid}/schedule/${it.id}`, body);
        saveId = it.id;
      }
      // リンク処理
      if (linkChecks.length) {
        if (selectedIds.length === 0) {
          // 全部外し → 自分の pair_id を NULL に。 残ったメンバはそのまま連結状態。
          if (it.link_pair_id) {
            await patch(`/api/groups/${gid}/schedule/${saveId}`, { link_pair_id: null });
          }
        } else {
          // 既存連結グループの pair_id を引き継ぐか、 新規生成。
          let pid = it.link_pair_id;
          if (!pid) {
            const someone = selectedIds.map(id => lastSchedItems.find(x => Number(x.id) === id))
                                       .find(x => x?.link_pair_id);
            pid = someone?.link_pair_id
              || ('p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
          }
          // 自分 + 選択された全員 に pair_id を伝播。
          await patch(`/api/groups/${gid}/schedule/${saveId}`, { link_pair_id: pid });
          for (const id of selectedIds) {
            await patch(`/api/groups/${gid}/schedule/${id}`, { link_pair_id: pid });
          }
          // 元グループに居て選び直しで外れたアイテム → pair_id クリア。
          if (it.link_pair_id) {
            const oldGroupMembers = lastSchedItems
              .filter(x => x.link_pair_id === it.link_pair_id && Number(x.id) !== Number(it.id));
            const toRemove = oldGroupMembers.filter(x => !selectedIds.includes(Number(x.id)));
            for (const x of toRemove) {
              await patch(`/api/groups/${gid}/schedule/${x.id}`, { link_pair_id: null });
            }
          }
        }
      }
      toast('保存しました');
      close();
      await loadSchedule(gid);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  // コピー: 現在のアイテムをほぼそのまま別 row として複製。 day_date は 1 日後を
  // 初期値に (連泊や同じ予定の翌日繰り返しを楽にする)。 ペアリンクは引き継がない。
  document.getElementById('sim-copy')?.addEventListener('click', async () => {
    if (!confirm('このアイテムをコピーしますか? (翌日に複製します)')) return;
    const next = (() => {
      const [y, m, dd] = (it.day_date || '').split('-').map(Number);
      if (!y) return it.day_date;
      const dt = new Date(y, m - 1, dd); dt.setDate(dt.getDate() + 1);
      const p = (n) => String(n).padStart(2, '0');
      return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}`;
    })();
    const copyBody = {
      day_date:   next,
      title:      it.title,
      kind:       it.kind,
      start_time: it.start_time || null,
      end_date:   null,
      duration_minutes: it.duration_minutes || null,
      location:   it.location || null,
      url:        it.url || null,
      image_url:  it.image_url || null,
      memo:       it.memo || null,
    };
    try {
      const r = await post(`/api/groups/${gid}/schedule`, copyBody);
      toast('コピーしました');
      close();
      await loadSchedule(gid);
      openSchedItemModal(gid, { ...copyBody, id: r.id });
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

// ──────────────────────────── CHAT ─────────────────────────────────────
// LINE 風のチャット。 5 秒ポーリング (since_id 差分のみ) + 自動スクロール。
// グループ詳細画面から離れたら timer 停止 (#gd-chat-card 消失で検知)。

let chatPollTimer = null;
let chatVisHandler = null;
let chatLastId = 0;
let chatUserScrolled = false; // 上にスクロールして読んでる時は 末尾に勝手に飛ばさない

function stopChatLoop() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  if (chatVisHandler) {
    document.removeEventListener('visibilitychange', chatVisHandler);
    chatVisHandler = null;
  }
}

function renderChatBubble(msg, prevMsg) {
  const meId = state.me?.id;
  const isMe = Number(msg.user_id) === Number(meId);
  // 同じ送信者の連続発言は アバター + 名前 を省略してくっつける。
  const samePrev = prevMsg && Number(prevMsg.user_id) === Number(msg.user_id)
    && (Date.parse((msg.created_at || '').replace(' ', 'T')) - Date.parse((prevMsg.created_at || '').replace(' ', 'T'))) < 5 * 60_000;
  const t = (msg.created_at || '').slice(11, 16);   // HH:MM
  const head = samePrev ? '' : `
    <div style="display:flex; align-items:center; gap:6px; margin:2px 0 2px; ${isMe ? 'flex-direction:row-reverse' : ''}">
      ${avatarHtml(msg.display_name, msg.avatar_url, 'sm')}
      <span class="bold" style="font-size:12px">${escapeHtml(msg.display_name)}</span>
    </div>`;
  const bubbleStyle = isMe
    ? 'background:var(--primary); color:white; align-self:flex-end; border-radius:14px 4px 14px 14px'
    : 'background:white; color:#222; align-self:flex-start; border-radius:4px 14px 14px 14px; border:1px solid var(--line)';
  // 行内の URL を自動リンク化 (rel=noopener)。
  const escaped = escapeHtml(msg.body).replace(/(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u}" target="_blank" rel="noopener" style="color:inherit; text-decoration:underline">${u}</a>`);
  return `
    <div style="display:flex; flex-direction:column; ${isMe ? 'align-items:flex-end' : 'align-items:flex-start'}"
         data-chat-id="${msg.id}">
      ${head}
      <div style="display:flex; align-items:flex-end; gap:4px; max-width:80%; ${isMe ? 'flex-direction:row-reverse' : ''}">
        <div style="padding:6px 10px; ${bubbleStyle}; white-space:pre-wrap; word-break:break-word; font-size:14px">${escaped}</div>
        <span class="muted" style="font-size:10px; padding-bottom:2px; flex-shrink:0">${t}</span>
      </div>
    </div>`;
}

function appendChatMessages(items) {
  const list = document.getElementById('gd-chat-list');
  if (!list || !items.length) return;
  const nearBottom = !chatUserScrolled
    || (list.scrollHeight - list.scrollTop - list.clientHeight < 80);
  // 既存末尾の data-chat-id から prev を取って連続発言判定。
  const lastEl = list.querySelector('[data-chat-id]:last-of-type');
  let prev = null;
  if (lastEl) {
    const id = Number(lastEl.dataset.chatId);
    // body は持って無いので最低限の prev を仮構築 (user / created_at を持つ要素は無い
    // ので、 隣の bubble を見て display_name を読む程度。 大事なのは user_id 一致だけ。
    // ここでは前回最後の msg を chatPrevMsg として module 持ち回す)。
    prev = chatPrevMsg;
  }
  let html = '';
  for (const m of items) {
    html += renderChatBubble(m, prev);
    prev = m;
  }
  chatPrevMsg = prev;
  list.insertAdjacentHTML('beforeend', html);
  if (nearBottom) {
    list.scrollTop = list.scrollHeight;
    chatUserScrolled = false;
  }
}
let chatPrevMsg = null;

async function refreshChat(gid) {
  try {
    const d = await get(`/api/groups/${gid}/chats`, chatLastId ? { since_id: chatLastId } : {});
    const items = d.items || [];
    if (!items.length) return;
    appendChatMessages(items);
    chatLastId = Math.max(chatLastId, ...items.map(m => Number(m.id)));
  } catch (_) { /* ネットワーク失敗は黙って次回再試行 */ }
}

async function startChatLoop(gid) {
  stopChatLoop();
  chatLastId = 0;
  chatPrevMsg = null;
  chatUserScrolled = false;
  const list = document.getElementById('gd-chat-list');
  if (list) {
    list.innerHTML = '';
    list.addEventListener('scroll', () => {
      // ユーザが上に戻ったら 自動末尾追従を無効化、 末尾近くに戻ったら再有効化。
      const distFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      chatUserScrolled = distFromBottom > 80;
    });
  }
  await refreshChat(gid);
  // <details> 開いた瞬間に末尾までスクロール (閉じた状態だと scrollHeight が
  // ゼロなので 初回の auto-scroll が効かないため)。
  const card = document.getElementById('gd-chat-card');
  if (card && list) {
    card.addEventListener('toggle', () => {
      if (card.open) {
        list.scrollTop = list.scrollHeight;
        chatUserScrolled = false;
      }
    });
  }
  // 入力欄: Enter で送信、 Shift+Enter で改行。 自動高さ調整。
  const input = document.getElementById('gd-chat-input');
  const send = document.getElementById('gd-chat-send');
  if (input && send) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(120, input.scrollHeight) + 'px';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send.click();
      }
    });
    send.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        await post(`/api/groups/${gid}/chats`, { body: text });
        input.value = '';
        input.style.height = 'auto';
        await refreshChat(gid);
      } catch (e) { toast('送信失敗: ' + e.message); }
      finally { send.disabled = false; input.focus(); }
    });
  }
  // 5 秒ごとに poll。 タブ裏なら skip。 ページから離れたら stop。
  chatPollTimer = setInterval(() => {
    if (!document.getElementById('gd-chat-card')) { stopChatLoop(); return; }
    if (document.hidden) return;
    refreshChat(gid);
  }, 5000);
  chatVisHandler = () => { if (!document.hidden) refreshChat(gid); };
  document.addEventListener('visibilitychange', chatVisHandler);
}

// ──────────────────────────── LODGINGS / FLIGHTS ──────────────────────
// 「ちょくちょく参照する」 ための独立エンティティ。 詳細フィールド
// (部屋番号・確認コード等) を保持して、 必要に応じて 「スケジュールに反映」 で
// schedule_items として 2 行 (チェックイン/アウト, 出発/到着) を 1 ペアで生成。

// 空港 / 航空会社 自動補完。 静的 JSON を 1 度だけ fetch して module レベルで持つ。
let airportsPromise = null;
let airlinesPromise = null;
function loadAirports() {
  if (!airportsPromise) airportsPromise = fetch('/data/airports.json').then(r => r.json()).catch(() => ({}));
  return airportsPromise;
}
function loadAirlines() {
  if (!airlinesPromise) airlinesPromise = fetch('/data/airlines.json').then(r => r.json()).catch(() => ({}));
  return airlinesPromise;
}

// 入力された IATA 3 文字を 大文字化して空港 DB から探す。 見つかれば 名前 + 市
// をヒントとして表示。
async function setupAirportAutocomplete(inputId, hintId) {
  const input = document.getElementById(inputId);
  const hint = document.getElementById(hintId);
  if (!input || !hint) return;
  const airports = await loadAirports();
  const refresh = () => {
    const code = input.value.trim().toUpperCase();
    if (code.length === 3 && airports[code]) {
      const a = airports[code];
      hint.style.color = '';
      hint.innerHTML = `✈ ${escapeHtml(a.name)} (${escapeHtml(a.city)})`;
    } else if (code.length === 3) {
      hint.style.color = 'var(--muted)';
      hint.textContent = '(未登録の IATA コード)';
    } else {
      hint.textContent = '';
    }
  };
  input.addEventListener('input', refresh);
  refresh();
}

// 便名 (例 NH771, JL101, CX543) の先頭 1〜3 文字から 航空会社を推定して
// airline input が空なら自動補完。 既に airline に値があれば上書きしない。
async function setupAirlineAutoComplete(numId, airlineId) {
  const num = document.getElementById(numId);
  const air = document.getElementById(airlineId);
  if (!num || !air) return;
  const airlines = await loadAirlines();
  const refresh = () => {
    const v = num.value.trim().toUpperCase();
    if (!v) return;
    // 先頭の英字 (2〜3 文字) を抽出。
    const m = v.match(/^([A-Z0-9]{2,3})/);
    if (!m) return;
    const prefix = m[1];
    // IATA は 2 文字または 2 数字、 ICAO は 3 文字。 まず 2 文字、 次に 3 文字。
    let label = airlines[prefix] || airlines[prefix.slice(0, 2)] || null;
    if (label && !air.value.trim()) {
      air.value = label;
      air.dispatchEvent(new Event('input'));
    }
  };
  num.addEventListener('input', refresh);
  num.addEventListener('blur', refresh);
}

// 航空券 添付ファイル (PDF / 画像 / e-ticket 等) を 持ち主タグ付きで管理。
// 持ち主はグループメンバーから選択。 同便の複数メンバーのチケットが整理可能。
async function setupFlightAttachments(gid, fid) {
  const listEl = document.getElementById('fm-att-list');
  const ownerSel = document.getElementById('fm-att-owner');
  const fileEl = document.getElementById('fm-att-file');
  if (!listEl || !ownerSel || !fileEl) return;
  // グループメンバーを owner プルダウンに入れる。 デフォルトは自分。
  let members = [];
  try {
    const g = await get(`/api/groups/${gid}`);
    members = (g.members || []).slice().sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'ja'));
  } catch (_) {}
  // v459 owner は 「未割当 (後で 紐付け)」 を デフォ + 各 行 で 後付け 紐付け 可能 に。
  const ownerOptions = (selectedId, includeBlank = true) => {
    const blank = includeBlank ? `<option value="">— 未割当 —</option>` : '';
    return blank + members.map(m =>
      `<option value="${m.id}" ${Number(m.id) === Number(selectedId) ? 'selected' : ''}>${escapeHtml(m.display_name)}</option>`
    ).join('');
  };
  ownerSel.innerHTML = ownerOptions('');  // アップロード時の デフォ = 未割当

  const ICONS = { 'application/pdf': '📕' };
  const renderRow = (a) => {
    const sz = a.size > 1024 * 1024
      ? (a.size / 1024 / 1024).toFixed(1) + ' MB'
      : Math.max(1, Math.round(a.size / 1024)) + ' KB';
    const icon = a.mime?.startsWith('image/') ? '🖼' : (ICONS[a.mime] || '📄');
    const ownerLabel = a.owner_user_id
      ? `${avatarHtml(a.owner_name, a.owner_avatar, 'sm')}<span class="muted" style="font-size:11px; flex-shrink:0">${escapeHtml(a.owner_name || '')}</span>`
      : `<select data-fatt-owner="${a.id}" style="font-size:11px; max-width:140px"><option value="">— 未割当 —</option>${ownerOptions('', false)}</select>`;
    return `<div class="list-item" style="gap:6px; padding:4px 6px; font-size:12px; align-items:center">
      ${ownerLabel}
      <a href="${escapeHtml(a.stored_path)}" target="_blank" rel="noopener" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--primary)">${icon} ${escapeHtml(a.filename)}</a>
      <span class="muted" style="font-size:11px; flex-shrink:0">${sz}</span>
      <button data-fatt-rm="${a.id}" class="btn" style="padding:0 6px; font-size:11px; color:var(--muted)">×</button>
    </div>`;
  };
  const reload = async () => {
    try {
      const d = await get(`/api/groups/${gid}/flights/${fid}/attachments`);
      const arr = Array.isArray(d?.attachments) ? d.attachments : [];
      // 未割当 を 上 に。 一目で 「誰か 紐付け してね」 と わかる ように。
      arr.sort((a, b) => {
        if (!a.owner_user_id && b.owner_user_id) return -1;
        if (a.owner_user_id && !b.owner_user_id) return 1;
        return (a.id || 0) - (b.id || 0);
      });
      listEl.innerHTML = arr.length
        ? arr.map(renderRow).join('')
        : '<div class="hint-sm" style="padding:2px 6px">添付なし</div>';
      listEl.querySelectorAll('[data-fatt-rm]').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('この添付を削除しますか?')) return;
          try { await del(`/api/groups/${gid}/flights/${fid}/attachments/${b.dataset.fattRm}`); await reload(); }
          catch (e) { toast('失敗: ' + e.message); }
        });
      });
      // v459 未割当 行 の owner ドロップダウン → 選択時 に PATCH で 紐付け
      listEl.querySelectorAll('[data-fatt-owner]').forEach(sel => {
        sel.addEventListener('change', async () => {
          const v = sel.value;
          try {
            await patch(`/api/groups/${gid}/flights/${fid}/attachments/${sel.dataset.fattOwner}`,
              { owner_user_id: v === '' ? null : Number(v) });
            await reload();
          } catch (e) { toast('失敗: ' + e.message); }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div class="hint-sm" style="color:var(--danger)">読み込み失敗</div>`;
    }
  };
  reload();
  // v459 multi-file upload (D&D 含む). HTMLInputElement.multiple を 有効化、
  // 選択 された 全ファイル を 順次 アップロード。 owner は 共通 (= ドロップダウン 値)。
  // 未割当 (空欄) でも 投げる。
  fileEl.setAttribute('multiple', 'multiple');
  fileEl.setAttribute('accept', 'application/pdf,image/*');
  fileEl.addEventListener('change', async (ev) => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    const ownerVal = ownerSel.value;  // '' = 未割当
    const ownerId = ownerVal === '' ? null : Number(ownerVal);
    fileEl.disabled = true;
    let ok = 0, fail = 0;
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      if (ownerId !== null) fd.append('owner_user_id', String(ownerId));
      try {
        const r = await fetch(`/api/groups/${gid}/flights/${fid}/attachments`, {
          method: 'POST', body: fd, credentials: 'same-origin',
          headers: { 'X-Requested-With': 'labpay' },
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error?.message || ('HTTP ' + r.status));
        }
        ok++;
      } catch (e) { fail++; }
    }
    fileEl.value = '';
    fileEl.disabled = false;
    toast(`${ok} 件 アップロード${fail ? ` (失敗 ${fail})` : ''}`);
    await reload();
  });
}

// v354/v357 航空券 e-ticket: 航空会社配布の QR 画像を そのまま アップロード保存。
// 1 行 = 1 人分。 表示は サムネ → タップで原寸 (新タブ)。
async function setupFlightEtickets(gid, fid) {
  const listEl = document.getElementById('fm-et-list');
  const ownerSel = document.getElementById('fm-et-owner');
  if (!listEl || !ownerSel) return;
  // owners は グループメンバー
  try {
    const g = await get('/api/groups/' + gid);
    ownerSel.innerHTML = (g.members || []).map(m =>
      `<option value="${m.id}">${escapeHtml(m.display_name)}</option>`).join('');
    const meId = Number(state.me?.id);
    if ([...ownerSel.options].some(o => Number(o.value) === meId)) ownerSel.value = String(meId);
  } catch (_) {}
  const reload = async () => {
    try {
      const d = await get(`/api/groups/${gid}/flights/${fid}/etickets`);
      const arr = d.etickets || [];
      if (!arr.length) { listEl.innerHTML = '<div class="hint-sm">登録なし</div>'; return; }
      listEl.innerHTML = arr.map(e => {
        const thumb = e.qr_thumb_url || e.qr_image_url;
        const full = e.qr_image_url || e.qr_thumb_url;
        // 画像があれば サムネタップで原寸 (新タブ)、 無ければ qr_payload 文字を表示。
        const qrBlock = full
          ? `<a href="${escapeHtml(full)}" target="_blank" rel="noopener" style="display:block; margin-top:6px; text-align:center"><img src="${escapeHtml(thumb)}" alt="QR" style="max-width:180px; max-height:180px; border:1px solid var(--line); border-radius:6px"></a>`
          : (e.qr_payload ? `<div class="mono hint-sm" style="white-space:pre-wrap; word-break:break-all; margin-top:4px">${escapeHtml(e.qr_payload)}</div>` : '');
        return `
        <div style="border:1px solid var(--line); border-radius:8px; padding:8px; background:#fff" data-et-id="${e.id}">
          <div class="row center" style="margin-bottom:4px">
            <span class="bold" style="font-size:13px; flex:1">${escapeHtml(e.owner_name)}</span>
            <button class="btn" data-et-rm="${e.id}" style="padding:2px 6px; font-size:11px; color:var(--muted)">×</button>
          </div>
          <div class="hint-sm" style="font-size:11px">
            ${e.seat ? '座席: ' + escapeHtml(e.seat) + ' · ' : ''}
            ${e.booking_ref ? '予約: ' + escapeHtml(e.booking_ref) : ''}
          </div>
          ${e.note ? `<div class="hint-sm" style="font-size:11px; white-space:pre-wrap; margin-top:2px">${escapeHtml(e.note)}</div>` : ''}
          ${qrBlock}
        </div>`;
      }).join('');
      listEl.querySelectorAll('[data-et-rm]').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('この e-ticket を削除しますか?')) return;
          try { await del(`/api/groups/${gid}/flights/${fid}/etickets/${b.dataset.etRm}`); toast('削除しました'); await reload(); }
          catch (e) { toast('失敗: ' + e.message); }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div class="hint-sm" style="color:var(--danger)">${escapeHtml(e.message)}</div>`;
    }
  };
  reload();
  // 画像ピッカー: 選択した瞬間に /api/uploads/image へ送る。
  document.getElementById('fm-et-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const st = document.getElementById('fm-et-upst');
    st.textContent = 'アップロード中…';
    try {
      const data = await uploadImage(f);
      document.getElementById('fm-et-imgurl').value = data.url || '';
      document.getElementById('fm-et-thumburl').value = data.thumb_url || data.url || '';
      const prev = document.getElementById('fm-et-preview');
      prev.src = data.url; prev.hidden = false;
      st.textContent = '✓ 完了';
    } catch (e) { st.textContent = '失敗: ' + e.message; }
  });
  document.getElementById('fm-et-add').addEventListener('click', async () => {
    const ownerId = Number(ownerSel.value);
    const imgUrl   = document.getElementById('fm-et-imgurl').value;
    const thumbUrl = document.getElementById('fm-et-thumburl').value;
    if (!ownerId) { toast('持ち主を選んでください'); return; }
    if (!imgUrl)  { toast('QR 画像を選んでください'); return; }
    const body = {
      owner_user_id: ownerId,
      qr_image_url: imgUrl,
      qr_thumb_url: thumbUrl,
      seat: document.getElementById('fm-et-seat').value.trim() || null,
      booking_ref: document.getElementById('fm-et-ref').value.trim() || null,
      note: document.getElementById('fm-et-note').value.trim() || null,
    };
    try {
      await post(`/api/groups/${gid}/flights/${fid}/etickets`, body);
      // form リセット
      document.getElementById('fm-et-file').value = '';
      document.getElementById('fm-et-imgurl').value = '';
      document.getElementById('fm-et-thumburl').value = '';
      const prev = document.getElementById('fm-et-preview');
      prev.hidden = true; prev.src = '';
      document.getElementById('fm-et-upst').textContent = '';
      document.getElementById('fm-et-seat').value = '';
      document.getElementById('fm-et-ref').value = '';
      document.getElementById('fm-et-note').value = '';
      toast('追加しました');
      await reload();
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

function fmtDateTimeShort(s) {
  if (!s) return '';
  return String(s).slice(0, 16).replace(' ', ' '); // "YYYY-MM-DD HH:MM"
}
function toLocalInputValue(s) {
  // DB の "YYYY-MM-DD HH:MM:SS" → datetime-local 用 "YYYY-MM-DDTHH:MM"
  if (!s) return '';
  return String(s).slice(0, 16).replace(' ', 'T');
}

async function loadLodgings(gid) {
  const list = document.getElementById('gd-lodging-list');
  if (!list) return;
  try {
    const d = await get(`/api/groups/${gid}/lodgings`);
    const items = d.items || [];
    document.getElementById('gd-lodging-count').textContent = `(${items.length})`;
    if (!items.length) {
      list.innerHTML = '<div class="empty" style="padding:6px">宿泊地未登録</div>';
      return;
    }
    list.innerHTML = items.map(l => {
      const inOut = [fmtDateTimeShort(l.check_in_at), fmtDateTimeShort(l.check_out_at)]
        .filter(Boolean).join(' 〜 ');
      const room = l.room_number ? ` · 室 ${escapeHtml(l.room_number)}` : '';
      const loc = l.location ? `<div class="meta">📍 ${escapeHtml(l.location)}</div>` : '';
      const url = l.url ? `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="color:var(--primary); font-size:12px">予約サイト 🔗</a>` : '';
      const memo = l.memo ? `<div class="meta" style="white-space:pre-wrap">${escapeHtml(l.memo)}</div>` : '';
      return `
        <div class="list-item" data-lod-edit="${l.id}" style="flex-direction:column; align-items:stretch; gap:4px; padding:8px 10px; cursor:pointer; position:relative">
          <div style="min-width:0; padding-right:36px">
            <div class="bold" style="font-size:14px">${escapeHtml(l.name)}</div>
            <div class="meta" style="font-size:12px">${escapeHtml(inOut || '日程未設定')}${room}</div>
            ${loc}
            ${url}
            ${memo}
          </div>
          <button data-lod-rm="${l.id}" class="btn"
                  style="position:absolute; right:8px; top:8px; padding:2px 8px; font-size:11px; background:#fff; color:var(--muted); border:1px solid var(--line)">削除</button>
        </div>`;
    }).join('');
    list.querySelectorAll('[data-lod-edit]').forEach(el => el.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const it = items.find(x => Number(x.id) === Number(el.dataset.lodEdit));
      if (it) openLodgingModal(gid, it);
    }));
    list.querySelectorAll('[data-lod-rm]').forEach(b => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm('この宿泊地を削除しますか?')) return;
      try { await del(`/api/groups/${gid}/lodgings/${b.dataset.lodRm}`); await loadLodgings(gid); }
      catch (e) { toast('失敗: ' + e.message); }
    }));
  } catch (e) {
    list.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function openLodgingModal(gid, it) {
  const root = document.getElementById('gd-lodging-modal');
  if (!root) return;
  const isNew = !it.id;
  root.hidden = false;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" id="lm-overlay">
      <div style="background:#fff; border-radius:14px; max-width:480px; width:100%; padding:20px">
        <div class="row center">
          <h3 class="row-title">${isNew ? '宿泊地を追加' : '宿泊地を編集'}</h3>
          <button id="lm-close">×</button>
        </div>
        <label class="field"><span class="lbl">宿泊地名</span>
          <input type="text" id="lm-name" maxlength="200" value="${escapeHtml(it.name || '')}" autofocus></label>
        <label class="field"><span class="lbl">場所 (任意)</span>
          <input type="text" id="lm-loc" maxlength="500" value="${escapeHtml(it.location || '')}"></label>
        <label class="field"><span class="lbl">緯度,経度 (任意 — Google Maps から右クリック → コピー で貼れる)</span>
          <input type="text" id="lm-latlng" placeholder="例: 35.6586, 139.7454" value="${it.lat != null && it.lng != null ? it.lat + ',' + it.lng : ''}">
        </label>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:180px"><span class="lbl">チェックイン</span>
            <input type="datetime-local" id="lm-ci" value="${escapeHtml(toLocalInputValue(it.check_in_at))}"></label>
          <label class="field" style="flex:1; min-width:180px"><span class="lbl">チェックアウト</span>
            <input type="datetime-local" id="lm-co" value="${escapeHtml(toLocalInputValue(it.check_out_at))}"></label>
        </div>
        <label class="field"><span class="lbl">部屋番号 (任意)</span>
          <input type="text" id="lm-room" maxlength="60" value="${escapeHtml(it.room_number || '')}"></label>
        <label class="field"><span class="lbl">予約 URL (任意)</span>
          <input type="url" id="lm-url" maxlength="2000" value="${escapeHtml(it.url || '')}"></label>
        <label class="field"><span class="lbl">メモ (任意)</span>
          <textarea id="lm-memo" rows="3" maxlength="2000">${escapeHtml(it.memo || '')}</textarea></label>
        ${isNew ? '' : `
        <div class="row" style="gap:6px; justify-content:flex-start; margin-top:8px">
          <button id="lm-sync" class="btn primary" style="padding:6px 12px">📅 保存してスケジュールに反映</button>
        </div>`}
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
          <button id="lm-cancel">キャンセル</button>
          <button id="lm-save" class="primary">${isNew ? '追加' : '保存'}</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  document.getElementById('lm-close').addEventListener('click', close);
  document.getElementById('lm-cancel').addEventListener('click', close);
  document.getElementById('lm-overlay').addEventListener('click', e => { if (e.target.id === 'lm-overlay') close(); });
  function collectLodgingModal() {
    return {
      name: document.getElementById('lm-name').value.trim(),
      location: document.getElementById('lm-loc').value.trim() || null,
      ...parseLatLng(document.getElementById('lm-latlng').value),
      check_in_at:  document.getElementById('lm-ci').value || null,
      check_out_at: document.getElementById('lm-co').value || null,
      room_number: document.getElementById('lm-room').value.trim() || null,
      url:  document.getElementById('lm-url').value.trim() || null,
      memo: document.getElementById('lm-memo').value.trim() || null,
    };
  }
  document.getElementById('lm-save').addEventListener('click', async () => {
    const body = collectLodgingModal();
    if (!body.name) { toast('宿泊地名を入れてください'); return; }
    try {
      if (isNew) await post(`/api/groups/${gid}/lodgings`, body);
      else       await patch(`/api/groups/${gid}/lodgings/${it.id}`, body);
      toast('保存しました');
      close();
      await loadLodgings(gid);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('lm-sync')?.addEventListener('click', async () => {
    try {
      const body = collectLodgingModal();
      if (!body.name) { toast('宿泊地名を入れてください'); return; }
      await patch(`/api/groups/${gid}/lodgings/${it.id}`, body);
      const r = await post(`/api/groups/${gid}/lodgings/${it.id}/sync`, {});
      toast(`保存 + スケジュールに ${r.created_ids.length} 件追加`);
      close();
      await loadLodgings(gid);
      await loadSchedule(gid);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

async function loadFlights(gid) {
  const list = document.getElementById('gd-flight-list');
  if (!list) return;
  try {
    const d = await get(`/api/groups/${gid}/flights`);
    const items = d.items || [];
    document.getElementById('gd-flight-count').textContent = `(${items.length})`;
    if (!items.length) {
      list.innerHTML = '<div class="empty" style="padding:6px">航空券未登録</div>';
      return;
    }
    list.innerHTML = items.map(f => {
      const label = [f.airline, f.flight_number].filter(Boolean).join(' ');
      const dep = f.dep_at ? `${escapeHtml(f.dep_airport || '?')} ${fmtDateTimeShort(f.dep_at).slice(5)} 発` : '';
      const arr = f.arr_at ? `${escapeHtml(f.arr_airport || '?')} ${fmtDateTimeShort(f.arr_at).slice(5)} 着` : '';
      const conf = f.confirmation_code ? `<div class="meta">予約番号: ${escapeHtml(f.confirmation_code)}</div>` : '';
      const seat = f.seat ? ` · 座席 ${escapeHtml(f.seat)}` : '';
      const url = f.url ? `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener" style="color:var(--primary); font-size:12px">予約サイト 🔗</a>` : '';
      const memo = f.memo ? `<div class="meta" style="white-space:pre-wrap">${escapeHtml(f.memo)}</div>` : '';
      return `
        <div class="list-item" data-flt-edit="${f.id}" style="flex-direction:column; align-items:stretch; gap:4px; padding:8px 10px; cursor:pointer; position:relative">
          <div style="min-width:0; padding-right:36px">
            <div class="bold" style="font-size:14px">${escapeHtml(label || '便')}${seat}</div>
            <div class="meta">${dep}${dep && arr ? ' → ' : ''}${arr}</div>
            ${conf}
            ${url}
            ${memo}
          </div>
          <button data-flt-rm="${f.id}" class="btn"
                  style="position:absolute; right:8px; top:8px; padding:2px 8px; font-size:11px; background:#fff; color:var(--muted); border:1px solid var(--line)">削除</button>
        </div>`;
    }).join('');
    // 行タップで編集モーダル (削除ボタンは stopPropagation)。
    list.querySelectorAll('[data-flt-edit]').forEach(el => el.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const it = items.find(x => Number(x.id) === Number(el.dataset.fltEdit));
      if (it) openFlightModal(gid, it);
    }));
    list.querySelectorAll('[data-flt-rm]').forEach(b => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm('この航空券を削除しますか?')) return;
      try { await del(`/api/groups/${gid}/flights/${b.dataset.fltRm}`); await loadFlights(gid); }
      catch (e) { toast('失敗: ' + e.message); }
    }));
  } catch (e) {
    list.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function openFlightModal(gid, it) {
  const root = document.getElementById('gd-flight-modal');
  if (!root) return;
  const isNew = !it.id;
  root.hidden = false;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto" id="fm-overlay">
      <div style="background:#fff; border-radius:14px; max-width:480px; width:100%; padding:20px">
        <div class="row center">
          <h3 class="row-title">${isNew ? '航空券を追加' : '航空券を編集'}</h3>
          <button id="fm-close">×</button>
        </div>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label class="field" style="flex:2; min-width:160px"><span class="lbl">航空会社</span>
            <input type="text" id="fm-airline" maxlength="120" placeholder="例: ANA (便名から自動補完)" value="${escapeHtml(it.airline || '')}"></label>
          <label class="field" style="flex:1; min-width:120px"><span class="lbl">便名 (IATA + 番号)</span>
            <input type="text" id="fm-num" maxlength="40" placeholder="例: NH771" value="${escapeHtml(it.flight_number || '')}" autocapitalize="characters"></label>
        </div>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:160px"><span class="lbl">出発空港 (IATA)</span>
            <input type="text" id="fm-depap" maxlength="80" placeholder="例: HND" value="${escapeHtml(it.dep_airport || '')}" autocapitalize="characters">
            <span class="hint-sm" id="fm-depap-info"></span>
          </label>
          <label class="field" style="flex:1; min-width:200px"><span class="lbl">出発日時</span>
            <input type="datetime-local" id="fm-depat" value="${escapeHtml(toLocalInputValue(it.dep_at))}"></label>
        </div>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:160px"><span class="lbl">到着空港 (IATA)</span>
            <input type="text" id="fm-arrap" maxlength="80" placeholder="例: ITM" value="${escapeHtml(it.arr_airport || '')}" autocapitalize="characters">
            <span class="hint-sm" id="fm-arrap-info"></span>
          </label>
          <label class="field" style="flex:1; min-width:200px"><span class="lbl">到着日時</span>
            <input type="datetime-local" id="fm-arrat" value="${escapeHtml(toLocalInputValue(it.arr_at))}"></label>
        </div>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <label class="field" style="flex:1; min-width:140px"><span class="lbl">予約番号</span>
            <input type="text" id="fm-conf" maxlength="60" value="${escapeHtml(it.confirmation_code || '')}"></label>
          <label class="field" style="flex:1; min-width:120px"><span class="lbl">座席</span>
            <input type="text" id="fm-seat" maxlength="60" value="${escapeHtml(it.seat || '')}"></label>
        </div>
        <label class="field"><span class="lbl">予約 URL</span>
          <input type="url" id="fm-url" maxlength="2000" value="${escapeHtml(it.url || '')}"></label>
        <label class="field"><span class="lbl">メモ</span>
          <textarea id="fm-memo" rows="3" maxlength="2000">${escapeHtml(it.memo || '')}</textarea></label>
        ${isNew ? '' : `
        <div class="field">
          <span class="lbl">チケット添付 (PDF / 画像 / QR スクショ 等)</span>
          <div id="fm-att-list" style="display:flex; flex-direction:column; gap:4px; margin-bottom:6px"></div>
          <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
            <label class="hint-sm">持ち主:</label>
            <select id="fm-att-owner" style="flex:1; min-width:120px; font-size:13px"></select>
            <input type="file" id="fm-att-file" style="font-size:12px; flex:2; min-width:140px">
          </div>
          <div class="hint-sm">16MB まで。 持ち主はグループメンバーから選択。</div>
        </div>
        <div class="field">
          <span class="lbl">e-ticket (航空会社の QR 画像) 人ごと</span>
          <div id="fm-et-list" style="display:flex; flex-direction:column; gap:8px; margin-bottom:8px"></div>
          <details>
            <summary class="hint" style="cursor:pointer">＋ e-ticket を追加</summary>
            <div style="margin-top:6px">
              <div class="row" style="gap:6px; flex-wrap:wrap">
                <label class="hint-sm">持ち主:</label>
                <select id="fm-et-owner" style="flex:1; min-width:120px; font-size:13px"></select>
              </div>
              <label class="hint-sm" style="margin-top:6px; display:block">QR 画像 (航空会社アプリやメールから 保存した画像 / スクショ)</label>
              <input type="file" id="fm-et-file" accept="image/*" style="font-size:12px">
              <input type="hidden" id="fm-et-imgurl" value="">
              <input type="hidden" id="fm-et-thumburl" value="">
              <img id="fm-et-preview" alt="" hidden style="max-width:140px; max-height:140px; margin-top:6px; border-radius:8px; object-fit:contain; display:block">
              <span id="fm-et-upst" class="hint-sm"></span>
              <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:4px">
                <input type="text" id="fm-et-seat" placeholder="座席 (任意)" maxlength="50" style="flex:1; min-width:100px; font-size:12px">
                <input type="text" id="fm-et-ref"  placeholder="予約番号 (任意)" maxlength="100" style="flex:1; min-width:100px; font-size:12px">
              </div>
              <input type="text" id="fm-et-note" placeholder="メモ (任意)" maxlength="500" style="width:100%; box-sizing:border-box; margin-top:4px; font-size:12px">
              <button id="fm-et-add" class="primary" style="margin-top:6px; padding:4px 12px; font-size:12px">追加</button>
            </div>
          </details>
        </div>`}
        ${isNew ? '' : `
        <div class="row" style="gap:6px; justify-content:flex-start; margin-top:8px">
          <button id="fm-sync" class="btn primary" style="padding:6px 12px">📅 保存してスケジュールに反映</button>
        </div>`}
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
          <button id="fm-cancel">キャンセル</button>
          <button id="fm-save" class="primary">${isNew ? '追加' : '保存'}</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  document.getElementById('fm-close').addEventListener('click', close);
  document.getElementById('fm-cancel').addEventListener('click', close);
  document.getElementById('fm-overlay').addEventListener('click', e => { if (e.target.id === 'fm-overlay') close(); });
  document.getElementById('fm-sync')?.addEventListener('click', async () => {
    // まず通常 save、 続けて sync を呼ぶ。
    try {
      const body = collectFlightModal();
      if (!body.airline && !body.flight_number) { toast('航空会社か便名を入れてください'); return; }
      await patch(`/api/groups/${gid}/flights/${it.id}`, body);
      const r = await post(`/api/groups/${gid}/flights/${it.id}/sync`, {});
      toast(`保存 + スケジュールに ${r.created_ids.length} 件追加`);
      close();
      await loadFlights(gid);
      await loadSchedule(gid);
    } catch (e) { toast('失敗: ' + e.message); }
  });
  // 空港 / 航空会社 自動補完。 入力直後に bundled JSON でルックアップ。
  setupAirportAutocomplete('fm-depap', 'fm-depap-info');
  setupAirportAutocomplete('fm-arrap', 'fm-arrap-info');
  setupAirlineAutoComplete('fm-num', 'fm-airline');
  document.getElementById('fm-depap').dispatchEvent(new Event('input'));
  document.getElementById('fm-arrap').dispatchEvent(new Event('input'));
  document.getElementById('fm-num').dispatchEvent(new Event('input'));
  // 既存航空券のみ: 添付 + e-ticket セクションを wire-up。
  if (!isNew) {
    setupFlightAttachments(gid, it.id);
    setupFlightEtickets(gid, it.id);
  }
  function collectFlightModal() {
    return {
      airline:       document.getElementById('fm-airline').value.trim() || null,
      flight_number: document.getElementById('fm-num').value.trim().toUpperCase() || null,
      dep_airport:   document.getElementById('fm-depap').value.trim().toUpperCase() || null,
      dep_at:        document.getElementById('fm-depat').value || null,
      arr_airport:   document.getElementById('fm-arrap').value.trim().toUpperCase() || null,
      arr_at:        document.getElementById('fm-arrat').value || null,
      confirmation_code: document.getElementById('fm-conf').value.trim() || null,
      seat:          document.getElementById('fm-seat').value.trim() || null,
      url:           document.getElementById('fm-url').value.trim() || null,
      memo:          document.getElementById('fm-memo').value.trim() || null,
    };
  }
  document.getElementById('fm-save').addEventListener('click', async () => {
    const body = collectFlightModal();
    if (!body.airline && !body.flight_number) { toast('航空会社か便名を入れてください'); return; }
    try {
      if (isNew) await post(`/api/groups/${gid}/flights`, body);
      else       await patch(`/api/groups/${gid}/flights/${it.id}`, body);
      toast('保存しました');
      close();
      await loadFlights(gid);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
