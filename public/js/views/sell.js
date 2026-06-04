import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { startScanner } from '../scan.js';
import { uploadImage } from '../upload.js';

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
    <div class="card">
      <p class="muted" style="margin:0">バーコードを読み取って新規出品します。バーコードが無い商品は下の「バーコードが無い商品を出品」を使ってください。</p>
      <div style="background:#fff8e6; border-left:4px solid var(--warn); padding:10px 12px; border-radius:8px; margin-top:10px; font-size:13px; line-height:1.6">
        💡 <span class="bold">価格のヒント</span><br>
        ・1pt ≈ 1円 換算が目安です<br>
        ・売れた時に <span class="bold">5%</span> が手数料として差し引かれるので、仕入れ値 + 手数料を考慮した値付けがオススメ<br>
        ・<span class="bold">20pt 未満</span> の出品は手数料がかかりません (端数切捨てで 0pt)
      </div>
      <div style="margin-top:10px; padding:8px 12px; font-size:13px; color:#c62828; font-weight:700">
        🚫 転売はやめてね！
      </div>
    </div>

    <!-- ============= 新規出品 (折りたたみ) ============= -->
    <details class="card collapsible-form">
      <summary>＋ 新規出品</summary>
      <div style="margin-top:10px"></div>

      <details class="collapsible-sub" open>
        <summary>📷 バーコードで登録</summary>
        <div style="margin-top:8px"></div>
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
        <label class="field">
          <span class="lbl">販売期限 (任意・無指定なら無期限)</span>
          <input type="datetime-local" id="expires_at">
          <span class="hint-sm">期限を過ぎると自動で「取り下げ」になります。</span>
        </label>
        <h3 style="margin:6px 0">出品条件</h3>
        <label style="display:flex; align-items:center; gap:10px; margin:4px 0 10px">
          <span class="switch">
            <input type="checkbox" id="is_gift">
            <span class="slider"></span>
          </span>
          <span>🎁 「これどうぞ！」(無料配布)</span>
        </label>
        <div class="row">
          <label class="field grow" id="price-field">
            <span class="lbl">価格 (pt)</span>
            <input type="number" id="price" min="1" step="1" value="100">
          </label>
          <label class="field grow">
            <span class="lbl">数量</span>
            <input type="number" id="qty" min="1" step="1" value="1">
          </label>
        </div>
        ${locationFieldHtml('')}
        <label class="field">
          <span class="lbl">購入時のメッセージ (任意)</span>
          <textarea id="completion_message" maxlength="2000" rows="2" placeholder="ご購入ありがとうございます!"></textarea>
          <div class="hint-sm">買ってくれた人に表示されます (note 風)。</div>
        </label>
        <div class="row" style="gap:6px">
          <button class="btn" id="preview-listing" type="button">👀 プレビュー</button>
          <button class="primary grow" id="submit-listing">出品する</button>
        </div>
        <div class="muted" style="margin-top:6px; font-size:13px">手数料は売れたときに価格×5%が差し引かれます。</div>
      </div>
      </details>

      <details class="collapsible-sub">
        <summary>✏️ バーコードなしで登録</summary>
        <div style="margin-top:8px"></div>
      <p class="hint">
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
        <span>🎁 「これどうぞ！」(無料配布)</span>
      </label>
      <div class="row">
        <label class="field grow" id="nj-price-field">
          <span class="lbl">単価 (pt)</span>
          <input type="number" id="nj-price" min="1" step="1" value="30">
        </label>
        <label class="field grow">
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
        <span class="lbl">販売期限 (任意・無指定なら無期限)</span>
        <input type="datetime-local" id="nj-expires_at">
      </label>
      <label class="field">
        <span class="lbl">購入時のメッセージ (任意)</span>
        <textarea id="nj-completion_message" maxlength="2000" rows="2" placeholder="ご購入ありがとうございます!"></textarea>
      </label>
      <div class="row" style="gap:6px">
        <button class="btn" id="nj-preview" type="button">👀 プレビュー</button>
        <button class="primary grow" id="nj-submit">出品する</button>
      </div>
      </details>
    </details>

    <!-- ============= 出品管理 ============= -->
    <div class="card">
      <h3>出品管理</h3>
      <p class="hint">価格変更・在庫補充・取り下げ。</p>
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
  document.getElementById('preview-listing').addEventListener('click', () => openSellPreview('jan'));
  document.getElementById('nj-preview'    ).addEventListener('click', () => openSellPreview('no_jan'));

  await loadMyListings();
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
    try {
      const data = await uploadImage(f);
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
// 出品プレビュー: 出品しないまま 「購入画面 一覧 / 詳細 で どう見えるか」 を
// モーダルで表示。 buy.js の tile + product.js の購入カード を 寄せて作る。
function openSellPreview(kind) {
  const p = kind === 'jan' ? '' : 'nj-';
  const name = document.getElementById(p + 'name')?.value?.trim() || '';
  const displayName = document.getElementById(p + 'display_name')?.value?.trim() || '';
  const imageUrl = document.getElementById(p + 'image_url')?.value?.trim() || '';
  const isGift = document.getElementById(p + 'is_gift')?.checked || false;
  const price = isGift ? 0 : Number(document.getElementById(p + 'price')?.value || 0);
  const qty = Number(document.getElementById(p + 'qty')?.value || 0);
  const location = readLocation(p);
  const expiresAt = document.getElementById(p + 'expires_at')?.value || '';
  const completionMsg = document.getElementById(p + 'completion_message')?.value?.trim() || '';
  if (!name) { toast('商品名 を入れてください'); return; }
  if (!isGift && !(price > 0)) { toast('価格 を入れてください'); return; }
  if (!(qty > 0)) { toast('数量 を入れてください'); return; }
  const titleForBuyer = displayName || name;
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const sellerName = state.me?.display_name || '自分';
  const sellerAvatar = state.me?.avatar_url || '';
  const priceLabel = isGift
    ? '🎁 これどうぞ'
    : `${price.toLocaleString()} pt`;
  const stockInline = qty > 1 ? `<span class="stock-pill">×${qty}</span>` : '';
  const bg = imageUrl ? `style="background-image:url('${escapeHtml(imageUrl)}')"` : '';
  const inner = imageUrl ? '' : `<div class="tile-noimg">${escapeHtml(initial)}</div>`;
  const badge = isGift ? '<span class="tile-badge gift">🎁</span>' : '';
  const locText = location ? '📍 ' + escapeHtml(location) : '';
  // 一覧 tile (buy.js と同じ class 構成)
  const tileHtml = `
    <div class="tile" ${bg} style="pointer-events:none; max-width:200px; margin:0 auto">
      ${inner}${badge}
      <div class="tile-seller">${avatarSmall(sellerName, sellerAvatar)}</div>
      <div class="tile-overlay">
        <div class="name">${escapeHtml(name)}</div>
        <div class="price-row"><span class="price">${priceLabel}</span>${stockInline}</div>
        ${locText ? `<div class="meta">${locText}</div>` : ''}
      </div>
    </div>`;
  // 詳細画面 (商品ページ) の見え方 - 簡易版
  const expiresLine = expiresAt
    ? `<div class="meta">📅 販売期限 ${escapeHtml(expiresAt.replace('T', ' '))}</div>` : '';
  const msgLine = completionMsg
    ? `<div class="muted" style="font-size:13px; white-space:pre-wrap; padding:8px; background:#fff8e6; border-radius:6px; margin-top:6px">💬 購入後表示: ${escapeHtml(completionMsg)}</div>` : '';
  const detailHtml = `
    <div style="border:1px solid var(--line); border-radius:8px; padding:10px; background:#fff">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" style="display:block; max-width:100%; max-height:200px; margin:0 auto 8px; border-radius:6px; object-fit:contain">` : ''}
      <div class="bold" style="font-size:16px">${escapeHtml(titleForBuyer)}</div>
      <div class="meta">${escapeHtml(name)}${displayName ? ` <span class="muted">(出品名: ${escapeHtml(displayName)})</span>` : ''}</div>
      <div class="row center" style="margin-top:6px">
        <div class="bold text-primary" style="font-size:18px">${priceLabel}</div>
        <div class="muted">在庫 ${qty}</div>
      </div>
      ${locText ? `<div class="meta">${locText}</div>` : ''}
      ${expiresLine}
      <div class="meta" style="margin-top:4px">出品者: ${escapeHtml(sellerName)}</div>
      <button class="primary" style="width:100%; margin-top:8px" disabled>${isGift ? 'もらう (プレビュー)' : '購入する (プレビュー)'}</button>
      ${msgLine}
    </div>`;
  // モーダル
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:flex-start; padding:20px; overflow-y:auto; justify-content:center';
  wrap.innerHTML = `
    <div style="background:#fff; border-radius:12px; padding:14px; max-width:480px; width:100%; box-sizing:border-box">
      <div class="row center" style="margin-bottom:8px">
        <h3 style="margin:0">👀 プレビュー</h3>
        <button class="btn" data-close>×</button>
      </div>
      <p class="hint" style="font-size:12px; margin:0 0 6px">出品はまだ実行されていません。 以下の見た目になります:</p>
      <h4 style="margin:10px 0 6px; font-size:13px">購入 一覧 (タイル)</h4>
      ${tileHtml}
      <h4 style="margin:14px 0 6px; font-size:13px">購入 詳細</h4>
      ${detailHtml}
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
}
// avatarHtml は router.js export 済だが、 ここでは name only の小型版を直接組む。
function avatarSmall(name, url) {
  if (url) return `<img src="${escapeHtml(url)}" alt="" style="width:24px; height:24px; border-radius:50%; object-fit:cover; vertical-align:middle">`;
  const ch = (name || '?').trim().charAt(0).toUpperCase();
  return `<span style="display:inline-flex; width:24px; height:24px; border-radius:50%; background:#ddd; align-items:center; justify-content:center; font-size:11px; vertical-align:middle">${escapeHtml(ch)}</span>`;
}

