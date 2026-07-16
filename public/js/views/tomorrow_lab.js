// /#/tomorrow-lab — 明日、研究室に一緒に行こう (v1119)
//   最初に「明日行く」宣言した人が fee を設定、他の人は無料で乗る。
//   翌日以降、精算ボタンで checkin データから show/no-show を判定、
//   no-show は fee pt 罰金、show は山分けボーナス。

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { toast, state } from '../app.js';

function todayIso() { return new Date().toISOString().slice(0, 10); }
function tomorrowIso() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const days = ['日','月','火','水','木','金','土'];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

export async function renderTomorrowLab() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🏫 明日、研究室に一緒に行こう</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px; line-height:1.6">
        明日研究室に行くと宣言 → 誰も居ないと寂しいので集まる仕組み。<br>
        最初に宣言した人が <b>罰金 fee</b> を設定、他の人は無料で参加。<br>
        当日以降に精算 → <b>行かなかった人 (checkin なし) は fee pt 支払い、行った人で山分け</b>。
      </p>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:8px">➕ 「明日行く」を宣言</div>
      <div class="row" style="gap:6px; flex-wrap:wrap; align-items:end">
        <label style="flex:1; min-width:130px">
          <div style="font-size:12px; color:#6b7280">対象日</div>
          <input type="date" id="tla-date" value="${tomorrowIso()}" style="width:100%; padding:6px; box-sizing:border-box">
        </label>
        <label style="flex:0 0 100px">
          <div style="font-size:12px; color:#6b7280">罰金 (5-500pt)</div>
          <input type="number" id="tla-fee" min="5" max="500" value="20" style="width:100%; padding:6px; box-sizing:border-box">
        </label>
        <label style="flex:2; min-width:180px">
          <div style="font-size:12px; color:#6b7280">メモ (任意)</div>
          <input type="text" id="tla-memo" maxlength="200" placeholder="例: 論文追い込み日、皆で" style="width:100%; padding:6px; box-sizing:border-box">
        </label>
        <button class="btn primary" id="tla-create">宣言する</button>
      </div>
      <div class="hint-sm" style="margin-top:6px; font-size:11px; color:#6b7280">
        同じ日に既存プランがあれば自動でそれに参加します。罰金設定は「初回宣言者」の値が採用されます。
      </div>
    </div>
    <div id="tla-list"><div class="muted">読み込み中…</div></div>
  `;
  document.getElementById('tla-create').addEventListener('click', createPlan);
  await loadList();
}

async function createPlan() {
  const date = document.getElementById('tla-date').value;
  const fee  = parseInt(document.getElementById('tla-fee').value, 10);
  const memo = document.getElementById('tla-memo').value.trim();
  if (!date) { toast('日付を入れてね'); return; }
  const btn = document.getElementById('tla-create');
  btn.disabled = true; btn.textContent = '⌛ 送信中…';
  try {
    const r = await post('/api/tomorrow-lab', { target_date: date, fee, memo });
    toast(r.joined_existing ? '既存プランに参加したよ' : '新しく「明日行く」を宣言したよ');
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '宣言する'; }
}

async function loadList() {
  const root = document.getElementById('tla-list');
  try {
    const d = await get('/api/tomorrow-lab');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="card"><div class="muted">まだ宣言がありません。上から作ってみよう。</div></div>';
      return;
    }
    root.innerHTML = items.map(planCard).join('');
    wireRows();
  } catch (e) {
    root.innerHTML = `<div class="card muted" style="color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function planCard(p) {
  const isToday = p.target_date === todayIso();
  const isFuture = p.target_date > todayIso();
  const isPast = p.target_date < todayIso();
  const isSettled = p.status === 'settled';
  const statusBadge = isSettled
    ? '<span style="background:#e5e7eb; color:#4b5563; padding:2px 8px; border-radius:6px; font-size:11px">精算済</span>'
    : isPast
      ? '<span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:6px; font-size:11px">精算待ち</span>'
      : isToday
        ? '<span style="background:#dcfce7; color:#166534; padding:2px 8px; border-radius:6px; font-size:11px">今日</span>'
        : '<span style="background:#dbeafe; color:#1e40af; padding:2px 8px; border-radius:6px; font-size:11px">予定</span>';
  const canJoin     = !p.me_joined && !isSettled && !isPast;
  const canWithdraw = p.me_joined && !isSettled && isFuture;
  const canSettle   = !isSettled && (p.is_mine || (state.me?.role === 'admin')) && !isFuture;
  return `
    <div class="card">
      <div class="row" style="gap:8px; align-items:center; margin-bottom:6px">
        <div style="font-weight:700; font-size:16px">🏫 ${escapeHtml(fmtDate(p.target_date))}</div>
        ${statusBadge}
        <span style="margin-left:auto; font-size:12px; color:#6b7280">罰金 ${p.fee}pt</span>
      </div>
      ${p.memo ? `<div style="font-size:13px; color:#4b5563; margin-bottom:6px">${escapeHtml(p.memo)}</div>` : ''}
      <div style="font-size:12px; color:#6b7280; margin-bottom:6px">
        起案: ${escapeHtml(p.creator_name || '')} · 参加宣言 ${p.joiner_count} 人
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px">
        ${(p.joiners || []).map(j => joinerChip(j, p)).join('')}
      </div>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        ${canJoin     ? `<button class="btn primary" data-tla-join="${p.id}">🙋 参加する</button>` : ''}
        ${canWithdraw ? `<button class="btn"         data-tla-withdraw="${p.id}">取消</button>` : ''}
        ${canSettle   ? `<button class="btn primary" data-tla-settle="${p.id}" style="background:#7c3aed">💰 精算する</button>` : ''}
      </div>
      ${isSettled ? `<div class="hint-sm" style="font-size:11px; color:#6b7280; margin-top:6px">精算済み — バッジ ✅=行った / ❌=行かなかった、下部に受取/支払 pt</div>` : ''}
    </div>
  `;
}

