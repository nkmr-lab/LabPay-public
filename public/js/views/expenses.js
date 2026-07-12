// v1002 個人家計簿 /#/expenses (中村さん要望「個人の家計簿機能。 領収書を写真で手軽に読み込める」)。
//   ・月別 一覧 + カテゴリ別 合計 + 新規追加 (手動 or 領収書撮影 → OCR)
//   ・全て 個人 スコープ (他人 に は 見えない)。 認証 済 の 本人 のみ CRUD 可
//   ・レシート 撮影 は <input type="file" accept="image/*" capture="environment"> で
//     モバイル は 直接 カメラ 起動、 PC は ファイル 選択。 送信前 に プレビュー + OCR 結果 で 確認。

import { escapeHtml, navigate } from '../router.js';
import { get, post, patch, del } from '../api.js';

const CATEGORY_EMOJI = {
  '食費': '🍴', '交通費': '🚃', '交際費': '🍻', '光熱費': '💡', '家賃': '🏠',
  '趣味': '🎮', '医療': '💊', '教育': '📚', '日用品': '🛒', '衣服': '👔',
  '通信': '📱', 'その他': '💰',
};

let currentYm = null;   // {year, month}
let dataCache = null;

function ymFromDate(d = new Date()) {
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export async function renderExpenses() {
  const app = document.getElementById('app');
  if (!currentYm) currentYm = ymFromDate();
  app.innerHTML = `<div class="card">💰 家計簿を読み込み中…</div>`;
  await refresh();
}

async function refresh() {
  const app = document.getElementById('app');
  try {
    const d = await get('/api/expenses', currentYm);
    dataCache = d;
    render(d);
  } catch (e) {
    app.innerHTML = `<div class="card">⚠ 読み込み失敗: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function render(d) {
  const app = document.getElementById('app');
  const items = d.items || [];
  const total = d.total || 0;
  const byCat = d.by_category || {};
  const maxCatAmount = Math.max(...Object.values(byCat), 1);

  const catBars = Object.entries(byCat).map(([cat, amt]) => {
    const pct = Math.round((amt / maxCatAmount) * 100);
    const emo = CATEGORY_EMOJI[cat] || '💰';
    return `
      <div style="display:grid; grid-template-columns: 24px minmax(0,1fr) 90px; gap:6px 8px; align-items:center; font-size:12.5px">
        <span>${emo}</span>
        <div>
          <div style="font-weight:600">${escapeHtml(cat)}</div>
          <div style="height:4px; background:#f3f4f6; border-radius:2px; margin-top:2px">
            <div style="height:100%; width:${pct}%; background:#4a106d; border-radius:2px"></div>
          </div>
        </div>
        <div style="text-align:right; font-variant-numeric:tabular-nums">¥${amt.toLocaleString()}</div>
      </div>`;
  }).join('');

  app.innerHTML = `
    <div class="card">
      <div class="row center" style="gap:6px">
        <h2 style="margin:0">💰 家計簿</h2>
        <span style="flex:1"></span>
        <button data-exp-prev class="btn" style="font-size:12px; padding:3px 10px">‹ 前月</button>
        <button data-exp-this class="btn" style="font-size:12px; padding:3px 10px">今月</button>
        <button data-exp-next class="btn" style="font-size:12px; padding:3px 10px">翌月 ›</button>
      </div>
      <div class="hint-sm" style="margin-top:6px">
        ${escapeHtml(d.range_label)} の 支出。 個人 スコープ (他人 に は 見えません)。
        「📷 領収書 を 撮影」 で OpenAI Vision に よる 自動 抽出 が 使えます。
      </div>
      <div style="margin-top:10px; padding:10px 12px; background:#f9fafb; border-radius:6px; display:flex; align-items:baseline; gap:8px">
        <span style="font-size:12px; color:#6b7280">合計</span>
        <span style="font-size:22px; font-weight:700; color:#4a106d">¥${total.toLocaleString()}</span>
        <span style="flex:1"></span>
        <span style="font-size:11px; color:#6b7280">${items.length} 件</span>
      </div>
      <div style="margin-top:10px; display:flex; gap:6px">
        <button data-exp-add-manual class="btn primary" style="font-size:12px; padding:5px 14px">＋ 手動追加</button>
        <button data-exp-add-ocr    class="btn primary" style="font-size:12px; padding:5px 14px">📷 領収書を撮影</button>
      </div>
    </div>

    ${Object.keys(byCat).length ? `
    <div class="card">
      <h3 style="margin:0 0 8px; font-size:14px">📊 カテゴリ別</h3>
      <div style="display:flex; flex-direction:column; gap:6px">${catBars}</div>
    </div>` : ''}

    <div class="card">
      <h3 style="margin:0 0 8px; font-size:14px">📝 一覧 (${items.length} 件)</h3>
      ${items.length ? `
        <div style="display:flex; flex-direction:column; gap:4px">
          ${items.map(renderItemRow).join('')}
        </div>` : `
        <div class="hint-sm">まだ 何 も 記録 が あり ませ ん。 上 の 「＋ 手動追加」 or 「📷 領収書 を 撮影」 から どうぞ。</div>`}
    </div>
  `;
  attach();
}

function renderItemRow(it) {
  const cat = it.category || 'その他';
  const emo = CATEGORY_EMOJI[cat] || '💰';
  const hasImg = !!it.image_path;
  return `
    <div data-exp-id="${it.id}" style="display:grid; grid-template-columns: 30px minmax(0,1fr) 100px 22px; gap:6px 8px; align-items:center; padding:6px 4px; border-bottom:1px solid #f3f4f6; font-size:13px">
      <span style="font-size:16px">${emo}</span>
      <div style="min-width:0">
        <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">
          ${escapeHtml(it.merchant || cat)}
          ${hasImg ? '<span style="font-size:10px; color:#7b3fa0; margin-left:4px">📷</span>' : ''}
        </div>
        <div class="hint-sm" style="font-size:11px">${escapeHtml(it.spent_at)}${it.memo ? ' · ' + escapeHtml(it.memo) : ''}</div>
      </div>
      <div style="text-align:right; font-variant-numeric:tabular-nums; font-weight:600">¥${(+it.amount).toLocaleString()}</div>
      <button data-exp-del="${it.id}" title="削除" style="background:none; border:none; color:#b91c1c; cursor:pointer; padding:0; font-size:14px">🗑</button>
    </div>`;
}

function attach() {
  const app = document.getElementById('app');
  app.querySelector('[data-exp-prev]')?.addEventListener('click', () => shiftMonth(-1));
  app.querySelector('[data-exp-next]')?.addEventListener('click', () => shiftMonth(+1));
  app.querySelector('[data-exp-this]')?.addEventListener('click', () => { currentYm = ymFromDate(); refresh(); });
  app.querySelector('[data-exp-add-manual]')?.addEventListener('click', () => openAddDialog(null));
  app.querySelector('[data-exp-add-ocr]')?.addEventListener('click', () => openCamera());
  app.querySelectorAll('[data-exp-del]').forEach(b => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm('この記録を削除しますか？')) return;
      try { await del('/api/expenses/' + b.dataset.expDel); refresh(); }
      catch (e) { alert('削除失敗: ' + e.message); }
    });
  });
}

function shiftMonth(delta) {
  let { year, month } = currentYm;
  month += delta;
  if (month < 1)  { year--; month = 12; }
  if (month > 12) { year++; month = 1;  }
  currentYm = { year, month };
  refresh();
}

// カメラ or ファイル 選択 で 画像 を 取得 → OCR → 追加ダイアログ
function openCamera() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';   // モバイル は 背面カメラ
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { alert('画像が大きすぎます (12MB まで)'); return; }
    const dataUrl = await fileToDataUrl(f);
    // 縮小 (長辺 1600px 上限) して 送信サイズ を 抑える
    const smaller = await resizeImage(dataUrl, 1600);
    const app = document.getElementById('app');
    const bar = document.createElement('div');
    bar.className = 'card';
    bar.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:9999; background:#fef3c7; border-left:4px solid #ea580c';
    bar.innerHTML = '⏳ 領収書を解析中… (5-15 秒)';
    document.body.appendChild(bar);
    try {
      const r = await post('/api/expenses/ocr', { image_data: smaller });
      bar.remove();
      openAddDialog({
        image_data: smaller,
        spent_at:   r.spent_at,
        amount:     r.amount,
        category:   r.category_guess,
        merchant:   r.merchant,
        line_items: r.line_items,
      });
    } catch (e) {
      bar.remove();
      alert('OCR 失敗: ' + (e.message || String(e)));
    }
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}

function fileToDataUrl(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(String(r.result));
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(f);
  });
}

async function resizeImage(dataUrl, maxSide) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      res(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

function openAddDialog(prefill) {
  const cats = dataCache?.categories || [];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:20px';
  const preview = prefill?.image_data
    ? `<img src="${prefill.image_data}" style="max-width:100%; max-height:200px; border-radius:6px; margin-bottom:8px">`
    : '';
  const lineItems = Array.isArray(prefill?.line_items) && prefill.line_items.length
    ? `<div class="hint-sm" style="margin-top:6px">明細: ${prefill.line_items.map(li => `${escapeHtml(li.name || '')}${li.price ? ' ¥' + Number(li.price).toLocaleString() : ''}`).join(' / ')}</div>`
    : '';
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:10px; max-width:420px; width:100%; max-height:90vh; overflow:auto; padding:16px">
      <h3 style="margin:0 0 8px">${prefill?.image_data ? '📷 領収書から追加' : '➕ 手動追加'}</h3>
      ${preview}
      ${lineItems}
      <div style="display:grid; gap:8px; margin-top:8px">
        <label style="display:flex; gap:6px; align-items:center; font-size:12px">
          <span style="width:70px; color:#6b7280">日付</span>
          <input id="exp-spent-at" type="date" value="${prefill?.spent_at || today}" style="flex:1; padding:5px">
        </label>
        <label style="display:flex; gap:6px; align-items:center; font-size:12px">
          <span style="width:70px; color:#6b7280">金額</span>
          <input id="exp-amount" type="number" min="1" step="1" value="${prefill?.amount || ''}" placeholder="0" style="flex:1; padding:5px">
          <span style="color:#6b7280">円</span>
        </label>
        <label style="display:flex; gap:6px; align-items:center; font-size:12px">
          <span style="width:70px; color:#6b7280">カテゴリ</span>
          <select id="exp-category" style="flex:1; padding:5px">
            <option value="">(未分類)</option>
            ${cats.map(c => `<option value="${escapeHtml(c)}"${c === (prefill?.category || '') ? ' selected' : ''}>${CATEGORY_EMOJI[c] || ''} ${escapeHtml(c)}</option>`).join('')}
          </select>
        </label>
        <label style="display:flex; gap:6px; align-items:center; font-size:12px">
          <span style="width:70px; color:#6b7280">店名</span>
          <input id="exp-merchant" type="text" value="${escapeHtml(prefill?.merchant || '')}" placeholder="店名 (省略可)" style="flex:1; padding:5px" maxlength="120">
        </label>
        <label style="display:flex; gap:6px; align-items:start; font-size:12px">
          <span style="width:70px; color:#6b7280; padding-top:5px">メモ</span>
          <textarea id="exp-memo" rows="2" placeholder="メモ (省略可)" style="flex:1; padding:5px; resize:vertical" maxlength="500"></textarea>
        </label>
      </div>
      <div style="display:flex; gap:6px; margin-top:14px">
        <button id="exp-save" class="btn primary" style="padding:6px 16px">保存</button>
        <button id="exp-cancel" class="btn" style="padding:6px 16px">キャンセル</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#exp-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#exp-save').addEventListener('click', async () => {
    const body = {
      spent_at: overlay.querySelector('#exp-spent-at').value,
      amount:   Number(overlay.querySelector('#exp-amount').value),
      category: overlay.querySelector('#exp-category').value,
      merchant: overlay.querySelector('#exp-merchant').value,
      memo:     overlay.querySelector('#exp-memo').value,
    };
    if (prefill?.image_data) body.image_data = prefill.image_data;
    if (Array.isArray(prefill?.line_items) && prefill.line_items.length) {
      body.ocr_json = { line_items: prefill.line_items };
    }
    if (!body.spent_at) { alert('日付を入力してください'); return; }
    if (!(body.amount > 0)) { alert('金額は 1 円以上'); return; }
    try {
      await post('/api/expenses', body);
      overlay.remove();
      refresh();
    } catch (e) {
      alert('保存失敗: ' + (e.message || String(e)));
    }
  });
}
