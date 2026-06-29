import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate, safeHttpUrl } from '../router.js';
import { state, toast } from '../app.js';
import { uploadTaskAttachment } from '../upload.js';
import { fmtLocalInput } from '../format.js';
import { localDtToIso, isoToLocalDt, tzToggleHtml, bindTzToggle, getTzMode } from '../tz_helper.js';
import { shareToSns, copyShareUrl } from '../share_to_sns.js';

const GRADES = ['B3', 'B4', 'M1', 'M2', 'D'];
// 学年の表示順 (上位学年から)。指名 picker のソートと bulk ボタン順に使用。
const GRADE_ORDER = ['D','M2','M1','B4','B3',''];

// v787 #390 タスク 説明 内 の URL を 別 タブ で 開ける リンク に。 escapeHtml した 後 で URL パターン だけ <a target="_blank"> に 置換。
function linkifyUrlsHtml(escapedText) {
  return String(escapedText).replace(/(https?:\/\/[^\s<>"']+)/g, url =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--primary); text-decoration:underline; word-break:break-all">${url}</a>`
  );
}

// v790 #393 完了 時 入力 欄 spec をパース。 1 行 1 項目、 `key|label|type|options` 形式。
//   type は text / textarea / select、 options は select 用 の ; 区切り。
//   label / type 末尾 に「*」 で required。 全 空 → null を 返す。
function parseCompletionFieldsSpec(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  if (lines.length > 10) throw new Error('最大 10 個 まで');
  const out = [];
  const seen = new Set();
  for (const ln of lines) {
    const parts = ln.split('|').map(s => s.trim());
    let key = parts[0] || '';
    let label = parts[1] || '';
    let type = (parts[2] || 'text').replace(/\*$/, '').trim();
    const requiredMark = (parts[2] || '').endsWith('*') || (parts[1] || '').endsWith('*');
    if (label.endsWith('*')) label = label.slice(0, -1).trim();
    const optsRaw = parts[3] || '';
    if (!key || !label) throw new Error(`行「${ln}」: key|label が 必要`);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(key)) throw new Error(`「${key}」 は 半角英数 _ - 32 字 以内`);
    if (seen.has(key)) throw new Error(`key 重複: ${key}`);
    seen.add(key);
    if (!['text', 'textarea', 'select'].includes(type)) throw new Error(`type は text / textarea / select のみ`);
    const f = { key, label, type, required: requiredMark };
    if (type === 'select') {
      const opts = optsRaw.split(';').map(s => s.trim()).filter(Boolean);
      if (!opts.length) throw new Error(`select は ; 区切り の オプション が 必要 (例: OK;NG)`);
      f.options = opts;
    }
    out.push(f);
  }
  return out;
}

// v790 #393 受諾者 の 完了 報告 フォーム に カスタム 入力 欄 を 差し込む HTML
function renderCompletionFieldsForm(fields) {
  if (!Array.isArray(fields) || !fields.length) return '';
  return `<div style="margin-top:8px; padding:8px 12px; background:#f5f3ff; border-left:3px solid #6b21a8; border-radius:0 6px 6px 0">
    <div class="bold" style="font-size:13px; color:#6b21a8; margin-bottom:4px">📝 完了 時 の 入力 欄</div>
    ${fields.map(f => {
      const id = 'cf-' + f.key;
      const lbl = escapeHtml(f.label) + (f.required ? ' <span style="color:#dc2626">*</span>' : '');
      if (f.type === 'select') {
        return `<label class="field" style="margin:6px 0">
          <span class="lbl" style="font-size:12px">${lbl}</span>
          <select id="${id}" data-cf-key="${escapeHtml(f.key)}">
            <option value=""></option>
            ${f.options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
          </select>
        </label>`;
      }
      if (f.type === 'textarea') {
        return `<label class="field" style="margin:6px 0">
          <span class="lbl" style="font-size:12px">${lbl}</span>
          <textarea id="${id}" data-cf-key="${escapeHtml(f.key)}" rows="2" maxlength="5000" placeholder="${escapeHtml(f.placeholder||'')}"></textarea>
        </label>`;
      }
      return `<label class="field" style="margin:6px 0">
        <span class="lbl" style="font-size:12px">${lbl}</span>
        <input id="${id}" data-cf-key="${escapeHtml(f.key)}" type="text" maxlength="2000" placeholder="${escapeHtml(f.placeholder||'')}">
      </label>`;
    }).join('')}
  </div>`;
}

// v790 #393 完了 報告 フォーム から 値 を 収集 + 簡易 必須 チェック
function collectCompletionFieldsValues(fields) {
  if (!Array.isArray(fields) || !fields.length) return null;
  const out = {};
  for (const f of fields) {
    const el = document.getElementById('cf-' + f.key);
    if (!el) continue;
    const v = (el.value || '').trim();
    if (!v) {
      if (f.required) throw new Error(`「${f.label}」 は 入力 必須 です`);
      continue;
    }
    out[f.key] = v;
  }
  return out;
}

// 履歴トグル: デフォは 「進行中のみ」、ON にすると終了/取消も含めて表示する。
// 同一セッション内では維持したいが、メモリ上の変数で十分 (renderTasks 呼び直し
// で初期化されても利便性は下がらない)。
let showHistory = false;

export async function renderTasks() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:flex-end; gap:6px; flex-wrap:wrap">
        <button id="task-new"     class="primary">+ 募集 (報酬あり)</button>
        <button id="task-assign"  class="btn">+ 割り当て</button>
        <button id="task-request" class="btn">+ 依頼 (報酬なし)</button>
      </div>
      <p class="muted" style="font-size:12px; margin:8px 0 0">
        <span class="text-primary">●</span> 自分 が 起案  ·
        <span style="color:#b54708">●</span> 引き受け 中 / 承認 待ち  ·
        <span style="color:#0e7c63">●</span> 受けられる
      </p>
      <p class="hint-sm" style="margin:6px 0 0">
        <b>🎯 募集</b> = 報酬付き、 誰 でも 引き受け OK の 公募 型 /
        <b>👤 割り当て</b> = 報酬付き、 指名 型 /
        <b>🙏 依頼</b> = 報酬 なし で お願い (善意 で 引き受けて もらう)
      </p>
      <label class="hint" style="display:inline-flex; align-items:center; gap:6px; margin-top:8px">
        <input type="checkbox" id="task-show-history" ${showHistory ? 'checked' : ''}>
        終了・取消したタスクも表示
      </label>
    </div>
    <div id="task-form-card" hidden></div>
    <div id="task-list"><div class="muted">読み込み中…</div></div>
  `;

  document.getElementById('task-new')    .addEventListener('click', () => toggleCreateForm('request'));
  document.getElementById('task-assign') .addEventListener('click', () => toggleCreateForm('assign'));
  document.getElementById('task-request').addEventListener('click', () => toggleCreateForm('free'));
  document.getElementById('task-show-history').addEventListener('change', (ev) => {
    showHistory = ev.currentTarget.checked;
    loadList();
  });
  // ホームの「＋ 新しくタスクを設定する」 経由など、 #/tasks?new=request / ?new=assign
  // で来た場合は対応フォームを自動展開。query 部分はそのまま残しておくと再 render
  // で毎回開いて鬱陶しいので、 URL を綺麗にしてから開く。
  const m = (location.hash || '').match(/[?&]new=(request|assign|free)/);
  if (m) {
    history.replaceState(null, '', '#/tasks');
    toggleCreateForm(m[1]);
    // ホームからの 遷移で 前画面の スクロール位置 が 引き継がれて 「フォーム途中
    // からになる」 不具合の 対処 (feedback#11)。 ページ先頭に 戻してから 開いた
    // フォームの 先頭が 自然に 見える 状態 にする。
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  await loadList();
}

// 作成フォームのモード: 'request' (募集型) / 'assign' (指名型)。
// renderForm の出し分けと onCreate のペイロード組み立てに使う。
let createMode = null;

function toggleCreateForm(mode = null) {
  const card = document.getElementById('task-form-card');
  // 同じモードを再度押す or mode=null → 閉じる
  if (mode === null || (createMode === mode && !card.hidden)) {
    card.hidden = true; card.innerHTML = ''; createMode = null; return;
  }
  createMode = mode;
  const isAssign = mode === 'assign';
  const isFree   = mode === 'free';  // 報酬なし リクエスト

  // 共通フィールド
  const commonTop = `
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="t-title" maxlength="200">
      </label>
      <label class="field">
        <span class="lbl">作業 URL (任意)</span>
        <input type="url" id="t-url" maxlength="2000" placeholder="https://...">
        <div class="hint-sm">引き受けた人が「作業を開く」を押すと新しいタブで開きます。</div>
      </label>
      <label class="field">
        <span class="lbl">詳細 (任意)</span>
        <textarea id="t-desc" maxlength="5000" rows="3"></textarea>
      </label>
      <label class="field">
        <span class="lbl">完了時のメッセージ (任意)</span>
        <textarea id="t-cmsg" maxlength="2000" rows="2" placeholder="ありがとうございます!次もよろしくね"></textarea>
        <div class="hint-sm">承認時にやってくれた人へ表示されます (note 風)。</div>
      </label>
      <label class="field">
        <span class="lbl">📝 完了時の入力欄 (任意・最大 10 個)</span>
        <textarea id="t-cfields" maxlength="2000" rows="4" placeholder="1 行 1 項目で「key|ラベル|type|オプション」 を 並べる。 type は text / textarea / select。 select の オプション は ; 区切り。 末尾 に * を 付ける と 必須。 例:&#10;user_id|ユーザID|text*&#10;exp_id|実験ID|select|A;B;C;D*&#10;issue|問題点・気づき|textarea&#10;survey_url|↗ 感想 アンケート (target=_blank)|text"></textarea>
        <div class="hint-sm" style="margin-top:4px; display:flex; gap:6px; flex-wrap:wrap">
          <button type="button" class="btn" id="t-cfields-preset-userexp"  style="font-size:11px; padding:2px 8px">↳ サンプル: ユーザID + 実験ID</button>
          <button type="button" class="btn" id="t-cfields-preset-pre"     style="font-size:11px; padding:2px 8px">↳ サンプル: プレ 実験 (問題点 + 感想 URL)</button>
        </div>
        <div class="hint-sm">受諾者が完了報告時に埋める欄。 ID 選択 / 自由入力 / 問題報告 などに 使えます (key は半角英数 _- 32 字 以内)。</div>
      </label>`;

  // 報酬欄: 募集型は「報酬 + 募集人数」 2 列、指名型は「報酬」 1 列のみ。
  const rewardRow = isAssign
    ? `<label class="field">
         <span class="lbl">報酬 (pt / 1人あたり、0 OK)</span>
         <input type="number" id="t-reward" min="0" value="10">
       </label>`
    : `<div class="row">
         <label class="field grow">
           <span class="lbl">報酬 (pt / 1人あたり、0 OK)</span>
           <input type="number" id="t-reward" min="0" value="10">
         </label>
         <label class="field grow">
           <span class="lbl">募集人数</span>
           <input type="number" id="t-capacity" min="1" value="1">
         </label>
       </div>`;

  // 募集型のみ: 参加回数、時間枠。 対象学年の checkbox は廃止し、共通の picker
  // (全員/学年/性別 bulk + 個別 chip) で対象を絞る。
  const requestOnly = isAssign ? '' : `
      <label class="field">
        <span class="lbl">1人あたりの参加可能回数</span>
        <select id="t-perlimit">
          <option value="1" selected>1回まで</option>
          <option value="3">3回まで</option>
          <option value="5">5回まで</option>
          <option value="0">無制限</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">時間枠 (任意・指定すると 各 枠 単位 で 募集)</span>
        <textarea id="t-slots" rows="4" placeholder="例) 6/15 11:00-15:00 30分刻み&#10;6/16 13:00-17:00 60分刻み x3      ← 各 枠 3 人&#10;6/17 14:00-18:00 30分刻み 5人   ← 各 枠 5 人"></textarea>
        <span class="hint-sm">
          各 枠 の 募集 人数 は 末尾 に <b>x3</b> や <b>3人</b> を 付けて 指定 (省略 時 1 人)。 「募集人数」 は 全 枠 の 合計 で 自動 算出 されます。
        </span>
      </label>`;

  // 依頼 / 割り当て 共通の picker: 全員/学年/性別 bulk + 個別 chip。
  // 依頼 mode は picked = audience filter (空 OK = 全員)、
  // 割り当て mode は picked = 直接アサイン (1人以上必須)。
  const pickerLabel = isAssign
    ? '割り当てる人 (必須・1 人以上)'
    : '対象 (空欄なら全員 OK / 絞り込みたい時に選ぶ)';
  const pickerHint = isAssign
    ? '承諾不要で 「やってください」 状態になり、本人に通知が飛びます。完了したら本人が報告 → あなたが承認 で支払い。'
    : 'チェックを入れた人だけが引き受け可能になります。空欄なら学年制限なし。';
  const pickerSection = `
      <div class="field">
        <span class="lbl">${pickerLabel}</span>
        <div id="t-pick-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px"></div>
        <div id="t-assigned-picker" class="row" style="gap:6px; flex-wrap:wrap">
          <span class="hint">読み込み中…</span>
        </div>
        <div id="t-pick-count" class="hint-sm" style="margin-top:6px">0 人選択中</div>
        <span class="hint-sm">${pickerHint}</span>
      </div>`;

  const deadline = `
      <label class="field">
        <span class="lbl">締切 (任意・無指定なら無期限)</span>
        ${tzToggleHtml('t-deadline-tz')}
        <input type="datetime-local" id="t-deadline">
      </label>`;

  // v749 #363 添付欄 が でかすぎ た ので コンパクト化。 label を 詰めて hint を 1 行 に。
  const files = `
      <label class="field" style="margin-bottom:6px">
        <span class="lbl" style="font-size:12px">📎 添付 (任意・複数可・1 ファイル 50MB)</span>
        <input type="file" id="t-files" multiple
               accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.md,.csv,image/*"
               style="font-size:12px">
      </label>`;

  const heading = isAssign ? 'タスクを割り当てる'
                : isFree   ? 'リクエスト (報酬なし) を出す'
                : 'タスクを依頼する';
  const intro = isAssign
    ? `<b>指定した人に直接アサイン</b>します。承諾不要で 「やる人」 として登録され、本人に通知が飛びます。完了報告→承認の流れは募集型と同じ。
       <br>・<b>報酬 × 指名人数の pt が ESCROW</b> に預けられます (取り消し時は未承認分が返金)。`
    : isFree
    ? `<b>報酬なしで お願い</b>するモードです。 善意で 誰かが 引き受けてくれます。 ESCROW も発生しません。
       <br>・タスクの一覧では 「🙏 リクエスト」 タグが付いて 表示されます。`
    : `<b>対象を絞れる募集</b>です。学年指定 (B3/B4/M1/M2/D) または全員に出せる。
       <br>・<b>時間枠で予定調整</b> — 「6/15 11:00-15:00 30分刻み」 で 枠 ごと に 1 人 / 末尾 「<b>x3</b>」 or 「<b>3人</b>」 で 各 枠 複数 人 募集 (v875)。
       <br>・<b>報酬 × 人数の pt が ESCROW</b> に預けられます (取り消し時は未承認分が返金)。`;

  card.hidden = false;
  card.innerHTML = `
    <div class="card">
      <h3>${heading}</h3>
      <div class="muted" style="font-size:12px; background:#faf7fd; border-left:3px solid var(--primary); padding:8px 10px; margin-bottom:10px; line-height:1.7">
        ${intro}
      </div>
      ${commonTop}
      ${isFree ? '' : rewardRow}
      ${isFree || state.me?.role !== 'admin' ? '' : `
        <label class="field" style="display:flex; align-items:center; gap:6px; background:#fef9c3; border:1px dashed #ca8a04; padding:6px 10px; border-radius:6px">
          <input type="checkbox" id="t-fund-system">
          <span style="font-size:13px"><b>💰 システム 持ち出し</b> (admin のみ — 報酬 × 人数 を LabPay 公式 アカウント から 出金 する)</span>
        </label>`}
      ${deadline}
      ${requestOnly}
      ${pickerSection}
      ${files}
      <div class="row" style="margin-top:6px">
        <button id="t-submit" class="primary">${isAssign ? '割り当てる' : isFree ? 'リクエストを出す' : '依頼する'}</button>
        <button id="t-cancel">キャンセル</button>
      </div>
    </div>`;
  document.getElementById('t-cancel').addEventListener('click', () => toggleCreateForm(null));
  document.getElementById('t-submit').addEventListener('click', onCreate);
  // v874 #455 完了 時 入力欄 サンプル の プリセット ボタン
  const cfEl = document.getElementById('t-cfields');
  document.getElementById('t-cfields-preset-userexp')?.addEventListener('click', () => {
    if (cfEl) cfEl.value = 'user_id|ユーザID|text*\nexp_id|実験ID|select|A;B;C;D*\nnote|メモ (任意)|textarea';
  });
  document.getElementById('t-cfields-preset-pre')?.addEventListener('click', () => {
    if (cfEl) cfEl.value = 'user_id|ユーザID|text*\nissue|問題点・気づき|textarea*\nsurvey_url|↗ 感想 アンケート (target=_blank で 開く)|text';
  });
  populateAssignedPicker();
}

// 指名 / 対象 picker — 「全員」 「学年」 「性別」 の bulk filter + 個別 chip。
// 学年順 (D → M2 → M1 → B4 → B3 → 他) でソート。同学年内は表示名 50 音順。
// 依頼 mode / 割り当て mode の両方で同じ picker を使う (上位 toggleCreateForm が
// label と hint だけ出し分け、picker の使い方は同じ)。
const assignedPicked = new Set();
let allTaskUsers = [];

async function populateAssignedPicker() {
  assignedPicked.clear();
  try {
    const u = await get('/api/users');
    allTaskUsers = [...u.items].sort((a, b) => {
      const ga = GRADE_ORDER.indexOf(a.grade || '');
      const gb = GRADE_ORDER.indexOf(b.grade || '');
      return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) ||
             (a.display_name || '').localeCompare(b.display_name || '', 'ja');
    });
    const grades = [...new Set(allTaskUsers.map(x => x.grade).filter(Boolean))]
      .sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
    const bulk = document.getElementById('t-pick-bulk');
    if (bulk) {
      bulk.innerHTML = `
        <button data-bulk="all"      class="btn">全員</button>
        ${grades.map(g => `<button data-bulk="grade:${g}" class="btn">${g}</button>`).join('')}
        <button data-bulk="gender:M" class="btn">男</button>
        <button data-bulk="gender:F" class="btn">女</button>
        <button data-bulk="clear"    class="btn">クリア</button>`;
      bulk.querySelectorAll('[data-bulk]').forEach(b => {
        b.addEventListener('click', () => applyBulkPick(b.dataset.bulk));
      });
    }
    const root = document.getElementById('t-assigned-picker');
    if (!root) return;
    root.innerHTML = allTaskUsers.map(x => `
      <span class="rl-chip" data-uid="${x.id}" style="cursor:pointer">
        ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
        <span>${escapeHtml(x.display_name)}</span>
        ${x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : ''}
      </span>`).join('');
    root.querySelectorAll('.rl-chip').forEach(c => {
      c.addEventListener('click', () => togglePick(Number(c.dataset.uid)));
    });
    refreshPickChips();
  } catch (_) { /* best-effort */ }
}

function memberMatchesBulk(u, key) {
  if (key === 'all') return true;
  if (key.startsWith('grade:'))  return (u.grade  || '') === key.slice(6);
  if (key.startsWith('gender:')) return (u.gender || '') === key.slice(7);
  return false;
}
function applyBulkPick(key) {
  if (key === 'clear') { assignedPicked.clear(); refreshPickChips(); return; }
  const targets = allTaskUsers.filter(u => memberMatchesBulk(u, key));
  const allOn = targets.every(u => assignedPicked.has(u.id));
  if (allOn) targets.forEach(u => assignedPicked.delete(u.id));
  else       targets.forEach(u => assignedPicked.add(u.id));
  refreshPickChips();
}
function togglePick(uid) {
  if (assignedPicked.has(uid)) assignedPicked.delete(uid);
  else assignedPicked.add(uid);
  refreshPickChips();
}
function refreshPickChips() {
  document.querySelectorAll('#t-assigned-picker .rl-chip').forEach(c => {
    const on = assignedPicked.has(Number(c.dataset.uid));
    c.style.background  = on ? 'var(--primary-soft, #efeafa)' : '';
    c.style.borderColor = on ? 'var(--primary)' : '';
  });
  const count = document.getElementById('t-pick-count');
  if (count) count.textContent = `${assignedPicked.size} 人選択中`;
}

async function onCreate() {
  const isAssign = createMode === 'assign';
  const isFree   = createMode === 'free';
  const title = document.getElementById('t-title').value.trim();
  const url = document.getElementById('t-url').value.trim();
  const description = document.getElementById('t-desc').value.trim();
  const completion_message = document.getElementById('t-cmsg').value.trim();
  // v790 #393 完了 時 入力 欄
  let completion_fields = null;
  try { completion_fields = parseCompletionFieldsSpec(document.getElementById('t-cfields')?.value || ''); }
  catch (e) { toast('完了 時 入力 欄: ' + e.message); return; }
  // 報酬: リクエストモードは 強制 0、 そうでなければ フォームから。
  const reward = isFree ? 0 : Number(document.getElementById('t-reward').value);
  // v560 #215 deadline は TZ helper 経由で JST or ローカル を選択可能に
  const deadlineRaw = document.getElementById('t-deadline').value || null;
  const deadline = deadlineRaw ? localDtToIso(deadlineRaw) : null;
  if (!title || !(reward >= 0)) { toast('タイトルを確認してください'); return; }
  const files = Array.from(document.getElementById('t-files')?.files || []);

  // モード別ペイロード組み立て:
  // * request: 募集人数 / per-user limit / 時間枠 / 対象学年 を含める
  // * assign : assigned_user_ids を含め、capacity は backend が指名人数に強制セット
  let payload = {
    title,
    url: url || null,
    description: description || null,
    completion_message: completion_message || null,
    completion_fields: completion_fields,   // v790 #393
    funded_by_system: document.getElementById('t-fund-system')?.checked ? 1 : 0,  // v874 #455 admin only
    reward,
    deadline,
  };
  if (isAssign) {
    if (assignedPicked.size === 0) { toast('割り当てる人を 1 人以上選んでください'); return; }
    payload.assigned_user_ids = [...assignedPicked];
    payload.auto_claim = true;
    payload.per_user_limit = 1;
    payload.capacity = assignedPicked.size; // backend 側でも上書きされるが明示。
  } else {
    const slots_spec = document.getElementById('t-slots').value.trim();
    // v700 #289 リクエスト モード では t-capacity input が DOM に 無い (rewardRow 側 の
    //   入力 として 同居 して いた ため、 isFree=true で 「報酬」 行 ごと skip される)。
    //   結果、 querySelector が null を 返して .value で TypeError → ボタン が
    //   無反応 に なる bug 修正。 fallback で 1 人 募集 を 既定 に。
    const tCapEl = document.getElementById('t-capacity');
    const capacityRaw = tCapEl ? Number(tCapEl.value) : 1;
    const capacity = isFree ? Math.max(1, capacityRaw || 1) : capacityRaw;
    const per_user_limit = Number(document.getElementById('t-perlimit').value);
    if (!isFree && !slots_spec && !(capacity > 0)) { toast('募集人数か時間枠を入れてください'); return; }
    payload.capacity = capacity;
    payload.per_user_limit = per_user_limit;
    payload.slots_spec = slots_spec || null;
    // 依頼 mode の picker: 0 人選択 = 全員可、それ以上 = audience filter として
    // assigned_user_ids を送る (auto_claim=false で auto-claim はしない)。
    if (assignedPicked.size > 0) {
      payload.assigned_user_ids = [...assignedPicked];
      payload.auto_claim = false;
    }
  }

  try {
    const created = await post('/api/tasks', payload);
    // Upload attachments after the task row is created so the task_id exists.
    // Failures here are surfaced but don't roll back the task — uploader can
    // retry from the task detail page (TODO: per-detail upload UI).
    let attachFails = 0;
    for (const f of files) {
      try { await uploadTaskAttachment(created.id, f); }
      catch (e) { attachFails++; console.warn('attach failed:', f.name, e); }
    }
    const verb = isAssign ? '割り当てました' : isFree ? 'リクエストを出しました' : '依頼しました';
    if (attachFails > 0) toast(`作成しました (添付 ${attachFails}件 失敗)`);
    else toast(verb + (files.length ? ` (添付 ${files.length}件)` : ''));
    toggleCreateForm(null);
    await loadList();
    navigate('#/tasks');
  } catch (e) { toast('失敗: ' + e.message); }
}


function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

async function loadList() {
  try {
    const d = await get('/api/tasks');
    const root = document.getElementById('task-list');
    // 表示フィルタ: 進行中 (status='open') のみが default。トグル ON で
    // closed/cancelled も含めて表示。
    const items = showHistory
      ? d.items
      : d.items.filter(t => t.status === 'open');
    if (!items.length) {
      const msg = showHistory
        ? '該当するタスクはありません'
        : '進行中のタスクはありません (チェックを入れると終了・取消も表示)';
      root.innerHTML = `<div class="card empty">${msg}</div>`;
      return;
    }
    // Sort: 自分が引き受け中/報告済みを先頭 → 承認待ちのある自分のタスク
    //     → その他自分のタスク → 受けられるタスク → 完了・参加済み
    const score = t => {
      if (['claimed', 'reported'].includes(t.my_status)) return 0;
      if (t.is_mine && t.pending_count > 0) return 1;
      if (t.is_mine) return 2;
      if (t.can_claim) return 3;
      return 4;
    };
    const sorted = items.slice().sort((a, b) => {
      const sa = score(a), sb = score(b);
      if (sa !== sb) return sa - sb;
      return b.id - a.id;
    });
    root.innerHTML = sorted.map(renderRow).join('');
  } catch (e) {
    document.getElementById('task-list').innerHTML = `<div class="card muted">${escapeHtml(e.message)}</div>`;
  }
}

// Role-coloured task row: each task carries a left border whose color tells the
// viewer their relationship to it at a glance — own task (purple), in-progress
// (orange), claimable (green), or neutral (gray).
function renderRow(t) {
  const audTag = t.audience_grades ? `<span class="tag muted" style="margin-left:4px">${escapeHtml(t.audience_grades)}</span>` : '';
  const assignedTag = t.assigned_user_ids
    ? `<span class="tag warn" style="margin-left:4px">${t.is_assigned_to_me ? '👉 あなた指名' : '指名'}</span>`
    : '';
  const statusTag = ({
    open: '<span class="tag">募集中</span>',
    closed: '<span class="tag muted">完了</span>',
    cancelled: '<span class="tag danger">取消</span>',
  })[t.status] || '';
  const deadlineTag = t.deadline ? `<span class="tag warn" style="margin-left:4px">締切 ${escapeHtml(t.deadline)}</span>` : '';
  const pendingTag = (t.is_mine && t.pending_count > 0)
    ? `<span class="tag" style="margin-left:4px; background:#fff3df; color:var(--warn)">🔔 完了待ち ${t.pending_count}</span>`
    : '';

  // Decide row role + border color.
  let borderColor = '#dadbe2', roleBadge = '';
  if (['claimed', 'reported'].includes(t.my_status)) {
    borderColor = '#b54708';
    const lbl = t.my_status === 'claimed' ? '引き受け中' : '承認待ち';
    roleBadge = `<span class="tag warn" style="margin-left:4px">${lbl}</span>`;
  } else if (t.is_mine) {
    borderColor = 'var(--primary)';
    roleBadge = '<span class="tag" style="margin-left:4px">自分が依頼</span>';
  } else if (t.can_claim) {
    borderColor = '#0e7c63';
  } else {
    borderColor = '#dadbe2';
  }

  // 指名対象 / 完了者 を avatar chips で。 avatar に hover title で名前。
  const peopleChip = (u) =>
    `<span title="${escapeHtml(u.display_name)}" style="display:inline-flex; align-items:center; gap:2px">
       ${avatarHtml(u.display_name, u.avatar_url, 'xs')}
     </span>`;
  const assignedRow = (Array.isArray(t.assigned_users) && t.assigned_users.length)
    ? `<div class="meta" style="display:flex; flex-wrap:wrap; gap:4px; align-items:center">
         <span class="muted" style="min-width:42px">指名:</span>
         ${t.assigned_users.map(peopleChip).join('')}
       </div>` : '';
  const approvedRow = (Array.isArray(t.approved_users) && t.approved_users.length)
    ? `<div class="meta" style="display:flex; flex-wrap:wrap; gap:4px; align-items:center">
         <span class="muted" style="min-width:42px">完了:</span>
         ${t.approved_users.map(peopleChip).join('')}
       </div>` : '';

  // 進捗集計。 完了者を avatar で出すなら 「X / Y 人」 だけで十分。
  const progressLine = `<div class="meta">完了 ${t.approved_count ?? 0} / ${t.capacity}人${t.pending_count ? ` · 完了待ち ${t.pending_count}` : ''}</div>`;

  return `
    <a href="#/tasks/${t.id}" class="list-item" style="align-items:flex-start; gap:10px; border-left:5px solid ${borderColor}; text-decoration:none; color:inherit">
      <span style="display:inline-flex; flex:none">${avatarHtml(t.requester_name, t.requester_avatar_url, 'sm')}</span>
      <div class="grow" style="min-width:0">
        <div style="font-size:14px">
          <span class="bold">${escapeHtml(t.title)}</span>
          ${Number(t.reward) === 0
            ? '<span class="tag" style="background:#e3f2fd; color:#0277bd">🙏 依頼</span>'
            : (t.assigned_user_id ? '<span class="tag" style="background:#fef3c7; color:#92400e">👤 割り当て</span>'
                                  : '<span class="tag" style="background:#dcfce7; color:#166534">🎯 募集</span>')}
          ${statusTag}${roleBadge}${pendingTag}${audTag}${assignedTag}${deadlineTag}
        </div>
        <div class="meta">${escapeHtml(t.requester_name)} · ${Number(t.reward) === 0 ? '報酬なし' : t.reward + 'pt'} × ${t.capacity}人${t.per_user_limit === 0 ? ' (各自無制限)' : (t.per_user_limit > 1 ? ` (各自 ${t.per_user_limit}回まで)` : '')}</div>
        ${assignedRow}
        ${progressLine}
        ${approvedRow}
      </div>
    </a>`;
}

// ==================== Task detail (#/tasks/:id) ====================

export async function renderTaskDetail({ params }) {
  const id = params.id;
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><a href="#/tasks">← タスク一覧</a></div><div id="task-detail"><div class="muted">読み込み中…</div></div>`;
  await loadDetail(id);
}

let lastLoadedTask = null;   // v790 #393 onReport が completion_fields を 参照 する 用
async function loadDetail(id) {
  try {
    const t = await get('/api/tasks/' + id);
    lastLoadedTask = t;  // v790 #393
    const root = document.getElementById('task-detail');
    const meId = state.me?.id;
    const isRequester = meId === Number(t.requester_user_id);
    const myActive = (t.my_claims || []).filter(c => ['claimed','reported','approved'].includes(c.status));
    const myLastClaim = (t.my_claims || []).find(c => ['claimed','reported'].includes(c.status));

    // Has THIS user already been approved on this task? If so, surface the requester's
    // thank-you message (note-style).
    const myApproved = (t.my_claims || []).find(c => c.status === 'approved');

    let actions = '';
    if (!isRequester && t.status === 'open') {
      const canClaim = t.remaining > 0
        && (t.per_user_limit === 0 || myActive.length < t.per_user_limit);
      if (myLastClaim) {
        if (myLastClaim.status === 'claimed') {
          const safeUrl = safeHttpUrl(t.url);
          const openBtn = safeUrl
            ? `<a class="btn primary" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">作業を開く ↗</a>`
            : '';
          actions = `
            ${openBtn}
            <textarea id="report-notes" maxlength="2000" placeholder="完了内容や気づき (任意) — 実験で問題があった点なども" rows="3" style="margin-top:6px; width:100%; box-sizing:border-box"></textarea>
            ${renderCompletionFieldsForm(t.completion_fields)}
            <button id="report-btn" class="primary" data-claim="${myLastClaim.id}">完了報告</button>`;
        } else if (myLastClaim.status === 'reported') {
          actions = `<div class="muted">承認待ち</div>`;
        }
      } else if (canClaim) {
        // Slot-aware claim: when slots exist, the worker must pick one before
        // calling /claim. Slots that have already filled their capacity are disabled.
        if (Array.isArray(t.slots) && t.slots.length > 0) {
          actions = `
            <div style="font-weight:700; margin-bottom:6px">時間枠を選んでください</div>
            <div class="row" style="flex-wrap:wrap; gap:6px">
              ${t.slots.map(s => {
                const full = (s.taken|0) >= (s.capacity|0);
                return `<button class="slot-chip ${full?'disabled':''}" data-slot="${s.id}" ${full?'disabled':''}>
                  ${escapeHtml(s.started_at.slice(5, 16).replace(' ', ' '))} 〜 ${escapeHtml(s.ended_at.slice(11, 16))}
                  ${full ? '(満)' : ''}
                </button>`;
              }).join('')}
            </div>
            <button id="claim-btn" class="primary" style="margin-top:10px" disabled>枠を選択 → 引き受ける</button>`;
        } else {
          actions = `<button id="claim-btn" class="primary">これを引き受ける</button>`;
        }
      } else if (t.remaining === 0) {
        actions = `<button class="primary" disabled>定員 に 達して います</button>`;
      } else {
        // v787 #392 指名 型 で 自分 が 対象 外 なら 「指名 対象 外 です」 と 明示 した
        //   disabled ボタン に。 単純 な 上限 オーバー の 場合 も 同じ ボタン で 統一。
        const isAssignTaskNotMe = (t.assigned_user_ids?.length || 0) > 0
          && !t.is_assigned_to_me;
        const label = isAssignTaskNotMe ? '🚫 指名 対象 外 です'
          : (t.per_user_limit > 0 && myActive.length >= t.per_user_limit)
            ? '上限 に 達して います'
            : '対象 外 で 受け られ ません';
        actions = `<button class="primary" disabled>${label}</button>`;
      }
    }

    if (isRequester && t.status === 'open') {
      actions += `
        <div class="row" style="margin-top:6px; gap:6px; flex-wrap:wrap">
          <button id="edit-task">編集</button>
          <button id="close-task" class="btn">✅ 終了 する</button>
          <button id="cancel-task" class="danger">取り消す</button>
        </div>`;
    }

    const safeDetailUrl = safeHttpUrl(t.url);
    const urlBlock = safeDetailUrl
      ? `<div style="margin-top:6px">
           <a href="${escapeHtml(safeDetailUrl)}" target="_blank" rel="noopener noreferrer" class=" bold text-primary">
             🔗 ${escapeHtml(safeDetailUrl)} ↗
           </a>
         </div>`
      : '';
    // Attachments block: visible to anyone who can see the task. Same-origin
    // <a> works for download (cookie auth flows automatically); the server
    // sends Content-Disposition: attachment with the original filename.
    const atts = t.attachments || [];
    const canEditAtt = isRequester;
    const attBlock = (atts.length || canEditAtt) ? `
      <div class="sep"></div>
      <div class="bold" style="margin-bottom:6px">📎 添付ファイル (${atts.length})</div>
      ${atts.length ? `<div class="list" style="margin-bottom:6px">
        ${atts.map(a => `
          <div class="list-item">
            <div style="flex:1; min-width:0">
              <a href="/api/tasks/${t.id}/attachments/${a.id}" class="bold" style="color:var(--primary); word-break:break-all">
                ${escapeHtml(a.filename)}
              </a>
              <div class="meta">${formatBytes(a.size_bytes)} · ${escapeHtml(a.mime)}</div>
            </div>
            ${canEditAtt
              ? `<button class="danger" data-att-del="${a.id}" title="削除">削除</button>`
              : ''}
          </div>`).join('')}
      </div>` : ''}
      ${canEditAtt ? `
        <div class="row center" style="gap:6px">
          <input type="file" id="t-add-files" multiple
                 accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.md,.csv,image/*"
                 class="grow">
          <button id="t-add-files-btn">追加アップロード</button>
        </div>` : ''}
    ` : '';
    const thankBlock = (myApproved && t.completion_message)
      ? `<div class="card" style="border-left:4px solid var(--primary); background:#faf6ff">
           <div class="bold" style="margin-bottom:4px">${escapeHtml(t.requester_name)} さんから</div>
           <div style="white-space:pre-wrap">${escapeHtml(t.completion_message)}</div>
         </div>`
      : '';

    // For requesters: surface any 'reported' claims at the top so the approval action
    // is impossible to miss (otherwise the approve button sits below the fold).
    const reportedClaims = (isRequester && t.claims) ? t.claims.filter(c => c.status === 'reported') : [];
    const pendingAlert = reportedClaims.length > 0
      ? `<div class="card" style="background:#fff8e6; border-left:4px solid var(--warn)">
           <h3 style="margin:0 0 4px; color:var(--warn)">🔔 ${reportedClaims.length} 件の完了報告 — 承認待ち</h3>
           <p class="muted" style="font-size:13px; margin:0 0 8px">内容を確認して承認すると、${t.reward}pt が報酬として支払われます。違う場合は却下してください。</p>
           ${reportedClaims.map(c => renderReportedClaimCard(c, t.reward)).join('')}
         </div>`
      : '';

    root.innerHTML = `
      ${pendingAlert}

      <div class="card">
        <div class="row center" style="gap:10px">
          <span style="display:inline-flex; flex:none">${avatarHtml(t.requester_name, t.requester_avatar_url, 'md')}</span>
          <div class="grow">
            <div class="bold" style="font-size:18px">${escapeHtml(t.title)}</div>
            <div class="meta">${escapeHtml(t.requester_name)} · ${t.created_at}</div>
          </div>
          <button id="task-copy-url" class="btn" style="font-size:12px; padding:4px 8px; flex:none" title="URL を コピー">🔗 URL</button>
          <button id="task-share" class="btn" style="font-size:12px; padding:4px 8px; flex:none" title="らぼったー で 共有">💬 共有</button>
        </div>
        ${urlBlock}
        ${t.description ? `<div style="margin-top:10px; white-space:pre-wrap">${linkifyUrlsHtml(escapeHtml(t.description))}</div>` : ''}
        ${attBlock}
        <div class="sep"></div>
        <div>
          <div>報酬: <span class=" bold text-primary">${t.reward}pt</span> × ${t.capacity}人 (残 ${t.remaining}人)</div>
          <div class="meta">
            ${t.per_user_limit === 0 ? '各自無制限' : `各自 ${t.per_user_limit} 回まで`}
            ${t.audience_grades ? ` · 対象: ${escapeHtml(t.audience_grades)}` : ''}
            ${t.deadline ? ` · 締切: ${escapeHtml(t.deadline)}` : ''}
            · 状態: ${escapeHtml(t.status)}
          </div>
        </div>
        <div style="margin-top:12px">${actions}</div>
      </div>

      ${thankBlock}

      <div id="edit-form-wrap" hidden></div>

      ${isRequester ? renderClaimsAdmin(t) : ''}
    `;

    // Slot selection wiring (when the task uses time slots).
    let selectedSlotId = null;
    root.querySelectorAll('.slot-chip').forEach(b => {
      if (b.disabled) return;
      b.addEventListener('click', () => {
        root.querySelectorAll('.slot-chip').forEach(o => o.classList.remove('primary'));
        b.classList.add('primary');
        selectedSlotId = Number(b.dataset.slot);
        const claimBtn = document.getElementById('claim-btn');
        if (claimBtn) {
          claimBtn.disabled = false;
          claimBtn.textContent = 'この枠で引き受ける';
        }
      });
    });
    document.getElementById('task-copy-url')?.addEventListener('click', () => copyShareUrl(`#/tasks/${t.id}`));
    document.getElementById('task-share')?.addEventListener('click', () => {
      const label = t.is_free ? 'リクエスト' : 'タスク';
      const reward = t.is_free ? '' : ` ${t.reward}pt`;
      shareToSns(`🎯 ${label} 「${t.title}」${reward} (残 ${t.remaining}人)`, `#/tasks/${t.id}`);
    });
    document.getElementById('claim-btn')?.addEventListener('click', () => onClaim(id, selectedSlotId));
    document.getElementById('report-btn')?.addEventListener('click', e => onReport(id, e.currentTarget.dataset.claim));
    document.getElementById('close-task')?.addEventListener('click', () => onCloseTask(id));
    document.getElementById('cancel-task')?.addEventListener('click', () => onCancelTask(id));
    document.getElementById('edit-task')?.addEventListener('click', () => renderEditForm(t));
    root.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => onApprove(id, b.dataset.approve)));
    root.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => onReject(id, b.dataset.reject)));
    root.querySelectorAll('[data-att-del]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この添付を削除しますか?')) return;
        try {
          await del(`/api/tasks/${id}/attachments/${b.dataset.attDel}`);
          toast('削除しました');
          await loadDetail(id);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
    document.getElementById('t-add-files-btn')?.addEventListener('click', async () => {
      const files = Array.from(document.getElementById('t-add-files')?.files || []);
      if (!files.length) { toast('ファイルを選んでください'); return; }
      let fails = 0;
      for (const f of files) {
        try { await uploadTaskAttachment(id, f); }
        catch (e) { fails++; console.warn(e); }
      }
      toast(fails ? `${files.length - fails}件成功 / ${fails}件失敗` : `添付 ${files.length}件 追加`);
      await loadDetail(id);
    });
  } catch (e) {
    document.getElementById('task-detail').innerHTML = `<div class="card muted">${escapeHtml(e.message)}</div>`;
  }
}

// One reported-claim card inside the top pendingAlert: avatar, worker name, notes,
// and big inline approve/reject buttons so the requester can act immediately.
function renderReportedClaimCard(c, reward) {
  // v790 #393 受諾者 が 埋めた completion_data を 表示
  const cd = c.completion_data;
  const cdHtml = (cd && typeof cd === 'object' && Object.keys(cd).length) ? `
    <div style="margin-top:4px; padding:8px 10px; background:#f5f3ff; border-left:3px solid #6b21a8; border-radius:0 6px 6px 0; font-size:13px">
      <div class="bold" style="font-size:12px; color:#6b21a8; margin-bottom:4px">📝 完了 時 の 入力</div>
      ${Object.entries(cd).map(([k, v]) =>
        `<div style="margin-top:3px"><span class="bold">${escapeHtml(k)}:</span> ${escapeHtml(String(v))}</div>`).join('')}
    </div>` : '';
  return `
    <div class="list-item" style="background:#fff; align-items:flex-start; margin-top:6px">
      <div style="display:flex; gap:8px; align-items:flex-start; flex:1">
        <span style="display:inline-flex; flex:none">${avatarHtml(c.display_name, c.avatar_url, 'md')}</span>
        <div class="grow">
          <div class="bold">${escapeHtml(c.display_name)}</div>
          ${c.notes ? `<div style="margin-top:4px; padding:8px 10px; background:#f6f3fa; border-radius:6px; white-space:pre-wrap; font-size:13px">${escapeHtml(c.notes)}</div>` : '<div class="meta" style="margin-top:4px">(完了メモなし)</div>'}
          ${cdHtml}
          <div class="meta">報告 ${escapeHtml(c.reported_at ?? '')}</div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; align-items:stretch">
        <button class="primary" data-approve="${c.id}">承認 (+${reward}pt)</button>
        <button class="danger" data-reject="${c.id}">却下</button>
      </div>
    </div>`;
}

function renderClaimsAdmin(t) {
  if (!t.claims) return '';
  if (t.claims.length === 0) return `<div class="card"><h3>申請</h3><div class="empty">まだ誰も引き受けていません</div></div>`;
  const rows = t.claims.map(c => `
    <div class="list-item" style="align-items:flex-start">
      <div style="flex:1; display:flex; align-items:flex-start; gap:8px">
        <span style="display:inline-flex; flex:none">${avatarHtml(c.display_name, c.avatar_url, 'sm')}</span>
        <div class="grow">
          <div class="bold">${escapeHtml(c.display_name)} <span class="tag muted">${escapeHtml(c.status)}</span></div>
          ${c.notes ? `<div style="margin-top:4px; padding:6px 8px; background:#f6f3fa; border-radius:6px; white-space:pre-wrap; font-size:13px">${escapeHtml(c.notes)}</div>` : ''}
          <div class="meta">${escapeHtml(c.created_at)}${c.reported_at ? ' · 報告 ' + escapeHtml(c.reported_at) : ''}</div>
        </div>
      </div>
      ${c.status === 'reported' ? `
        <div>
          <button class="primary" data-approve="${c.id}">承認 (+${t.reward}pt)</button>
          <button class="danger" data-reject="${c.id}">却下</button>
        </div>` : ''}
    </div>`).join('');
  return `<div class="card"><h3>申請 (${t.claims.length}件)</h3><div class="list">${rows}</div></div>`;
}

async function onClaim(taskId, slotId) {
  try {
    await post(`/api/tasks/${taskId}/claim`, slotId ? { slot_id: slotId } : {});
    toast('引き受けました');
    await loadDetail(taskId);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onReport(taskId, claimId) {
  const notes = document.getElementById('report-notes')?.value.trim() || null;
  // v790 #393 task.completion_fields に 基づい て 値 を 集める (loadDetail で 取得 した task object を 参照)
  const fields = lastLoadedTask?.completion_fields || [];
  let completion_data = null;
  try { completion_data = collectCompletionFieldsValues(fields); }
  catch (e) { toast(e.message); return; }
  try {
    await post(`/api/tasks/${taskId}/claims/${claimId}/report`, { notes, completion_data });
    toast('完了報告しました');
    await loadDetail(taskId);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onApprove(taskId, claimId) {
  if (!confirm('承認して報酬を支払いますか?')) return;
  try {
    const r = await post(`/api/tasks/${taskId}/claims/${claimId}/approve`, {});
    toast(r.completion_message
      ? '承認しました — やってくれた人へお礼メッセージを送信'
      : '承認しました');
    await loadDetail(taskId);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onReject(taskId, claimId) {
  if (!confirm('却下しますか?')) return;
  try { await post(`/api/tasks/${taskId}/claims/${claimId}/reject`, {}); toast('却下しました'); await loadDetail(taskId); }
  catch (e) { toast('失敗: ' + e.message); }
}

function renderEditForm(t) {
  const wrap = document.getElementById('edit-form-wrap');
  wrap.hidden = false;
  const auds = (t.audience_grades || '').split(',').filter(Boolean);
  // v560 #215 datetime-local needs "YYYY-MM-DDTHH:MM" — TZ mode 考慮で生成
  const dlVal = t.deadline ? isoToLocalDt(t.deadline) : '';
  wrap.innerHTML = `
    <div class="card">
      <h3>タスクを編集</h3>
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="e-title" maxlength="200" value="${escapeHtml(t.title)}">
      </label>
      <label class="field">
        <span class="lbl">作業 URL</span>
        <input type="url" id="e-url" maxlength="2000" placeholder="https://..." value="${escapeHtml(t.url ?? '')}">
      </label>
      <label class="field">
        <span class="lbl">詳細</span>
        <textarea id="e-desc" maxlength="5000" rows="3">${escapeHtml(t.description ?? '')}</textarea>
      </label>
      <label class="field">
        <span class="lbl">完了時のメッセージ</span>
        <textarea id="e-cmsg" maxlength="2000" rows="2">${escapeHtml(t.completion_message ?? '')}</textarea>
      </label>
      <div class="row">
        <label class="field grow">
          <span class="lbl">報酬 (pt / 1人あたり)</span>
          <input type="number" id="e-reward" min="1" value="${t.reward}">
        </label>
        <label class="field grow">
          <span class="lbl">募集人数 (承認済み ${t.approved_count} 件以上必須)</span>
          <input type="number" id="e-capacity" min="${t.approved_count || 1}" value="${t.capacity}">
        </label>
      </div>
      <label class="field">
        <span class="lbl">1人あたりの参加可能回数</span>
        <select id="e-perlimit">
          <option value="1" ${t.per_user_limit===1?'selected':''}>1回まで</option>
          <option value="3" ${t.per_user_limit===3?'selected':''}>3回まで</option>
          <option value="5" ${t.per_user_limit===5?'selected':''}>5回まで</option>
          <option value="0" ${t.per_user_limit===0?'selected':''}>無制限</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">締切 (空欄で無期限)</span>
        ${tzToggleHtml('e-deadline-tz')}
        <input type="datetime-local" id="e-deadline" value="${escapeHtml(dlVal)}">
      </label>
      <div class="field">
        <span class="lbl">対象学年</span>
        <div class="row" style="gap:8px; flex-wrap:wrap">
          ${['B3','B4','M1','M2','D'].map(g => `
            <label class="muted" style="display:inline-flex; align-items:center; gap:4px">
              <input type="checkbox" value="${g}" class="e-aud" ${auds.includes(g)?'checked':''}> ${g}
            </label>`).join('')}
        </div>
      </div>
      <div class="muted" style="font-size:12px; margin-bottom:6px">
        報酬・募集人数を変えると、未承認分の差額が自動で預け or 返金されます。
      </div>
      <div class="row">
        <button id="e-save" class="primary">保存</button>
        <button id="e-cancel">キャンセル</button>
      </div>
    </div>
  `;
  document.getElementById('e-cancel').addEventListener('click', () => { wrap.hidden = true; wrap.innerHTML = ''; });
  document.getElementById('e-save').addEventListener('click', () => onSaveEdit(t.id));
}

async function onSaveEdit(taskId) {
  const title = document.getElementById('e-title').value.trim();
  const url = document.getElementById('e-url').value.trim();
  const description = document.getElementById('e-desc').value.trim();
  const completion_message = document.getElementById('e-cmsg').value.trim();
  const reward   = Number(document.getElementById('e-reward').value);
  const capacity = Number(document.getElementById('e-capacity').value);
  const per_user_limit = Number(document.getElementById('e-perlimit').value);
  const deadlineRaw = document.getElementById('e-deadline').value || null;
  const deadline = deadlineRaw ? localDtToIso(deadlineRaw) : null;
  const aud = Array.from(document.querySelectorAll('.e-aud:checked')).map(el => el.value);
  if (!title || !(reward > 0) || !(capacity > 0)) { toast('入力を確認してください'); return; }
  try {
    await patch('/api/tasks/' + taskId, {
      title,
      url: url || null,
      description: description || null,
      completion_message: completion_message || null,
      reward, capacity, per_user_limit, deadline,
      audience_grades: aud,
    });
    toast('保存しました');
    await loadDetail(taskId);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onCancelTask(taskId) {
  if (!confirm('タスクを取り消しますか? (未承認分の報酬が返金されます)')) return;
  try { const r = await post(`/api/tasks/${taskId}/cancel`, {}); toast(`取り消しました (${r.refunded}pt 返金)`); await loadDetail(taskId); }
  catch (e) { toast('失敗: ' + e.message); }
}

// v714 #309 「終了」 = 取消 と 違って 「もう 募集 締切 で OK」 完了 扱い に する。
//   未承認 capacity 分 は 返金、 進行 中 の claim は cancel 扱い (取消 と 同じ)、
//   ただし 履歴 上 の status は 'closed'。
async function onCloseTask(taskId) {
  if (!confirm('タスク を 終了 しますか? (= 募集 を 締切 完了 扱い に。 未承認 分 の 報酬 は 返金 されます)')) return;
  try { const r = await post(`/api/tasks/${taskId}/close`, {}); toast(`終了 しました (${r.refunded}pt 返金)`); await loadDetail(taskId); }
  catch (e) { toast('失敗: ' + e.message); }
}
