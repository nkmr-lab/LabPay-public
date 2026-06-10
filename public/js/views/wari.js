// /#/wari — 'ワリカ' multi-currency split calculator.
// Pure UI / pure math — no DB, no notifications. Enter total + currency,
// number of payers (optional unequal weights), get per-head amount in both
// the source currency and JPY. Exchange rates are stored in localStorage and
// editable inline — real-time FX isn't worth the complexity for a calculator
// that settles in <10 seconds.

import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

const DEFAULT_RATES = { JPY: 1, USD: 158, EUR: 168, GBP: 198, CNY: 22, KRW: 0.11, TWD: 4.9, AUD: 103 };

export async function renderWari() {
  const app = document.getElementById('app');
  const rates = loadRates();
  app.innerHTML = `
    <div class="card">
      <a href="#/apps" class="hint">← アプリ</a>
      <h2 style="margin:6px 0 0">ワリカ</h2>
    </div>

    <div class="card">
      <label class="field">
        <span class="lbl">総額</span>
        <div class="row">
          <input type="number" id="wari-amount" min="0" step="0.01" style="flex:2" placeholder="例: 24.50">
          <select id="wari-currency" class="grow">
            ${Object.keys(rates).map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
      </label>
      <label class="field">
        <span class="lbl">人数</span>
        <input type="number" id="wari-count" min="1" value="4">
      </label>
      <label class="field">
        <span class="lbl">レート (1 通貨 = ? JPY)</span>
        <input type="number" id="wari-rate" min="0" step="0.01" style="max-width:160px">
      </label>
      <button id="wari-calc" class="primary">計算する</button>
    </div>

    <div class="card" id="wari-result" hidden></div>
  `;

  const ccyEl  = document.getElementById('wari-currency');
  const rateEl = document.getElementById('wari-rate');
  const syncRate = () => { rateEl.value = rates[ccyEl.value] ?? 1; };
  ccyEl.addEventListener('change', syncRate);
  rateEl.addEventListener('change', () => {
    rates[ccyEl.value] = Number(rateEl.value) || 1;
    saveRates(rates);
  });
  syncRate();
  document.getElementById('wari-calc').addEventListener('click', () => onCalc(rates));
}

function onCalc(rates) {
  const amt = Number(document.getElementById('wari-amount').value);
  const ccy = document.getElementById('wari-currency').value;
  const n   = Math.max(1, Number(document.getElementById('wari-count').value));
  const rate = Number(rates[ccy] || 1);
  if (!(amt > 0)) { toast('総額を入力してください'); return; }
  const perCcy = amt / n;
  const totalJpy = Math.round(amt * rate);
  const perJpy   = Math.round(perCcy * rate);
  const root = document.getElementById('wari-result');
  root.hidden = false;
  root.innerHTML = `
    <h3 style="margin:0 0 6px">結果</h3>
    <div class="meta">${escapeHtml(amt.toLocaleString())} ${escapeHtml(ccy)} × 1 = ${escapeHtml(rate.toLocaleString())} JPY</div>
    <div style="font-size:18px; margin-top:6px">
      総額 <span class="bold">${totalJpy.toLocaleString()}</span> JPY
    </div>
    <div style="font-size:24px; margin-top:6px">
      1人あたり <span class=" bold text-primary">${perJpy.toLocaleString()}</span> JPY
      <span class="muted" style="font-size:14px">(${perCcy.toFixed(2)} ${escapeHtml(ccy)})</span>
    </div>
  `;
}

function loadRates() {
  try {
    const v = JSON.parse(localStorage.getItem('labpay-wari-rates') || 'null');
    if (v && typeof v === 'object') return { ...DEFAULT_RATES, ...v };
  } catch (_) {}
  return { ...DEFAULT_RATES };
}
function saveRates(r) {
  try { localStorage.setItem('labpay-wari-rates', JSON.stringify(r)); } catch (_) {}
}
