import { get } from '../api.js';
import { escapeHtml } from '../router.js';

export async function renderHistory() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2>取引履歴</h2>
      <p class="muted">すべての出入り (購入・販売・ラボイン・手数料・取消) が並びます。</p>
    </div>
    <div id="list" class="list"><div class="muted">読み込み中…</div></div>
  `;

  try {
    const tx = await get('/api/me/transactions', { limit: 200 });
    const root = document.getElementById('list');
    if (!tx.items.length) {
      root.innerHTML = `<div class="empty">取引はまだありません</div>`;
      return;
    }
    root.innerHTML = tx.items.map(row).join('');
  } catch (e) {
    document.getElementById('list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function row(t) {
  const sign = t.signed_amount > 0 ? '+' : '';
  const color = t.signed_amount > 0 ? 'var(--primary)' : 'var(--danger)';
  const lbl = ({
    initial: '初期配布', checkin: 'ラボインボーナス', purchase: '購入', fee: '手数料',
    reversal: '取消', transfer: '送金', task_reward: 'タスク報酬',
    deposit: '預け入れ', refund: '返金', burn: '消却'
  })[t.type] || t.type;
  return `
    <div class="list-item">
      <div>
        <div class="bold">${escapeHtml(lbl)}${t.product_name ? ' · ' + escapeHtml(t.product_name) : ''}</div>
        <div class="meta">${escapeHtml(t.counterparty ?? '')} ${t.memo ? '· ' + escapeHtml(t.memo) : ''}</div>
        <div class="meta">${escapeHtml(t.created_at)}</div>
      </div>
      <div style="color:${color}; font-weight:800; white-space:nowrap">${sign}${t.signed_amount.toLocaleString()} pt</div>
    </div>`;
}
