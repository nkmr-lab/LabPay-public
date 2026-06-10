// /#/requests          → 一覧 + 新規作成
// /#/requests/{id}     → 詳細 (受取人視点 = 自分の額 + 支払うボタン / 発起人視点 = 全員の支払い状況)
//
// 飲み会割り勘とは独立した一般用途の「集金」: 学会参加費、事務局費、
// 部屋の備品代など。支払いは外 (現金/PayPay/銀行/立替) でやり取り。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const GRADE_ORDER = ['D','M2','M1','B4','B3',''];
const METHOD_LABEL = { cash: '現金', paypay: 'PayPay', bank: '銀行振込', proxy: '立替' };

// ─── LIST + CREATE ────────────────────────────────────────────────────

let allUsers = [];
const picked = new Set();
// uid → 円. mode === 'flat' のときは無視 (flatAmount を使う)
const customAmount = new Map();
let mode = 'flat';        // 'flat' = 全員同額 / 'custom' = 指定額
let flatAmount = 1000;

export async function renderMoneyRequests() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/apps" class="hint">← アプリ</a>
      <h2 style="margin:6px 0 0">請求 (集金)</h2>
    </div>

    <details class="card collapsible-form">
      <summary>＋ 新規請求</summary>
      <div style="margin-top:10px"></div>
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="mr-title" maxlength="200" placeholder="例: 学会参加費 集金">
      </label>
      <label class="field">
        <span class="lbl">メモ (任意)</span>
        <textarea id="mr-memo" maxlength="2000" rows="2" placeholder="期限・振込み先補足など"></textarea>
      </label>

      <div class="field">
        <span class="lbl">メンバー</span>
        <div id="mr-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px"></div>
        <div id="mr-picker" class="row" style="gap:6px; flex-wrap:wrap"></div>
        <div id="mr-count" class="muted" style="font-size:12px; margin-top:6px">0 人選択中</div>
      </div>

      <div class="field">
        <span class="lbl">金額の指定</span>
        <div class="row" style="gap:6px; flex-wrap:wrap; align-items:center">
          <button data-mode="flat"   class="btn primary" id="mr-mode-flat">全員に同額</button>
          <button data-mode="custom" class="btn" id="mr-mode-custom">人ごとに指定</button>
        </div>
        <div id="mr-amount-area" style="margin-top:8px"></div>
      </div>

      <div id="mr-preview-total" class="muted" style="font-size:13px; margin-bottom:6px"></div>
      <div id="mr-preview-list" class="list" style="margin-bottom:8px" hidden></div>
      <div class="row" style="gap:6px">
        <button id="mr-submit" class="primary">作成 + 全員に通知</button>
        <button id="mr-dry"    class="btn">通知内容を確認</button>
        <button id="mr-clear"  class="btn">クリア</button>
      </div>
    </details>

    <div class="card">
      <h3>履歴</h3>
      <div id="mr-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await populatePicker();
  document.getElementById('mr-title').addEventListener('input', renderPreview);
  document.getElementById('mr-mode-flat')  .addEventListener('click', () => switchMode('flat'));
  document.getElementById('mr-mode-custom').addEventListener('click', () => switchMode('custom'));
  document.getElementById('mr-submit')     .addEventListener('click', onCreate);
  document.getElementById('mr-dry')        .addEventListener('click', onDryRun);
  document.getElementById('mr-clear')      .addEventListener('click', resetForm);
  switchMode('flat');
  await loadList();
  // 直近の自分作成の請求があればプリロード (タイトル/メモ/受取人/金額)。
  // 「またあの集金やる」が大半なので、ベース設定を毎回入れ直さなくて
  // 済むようにする。要らないときは [クリア] で消せる。
  await prefillFromLast();
}

async function prefillFromLast() {
  // 直近の自分作成の請求から memo だけ取り出してフォームに乗せる。
  // タイトル/受取人/金額は毎回違うので prefill しない (誤送信を避ける)。
  try {
    const d = await get('/api/money-requests');
    const meId = state.me?.id;
    const mine = (d.items || []).find(r => Number(r.creator_user_id) === Number(meId));
    if (!mine || !mine.memo) return;
    const memoEl = document.getElementById('mr-memo');
    if (memoEl && !memoEl.value) memoEl.value = mine.memo;
  } catch (_) { /* prefill は best-effort */ }
}