async function submitListing(kind) {
  const prefix = kind === 'jan' ? '' : 'nj-';
  const name = document.getElementById(prefix + 'name').value.trim();
  const image_url = document.getElementById(prefix + 'image_url').value.trim();
  const isGift = !!document.getElementById(prefix + 'is_gift')?.checked;
  const price = isGift ? 0 : Number(document.getElementById(prefix + 'price').value);
  const qty   = Number(document.getElementById(prefix + 'qty'  ).value);
  const completion_message = document.getElementById(prefix + 'completion_message')?.value.trim() || '';
  const display_name = document.getElementById(prefix + 'display_name')?.value.trim() || '';
  const expires_at = document.getElementById(prefix + 'expires_at')?.value || '';
  const location = readLocation(prefix);

  // JAN flow needs a scanned JAN; no-JAN flow doesn't.
  if (kind === 'jan' && !currentJan) { toast('バーコードを読み取ってください'); return; }
  if (!name || !(qty > 0)) { toast('入力を確認してください'); return; }
  if (!isGift && !(price > 0)) { toast('価格を入力してください'); return; }
  // Race guard — user selected an image file but the upload hasn't populated the
  // hidden URL yet. Submitting now would race against a half-finished upload.
  const fileInputId = (kind === 'jan' ? 'image' : 'nj-image') + '_file';
  const fileInput = document.getElementById(fileInputId);
  if (fileInput && fileInput.files && fileInput.files.length > 0 && !image_url) {
    toast('画像のアップロード完了をお待ちください'); return;
  }

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
      expires_at: expires_at || null,
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
  const ex = document.getElementById(prefix + 'expires_at');
  if (ex) ex.value = '';
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
// Listing IDs the user has tapped [編集] on — those render the full edit form,
// the rest render a compact summary with [編集] / [取り下げ]. Module-level so
// the state survives re-renders triggered by 更新 etc.
const editingIds = new Set();

async function loadMyListings() {
  try {
    const data = await get('/api/me/listings');
    const root = document.getElementById('my-list');
    if (!data.items.length) {
      root.innerHTML = `<div class="empty">まだ出品がありません</div>`;
      return;
    }
    root.innerHTML = data.items.map(l =>
      editingIds.has(l.id) ? renderEditRow(l) : renderSummaryRow(l)
    ).join('');
    root.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => onAction(btn));
    });
    // 画像差し替え: ファイル選択するだけで自動 upload + PATCH。
    root.querySelectorAll('[data-img-file]').forEach(input => {
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const jan = input.dataset.jan;
        try {
          const upData = await uploadImage(file);
          await patch('/api/products/' + encodeURIComponent(jan), { image_url: upData.url });
          toast('画像を差し替えました');
          await loadMyListings();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    document.getElementById('my-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// Shared bits between summary and edit modes.
function listingTags(l) {
  const statusTag = ({
    on_sale:   '<span class="tag">販売中</span>',
    sold_out:  '<span class="tag warn">在庫切れ</span>',
    withdrawn: '<span class="tag muted">取り下げ</span>',
  })[l.status] || '';
  const locTag = l.location ? `<span class="tag muted" style="margin-left:4px">📍 ${escapeHtml(l.location)}</span>` : '';
  const giftTag = l.is_gift ? `<span class="tag" style="margin-left:4px; background:#fce4ec; color:#b71c50">🎁 これどうぞ</span>` : '';
  return statusTag + giftTag + locTag;
}

// Compact read-only summary — the default view. Tap [編集] to expand into the
// full form. Withdrawn listings expose [再出品] / [完全削除] inline since
// there are no fields to edit anyway.
function renderSummaryRow(l) {
  const productName = l.product_name ?? l.name;
  const effectiveName = l.name ?? productName;
  const tags = listingTags(l);
  const priceLine = l.is_gift
    ? `<div class="meta">JAN <span class="mono">${escapeHtml(l.jan)}</span> · 🎁 無料配布 · 在庫 ${l.qty}</div>`
    : `<div class="meta">JAN <span class="mono">${escapeHtml(l.jan)}</span> · 価格 ${l.price.toLocaleString()}pt · 在庫 ${l.qty}</div>`;
  const thumb = l.image_url
    ? `<img src="${escapeHtml(l.image_url)}" style="width:48px; height:48px; object-fit:cover; border-radius:6px; flex:0 0 auto">`
    : `<div style="width:48px; height:48px; border-radius:6px; background:#f1f1f4; flex:0 0 auto"></div>`;
  const actions = l.status === 'withdrawn'
    ? `<button data-action="repost" data-id="${l.id}" class="primary">再出品</button>
       <button data-action="hard_delete" data-id="${l.id}" class="danger">完全削除</button>`
    : `<button data-action="edit-start" data-id="${l.id}">編集</button>
       <button data-action="withdraw" data-id="${l.id}" class="danger">取り下げ</button>`;
  return `
    <div class="list-item sell-row" data-id="${l.id}" style="align-items:center; gap:10px">
      ${thumb}
      <div style="flex:1; min-width:0">
        <div class="bold">${escapeHtml(effectiveName)} ${tags}</div>
        ${priceLine}
        ${l.completion_message ? `<div class="meta" style="white-space:pre-wrap">${escapeHtml(l.completion_message.slice(0, 80))}${l.completion_message.length > 80 ? '…' : ''}</div>` : ''}
      </div>
      <div style="display:flex; flex-direction:column; gap:4px; flex:0 0 auto">
        ${actions}
      </div>
    </div>`;
}

// Full edit form — what [編集] expands to. Bottom row gets a キャンセル so the
// user can bail without saving. 更新 collapses back to summary on success.
function renderEditRow(l) {
  const tags = listingTags(l);
  const productName = l.product_name ?? l.name;
  const effectiveName = l.name ?? productName;
  const priceLine = l.is_gift
    ? `<div class="meta">JAN <span class="mono">${escapeHtml(l.jan)}</span> · 🎁 無料配布 · 在庫 ${l.qty}</div>`
    : `<div class="meta">JAN <span class="mono">${escapeHtml(l.jan)}</span> · 価格 ${l.price.toLocaleString()}pt · 在庫 ${l.qty}</div>`;
  // Editable fields stack — each row is its own label + input. The single
  // [更新] button below collects every field's current value and writes them
  // in one call. Gift listings hide the price field (replaced with the gift
  // chip + 通常販売に戻す button); everything else is identical.
  // Price row + gift-toggle row sit together so the mode change is read as
  // 'about the price', not a stray button at the bottom of the card.
  const priceField = l.is_gift
    ? `<div class="sell-edit-row" style="align-items:center">
         <span class="sell-edit-label">価格</span>
         <div class="sell-edit-input" style="color:#b71c50; font-weight:600">🎁 これどうぞ (0pt)</div>
       </div>
       <div class="sell-edit-row" style="align-items:center">
         <span class="sell-edit-label"></span>
         <div class="sell-edit-input" style="display:block">
           <button data-action="ungift" data-id="${l.id}">通常販売に戻す</button>
         </div>
       </div>`
    : `<div class="sell-edit-row" style="align-items:center">
         <span class="sell-edit-label">価格 (pt)</span>
         <div class="sell-edit-input"><input type="number" min="1" value="${l.price}" data-price="${l.id}"></div>
       </div>
       <div class="sell-edit-row" style="align-items:center">
         <span class="sell-edit-label"></span>
         <div class="sell-edit-input" style="display:block">
           <button data-action="makegift" data-id="${l.id}">🎁 これどうぞに切替</button>
         </div>
       </div>`;
  // Action row: per the consolidation, only 更新 / 取り下げ are universal;
  // 🎁 toggle and 1個消費 stay as separate intents because they're mode
  // changes / inventory adjustments rather than "save what I just typed".
  // Gift toggle moved up next to 価格. Bottom action row is just [更新] and
  // [取り下げ] now — the two universal operations on an active listing.
  // [取り下げ] はサマリ側に既にあるので編集中には出さない (誤爆防止 + UI 簡素化)。
  const actionRow = `
    <button data-action="update" data-id="${l.id}" data-jan="${escapeHtml(l.jan)}" class="primary">更新</button>
    <button data-action="edit-cancel" data-id="${l.id}">キャンセル</button>`;
  // Field rows share a fixed-width left label + flex-grow input. min-width:0 on
  // every flex item is the canonical fix for inputs (especially <input type="file">)
  // pushing their parent wider than its container.
  const fieldRow = (label, inputHtml, align = 'center') => `
    <div class="sell-edit-row" style="align-items:${align}">
      <span class="sell-edit-label">${label}</span>
      <div class="sell-edit-input">${inputHtml}</div>
    </div>`;
  return `
    <div class="list-item sell-row" data-id="${l.id}" style="align-items:flex-start">
      <div style="flex:1; min-width:0; max-width:100%">
        <div class="bold">${escapeHtml(effectiveName)} ${tags}</div>
        ${priceLine}
        ${priceField}
        ${fieldRow('在庫',     `<input type="number" min="0" value="${l.qty}" data-qty="${l.id}">`)}
        ${fieldRow('出品名',   `<input type="text" maxlength="200" value="${escapeHtml(l.display_name ?? '')}" data-dname="${l.id}" placeholder="空欄なら「${escapeHtml(productName)}」">`)}
        ${fieldRow('商品名',   `<input type="text" maxlength="200" value="${escapeHtml(productName)}" data-pname="${l.id}">`)}
        ${fieldRow('置き場所', `<input type="text" maxlength="100" value="${escapeHtml(l.location ?? '')}" data-loc="${l.id}" placeholder="例: 10階冷蔵庫">`)}
        ${fieldRow('メッセージ',
          `<textarea data-cmsg="${l.id}" maxlength="2000" rows="2" placeholder="購入時のメッセージ (任意)">${escapeHtml(l.completion_message ?? '')}</textarea>`,
          'flex-start')}

        <!-- Image block lives in its own outlined section so the wide <input
             type="file"> rendering on iOS doesn't push the text rows off
             alignment / out of the card. -->
        <div style="margin-top:10px; padding:8px 10px; border:1px dashed var(--line); border-radius:8px">
          <div class="muted" style="font-size:12px; margin-bottom:6px">画像</div>
          <div style="display:flex; align-items:center; gap:8px; min-width:0">
            ${l.image_url
              ? `<img src="${escapeHtml(l.image_url)}" style="width:48px; height:48px; object-fit:cover; border-radius:6px; flex:0 0 auto">`
              : `<div style="width:48px; height:48px; border-radius:6px; background:#f1f1f4; display:flex; align-items:center; justify-content:center; flex:0 0 auto; color:var(--muted); font-size:11px">未設定</div>`}
            <input type="file" accept="image/*" data-img-file="${l.id}" data-jan="${escapeHtml(l.jan)}" style="flex:1; min-width:0">
          </div>
        </div>

        <div class="row" style="margin-top:8px; gap:6px; flex-wrap:wrap">
          ${actionRow}
        </div>
      </div>
    </div>`;
}

async function onAction(btn) {
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  try {
    // Flip the row between summary/edit modes without hitting the API.
    if (action === 'edit-start')  { editingIds.add(Number(id));    await loadMyListings(); return; }
    if (action === 'edit-cancel') { editingIds.delete(Number(id)); await loadMyListings(); return; }

    if (action === 'update') {
      // Bundle every editable field into one PATCH on the listing. If the
      // product name (catalog-side, keyed by JAN) was also touched, send a
      // separate PATCH for that — there's no combined endpoint.
      const jan = btn.dataset.jan;
      const qtyEl   = document.querySelector(`[data-qty="${id}"]`);
      const priceEl = document.querySelector(`[data-price="${id}"]`);
      const dnameEl = document.querySelector(`[data-dname="${id}"]`);
      const pnameEl = document.querySelector(`[data-pname="${id}"]`);
      const locEl   = document.querySelector(`[data-loc="${id}"]`);
      const cmsgEl  = document.querySelector(`[data-cmsg="${id}"]`);

      const qty = Number(qtyEl.value);
      if (!(qty >= 0)) return toast('在庫は0以上');
      const listingPatch = {
        qty,
        display_name:       dnameEl.value.trim() || null,
        location:           locEl.value.trim()   || null,
        completion_message: cmsgEl.value.trim()  || null,
      };
      // Gift listings hide the price input; only attach price when it's there.
      if (priceEl) {
        const v = Number(priceEl.value);
        if (!(v > 0)) return toast('価格は1以上');
        listingPatch.price = v;
      }
      const pname = pnameEl.value.trim();
      if (!pname) return toast('商品名は必須');

      await patch('/api/listings/' + id, listingPatch);
      // Only touch the product if the catalog name actually changed (saves a
      // round-trip when the user just tweaked price or stock).
      const prevPname = pnameEl.defaultValue;
      if (pname !== prevPname) {
        await patch('/api/products/' + encodeURIComponent(jan), { name: pname });
      }
      // Collapse back to the summary view now that the save succeeded.
      editingIds.delete(Number(id));
      toast('更新しました');
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
