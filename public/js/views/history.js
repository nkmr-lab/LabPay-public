// /#/history — 取引履歴 + ポイント残高時系列グラフ (v812 #404)。
import { get } from '../api.js';
import { escapeHtml } from '../router.js';
import { ledgerTypeLabel } from '../labels.js';

export async function renderHistory() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 4px">取引履歴</h2>
      <p class="muted" style="font-size:13px; margin:0">すべての出入り (購入・販売・ラボイン・手数料・取消) が並びます。</p>
    </div>
    <div id="hist-chart-card" class="card" hidden>
      <div class="row center" style="margin-bottom:4px">
        <h3 class="row-title" style="margin:0">📈 ポイント残高の推移</h3>
        <span id="hist-chart-range" class="hint-sm" style="margin-left:auto"></span>
      </div>
      <div id="hist-chart" style="margin-top:6px"></div>
    </div>
    <div id="list" class="list"><div class="muted">読み込み中…</div></div>
  `;

  try {
    // 残高 + 取引を並列取得。残高は /api/me の balance field。
    const [meResp, tx] = await Promise.all([
      get('/api/me'),
      get('/api/me/transactions', { limit: 200 }),
    ]);
    const root = document.getElementById('list');
    if (!tx.items.length) {
      root.innerHTML = `<div class="empty">取引はまだありません</div>`;
      return;
    }
    root.innerHTML = tx.items.map(row).join('');
    renderBalanceChart(tx.items, Number(meResp?.balance ?? 0));
  } catch (e) {
    document.getElementById('list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// items は新しい順 (created_at DESC)。「今の残高」から逆算して各取引後の残高
// 系列を作り、 SVG ラインチャートで描画。
function renderBalanceChart(items, currentBalance) {
  const card = document.getElementById('hist-chart-card');
  const root = document.getElementById('hist-chart');
  const rangeEl = document.getElementById('hist-chart-range');
  if (!card || !root || !items?.length) return;

  // 新しい順 → 古い順に並べ替えて、各取引後の残高を累積
  const asc = items.slice().reverse();
  const totalSigned = asc.reduce((s, t) => s + (Number(t.signed_amount) || 0), 0);
  // 古い方の起点残高 = 現残高 - これから起きる全取引の合計
  let bal = currentBalance - totalSigned;
  const series = [];
  // 起点ポイント (一番古い取引の直前) も入れる
  if (asc[0]?.created_at) {
    series.push({ t: parseTs(asc[0].created_at), v: bal });
  }
  for (const tx of asc) {
    bal += Number(tx.signed_amount) || 0;
    series.push({ t: parseTs(tx.created_at), v: bal });
  }
  if (series.length < 2) return;

  card.hidden = false;

  // 描画
  const W = Math.min(900, root.clientWidth || 720);
  const H = 200;
  const padL = 44, padR = 12, padT = 8, padB = 22;
  const xs = series.map(p => p.t);
  const ys = series.map(p => p.v);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = Math.max(1, xMax - xMin);
  const yPad = Math.max(1, yMax - yMin) * 0.1;
  // v1161 中村さん要望「座標の軸は 0 から」→ 下限は常に 0 (残高がマイナスになる稀なケース
  //   だけ下に伸ばす)。上端は今まで通り 10% パディング。
  const yLo = Math.min(0, yMin), yHi = yMax + yPad;
  const sx = t => padL + (t - xMin) / (xMax - xMin || 1) * (W - padL - padR);
  const sy = v => padT + (1 - (v - yLo) / (yHi - yLo || 1)) * (H - padT - padB);

  // line path
  const path = series.map((p, i) => (i === 0 ? 'M' : 'L') + sx(p.t).toFixed(1) + ',' + sy(p.v).toFixed(1)).join(' ');
  // area path (下を塗る)
  const area = path + ` L${sx(xMax).toFixed(1)},${(H - padB).toFixed(1)} L${sx(xMin).toFixed(1)},${(H - padB).toFixed(1)} Z`;

  // Y 軸目盛 (4 段、整数寄り)
  const yTicks = niceTicks(yLo, yHi, 4);
  const yLines = yTicks.map(v => {
    const y = sy(v);
    return `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${Math.round(v).toLocaleString()}</text>`;
  }).join('');
  // X 軸 (両端 + 中央の日付)
  const fmtX = (ms) => {
    const d = new Date(ms);
    const m = d.getMonth() + 1, dd = d.getDate();
    return `${m}/${dd}`;
  };
  const xMid = xMin + (xMax - xMin) / 2;
  const xLabels = [xMin, xMid, xMax].map(t => {
    const x = sx(t);
    return `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#6b7280">${fmtX(t)}</text>`;
  }).join('');

  // 現在値ドット
  const last = series[series.length - 1];
  const lastX = sx(last.t), lastY = sy(last.v);

  root.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block">
      ${yLines}
      <path d="${area}" fill="#4a106d" fill-opacity="0.10"/>
      <path d="${path}" stroke="#4a106d" stroke-width="2" fill="none" stroke-linejoin="round"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5" fill="#4a106d"/>
      <text x="${(lastX + 6).toFixed(1)}" y="${(lastY - 6).toFixed(1)}" font-size="11" font-weight="700" fill="#4a106d">${Math.round(last.v).toLocaleString()}pt</text>
      ${xLabels}
    </svg>`;
  const span = Math.max(1, Math.round((xMax - xMin) / 86400000));
  rangeEl.textContent = `${series.length} 件 / 直近 ${span} 日`;
}

// "YYYY-MM-DD HH:MM:SS" (JST, server local) → ms epoch。
function parseTs(s) {
  if (!s) return Date.now();
  return new Date(String(s).replace(' ', 'T') + '+09:00').getTime();
}

// Y 軸のキリの良い目盛を出す (1, 2, 5 × 10^n)。
function niceTicks(lo, hi, n) {
  const range = hi - lo;
  if (range <= 0) return [lo];
  const raw = range / n;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * pow;
  const out = [];
  const first = Math.ceil(lo / step) * step;
  for (let v = first; v <= hi; v += step) out.push(v);
  return out;
}

function row(t) {
  const sign = t.signed_amount > 0 ? '+' : '';
  const color = t.signed_amount > 0 ? 'var(--primary)' : 'var(--danger)';
  const lbl = ledgerTypeLabel(t.type);
  return `
    <div class="list-item">
      <div>
        <div class="bold">${escapeHtml(lbl)}${t.product_name ? ' · ' + escapeHtml(t.product_name) : ''}</div>
        <div class="meta">${escapeHtml(t.counterparty ?? '')} ${t.memo ? '· ' + escapeHtml(t.memo) : ''}</div>
        <div class="meta">${escapeHtml(t.created_at)}</div>
      </div>
      <div style="color:${color}; font-weight:800; white-space:nowrap">${sign}${t.signed_amount.toLocaleString()} pt</div>
    </div>`;
}