function resetForm() {
  document.getElementById('mr-title').value = '';
  document.getElementById('mr-memo') .value = '';
  picked.clear();
  customAmount.clear();
  flatAmount = 1000;
  switchMode('flat');
  refreshChips();
}

async function populatePicker() {
  const u = await get('/api/users');
  picked.clear();
  customAmount.clear();
  allUsers = [...u.items].sort((a, b) => {
    const ga = GRADE_ORDER.indexOf(a.grade || '');
    const gb = GRADE_ORDER.indexOf(b.grade || '');
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) ||
      (a.display_name || '').localeCompare(b.display_name || '', 'ja');
  });
  const grades = [...new Set(allUsers.map(u => u.grade).filter(Boolean))]
    .sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  const bulk = document.getElementById('mr-bulk');
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
  const picker = document.getElementById('mr-picker');
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

function memberMatches(u, key) {
  if (key === 'all') return true;
  if (key.startsWith('grade:')) return (u.grade || '') === key.slice(6);
  if (key.startsWith('gender:')) return (u.gender || '') === key.slice(7);
  return false;
}
function applyBulk(key) {
  if (key === 'clear') { picked.clear(); refreshChips(); return; }
  const targets = allUsers.filter(u => memberMatches(u, key));
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
  document.querySelectorAll('#mr-picker .rl-chip').forEach(c => {
    const on = picked.has(Number(c.dataset.uid));
    c.style.background = on ? 'var(--primary-soft, #efeafa)' : '';
    c.style.borderColor = on ? 'var(--primary)' : '';
  });
  document.getElementById('mr-count').textContent = `${picked.size} 人選択中`;
  if (mode === 'custom') renderCustomArea();
  renderPreview();
}

function switchMode(m) {
  mode = m;
  document.getElementById('mr-mode-flat')  .classList.toggle('primary', m === 'flat');
  document.getElementById('mr-mode-custom').classList.toggle('primary', m === 'custom');
  if (m === 'flat') {
    document.getElementById('mr-amount-area').innerHTML = `
      <label class="field" style="margin-top:6px">
        <span class="lbl">1 人あたり (円)</span>
        <input type="number" id="mr-flat" min="0" step="100" value="${flatAmount}" style="max-width:160px">
      </label>`;
    document.getElementById('mr-flat').addEventListener('input', () => {
      flatAmount = Math.max(0, Math.floor(Number(document.getElementById('mr-flat').value) || 0));
      renderPreview();
    });
  } else {
    renderCustomArea();
  }
  renderPreview();
}

