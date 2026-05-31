import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';
import { startScanner } from '../scan.js';

let currentScanner = null;
let currentJan = '';     // The JAN held internally for the active new-listing flow (set by scanner)

export async function renderSell() {
  stopCurrent();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card balance-strip">
      <span class="muted">残高</span>
      <span class="bold" id="sell-balance" style="color:var(--primary)">— pt</span>
    </div>

    <div class="card">
      <h2>売る</h2>
      <p class="muted">バーコードを読み取って新規出品します。バーコードが無い商品は下の「バーコードが無い商品を出品」を使ってください。</p>
    </div>

    <!-- ============= 新規出品 ============= -->
    <div class="card">
      <h3>新規出品</h3>
      <button class="primary" id="scan-toggle" style="width:100%">📷 バーコードを読み取って出品</button>
      <div id="scanner-wrap" hidden style="margin-top:10px">
        <video id="sell-video" playsinline style="width:100%; max-width:320px; border-radius:12px; background:#000; display:block; margin:0 auto"></video>
      </div>
      <div id="scanned-jan" class="muted" style="margin-top:6px; font-size:12px"></div>

      <div id="form-card" hidden style="margin-top:14px">
        <h3 style="margin:0 0 6px">商品情報</h3>
        <label class="field">
          <span class="lbl">商品名 (必須)</span>
          <input type="text" id="name" maxlength="200">
        </label>
        <label class="field">
          <span class="lbl">商品画像 (任意・タップで撮影 or アルバム選択)</span>
          <input type="file" id="image_file" accept="image/*">
          <input type="hidden" id="image_url" value="">
          <img id="image_preview" alt="" hidden style="max-width:140px; max-height:140px; margin-top:6px; border-radius:8px; object-fit:contain; display:block">
          <div id="image_status" class="muted" style="font-size:12px; margin-top:4px"></div>
        </label>
        <h3 style="margin:6px 0">出品条件</h3>
        <div class="row">
          <label class="field" style="flex:1">
            <span class="lbl">価格 (pt)</span>
            <input type="number" id="price" min="1" step="1" value="100">
          </label>
          <label class="field" style="flex:1">
            <span class="lbl">数量</span>
            <input type="number" id="qty" min="1" step="1" value="1">
          </label>
        </div>
        <button class="primary" id="submit-listing">出品する</button>
        <div class="muted" style="margin-top:6px; font-size:13px">手数料は売れたときに価格×5%が差し引かれます。</div>
      </div>
    </div>

    <!-- ============= バーコード無し ============= -->
    <div class="card">
      <h3>バーコードが無い商品を出品</h3>
      <p class="muted" style="font-size:13px">
        カプセルコーヒー1個、お手製のお菓子、ばら売り商品など。<br>
        内部用に擬似 JAN を自動生成します (購入フローからは普通の商品と同じに見えます)。
      </p>
      <label class="field">
        <span class="lbl">商品名 (必須)</span>
        <input type="text" id="nj-name" maxlength="200" placeholder="例: コーヒーカプセル (1個)">
      </label>
      <label class="field">
        <span class="lbl">商品画像 (任意・タップで撮影 or アルバム選択)</span>
        <input type="file" id="nj-image_file" accept="image/*">
        <input type="hidden" id="nj-image_url" value="">
        <img id="nj-image_preview" alt="" hidden style="max-width:140px; max-height:140px; margin-top:6px; border-radius:8px; object-fit:contain; display:block">
        <div id="nj-image_status" class="muted" style="font-size:12px; margin-top:4px"></div>
      </label>
      <div class="row">
        <label class="field" style="flex:1">
          <span class="lbl">単価 (pt)</span>
          <input type="number" id="nj-price" min="1" step="1" value="30">
        </label>
        <label class="field" style="flex:1">
          <span class="lbl">数量 (在庫)</span>
          <input type="number" id="nj-qty" min="1" step="1" value="20">
        </label>
      </div>
      <button class="primary" id="nj-submit">出品する</button>
    </div>

    <!-- ============= 出品管理 ============= -->
    <div class="card">
      <h3>出品管理</h3>
      <p class="muted" style="font-size:13px">価格変更・在庫補充・取り下げ。</p>
      <div id="my-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;

  // --- new listing wiring ---
  document.getElementById('scan-toggle').addEventListener('click', toggleScanner);
  setupImagePicker('image');
  setupImagePicker('nj-image');

  document.getElementById('submit-listing').addEventListener('click', () => submitListing('jan'));
  document.getElementById('nj-submit'    ).addEventListener('click', () => submitListing('no_jan'));

  await loadMyListings();
  // Balance strip
  get('/api/me').then(d => {
    const el = document.getElementById('sell-balance');
    if (el) el.textContent = (d.balance ?? 0).toLocaleString() + ' pt';
  }).catch(() => {});

  window.addEventListener('hashchange', stopCurrent, { once: true });
}

