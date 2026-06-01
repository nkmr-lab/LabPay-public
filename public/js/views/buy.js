import { get } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { toast } from '../app.js';
import { startScanner } from '../scan.js';

let currentScanner = null;

export async function renderBuy() {
  stopCurrent();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card balance-strip">
      <span class="muted">残高</span>
      <span class="bold" id="buy-balance" style="color:var(--primary)">— pt</span>
    </div>

    <div class="card">
      <h2>買う</h2>
      <p class="muted">バーコードを読み取るか、下の一覧から選んでください。</p>
      <button class="primary" id="scan-toggle" style="width:100%">📷 バーコードを読み取って買う</button>
      <div id="scanner-wrap" hidden style="margin-top:10px">
        <video id="buy-video" playsinline style="width:100%; max-width:480px; border-radius:12px; background:#000; display:block; margin:0 auto"></video>
        <div class="scanner-status" id="scan-status" style="text-align:center; margin-top:4px"></div>
      </div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px">
        <h3 style="flex:1; margin:0">出品中の商品</h3>
        <select id="buy-sort" style="font-size:13px">
          <option value="newest">新しい順</option>
          <option value="oldest">古い順</option>
          <option value="cheapest">安い順</option>
          <option value="priciest">高い順</option>
        </select>
      </div>
      <div id="grouped"><div class="muted">読み込み中…</div></div>
    </div>
  `;

  document.getElementById('scan-toggle').addEventListener('click', toggleScanner);
  // Restore the saved sort preference; default is "newest".
  const savedSort = localStorage.getItem('labpay-buy-sort') || 'newest';
  document.getElementById('buy-sort').value = savedSort;
  document.getElementById('buy-sort').addEventListener('change', (ev) => {
    localStorage.setItem('labpay-buy-sort', ev.target.value);
    loadListings();
  });

  await loadListings();
  get('/api/me').then(d => {
    const el = document.getElementById('buy-balance');
    if (el) el.textContent = (d.balance ?? 0).toLocaleString() + ' pt';
  }).catch(() => {});

  window.addEventListener('hashchange', stopCurrent, { once: true });
}

async function toggleScanner() {
  const wrap = document.getElementById('scanner-wrap');
  const btn = document.getElementById('scan-toggle');
  if (currentScanner) {
    stopCurrent();
    wrap.hidden = true;
    btn.textContent = '📷 バーコードを読み取って買う';
    return;
  }
  wrap.hidden = false;
  btn.textContent = '■ スキャン停止';
  const status = document.getElementById('scan-status');
  status.textContent = 'カメラ起動中…';
  try {
    currentScanner = await startScanner(document.getElementById('buy-video'), (code) => {
      stopCurrent();
      navigate('#/product/' + encodeURIComponent(code.trim()));
    });
    status.textContent = 'バーコードにかざしてください';
  } catch (e) {
    status.textContent = 'エラー: ' + (e.message || e);
    toast('スキャン開始失敗: ' + (e.message || e));
    wrap.hidden = true;
    btn.textContent = '📷 バーコードを読み取って買う';
  }
}

async function loadListings() {
  try {
    const data = await get('/api/listings');
    // Grouped overview uses the canonical product name (multiple sellers might each pick
    // a different display_name like 「賞味期限近」 — the group header still shows the catalog name).
    const groups = new Map();
    for (const l of data.items) {
      if (!groups.has(l.jan)) groups.set(l.jan, {
        jan: l.jan,
        name: l.product_name ?? l.name,
        image_url: l.image_url,
        listings: [],
      });
      groups.get(l.jan).listings.push(l);
    }
    const root = document.getElementById('grouped');
    if (groups.size === 0) {
      root.innerHTML = `<div class="empty">出品はまだありません</div>`;
      return;
    }
    // Pre-compute sort keys (cheapest sale price, newest/oldest created_at) per group.
    const annotated = [...groups.values()].map(g => {
      const sale = g.listings.filter(x => !x.is_gift);
      const prices = sale.map(x => x.price);
      const minPrice = prices.length ? Math.min(...prices) : Infinity;
      const maxPrice = prices.length ? Math.max(...prices) : -Infinity;
      const newest = g.listings.reduce((acc, x) => x.created_at > acc ? x.created_at : acc, '');
      const oldest = g.listings.reduce((acc, x) => (acc === '' || x.created_at < acc) ? x.created_at : acc, '');
      return { g, minPrice, maxPrice, newest, oldest };
    });
    const sortMode = document.getElementById('buy-sort')?.value || 'newest';
    annotated.sort((a, b) => {
      switch (sortMode) {
        case 'oldest':   return a.oldest.localeCompare(b.oldest);
        case 'cheapest': return a.minPrice - b.minPrice;
        case 'priciest': return b.maxPrice - a.maxPrice;
        case 'newest':
        default:         return b.newest.localeCompare(a.newest);
      }
    });

    const tiles = annotated.map(({ g }) => {
      // Gift listings are surfaced with their own "🎁 これどうぞ" indicator so the price
      // column doesn't read as "0 pt〜" (which feels devaluing). Mixed groups show both.
      const giftCount = g.listings.filter(x => x.is_gift).length;
      const sale = g.listings.filter(x => !x.is_gift);
      let priceLabel;
      if (sale.length === 0) {
        priceLabel = '🎁 これどうぞ';
      } else {
        const prices = sale.map(x => x.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        //   (non-breaking space) keeps "100 pt" on one line even when the column wraps.
        priceLabel = (min === max)
          ? `${min.toLocaleString()} pt`
          : `${min.toLocaleString()}〜${max.toLocaleString()} pt`;
        if (giftCount > 0) priceLabel += ' / 🎁あり';
      }
      const sellers = g.listings.length;
      const totalQty = g.listings.reduce((a, b) => a + b.qty, 0);
      const locs = [...new Set(g.listings.map(x => x.location).filter(Boolean))];
      const giftOnly = sale.length === 0;
      const initial = (g.name || '?').trim().charAt(0).toUpperCase();
      const bg = g.image_url
        ? `style="background-image:url('${escapeHtml(g.image_url)}')"`
        : '';
      const inner = g.image_url ? '' : `<div class="tile-noimg">${escapeHtml(initial)}</div>`;
      const badge = giftOnly
        ? '<span class="tile-badge gift">🎁</span>'
        : (giftCount > 0 ? '<span class="tile-badge">🎁あり</span>' : '');
      // Distinct sellers (by user_id). Show top 3 avatars stacked top-right
      // ("avatar pill") with "+N" when more, plus a primary-seller name on the bottom.
      const seenSellers = new Map();
      g.listings.forEach(l => {
        if (!seenSellers.has(l.seller_user_id)) {
          seenSellers.set(l.seller_user_id, {
            name: l.seller_name,
            avatar_url: l.seller_avatar_url ?? null,
          });
        }
      });
      const distinctSellers = [...seenSellers.values()];
      const stackAvatars = distinctSellers.slice(0, 3)
        .map(s => avatarHtml(s.name, s.avatar_url, 'sm')).join('');
      const moreCount = distinctSellers.length - 3;
      const tileSellersBadge = `
        <div class="tile-sellers">
          ${stackAvatars}
          <span style="margin-left:5px">${distinctSellers.length}人${moreCount > 0 ? ' (+' + moreCount + ')' : ''}</span>
        </div>`;
      const primary = distinctSellers[0];
      const sellerRow = primary
        ? `<div class="seller-row">
             ${avatarHtml(primary.name, primary.avatar_url, 'sm')}
             <span>${escapeHtml(primary.name)}${distinctSellers.length > 1 ? ' 他' : ''}</span>
           </div>`
        : '';
      return `
        <a class="tile" href="#/product/${encodeURIComponent(g.jan)}" ${bg}>
          ${inner}
          ${badge}
          ${tileSellersBadge}
          <div class="tile-overlay">
            <div class="name">${escapeHtml(g.name)}</div>
            <div class="price">${priceLabel}</div>
            ${sellerRow}
            <div class="meta">在庫 ${totalQty}${locs.length ? ' · 📍 ' + escapeHtml(locs.join('/')) : ''}</div>
          </div>
        </a>`;
    });
    root.innerHTML = `<div class="tile-grid">${tiles.join('')}</div>`;
  } catch (e) {
    document.getElementById('grouped').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function stopCurrent() {
  if (currentScanner) { try { currentScanner.stop(); } catch (_) {} }
  currentScanner = null;
}
