// v1208 年度別 名言/迷言 集 (娯楽アプリ)
//   who / when / where / what / context を 登録、 年度末 に 投票 (1 人 1 票 toggle)。
//   URL: /#/sayings  (?year=YYYY で 年度 切替、 ?sort=votes で 得票順)

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

let CURRENT_YEAR = null;
let CURRENT_SORT = 'date';
let LAB_USERS = [];   // 発言者 dropdown 用 (id, display_name)
let ITEMS = [];
let YEARS = [];

export async function renderLabSayings({ query }) {
  const app = document.getElementById('app');
  CURRENT_YEAR = query?.year ? parseInt(query.year, 10) : null;
  CURRENT_SORT = query?.sort === 'votes' ? 'votes' : 'date';

  app.innerHTML = `
    <div class="card">
      <a href="#/games" class="hint">← 娯楽</a>
      <h2 style="margin:6px 0 0">🎤 ラボ名言集</h2>
      <p class="hint" style="margin:6px 0 0; font-size:12px; line-height:1.6">
        誰が いつ どこで 何を 言ったか を 登録。 年度 (4月-3月) ごとに まとめ、 みんなで ❤️ で 投票。 年度末 に 得票順 で 名言大賞 を 決めよう。
      </p>
    </div>

    <div class="card">
      <details>
        <summary style="cursor:pointer; font-weight:600">➕ 名言/迷言 を 登録</summary>
        <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px">
          <label class="field">
            <span class="lbl">発言者 (ラボメンなら 選択、 それ以外は 直接入力)</span>
            <div class="row" style="gap:6px; flex-wrap:wrap">
              <select id="ls-said-user" style="flex:1; min-width:180px">
                <option value="">(選ばない / 外部の人)</option>
              </select>
              <input type="text" id="ls-said-name" maxlength="80" placeholder="表示名 (外部者/ゲスト用)" style="flex:1; min-width:180px">
            </div>
          </label>
          <label class="field">
            <span class="lbl">いつ</span>
            <input type="date" id="ls-said-at" style="max-width:200px">
          </label>
          <label class="field">
            <span class="lbl">どこで</span>
            <input type="text" id="ls-place" maxlength="120" placeholder="例: 明治大学 中野キャンパス 8F">
          </label>
          <label class="field">
            <span class="lbl">何を言った (必須)</span>
            <textarea id="ls-body" rows="3" maxlength="4000" placeholder="例: 「研究は 詰まった時こそ 進んでいる」"></textarea>
          </label>
          <label class="field">
            <span class="lbl">解説/背景 (任意)</span>
            <textarea id="ls-context" rows="2" maxlength="4000" placeholder="どんな状況/雑談 の 流れで 出た 発言か"></textarea>
          </label>
          <div class="row" style="gap:6px; justify-content:flex-end">
            <button class="btn primary" id="ls-create">登録する</button>
          </div>
        </div>
      </details>
    </div>

    <div class="card">
      <div class="row" style="gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:6px">
        <div class="bold">年度</div>
        <select id="ls-year" style="padding:2px 6px"></select>
        <div style="margin-left:auto; display:flex; gap:4px; align-items:center">
          <span class="hint-sm" style="font-size:12px">並び</span>
          <button class="btn ls-sort" data-sort="date"  style="padding:2px 8px; font-size:12px">📅 新しい順</button>
          <button class="btn ls-sort" data-sort="votes" style="padding:2px 8px; font-size:12px">❤️ 得票順</button>
        </div>
      </div>
      <div id="ls-list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('ls-create').addEventListener('click', onCreate);
  document.getElementById('ls-year').addEventListener('change', (ev) => {
    const y = parseInt(ev.target.value, 10);
    navigate(`/sayings?year=${y}${CURRENT_SORT === 'votes' ? '&sort=votes' : ''}`);
  });
  document.querySelectorAll('.ls-sort').forEach(b => b.addEventListener('click', () => {
    const s = b.dataset.sort;
    navigate(`/sayings?year=${CURRENT_YEAR || ''}&sort=${s}`);
  }));
  // 発言者 select が 変わったら 名前 input を 補完
  document.getElementById('ls-said-user').addEventListener('change', (ev) => {
    const uid = parseInt(ev.target.value, 10);
    const nameInput = document.getElementById('ls-said-name');
    if (uid) {
      const u = LAB_USERS.find(x => x.id === uid);
      if (u) { nameInput.value = u.display_name || ''; nameInput.placeholder = '(選択済み)'; }
    }
  });
  // 発言日 は 今日
  document.getElementById('ls-said-at').value = new Date().toISOString().slice(0, 10);
  // 発言者 dropdown 用 の ユーザ一覧 取得 (fire-and-forget)
  loadUsers();
  loadYearsThenList();
}

async function loadUsers() {
  try {
    const d = await get('/api/users');
    LAB_USERS = (d.items || d.users || []).map(u => ({ id: u.id, display_name: u.display_name || u.name || '' }));
    const sel = document.getElementById('ls-said-user');
    if (sel) {
      sel.innerHTML = '<option value="">(選ばない / 外部の人)</option>'
        + LAB_USERS.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('');
    }
  } catch (_) {}
}

async function loadYearsThenList() {
  try {
    const dy = await get('/api/sayings/years');
    YEARS = dy.items || [];
    if (CURRENT_YEAR === null) CURRENT_YEAR = dy.current_year;
    const cur = dy.current_year;
    // 現在年度 が YEARS に なくても 選べる ように 追加
    const yearsSet = new Set(YEARS.map(y => y.fiscal_year));
    if (!yearsSet.has(cur)) YEARS.unshift({ fiscal_year: cur, count: 0 });
    if (!yearsSet.has(CURRENT_YEAR) && CURRENT_YEAR !== cur) YEARS.unshift({ fiscal_year: CURRENT_YEAR, count: 0 });
    const sel = document.getElementById('ls-year');
    if (sel) {
      sel.innerHTML = YEARS.map(y =>
        `<option value="${y.fiscal_year}" ${y.fiscal_year === CURRENT_YEAR ? 'selected' : ''}>${y.fiscal_year} 年度 (${y.count})</option>`
      ).join('');
    }
    document.querySelectorAll('.ls-sort').forEach(b => {
      const active = b.dataset.sort === CURRENT_SORT;
      b.style.background = active ? '#7b3fa0' : '';
      b.style.color = active ? '#fff' : '';
    });
    await loadList();
  } catch (e) {
    document.getElementById('ls-list').innerHTML = `<div class="muted" style="color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

async function loadList() {
  const root = document.getElementById('ls-list');
  try {
    const d = await get('/api/sayings', { year: CURRENT_YEAR, sort: CURRENT_SORT });
    ITEMS = d.items || [];
    if (!ITEMS.length) {
      root.innerHTML = '<div class="muted">この年度にはまだ 名言 が ないよ。 上から 登録して みよう。</div>';
      return;
    }
    root.innerHTML = ITEMS.map(cardHtml).join('');
    root.querySelectorAll('[data-vote-id]').forEach(el => el.addEventListener('click', () => toggleVote(parseInt(el.dataset.voteId, 10))));
    root.querySelectorAll('[data-del-id]').forEach(el => el.addEventListener('click', () => deleteOne(parseInt(el.dataset.delId, 10))));
    root.querySelectorAll('[data-edit-id]').forEach(el => el.addEventListener('click', () => editOne(parseInt(el.dataset.editId, 10))));
  } catch (e) {
    root.innerHTML = `<div class="muted" style="color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function cardHtml(s) {
  const myId = state?.me?.id ?? 0;
  const myRole = state?.me?.role ?? '';
  const canEdit = (s.created_by_user_id === myId) || myRole === 'admin';
  const heart = s.my_voted ? '❤️' : '🤍';
  const heartColor = s.my_voted ? '#e11d48' : '#9ca3af';
  const editButtons = canEdit
    ? `<button class="btn hint-sm" data-edit-id="${s.id}" style="padding:2px 6px; font-size:11px">✏️ 編集</button>
       <button class="btn hint-sm" data-del-id="${s.id}"  style="padding:2px 6px; font-size:11px; color:#b91c1c">🗑</button>`
    : '';
  const said = new Date(s.said_at);
  const dateStr = `${said.getFullYear()}/${said.getMonth() + 1}/${said.getDate()}`;
  const placeStr = s.place ? ` @ ${escapeHtml(s.place)}` : '';
  const contextBlock = s.context
    ? `<details style="margin-top:6px"><summary class="hint-sm" style="cursor:pointer; font-size:12px; color:#6b7280">💬 解説/背景</summary>
        <div style="font-size:13px; color:#4b5563; margin-top:4px; white-space:pre-wrap">${escapeHtml(s.context)}</div>
      </details>` : '';
  return `
    <div class="card" style="margin-bottom:8px; padding:12px; border-left:4px solid #a855f7">
      <div style="display:flex; align-items:flex-start; gap:10px">
        <div style="flex-shrink:0">${avatarHtml(s.said_by_name, s.said_by_avatar, 'sm')}</div>
        <div style="flex:1; min-width:0">
          <div style="font-size:15px; line-height:1.5; white-space:pre-wrap; font-weight:500">「${escapeHtml(s.body)}」</div>
          <div style="font-size:12px; color:#6b7280; margin-top:6px">
            <span style="font-weight:600; color:#4b5563">${escapeHtml(s.said_by_name)}</span>
            <span> ・ ${dateStr}${placeStr}</span>
          </div>
          ${contextBlock}
          <div class="row" style="gap:6px; margin-top:8px; align-items:center">
            <button class="btn" data-vote-id="${s.id}" style="padding:3px 10px; font-size:13px; color:${heartColor}; font-weight:600">${heart} ${s.vote_count}</button>
            <div style="margin-left:auto; display:flex; gap:4px">${editButtons}</div>
          </div>
          <div class="hint-sm" style="font-size:10px; color:#9ca3af; margin-top:4px">登録: ${escapeHtml(s.created_by_name || '')}</div>
        </div>
      </div>
    </div>
  `;
}

async function onCreate() {
  const said_by_user_id = parseInt(document.getElementById('ls-said-user').value, 10) || null;
  const said_by_name = document.getElementById('ls-said-name').value.trim();
  const said_at = document.getElementById('ls-said-at').value;
  const place = document.getElementById('ls-place').value.trim();
  const body = document.getElementById('ls-body').value.trim();
  const context = document.getElementById('ls-context').value.trim();
  if (!said_at) { toast('日付を入れてね'); return; }
  if (!body) { toast('発言内容を入れてね'); return; }
  if (!said_by_name && !said_by_user_id) { toast('発言者を選ぶか、名前を入れてね'); return; }
  try {
    await post('/api/sayings', { said_by_user_id, said_by_name, said_at, place, body, context });
    toast('登録しました');
    // フォーム リセット (発言者 name/uid、 place、 body、 context)
    document.getElementById('ls-said-user').value = '';
    document.getElementById('ls-said-name').value = '';
    document.getElementById('ls-place').value = '';
    document.getElementById('ls-body').value = '';
    document.getElementById('ls-context').value = '';
    await loadYearsThenList();
  } catch (e) {
    toast('登録失敗: ' + e.message);
  }
}

async function toggleVote(id) {
  try {
    const r = await post(`/api/sayings/${id}/vote`, {});
    // 該当 item だけ 差替え
    const item = ITEMS.find(x => x.id === id);
    if (item) {
      item.vote_count = r.vote_count;
      item.my_voted = !!r.voted;
      await loadList();
    }
  } catch (e) { toast('投票失敗: ' + e.message); }
}

async function deleteOne(id) {
  const item = ITEMS.find(x => x.id === id);
  const preview = (item?.body || '').slice(0, 30);
  if (!confirm(`「${preview}${preview.length >= 30 ? '…' : ''}」を 削除?`)) return;
  try {
    await del(`/api/sayings/${id}`);
    toast('削除しました');
    await loadYearsThenList();
  } catch (e) { toast('削除失敗: ' + e.message); }
}

async function editOne(id) {
  const item = ITEMS.find(x => x.id === id);
  if (!item) return;
  // シンプル に prompt で 各項目を 変更 (今回 は inline modal 省略、 別 バージョン で 化粧)
  const newBody = prompt('発言内容 を 修正 (空欄で キャンセル)', item.body);
  if (newBody === null || newBody.trim() === '') return;
  const newContext = prompt('解説/背景 を 修正 (そのまま Enter で 変更なし、 空文字 で 削除)', item.context || '');
  if (newContext === null) return;
  try {
    await patch(`/api/sayings/${id}`, { body: newBody.trim(), context: newContext.trim() });
    toast('更新しました');
    await loadList();
  } catch (e) { toast('更新失敗: ' + e.message); }
}
