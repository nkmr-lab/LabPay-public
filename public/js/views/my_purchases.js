// /#/me/purchases — 自分の購入履歴 (v847 #430)
//   ラボ内で買ったものを最新順で一覧。商品名 + 値段 + 出品者 + 日付。

import { get } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';

export async function renderMyPurchases() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🛒 自分の購入履歴</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        ラボ内で買ったもの一覧。新しい順、最大 100 件まで表示。
      </p>
    </div>
    <div id="mp-summary" class="card" hidden></div>
    <div id="mp-list" class="card"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/me/purchases', { limit: 100 });
    const items = d.items || [];
    const sumEl = document.getElementById('mp-summary');
    if (items.length) {
      sumEl.hidden = false;
      sumEl.innerHTML = `
        <div style="font-size:13px">
          表示中 <b>${items.length}</b> 件・合計 <b>${(d.total_spent_in_window || 0).toLocaleString()}</b> pt 支払い
        </div>`;
    }
    const root = document.getElementById('mp-list');
    if (!items.length) {
      root.innerHTML = '<div class="muted">まだ購入履歴はありません。 /#/buy から買ってみてください。</div>';
      return;
    }
    root.innerHTML = `<div class="list">${items.map(it => `
      <div class="list-item" style="gap:8px; align-items:flex-start; padding:8px 0">
        <div style="font-size:22px; flex:none">🛒</div>
        <div class="grow" style="min-width:0">
          <div class="bold" style="font-size:14px">${escapeHtml(it.product_name || it.jan || '(商品名なし)')}</div>
          <div class="hint-sm" style="font-size:11px; color:#6b7280; margin-top:2px">
            ${avatarHtml(it.seller_name, it.seller_avatar, 'xs')}
            <span style="margin-left:4px">${escapeHtml(it.seller_name || '?')} さんから</span>
            ・ ${escapeHtml(it.created_at || '')}
            ${it.qty > 1 ? ` ・ ${it.qty} 個` : ''}
          </div>
        </div>
        <div style="text-align:right; flex:none; font-size:13px">
          <div class="bold">${(it.line_total || 0).toLocaleString()} pt</div>
          ${it.fee > 0 ? `<div class="hint-sm" style="font-size:10px; color:#9ca3af">(うち手数料 ${it.fee} pt)</div>` : ''}
        </div>
      </div>`).join('')}</div>`;
  } catch (e) {
    document.getElementById('mp-list').innerHTML = `<div class="muted">取得失敗: ${escapeHtml(e.message)}</div>`;
  }
}