async function toggleScanner() {
  const wrap = document.getElementById('scanner-wrap');
  const btn  = document.getElementById('scan-toggle');
  if (currentScanner) {
    stopCurrent();
    wrap.hidden = true;
    btn.textContent = '📷 バーコードを読み取って出品';
    return;
  }
  wrap.hidden = false;
  btn.textContent = '■ 停止';
  try {
    currentScanner = await startScanner(document.getElementById('sell-video'), async (code) => {
      const jan = code.trim();
      currentJan = jan;
      document.getElementById('scanned-jan').textContent = `読取: ${jan}`;
      stopCurrent();
      wrap.hidden = true;
      btn.textContent = '📷 バーコードを読み取って出品';
      await doLookup(jan);
    });
  } catch (e) {
    toast('カメラ失敗: ' + e.message);
    wrap.hidden = true;
    btn.textContent = '📷 バーコードを読み取って出品';
  }
}

// Wire a <input type="file"> + hidden URL + preview triplet, with auto-upload on selection.
// `prefix` matches the HTML ids: ${prefix}_file / ${prefix}_url / ${prefix}_preview / ${prefix}_status
function setupImagePicker(prefix) {
  const file = document.getElementById(prefix + '_file');
  if (!file) return;
  file.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    // Local preview right away
    const rdr = new FileReader();
    rdr.onload = e => showPreview(prefix, e.target.result);
    rdr.readAsDataURL(f);
    const status = document.getElementById(prefix + '_status');
    status.textContent = 'アップロード中…';
    const fd = new FormData(); fd.append('file', f);
    try {
      const res = await fetch('/api/uploads/image', {
        method: 'POST',
        headers: { 'X-Requested-With': 'labpay' },
        credentials: 'same-origin',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'upload failed');
      document.getElementById(prefix + '_url').value = data.url;
      status.textContent = `アップロード済 (${Math.round(data.size/1024)} KB)`;
      showPreview(prefix, data.url);
    } catch (e) {
      status.textContent = 'アップロード失敗: ' + e.message;
    }
  });
}

function showPreview(prefix, src) {
  const img = document.getElementById(prefix + '_preview');
  if (!img) return;
  img.src = src;
  img.hidden = false;
}

// Unified submit for both JAN and no-JAN flows. `kind` is 'jan' or 'no_jan'.
// JAN flow: register the product under the scanned JAN, then list it.
// no-JAN flow: ask the server to mint a synthetic JAN, then list under it.
async function submitListing(kind) {
  const prefix = kind === 'jan' ? '' : 'nj-';
  const name = document.getElementById(prefix + 'name').value.trim();
  const image_url = document.getElementById(prefix + 'image_url').value.trim();
  const price = Number(document.getElementById(prefix + 'price').value);
  const qty   = Number(document.getElementById(prefix + 'qty'  ).value);

  // JAN flow needs a scanned JAN; no-JAN flow doesn't.
  if (kind === 'jan' && !currentJan) { toast('バーコードを読み取ってください'); return; }
  if (!name || !(price > 0) || !(qty > 0)) { toast('入力を確認してください'); return; }

  try {
    let jan;
    if (kind === 'jan') {
      await post('/api/products', { jan: currentJan, name, image_url: image_url || null });
      jan = currentJan;
    } else {
      const created = await post('/api/products/no_jan', { name, image_url: image_url || null });
      jan = created.jan;
    }
    const listing = await post('/api/listings', { jan, price, qty });
    toast(`出品しました (#${listing.id} / 単価 ${price}pt × 在庫 ${qty})`);
    resetListingForm(kind);
    await loadMyListings();
  } catch (e) {
    toast('出品失敗: ' + e.message);
  }
}

function resetListingForm(kind) {
  const prefix = kind === 'jan' ? '' : 'nj-';
  if (kind === 'jan') {
    document.getElementById('form-card').hidden = true;
    document.getElementById('scanned-jan').textContent = '';
    currentJan = '';
  }
  document.getElementById(prefix + 'name').value = '';
  document.getElementById(prefix + 'image_url').value = '';
  const preview = document.getElementById(prefix + 'image_preview');
  if (preview) preview.hidden = true;
}

