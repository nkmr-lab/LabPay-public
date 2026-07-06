import { get, post } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { refreshMe, state, toast } from '../app.js';
import { playSound } from '../sounds.js';

export async function renderProduct({ params }) {
  const jan = params.jan;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card product-hero" id="product-hero">
      <div class="product-image" id="product-image"></div>
      <h2 id="product-title" style="margin:14px 0 4px">読み込み中…</h2>
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
    const imgEl = document.getElementById('product-image');
    if (prod.image_url) {
      // v521 #157 サムネ優先 (なければ原画像 fallback)
      const src = prod.image_thumb_url || prod.image_url;
      imgEl.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(prod.name || '')}" loading="lazy" decoding="async">`;
    } else {
      const initial = (prod.name || jan).trim().charAt(0).toUpperCase();
      imgEl.innerHTML = `<div class="product-image-fallback">${escapeHtml(initial)}</div>`;
    }
  } catch (e) {
    document.getElementById('product-title').textContent = '(商品未登録) ' + jan;
    document.getElementById('product-image').remove();
  }

  try {
    const data = await get('/api/listings', { jan });
    const root = document.getElementById('seller-list');
    if (!data.items.length) {
      root.innerHTML = `<div class="empty">この商品の出品はありません</div>`;
      return;
    }
    root.innerHTML = data.items.map(renderListingRow).join('');
    // 自己消費 (在庫だけ -1、ledger に動きなし) — seller が自分の出品ボタンを押した時
    root.querySelectorAll('button[data-consume]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const lid = Number(btn.dataset.consume);
        if (!confirm('在庫を 1 個自分用に減らしますか? (ポイント移動なし)')) return;
        btn.disabled = true;
        try {
          const res = await post(`/api/listings/${lid}/consume`, { qty: 1 });
          toast(`在庫を 1 減らしました (残 ${res.qty_remaining})`);
          await renderProduct({ params });
        } catch (e) {
          toast('失敗: ' + e.message);
          btn.disabled = false;
        }
      });
    });
    root.querySelectorAll('button[data-buy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const lid = Number(btn.dataset.buy);
        const price = Number(btn.dataset.price);
        const seller = btn.dataset.seller;
        const isGift = btn.dataset.gift === '1';
        const verb = isGift ? 'もらう' : '購入する';
        const priceTxt = isGift ? '🎁 ' : `${price.toLocaleString()}pt で `;
        if (!confirm(`${priceTxt}${seller} から${verb}か?`)) return;
        btn.disabled = true;
        try {
          const res = await post('/api/purchases', { listing_id: lid }, { withIdempotency: true });
          playSound('payment');
          const took = isGift ? 'ありがたく頂きました' : `購入しました (-${res.unit_price}pt)`;
          toast(`${took}: ${res.product_name} / 残高 ${res.new_balance.toLocaleString()}pt`);
          state.balance = res.new_balance;
          await refreshMe();
          showPostPurchaseModal({
            purchaseId: res.purchase_id,
            sellerName: res.seller_name || seller,
            sellerMessage: res.completion_message || null,
            productName: res.product_name,
            isGift: res.is_gift ?? isGift,
          });
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

// Combined post-purchase modal:
//   1) Seller's note-style thank-you (if configured)
//   2) Buyer's own message + optional pt tip → POST /api/purchases/{id}/thank
// Free items get the thank-you UI prominently (since no money changed hands);
// paid items still get it but folded behind a "お礼を送る" toggle.
function showPostPurchaseModal({ purchaseId, sellerName, sellerMessage, productName, isGift }) {
  const existing = document.getElementById('thankyou-modal');
  if (existing) existing.remove();

  const tipChips = [10, 30, 100].map(n =>
    `<button type="button" class="tip-chip" data-tip="${n}">+${n}pt</button>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.id = 'thankyou-modal';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:14px; max-width:440px; width:100%; padding:20px; box-shadow:0 12px 40px rgba(0,0,0,0.3); max-height:90vh; overflow-y:auto">
      <div style="font-size:13px; color:#666">${escapeHtml(sellerName)} さんから</div>
      ${sellerMessage
        ? `<div style="font-size:16px; margin-top:8px; white-space:pre-wrap; line-height:1.55">${escapeHtml(sellerMessage)}</div>`
        : `<div style="font-size:14px; margin-top:6px; color:#999">${isGift ? 'ありがたく頂きました。' : 'ご購入ありがとうございます。'}</div>`
      }
      <div class="sep" style="margin:14px 0; border-top:1px solid #eee"></div>
      <div style="font-weight:700; margin-bottom:6px">🙏 お礼を送る ${isGift ? '' : '(任意)'}</div>
      <textarea id="thx-msg" rows="2" maxlength="500" placeholder="例: ありがとうございました!" style="width:100%; box-sizing:border-box"></textarea>
      <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center">
        <span style="font-size:12px; color:#666">チップ (任意):</span>
        ${tipChips}
        <input type="number" id="thx-tip-custom" min="0" max="10000" placeholder="自由" style="width:80px">
      </div>
      <div style="margin-top:14px; display:flex; gap:8px; justify-content:flex-end">
        <button id="thankyou-close">閉じる</button>
        <button id="thankyou-send" class="primary">お礼を送る</button>
      </div>
      <div id="thx-status" class="muted" style="font-size:12px; margin-top:6px; text-align:right"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  let selectedTip = 0;
  overlay.querySelectorAll('.tip-chip').forEach(b => {
    b.addEventListener('click', () => {
      overlay.querySelectorAll('.tip-chip').forEach(o => o.classList.remove('primary'));
      b.classList.add('primary');
      selectedTip = Number(b.dataset.tip);
      overlay.querySelector('#thx-tip-custom').value = '';
    });
  });
  overlay.querySelector('#thx-tip-custom').addEventListener('input', (ev) => {
    overlay.querySelectorAll('.tip-chip').forEach(o => o.classList.remove('primary'));
    selectedTip = Number(ev.target.value) || 0;
  });

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#thankyou-close').addEventListener('click', close);
  overlay.querySelector('#thankyou-send').addEventListener('click', async () => {
    const msg = overlay.querySelector('#thx-msg').value.trim();
    const tip = selectedTip;
    if (!msg && !(tip > 0)) {
      overlay.querySelector('#thx-status').textContent = 'メッセージかチップ、どちらかは入れてください';
      return;
    }
    const sendBtn = overlay.querySelector('#thankyou-send');
    sendBtn.disabled = true;
    overlay.querySelector('#thx-status').textContent = '送信中…';
    try {
      const res = await post(`/api/purchases/${purchaseId}/thank`, { message: msg || null, tip: tip || 0 });
      toast(`お礼を送りました${tip > 0 ? ` (-${tip}pt)` : ''}`);
      if (typeof res?.new_balance === 'number') state.balance = res.new_balance;
      await refreshMe();
      close();
    } catch (e) {
      overlay.querySelector('#thx-status').textContent = '失敗: ' + e.message;
      sendBtn.disabled = false;
    }
  });
}

function renderListingRow(l) {
  const isMe = state.me && state.me.id === Number(l.seller_user_id);
  const isGift = !!l.is_gift;
  const inLab = state.inLab === true;  // refreshed from /api/me
  const priceTag = isGift
    ? `<span class="bold" style="color:#b71c50">🎁</span>`
    : `<span class="bold" style="color:var(--primary); white-space:nowrap">${l.price.toLocaleString()} pt</span>`;
  // Three button states:
  //   - own listing: 'cannot buy'
  //   - not in lab: greyed out with explainer (server also enforces this)
  //   - normal: enabled
  let btn;
  if (isMe) {
    // 自分の出品: 自己消費 (在庫だけ減らす・ledger 動かない) ボタンを出す。
    btn = `<button data-consume="${l.id}" title="自己消費 (自分用に在庫を減らす)">自分用に減らす</button>`;
  } else if (!inLab) {
    btn = `<button disabled title="ラボのWi-Fiに繋いでいる時だけ購入できます">ラボWi-Fi必須</button>`;
  } else {
    btn = `<button class="primary" data-buy="${l.id}" data-price="${l.price}" data-gift="${isGift ? '1' : '0'}" data-seller="${escapeHtml(l.seller_name)}">
         ${isGift ? 'もらう' : `${l.price.toLocaleString()}pt で買う`}
       </button>`;
  }
  const locLine = l.location
    ? `<div class="meta">📍 ${escapeHtml(l.location)}</div>`
    : '';
  const dnameLine = (l.display_name && l.display_name !== l.product_name)
    ? `<div class="meta">出品名: ${escapeHtml(l.display_name)}</div>`
    : '';
  // Resale chain — show "原始出品者 → ... → 現在の出品者" when the listing has been
  // resold at least once. We trim long chains visually with an ellipsis but keep the
  // first and last names since they're the most informative.
  const chain = Array.isArray(l.resale_chain) ? l.resale_chain : [];
  const chainLine = l.is_resale && chain.length >= 2
    ? `<div class="meta" style="color:#7a5a00">🔄 ${renderChainNames(chain)}</div>`
    : '';
  return `
    <div class="list-item">
      <div style="display:flex; align-items:center; gap:10px; flex:1">
        ${avatarHtml(l.seller_name, l.seller_avatar_url, 'md')}
        <div>
          <div class="bold">${escapeHtml(l.seller_name)} · ${priceTag}</div>
          <div class="meta">在庫 ${l.qty} · この商品 通算${l.jan_sales ?? 0}個 · 売主通算${l.seller_sales ?? 0}個</div>
          ${dnameLine}
          ${locLine}
          ${chainLine}
        </div>
      </div>
      <div>${btn}</div>
    </div>`;
}

// Render the resale chain as "原始 → 中継 → 現在" using display_name. When the chain
// gets long (>3) we collapse the middle into a "...+N..." marker so the row stays compact.
function renderChainNames(chain) {
  if (chain.length <= 3) {
    return chain.map(c => escapeHtml(c.display_name)).join(' → ');
  }
  const first = chain[0];
  const last = chain[chain.length - 1];
  const middle = chain.length - 2;
  return `${escapeHtml(first.display_name)} → …+${middle}人… → ${escapeHtml(last.display_name)}`;
}
