import { get } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
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
      <h3>出品中の商品 (安い順)</h3>
      <div id="grouped" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;

  document.getElementById('scan-toggle').addEventListener('click', toggleScanner);

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
    const html = [];
    for (const g of groups.values()) {
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
        priceLabel = (min === max)
          ? `${min.toLocaleString()} pt`
          : `${min.toLocaleString()}〜${max.toLocaleString()} pt`;
        if (giftCount > 0) priceLabel += ' / 🎁あり';
      }
      const sellers = g.listings.length;
      const totalQty = g.listings.reduce((a, b) => a + b.qty, 0);
      const locs = [...new Set(g.listings.map(x => x.location).filter(Boolean))];
      const locTag = locs.length
        ? `<span class="tag muted" style="margin-left:6px">📍 ${escapeHtml(locs.join(' / '))}</span>`
        : '';
      html.push(`
        <a class="list-item" href="#/product/${encodeURIComponent(g.jan)}">
          <div>
            <div class="bold">${escapeHtml(g.name)}${locTag}</div>
            <div class="meta">JAN <span class="mono">${escapeHtml(g.jan)}</span> · ${sellers}人が出品 · 在庫 ${totalQty}</div>
          </div>
          <div style="text-align:right">
            <div class="bold" style="color:var(--primary)">${priceLabel}</div>
          </div>
        </a>
      `);
    }
    root.innerHTML = html.join('');
  } catch (e) {
    document.getElementById('grouped').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function stopCurrent() {
  if (currentScanner) { try { currentScanner.stop(); } catch (_) {} }
  currentScanner = null;
}