function renderCustomArea() {
  const root = document.getElementById('mr-amount-area');
  if (!root) return;
  if (mode !== 'custom') return;
  const arr = allUsers.filter(u => picked.has(u.id));
  if (!arr.length) {
    root.innerHTML = `<div class="muted" style="font-size:13px; margin-top:6px">メンバーを選んでください</div>`;
    return;
  }
  root.innerHTML = `
    <div class="muted" style="font-size:12px; margin:6px 0 4px">各人の金額を入力 (空欄は ¥0 扱い、0円は除外されます)</div>
    ${arr.map(u => `
      <div class="row" style="gap:6px; align-items:center; padding:3px 0">
        ${avatarHtml(u.display_name, u.avatar_url, 'sm')}
        <span class="grow">${escapeHtml(u.display_name)} ${u.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(u.grade)}]</span>` : ''}</span>
        <input type="number" min="0" step="100" data-amt="${u.id}" value="${customAmount.get(u.id) ?? ''}" placeholder="¥" style="width:110px; text-align:right">
      </div>`).join('')}
  `;
  root.querySelectorAll('[data-amt]').forEach(inp => {
    inp.addEventListener('input', () => {
      const uid = Number(inp.dataset.amt);
      const v = Math.max(0, Math.floor(Number(inp.value) || 0));
      if (v > 0) customAmount.set(uid, v);
      else customAmount.delete(uid);
      renderPreview();
    });
  });
}

function renderPreview() {
  const root = document.getElementById('mr-preview-total');
  if (!root) return;
  const recipients = buildRecipients();
  if (!recipients.length) {
    root.textContent = '対象者と金額を入れてください';
    return;
  }
  const sum = recipients.reduce((s, r) => s + r.amount_yen, 0);
  root.textContent = `合計 ¥${sum.toLocaleString()} (${recipients.length} 人)`;
}

function buildRecipients() {
  const out = [];
  for (const u of allUsers) {
    if (!picked.has(u.id)) continue;
    const amt = mode === 'flat' ? flatAmount : (customAmount.get(u.id) ?? 0);
    if (amt > 0) out.push({ user_id: u.id, amount_yen: amt });
  }
  return out;
}

async function onDryRun() {
  const title = document.getElementById('mr-title').value.trim();
  const memo  = document.getElementById('mr-memo') .value.trim() || null;
  if (!title) { toast('タイトルを入れてください'); return; }
  const recipients = buildRecipients();
  if (!recipients.length) { toast('対象者と金額を入れてください'); return; }
  const previewRoot = document.getElementById('mr-preview-list');
  try {
    const r = await post('/api/money-requests', { title, memo, recipients, dry_run: true });
    const meId = Number(state.me?.id) || 0;
    const header = `
      <div class="row center" style="margin-bottom:4px">
        <span class="muted" style="font-size:11px; flex:1">↓ 各受取人に届く通知 (${(r.previews || []).length} 件)</span>
        <button id="mr-preview-clear" class="btn" style="padding:2px 8px; font-size:11px">プレビューをクリア</button>
      </div>`;
    if (!(r.previews || []).length) {
      previewRoot.innerHTML = header + `<div class="muted">送信される通知はありません</div>`;
    } else {
      previewRoot.innerHTML = header + r.previews.map(p => {
            const mine = Number(p.user_id) === meId;
            return `
              <div class="list-item" style="${mine ? 'background:#fff8e6; border-left:3px solid var(--primary)' : ''}; align-items:flex-start">
                <div class="grow">
                  <div class="bold" style="font-size:13px">→ ${escapeHtml(p.display_name)} (¥${Number(p.amount_yen).toLocaleString()})${mine ? ' <span class="muted" style="font-size:10px">(あなた)</span>' : ''}</div>
                  <div class="meta" style="white-space:pre-wrap; font-size:12px">${escapeHtml(p.message)}</div>
                </div>
              </div>`;
          }).join('');
    }
    previewRoot.hidden = false;
    document.getElementById('mr-preview-clear')?.addEventListener('click', () => {
      previewRoot.innerHTML = '';
      previewRoot.hidden = true;
    });
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onCreate() {
  const title = document.getElementById('mr-title').value.trim();
  const memo = document.getElementById('mr-memo').value.trim() || null;
  if (!title) { toast('タイトルを入れてください'); return; }
  const recipients = buildRecipients();
  if (!recipients.length) { toast('対象者と金額を入れてください'); return; }
  if (!confirm(`${recipients.length} 人に請求を送ります。よろしいですか?`)) return;
  try {
    const r = await post('/api/money-requests', { title, memo, recipients });
    toast('作成しました');
    navigate('#/requests/' + r.id);
  } catch (e) { toast('失敗: ' + e.message); }
}

async function loadList() {
  try {
    const d = await get('/api/money-requests');
    const root = document.getElementById('mr-list');
    if (!d.items.length) { root.innerHTML = `<div class="empty">まだ請求はありません</div>`; return; }
    const meId = state.me?.id;
    root.innerHTML = d.items.map(r => {
      const isMine      = Number(r.creator_user_id) === Number(meId);
      const isGenerator = Number(r.created_by_user_id) === Number(meId) && !isMine;
      const tagBits = [];
      if (isMine)      tagBits.push('<span class="tag">発起人</span>');
      if (isGenerator) tagBits.push(`<span class="tag warn">代理生成</span>`);
      const myLine = r.my_amount != null
        ? `あなたへ ¥${Number(r.my_amount).toLocaleString()} ${r.my_paid_at ? '✓支払済' : '未払い'}`
        : (isMine
            ? `あなたが受取側 (${r.member_count} 人から)`
            : (isGenerator
                ? `代理生成: ${escapeHtml(r.creator_name)} 宛 / ${r.member_count} 人`
                : 'あなたは受取人ではありません'));
      return `
        <a class="list-item" href="#/requests/${r.id}">
          <div class="grow">
            <div class="bold">${escapeHtml(r.title)} ${tagBits.join(' ')}</div>
            <div class="meta">${escapeHtml(r.creator_name)} · 支払い済 ${r.paid_count}/${r.member_count}</div>
            <div class="meta">${myLine} · ${escapeHtml(r.created_at)}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('mr-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ─── DETAIL ───────────────────────────────────────────────────────────

export async function renderMoneyRequestDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/requests" class="hint">← 請求一覧</a>
      <div id="mr-detail" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card">
      <h3>支払い状況</h3>
      <div id="mr-detail-list" class="list"></div>
    </div>
  `;
  await loadDetail(id);
}

async function loadDetail(id) {
  try {
    const r = await get('/api/money-requests/' + id);
    const meId = state.me?.id;
    const isCreator = Number(r.creator_user_id) === Number(meId);
    const isGenerator = Number(r.created_by_user_id) === Number(meId);
    const canManage = isCreator || isGenerator;
    const myRow = (r.recipients || []).find(x => Number(x.user_id) === Number(meId));
    const settle = settlementInfo(r);

    document.getElementById('mr-detail').innerHTML = `
      <div style="display:flex; align-items:start; gap:8px">
        <div class="bold" style="font-size:18px; flex:1">${escapeHtml(r.title)}</div>
        ${canManage ? `<button id="mr-edit" class="btn" style="padding:2px 8px; font-size:12px">編集</button>` : ''}
      </div>
      <div class="meta">${escapeHtml(r.creator_name)} · ${escapeHtml(r.created_at)}</div>
      ${r.created_by_user_id && Number(r.created_by_user_id) !== Number(r.creator_user_id) && r.created_by_name
        ? `<div class="meta" style="margin-top:2px; color:#b54708">📝 ${escapeHtml(r.created_by_name)} さんが代理生成 (ワリカ精算からの一括作成など)</div>`
        : ''}
      ${r.memo ? `<div class="meta" style="white-space:pre-wrap; margin-top:4px">${escapeHtml(r.memo)}</div>` : ''}
      ${settle ? `
        <div style="margin-top:8px; padding:8px 10px; background:#faf6ff; border-left:3px solid var(--primary); border-radius:6px; font-size:13px">
          振込先 (${escapeHtml(r.creator_name)} さん): ${settle}
        </div>` : ''}
      ${myRow ? `
        <div style="margin-top:8px; padding:8px 10px; background:#fff8e6; border-radius:6px">
          <div class="bold">あなたの支払額: ¥${Number(myRow.amount_yen).toLocaleString()}</div>
          ${myRow.paid_at
            ? `<div class="meta">✅ 支払い済 (${escapeHtml(METHOD_LABEL[myRow.paid_method] || myRow.paid_method)}) · ${escapeHtml(myRow.paid_at)}</div>
               <div class="row" style="margin-top:6px; gap:6px; flex-wrap:wrap">
                 <button id="mr-correct" style="padding:4px 8px; font-size:13px">✏️ 方法を訂正</button>
                 <button id="mr-unpay"   style="padding:4px 8px; font-size:13px">未払いに戻す</button>
               </div>
               <div id="mr-correct-picker" hidden class="row" style="margin-top:6px; gap:6px; flex-wrap:wrap">
                 <button data-pay="cash"   class="primary">現金で払った</button>
                 <button data-pay="paypay">PayPay で払った</button>
                 <button data-pay="bank">銀行振込で払った</button>
                 <button data-pay="proxy">他の人に立替えてもらった</button>
               </div>`
            : `<div class="row" style="margin-top:6px; gap:6px; flex-wrap:wrap">
                 <button data-pay="cash"   class="primary">現金で払った</button>
                 <button data-pay="paypay">PayPay で払った</button>
                 <button data-pay="bank">銀行振込で払った</button>
                 <button data-pay="proxy">他の人に立替えてもらった</button>
               </div>`}
        </div>` : ''}
      ${canManage ? `<div style="margin-top:8px"><button id="mr-close" class="danger">この請求を削除する</button></div>` : ''}
    `;

    // 受取人リスト: 未払いを上、支払い済を下にまとめる。支払い済は薄く
    // グレーアウトして「終わった人」感を出す。
    const unpaid = (r.recipients || []).filter(rec => !rec.paid_at);
    const paid   = (r.recipients || []).filter(rec =>  rec.paid_at);
    const renderRow = (rec, dim) => `
      <div class="list-item" style="${dim ? 'opacity:.55; filter:grayscale(40%)' : ''}">
        <div style="flex:1; display:flex; align-items:center; gap:8px">
          ${avatarHtml(rec.display_name, rec.avatar_url, 'sm')}
          <div>
            <div class="bold">${escapeHtml(rec.display_name)} ${rec.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(rec.grade)}]</span>` : ''}</div>
            <div class="meta">¥${Number(rec.amount_yen).toLocaleString()}</div>
          </div>
        </div>
        <div>
          ${rec.paid_at
            ? `<span class="tag ok">✓ ${escapeHtml(METHOD_LABEL[rec.paid_method] || rec.paid_method)}${rec.proxy_name ? ' (←' + escapeHtml(rec.proxy_name) + ')' : ''}</span>`
            : `<span class="tag warn">未払い</span>`}
        </div>
      </div>`;
    const sep = (paid.length && unpaid.length)
      ? `<div class="muted" style="font-size:11px; margin:6px 0 2px">─── 支払い済 (${paid.length}/${(r.recipients || []).length}) ───</div>`
      : '';
    document.getElementById('mr-detail-list').innerHTML =
      unpaid.map(rec => renderRow(rec, false)).join('')
      + sep
      + paid.map(rec => renderRow(rec, true)).join('');

    document.querySelectorAll('[data-pay]').forEach(b => {
      b.addEventListener('click', () => onPay(id, b.dataset.pay, r));
    });
    document.getElementById('mr-unpay')?.addEventListener('click', () => onUnpay(id));
    document.getElementById('mr-correct')?.addEventListener('click', () => {
      // 訂正ボタン: 隠れていた method picker を出すだけ。タップ後は data-pay の
      // 通常フローで /pay を再呼び出し → backend が paid_at の有無で訂正/新規を分岐。
      const picker = document.getElementById('mr-correct-picker');
      if (picker) picker.hidden = false;
      document.getElementById('mr-correct')?.setAttribute('disabled', 'disabled');
    });
    document.getElementById('mr-edit')?.addEventListener('click', () => openEdit(r));
    document.getElementById('mr-close')?.addEventListener('click', async () => {
      const paidCount = (r.recipients || []).filter(x => x.paid_at).length;
      const extra = paidCount > 0 ? `\n(${paidCount} 人がすでに支払い済とマークしています)` : '';
      if (!confirm(`この請求を削除します。元に戻せません。${extra}\n受取人にすでに送った通知は残ります。よろしいですか?`)) return;
      try { await del('/api/money-requests/' + id); toast('削除しました'); location.hash = '#/requests'; }
      catch (e) { toast('失敗: ' + e.message); }
    });
  } catch (e) {
    document.getElementById('mr-detail').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function settlementInfo(r) {
  const bits = [];
  if (r.creator_paypay_id) bits.push(`PayPay: ${escapeHtml(r.creator_paypay_id)}`);
  if (r.creator_bank_info) bits.push(`口座: ${escapeHtml(r.creator_bank_info)}`);
  return bits.join(' · ');
}

async function onPay(id, method, r) {
  let proxyId = null;
  if (method === 'proxy') {
    const others = r.recipients
      .filter(x => Number(x.user_id) !== Number(state.me?.id))
      .map(x => `${x.user_id}: ${x.display_name}`).join('\n');
    const ans = prompt('立て替えてくれた人の user_id を入れてください\n対象:\n' + others);
    proxyId = Number(ans);
    if (!proxyId) { toast('user_id を入れてください'); return; }
  }
  try {
    // backend が paid_at の有無を見て 「新規 / 訂正」 を自動判定し、
    // res.corrected で結果を返す。toast はそれで切り替える。
    const res = await patch(`/api/money-requests/${id}/pay`, { method, proxy_user_id: proxyId });
    toast(res?.corrected ? '支払い方法を訂正しました' : '支払い済にしました');
    await loadDetail(id);
  } catch (e) { toast('失敗: ' + e.message); }
}

// 編集モーダル: タイトル / メモ / 各受取人の金額を変更可能。受取人の
// 追加・削除はここでは扱わない (作り直しを推奨)。
function openEdit(r) {
  const existing = document.getElementById('mr-edit-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'mr-edit-modal';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:14px; max-width:520px; width:100%; max-height:85vh; display:flex; flex-direction:column; padding:20px">
      <div class="row center">
        <h3 class="row-title">請求を編集</h3>
        <button id="mr-edit-close">×</button>
      </div>
      <label class="field" style="margin-top:8px">
        <span class="lbl">タイトル</span>
        <input type="text" id="mr-edit-title" maxlength="200" value="${escapeHtml(r.title || '')}">
      </label>
      <label class="field">
        <span class="lbl">メモ</span>
        <textarea id="mr-edit-memo" maxlength="5000" rows="3">${escapeHtml(r.memo || '')}</textarea>
      </label>
      <div class="muted" style="font-size:12px; margin:6px 0 2px">各人の金額</div>
      <div style="overflow:auto; max-height:40vh">
        ${r.recipients.map(rec => `
          <div class="row center" style="gap:6px; padding:3px 0">
            ${avatarHtml(rec.display_name, rec.avatar_url, 'sm')}
            <span class="grow">${escapeHtml(rec.display_name)} ${rec.paid_at ? '<span class="tag ok" style="font-size:10px">✓払</span>' : ''}</span>
            <input type="number" min="0" step="100" data-eamt="${rec.user_id}" value="${Number(rec.amount_yen)}" style="width:110px; text-align:right">
          </div>`).join('')}
      </div>
      <div class="row" style="gap:6px; margin-top:12px; justify-content:flex-end">
        <button id="mr-edit-cancel" class="btn">キャンセル</button>
        <button id="mr-edit-save"   class="primary">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#mr-edit-close') .addEventListener('click', close);
  overlay.querySelector('#mr-edit-cancel').addEventListener('click', close);
  overlay.querySelector('#mr-edit-save')  .addEventListener('click', async () => {
    const title = overlay.querySelector('#mr-edit-title').value.trim();
    const memo  = overlay.querySelector('#mr-edit-memo') .value.trim() || null;
    if (!title) { toast('タイトルを入れてください'); return; }
    const recipient_amounts = {};
    overlay.querySelectorAll('[data-eamt]').forEach(inp => {
      const uid = Number(inp.dataset.eamt);
      const v = Math.max(0, Math.floor(Number(inp.value) || 0));
      if (v > 0) recipient_amounts[uid] = v;
    });
    try {
      await patch('/api/money-requests/' + r.id, { title, memo, recipient_amounts });
      toast('保存しました');
      close();
      await loadDetail(r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

async function onUnpay(id) {
  if (!confirm('支払い済を取り消しますか?')) return;
  try { await patch(`/api/money-requests/${id}/unpay`, {}); toast('取消しました'); await loadDetail(id); }
  catch (e) { toast('失敗: ' + e.message); }
}
