// /#/pres-order — 発表順オークション (v1120)
//   sealed 入札で早い順を勝ち取る。締切後に一斉開票 → 金額降順で 1, 2, ... を割り当て
//   勝者は入札額を SYSTEM に支払う (未入札は 0pt で最下位ゾーンに並ぶ)。

import { get, post, put, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { toast, state } from '../app.js';

function fmtDeadline(iso) {
  if (!iso) return '締切なし (手動)';
  const d = new Date(iso.replace(' ', 'T'));
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function localDeadlineToServer(v) {
  if (!v) return null;
  return v.replace('T', ' ') + ':00';
}

export async function renderPresOrder() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🎪 発表順オークション</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px; line-height:1.6">
        論文紹介 / ポスターセッションの<b>発表順</b>を、sealed 入札で決める。<br>
        全員好きな額を入れて締切 → 金額の高い順に <b>1番目、2番目、…</b> を割り当て。<br>
        勝者は入札額を pot に支払う (未入札は 0pt で最下位ゾーンに並ぶ)。
      </p>
    </div>
    <div class="card">
      <details>
        <summary style="cursor:pointer; font-weight:600">➕ 新しいオークションを起案</summary>
        <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px">
          <label><div style="font-size:12px; color:#6b7280">タイトル (必須)</div>
            <input type="text" id="poa-title" maxlength="200" placeholder="例: 8/5 ゼミ論文紹介発表順" style="width:100%; padding:6px; box-sizing:border-box"></label>
          <label><div style="font-size:12px; color:#6b7280">説明 (任意)</div>
            <textarea id="poa-desc" rows="2" maxlength="2000" placeholder="ルール等" style="width:100%; padding:6px; box-sizing:border-box"></textarea></label>
          <label><div style="font-size:12px; color:#6b7280">締切 (任意、未設定は手動締切)</div>
            <input type="datetime-local" id="poa-deadline" style="padding:6px"></label>
          <div class="row" style="justify-content:flex-end">
            <button class="btn primary" id="poa-create">起案</button>
          </div>
        </div>
      </details>
    </div>
    <div id="poa-list"><div class="muted">読み込み中…</div></div>
  `;
  document.getElementById('poa-create').addEventListener('click', createAuction);
  await loadList();
}

async function createAuction() {
  const title = document.getElementById('poa-title').value.trim();
  const desc  = document.getElementById('poa-desc').value.trim();
  const dl    = document.getElementById('poa-deadline').value;
  if (!title) { toast('タイトルを入れてね'); return; }
  const btn = document.getElementById('poa-create');
  btn.disabled = true; btn.textContent = '⌛ 送信中…';
  try {
    await post('/api/pres-order', { title, description: desc, deadline: localDeadlineToServer(dl) });
    toast('起案しました');
    await loadList();
  } catch (e) { toast('失敗: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '起案'; }
}

async function loadList() {
  const root = document.getElementById('poa-list');
  try {
    const d = await get('/api/pres-order');
    const items = d.items || [];
    if (!items.length) { root.innerHTML = '<div class="card"><div class="muted">まだオークションがありません。上から作ってみよう。</div></div>'; return; }
    root.innerHTML = items.map(auctionCard).join('');
    wireCards();
  } catch (e) {
    root.innerHTML = `<div class="card muted" style="color:#b91c1c">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function auctionCard(a) {
  const isOpen = a.status === 'open';
  const isClosed = a.status === 'closed';
  const statusBadge = isOpen
    ? '<span style="background:#dcfce7; color:#166534; padding:2px 8px; border-radius:6px; font-size:11px">🎪 入札受付中</span>'
    : isClosed
      ? '<span style="background:#e5e7eb; color:#4b5563; padding:2px 8px; border-radius:6px; font-size:11px">開票済</span>'
      : '<span style="background:#fee2e2; color:#b91c1c; padding:2px 8px; border-radius:6px; font-size:11px">キャンセル</span>';
  const bidRow = isOpen ? `
    <div class="row" style="gap:6px; align-items:end; margin-top:8px">
      <label style="flex:0 0 140px">
        <div style="font-size:12px; color:#6b7280">あなたの入札額 (0-5000)</div>
        <input type="number" data-poa-amt="${a.id}" min="0" max="5000" value="${a.my_bid ?? ''}" placeholder="0=非入札" style="width:100%; padding:6px; box-sizing:border-box">
      </label>
      <button class="btn primary" data-poa-bid="${a.id}">入札</button>
      ${a.my_bid !== null ? `<button class="btn" data-poa-cancel-bid="${a.id}">取消</button>` : ''}
    </div>
    <div class="hint-sm" style="font-size:11px; color:#6b7280; margin-top:4px">
      あなたの現在の入札: <b>${a.my_bid !== null ? a.my_bid + 'pt' : '未入札'}</b> (他人の額は締切まで見えません)
    </div>
  ` : '';
  const bidderChips = isOpen ? `
    <div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:6px">
      ${(a.bidders || []).map(b => `<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 6px; border-radius:10px; background:#f3f4f6; font-size:11px; ${b.is_me ? 'border:2px solid #4a106d; font-weight:700' : ''}">${avatarHtml(b.display_name, b.avatar_url, 'xs')} ${escapeHtml(b.display_name)}</span>`).join('')}
    </div>
  ` : '';
  const results = isClosed ? `
    <div style="margin-top:8px; border-top:1px dashed #e5e7eb; padding-top:8px">
      <div style="font-weight:600; font-size:13px; margin-bottom:4px">🎪 開票結果</div>
      ${(a.results || []).map(r => {
        const emoji = ['🥇','🥈','🥉'][r.assigned_slot - 1] || `${r.assigned_slot}.`;
        const mine = r.is_me ? 'background:#ede4f7; border:2px solid #4a106d' : 'background:#fafafa';
        return `<div style="display:flex; align-items:center; gap:6px; padding:4px 8px; ${mine}; border-radius:6px; margin-bottom:2px">
          <span style="min-width:24px; font-weight:700">${emoji}</span>
          ${avatarHtml(r.display_name, r.avatar_url, 'xs')}
          <span style="flex:1">${escapeHtml(r.display_name)}</span>
          <span style="font-size:12px; color:${r.amount > 0 ? '#059669' : '#9ca3af'}">${r.amount > 0 ? r.amount + 'pt' : '非入札'}</span>
        </div>`;
      }).join('')}
    </div>
  ` : '';
  const controls = a.can_close ? `
    <div class="row" style="gap:6px; margin-top:8px">
      <button class="btn primary" data-poa-close="${a.id}" style="background:#7c3aed">🎪 締めて開票</button>
      <button class="btn" data-poa-cancel="${a.id}" style="color:#b91c1c">取消</button>
    </div>` : '';
  return `
    <div class="card">
      <div class="row" style="gap:8px; align-items:center">
        <div style="font-weight:700; font-size:16px; flex:1; min-width:0">${escapeHtml(a.title)}</div>
        ${statusBadge}
      </div>
      ${a.description ? `<div style="font-size:13px; color:#4b5563; margin-top:4px; white-space:pre-wrap">${escapeHtml(a.description)}</div>` : ''}
      <div style="font-size:11px; color:#6b7280; margin-top:4px">
        起案: ${escapeHtml(a.creator_name || '')} · 入札 ${a.bid_count} 人 · 締切 ${fmtDeadline(a.deadline)}
      </div>
      ${bidRow}
      ${bidderChips}
      ${controls}
      ${results}
    </div>
  `;
}

function wireCards() {
  document.querySelectorAll('[data-poa-bid]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.poaBid;
      const input = document.querySelector(`[data-poa-amt="${id}"]`);
      const amount = parseInt(input.value, 10);
      if (isNaN(amount) || amount < 0 || amount > 5000) { toast('0-5000pt で入れてね'); return; }
      el.disabled = true; el.textContent = '送信中…';
      try { await put(`/api/pres-order/${id}/bid`, { amount }); toast('入札しました'); await loadList(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; el.textContent = '入札'; }
    });
  });
  document.querySelectorAll('[data-poa-cancel-bid]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('入札を取消?')) return;
      const id = el.dataset.poaCancelBid;
      el.disabled = true;
      try { await del(`/api/pres-order/${id}/bid`); toast('取消しました'); await loadList(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
  document.querySelectorAll('[data-poa-close]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('締切して開票しますか? 落札者は入札額を支払い、全員に通知が飛びます。')) return;
      const id = el.dataset.poaClose;
      el.disabled = true; el.textContent = '⌛ 開票中…';
      try {
        const r = await post(`/api/pres-order/${id}/close`, {});
        toast(`開票完了 (総額 ${r.total_charged}pt を pot へ)`);
        await loadList();
      } catch (e) { toast('失敗: ' + e.message); el.disabled = false; el.textContent = '🎪 締めて開票'; }
    });
  });
  document.querySelectorAll('[data-poa-cancel]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('オークションをキャンセル (誰にも課金しない)?')) return;
      const id = el.dataset.poaCancel;
      el.disabled = true;
      try { await post(`/api/pres-order/${id}/cancel`, {}); toast('キャンセルしました'); await loadList(); }
      catch (e) { toast('失敗: ' + e.message); el.disabled = false; }
    });
  });
}