async function doLookup(jan) {
  if (!jan) return;
  const form = document.getElementById('form-card');
  form.hidden = false;
  try {
    const p = await get('/api/products/' + encodeURIComponent(jan));
    document.getElementById('name').value = p.name || '';
    document.getElementById('image_url').value = p.image_url || '';
    if (p.image_url) showPreview('image', p.image_url);
    if (p.source === 'api' && p.confidence === 'low') {
      toast('楽天で候補を取得しました — 商品名が正しいか必ず確認してください');
    } else if (p.source === 'api') {
      toast('楽天から商品情報を取得しました');
    } else {
      toast('登録済みの商品情報を読み込みました');
      if (p.image_url) showPreview('image', p.image_url);
    }
  } catch (e) {
    if (e.status === 404) {
      document.getElementById('name').value = '';
      document.getElementById('image_url').value = '';
      toast('未登録の商品です。商品名を入力してください');
    } else {
      toast('照会エラー: ' + e.message);
    }
  }
}

// ---------------- 出品管理 ----------------
async function loadMyListings() {
  try {
    const data = await get('/api/me/listings');
    const root = document.getElementById('my-list');
    if (!data.items.length) {
      root.innerHTML = `<div class="empty">まだ出品がありません</div>`;
      return;
    }
    root.innerHTML = data.items.map(renderRow).join('');
    root.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => onAction(btn));
    });
  } catch (e) {
    document.getElementById('my-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderRow(l) {
  const statusTag = ({
    on_sale:   '<span class="tag">販売中</span>',
    sold_out:  '<span class="tag warn">在庫切れ</span>',
    withdrawn: '<span class="tag muted">取り下げ</span>',
  })[l.status] || '';
  return `
    <div class="list-item" data-id="${l.id}">
      <div style="flex:1">
        <div class="bold">${escapeHtml(l.name)} ${statusTag}</div>
        <div class="meta">JAN ${escapeHtml(l.jan)} · 価格 ${l.price.toLocaleString()}pt · 在庫 ${l.qty}</div>
        <div class="row" style="margin-top:6px; gap:6px">
          <input type="number" min="1" value="${l.price}" data-price="${l.id}" style="max-width:120px">
          <button data-action="price" data-id="${l.id}">価格更新</button>
          <input type="number" min="0" value="${l.qty}" data-qty="${l.id}" style="max-width:90px">
          <button data-action="qty" data-id="${l.id}">在庫更新</button>
          ${l.status === 'withdrawn'
            ? `<button data-action="repost" data-id="${l.id}" class="primary">再出品</button>
               <button data-action="hard_delete" data-id="${l.id}" class="danger">完全削除</button>`
            : `<button data-action="withdraw" data-id="${l.id}" class="danger">取り下げ</button>`
          }
        </div>
      </div>
    </div>`;
}

async function onAction(btn) {
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  try {
    if (action === 'price') {
      const v = Number(document.querySelector(`[data-price="${id}"]`).value);
      if (!(v > 0)) return toast('価格は1以上');
      await patch('/api/listings/' + id, { price: v });
      toast('価格を更新しました');
    } else if (action === 'qty') {
      const v = Number(document.querySelector(`[data-qty="${id}"]`).value);
      if (!(v >= 0)) return toast('在庫は0以上');
      await patch('/api/listings/' + id, { qty: v });
      toast('在庫を更新しました');
    } else if (action === 'withdraw') {
      if (!confirm('この出品を取り下げますか? (購入実績が無ければ後で完全削除も可能)')) return;
      await del('/api/listings/' + id);
      toast('取り下げました');
    } else if (action === 'repost') {
      await patch('/api/listings/' + id, { status: 'on_sale' });
      toast('再出品しました');
    } else if (action === 'hard_delete') {
      if (!confirm('この出品を完全削除しますか? (DB から行ごと消去。購入実績があるものは削除できません)')) return;
      await del('/api/listings/' + id, { hard: 1 });
      toast('完全削除しました');
    }
    await loadMyListings();
  } catch (e) {
    toast('失敗: ' + e.message);
  }
}

function stopCurrent() {
  if (currentScanner) { try { currentScanner.stop(); } catch (_) {} }
  currentScanner = null;
}
