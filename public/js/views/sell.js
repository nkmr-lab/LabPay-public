import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';
import { startScanner } from '../scan.js';

let currentScanner = null;
let currentJan = '';     // The JAN held internally for the active new-listing flow (set by scanner)

// Common pickup locations. "その他" lets the seller type a custom string.
const LOCATIONS = ['10階冷蔵庫', '10階冷凍庫', '10階ハイテーブル上', '10階こたつ下', '7階棚'];

// Build the location <select> + free-text <input> pair shared by both new-listing forms.
// prefix is '' for JAN form, 'nj-' for no-JAN form. The free-text input is shown only
// when "その他" is selected and used as the final value when present.
function locationFieldHtml(prefix) {
  const opts = LOCATIONS.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  return `
    <label class="field">
      <span class="lbl">置き場所 (任意)</span>
      <select id="${prefix}location_select">
        <option value="">— 選択 —</option>
        ${opts}
        <option value="__other__">その他 (自由入力)</option>
      </select>
      <input type="text" id="${prefix}location_other" maxlength="100" placeholder="場所を自由に入力" hidden style="margin-top:6px">
    </label>`;
}

// Wire the select/other-text toggle. Returns the resolved location string ('' if none).
function wireLocationField(prefix) {
  const sel = document.getElementById(prefix + 'location_select');
  const other = document.getElementById(prefix + 'location_other');
  if (!sel || !other) return;
  sel.addEventListener('change', () => {
    other.hidden = sel.value !== '__other__';
    if (sel.value !== '__other__') other.value = '';
  });
}

function readLocation(prefix) {
  const sel = document.getElementById(prefix + 'location_select');
  const other = document.getElementById(prefix + 'location_other');
  if (!sel) return '';
  if (sel.value === '__other__') return (other?.value || '').trim();
  return sel.value;
}