function joinerChip(j, p) {
  const isSettled = p.status === 'settled';
  const cls = j.is_me ? 'font-weight:700; border:2px solid #4a106d' : 'border:1px solid #e5e7eb';
  let mark = '';
  if (isSettled) {
    if (j.showed_up === true)  mark = '<span title="行った" style="color:#059669; margin-left:2px">✅</span>';
    if (j.showed_up === false) mark = '<span title="行かなかった" style="color:#dc2626; margin-left:2px">❌</span>';
    if (j.bonus_received > 0)  mark += `<span style="color:#059669; font-size:10px; margin-left:2px">+${j.bonus_received}pt</span>`;
    if (j.penalty_paid > 0)    mark += `<span style="color:#dc2626; font-size:10px; margin-left:2px">−${j.penalty_paid}pt</span>`;
  }
  return `<span style="display:inline-flex; align-items:center; gap:3px; padding:3px 8px; border-radius:12px; background:#fafafa; ${cls}; font-size:12px">
    ${avatarHtml(j.display_name, j.avatar_url, 'xs')}
    <span>${escapeHtml(j.display_name)}</span>
    ${mark}
  </span>`;
}

function wireRows() {
  document.querySelectorAll('[data-tla-join]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.tlaJoin;
      el.disabled = true;
      try { await post(`/api/tomorrow-lab/${id}/join`, {}); toast('参加宣言完了'); await loadList(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
  document.querySelectorAll('[data-tla-withdraw]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('参加宣言を取り消します。よい?')) return;
      const id = el.dataset.tlaWithdraw;
      el.disabled = true;
      try { await del(`/api/tomorrow-lab/${id}/join`); toast('取消しました'); await loadList(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
  document.querySelectorAll('[data-tla-settle]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('精算します (checkin データから自動判定)。よい?')) return;
      const id = el.dataset.tlaSettle;
      el.disabled = true; el.textContent = '⌛ 精算中…';
      try {
        const r = await post(`/api/tomorrow-lab/${id}/settle`, {});
        toast(`精算完了: 行った ${r.showed} 人 / 行かなかった ${r.noshow} 人 (pot ${r.pot_total}pt)`);
        await loadList();
      } catch (e) { toast('失敗: ' + e.message); el.disabled = false; el.textContent = '💰 精算する'; }
    });
  });
}
