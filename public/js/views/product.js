import { get, post } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { refreshMe, state, toast } from '../app.js';

export async function renderProduct({ params }) {
  const jan = params.jan;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 id="product-title">読み込み中…</h2>
      <div class="meta">JAN <span class="mono">${escapeHtml(jan)}</span></div>
    </div>
    <div class="card">
      <h3>出品中</h3>
      <div id="seller-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;

  try {
    const prod = await get('/api/products/' + encodeURIComponent(jan));
    document.getElementById('product-title').textContent = prod.name || jan;
  } catch (e) {
    document.getElementById('product-title').textContent = '(商品未登録) ' + jan;
  }

  try {
    const data = await get('/api/listings', { jan });
    const root = document.getElementById('seller-list');
    if (!data.items.length) {
      root.innerHTML = `<div class="empty">この商品の出品はありません</div>`;
      return;
    }
    root.innerHTML = data.items.map(renderListingRow).join('');
    root.querySelectorAll('button[data-buy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const lid = Number(btn.dataset.buy);
        const price = Number(btn.dataset.price);
        const seller = btn.dataset.seller;
        if (!confirm(`${price.toLocaleString()}pt で ${seller} から購入しますか?`)) return;
        btn.disabled = true;
        try {
          const res = await post('/api/purchases', { listing_id: lid }, { withIdempotency: true });
          toast(`購入しました: ${res.product_name} (-${res.unit_price}pt, 残高 ${res.new_balance.toLocaleString()}pt)`);
          state.balance = res.new_balance;
          await refreshMe();
          await renderProduct({ params });
        } catch (e) {
          toast('購入失敗: ' + e.message);
          btn.disabled = false;
        }
      });
    });
  } catch (e) {
    document.getElementById('seller-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderListingRow(l) {
  const isMe = state.me && state.me.id === Number(l.seller_user_id);
  const btn = isMe
    ? `<button disabled title="自分の出品は買えません">自分の出品</button>`
    : `<button class="primary" data-buy="${l.id}" data-price="${l.price}" data-seller="${escapeHtml(l.seller_name)}">${l.price.toLocaleString()}pt で買う</button>`;
  return `
    <div class="list-item">
      <div style="display:flex; align-items:center; gap:10px">
        ${avatarHtml(l.seller_name, l.seller_avatar_url, 'md')}
        <div>
          <div class="bold">${escapeHtml(l.seller_name)}</div>
          <div class="meta">在庫 ${l.qty} · 累計販売 ${l.seller_sales ?? 0}</div>
        </div>
      </div>
      <div>${btn}</div>
    </div>`;
}