// Bind the "これどうぞ!" checkbox to the price field visibility. When checked,
// the price input is hidden; submitListing passes is_gift=true and the server
// forces price=0.
function wireGiftToggle(prefix) {
  const cb = document.getElementById(prefix + 'is_gift');
  const priceField = document.getElementById(prefix + 'price-field');
  if (!cb || !priceField) return;
  const sync = () => { priceField.hidden = cb.checked; };
  cb.addEventListener('change', sync);
  sync();
}

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
        <label class="field">
          <span class="lbl">出品名 (任意・例:「賞味期限近」/ 空欄なら商品名)</span>
          <input type="text" id="display_name" maxlength="200" placeholder="">
        </label>
        <h3 style="margin:6px 0">出品条件</h3>
        <label style="display:flex; align-items:center; gap:10px; margin:4px 0 10px">
          <span class="switch">
            <input type="checkbox" id="is_gift">
            <span class="slider"></span>
          </span>
          <span>🎁 これは「これどうぞ！」(無料配布)</span>
        </label>
        <div class="row">
          <label class="field" style="flex:1" id="price-field">
            <span class="lbl">価格 (pt)</span>
            <input type="number" id="price" min="1" step="1" value="100">
          </label>
          <label class="field" style="flex:1">
            <span class="lbl">数量</span>
            <input type="number" id="qty" min="1" step="1" value="1">
          </label>
        </div>
        ${locationFieldHtml('')}
        <label class="field">
          <span class="lbl">購入時のメッセージ (任意)</span>
          <textarea id="completion_message" maxlength="2000" rows="2" placeholder="ご購入ありがとうございます!"></textarea>
          <div class="muted" style="font-size:12px">買ってくれた人に表示されます (note 風)。</div>
        </label>
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
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0 10px">
        <span class="switch">
          <input type="checkbox" id="nj-is_gift">
          <span class="slider"></span>
        </span>
        <span>🎁 これは「これどうぞ！」(無料配布)</span>
      </label>
      <div class="row">
        <label class="field" style="flex:1" id="nj-price-field">
          <span class="lbl">単価 (pt)</span>
          <input type="number" id="nj-price" min="1" step="1" value="30">
        </label>
        <label class="field" style="flex:1">
          <span class="lbl">数量 (在庫)</span>
          <input type="number" id="nj-qty" min="1" step="1" value="20">
        </label>
      </div>
      ${locationFieldHtml('nj-')}
      <label class="field">
        <span class="lbl">出品名 (任意・空欄なら商品名)</span>
        <input type="text" id="nj-display_name" maxlength="200">
      </label>
      <label class="field">
        <span class="lbl">購入時のメッセージ (任意)</span>
        <textarea id="nj-completion_message" maxlength="2000" rows="2" placeholder="ご購入ありがとうございます!"></textarea>
      </label>
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
  wireLocationField('');
  wireLocationField('nj-');
  wireGiftToggle('');
  wireGiftToggle('nj-');

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
  const isGift = !!document.getElementById(prefix + 'is_gift')?.checked;
  const price = isGift ? 0 : Number(document.getElementById(prefix + 'price').value);
  const qty   = Number(document.getElementById(prefix + 'qty'  ).value);
  const completion_message = document.getElementById(prefix + 'completion_message')?.value.trim() || '';
  const display_name = document.getElementById(prefix + 'display_name')?.value.trim() || '';
  const location = readLocation(prefix);

  // JAN flow needs a scanned JAN; no-JAN flow doesn't.
  if (kind === 'jan' && !currentJan) { toast('バーコードを読み取ってください'); return; }
  if (!name || !(qty > 0)) { toast('入力を確認してください'); return; }
  if (!isGift && !(price > 0)) { toast('価格を入力してください'); return; }

  try {
    let jan;
    if (kind === 'jan') {
      await post('/api/products', { jan: currentJan, name, image_url: image_url || null });
      jan = currentJan;
    } else {
      const created = await post('/api/products/no_jan', { name, image_url: image_url || null });
      jan = created.jan;
    }
    const listing = await post('/api/listings', {
      jan, price, qty,
      is_gift: isGift,
      display_name: display_name || null,
      completion_message: completion_message || null,
      location: location || null,
    });
    const summary = isGift ? `これどうぞ × 在庫 ${qty}` : `単価 ${price}pt × 在庫 ${qty}`;
    toast(`出品しました (#${listing.id} / ${summary})`);
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
  const cm = document.getElementById(prefix + 'completion_message');
  if (cm) cm.value = '';
  const dn = document.getElementById(prefix + 'display_name');
  if (dn) dn.value = '';
  const gift = document.getElementById(prefix + 'is_gift');
  if (gift) { gift.checked = false; gift.dispatchEvent(new Event('change')); }
  const locSel = document.getElementById(prefix + 'location_select');
  if (locSel) locSel.value = '';
  const locOther = document.getElementById(prefix + 'location_other');
  if (locOther) { locOther.value = ''; locOther.hidden = true; }
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
  const locTag = l.location ? `<span class="tag muted" style="margin-left:4px">📍 ${escapeHtml(l.location)}</span>` : '';
  const giftTag = l.is_gift ? `<span class="tag" style="margin-left:4px; background:#fce4ec; color:#b71c50">🎁 これどうぞ</span>` : '';
  const productName = l.product_name ?? l.name;
  const effectiveName = l.name ?? productName;
  const priceLine = l.is_gift
    ? `<div class="meta">JAN <span class="mono">${escapeHtml(l.jan)}</span> · 🎁 無料配布 · 在庫 ${l.qty}</div>`
    : `<div class="meta">JAN <span class="mono">${escapeHtml(l.jan)}</span> · 価格 ${l.price.toLocaleString()}pt · 在庫 ${l.qty}</div>`;
  const priceControls = l.is_gift
    ? `<button data-action="ungift" data-id="${l.id}">通常販売に戻す</button>`
    : `<input type="number" min="1" value="${l.price}" data-price="${l.id}" style="max-width:120px">
       <button data-action="price" data-id="${l.id}">価格更新</button>
       <button data-action="makegift" data-id="${l.id}">🎁 これどうぞに切替</button>`;
  return `
    <div class="list-item" data-id="${l.id}" style="align-items:flex-start">
      <div style="flex:1">
        <div class="bold">${escapeHtml(effectiveName)} ${statusTag}${giftTag}${locTag}</div>
        ${priceLine}
        <div class="row" style="margin-top:6px; gap:6px; flex-wrap:wrap">
          ${priceControls}
          <input type="number" min="0" value="${l.qty}" data-qty="${l.id}" style="max-width:90px">
          <button data-action="qty" data-id="${l.id}">在庫更新</button>
          ${l.status === 'withdrawn'
            ? `<button data-action="repost" data-id="${l.id}" class="primary">再出品</button>
               <button data-action="hard_delete" data-id="${l.id}" class="danger">完全削除</button>`
            : `<button data-action="consume" data-id="${l.id}" ${l.qty > 0 ? '' : 'disabled'}>1個消費</button>
               <button data-action="withdraw" data-id="${l.id}" class="danger">取り下げ</button>`
          }
        </div>
        <div class="row" style="margin-top:6px; gap:6px; align-items:center">
          <span class="muted" style="font-size:12px; min-width:62px">出品名</span>
          <input type="text" maxlength="200" value="${escapeHtml(l.display_name ?? '')}" data-dname="${l.id}" placeholder="空欄なら「${escapeHtml(productName)}」" style="flex:1">
          <button data-action="dname" data-id="${l.id}">出品名更新</button>
        </div>
        <div class="row" style="margin-top:6px; gap:6px; align-items:center">
          <span class="muted" style="font-size:12px; min-width:62px">商品名</span>
          <input type="text" maxlength="200" value="${escapeHtml(productName)}" data-pname="${l.id}" data-jan="${escapeHtml(l.jan)}" style="flex:1">
          <button data-action="pname" data-id="${l.id}">商品名更新</button>
        </div>
        <div class="row" style="margin-top:6px; gap:6px; align-items:center">
          <span class="muted" style="font-size:12px; min-width:62px">置き場所</span>
          <input type="text" maxlength="100" value="${escapeHtml(l.location ?? '')}" data-loc="${l.id}" placeholder="例: 10階冷蔵庫" style="flex:1">
          <button data-action="loc" data-id="${l.id}">場所更新</button>
        </div>
        <div class="row" style="margin-top:6px; gap:6px; align-items:flex-start">
          <textarea data-cmsg="${l.id}" maxlength="2000" rows="2" placeholder="購入時のメッセージ (任意)" style="flex:1">${escapeHtml(l.completion_message ?? '')}</textarea>
          <button data-action="cmsg" data-id="${l.id}">メッセージ更新</button>
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
    } else if (action === 'cmsg') {
      const v = document.querySelector(`[data-cmsg="${id}"]`).value.trim();
      await patch('/api/listings/' + id, { completion_message: v || null });
      toast('メッセージを更新しました');
    } else if (action === 'loc') {
      const v = document.querySelector(`[data-loc="${id}"]`).value.trim();
      await patch('/api/listings/' + id, { location: v || null });
      toast('置き場所を更新しました');
    } else if (action === 'pname') {
      const input = document.querySelector(`[data-pname="${id}"]`);
      const v = input.value.trim();
      const jan = input.dataset.jan;
      if (!v) { toast('商品名は必須'); return; }
      await patch('/api/products/' + encodeURIComponent(jan), { name: v });
      toast('商品名を更新しました');
    } else if (action === 'dname') {
      const v = document.querySelector(`[data-dname="${id}"]`).value.trim();
      await patch('/api/listings/' + id, { display_name: v || null });
      toast(v ? '出品名を更新しました' : '出品名をクリアしました');
    } else if (action === 'makegift') {
      if (!confirm('この出品を「これどうぞ！」(無料配布) に切り替えます。価格は 0pt になります。よろしいですか?')) return;
      await patch('/api/listings/' + id, { is_gift: true });
      toast('これどうぞ! に切り替えました');
    } else if (action === 'ungift') {
      const v = prompt('通常販売に戻します。価格 (pt) を入力してください:', '100');
      const price = Number(v);
      if (!(price > 0)) { toast('価格を確認してください'); return; }
      await patch('/api/listings/' + id, { is_gift: false, price });
      toast(`通常販売 (${price}pt) に戻しました`);
    } else if (action === 'consume') {
      if (!confirm('この商品を 1 個、自分で消費します。手数料はかかりません。よろしいですか?')) return;
      const res = await post('/api/listings/' + id + '/consume', { qty: 1 });
      toast(`消費しました (在庫 ${res.qty_remaining})`);
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
