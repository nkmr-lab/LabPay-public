// /#/health — 体重 + BMI 記録 (レコーディングダイエット)。
// v532 #161 実装。 個人ツール (他人には見えない)。

import { get, post, del } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

// v747 #358 ローカル時刻 (= ブラウザ の タイムゾーン) で 今日 を 計算 する ヘルパ。
//   toISOString() は UTC ベース なので JST の 朝 (UTC 前日) に ズレ が 出ていた。
function todayLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function renderHealth() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">⚖️ 体重 / BMI</h2>
        <span style="flex:1"></span>
        <select id="hl-days" style="font-size:12px">
          <option value="30">30日</option>
          <option value="90" selected>90日</option>
          <option value="180">半年</option>
          <option value="365">1年</option>
        </select>
      </div>
    </div>
    <div class="card" id="hl-summary"><div class="muted">読み込み中…</div></div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📝 記録</div>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <input type="number" id="hl-weight" step="0.1" min="20" max="300" placeholder="体重 (kg)" style="flex:1; min-width:90px; font-size:13px">
        <input type="number" id="hl-height" step="0.1" min="100" max="250" placeholder="身長 (cm)" style="flex:1; min-width:90px; font-size:13px">
        <input type="number" id="hl-bf"     step="0.1" min="1"   max="60"  placeholder="体脂肪 (%)" style="flex:1; min-width:90px; font-size:13px">
      </div>
      <div class="row" style="gap:6px; margin-top:6px; flex-wrap:wrap">
        <input type="text" id="hl-memo" maxlength="200" placeholder="メモ (任意)" style="flex:1; min-width:140px; font-size:13px">
        <button id="hl-save" class="primary" style="padding:4px 12px; font-size:13px">＋ 記録</button>
      </div>
      <div class="row" style="gap:6px; margin-top:6px; flex-wrap:wrap; align-items:center">
        <label class="hint-sm" style="font-size:11px">📅 日付</label>
        <input type="date" id="hl-date" style="font-size:13px; padding:2px 6px">
        <button id="hl-date-today" type="button" class="btn" style="font-size:11px; padding:2px 8px">今日</button>
      </div>
      <div class="hint-sm" style="margin-top:4px; font-size:11px">どれか 1 つ入っていれば記録できます。 体重は 0.1kg 単位。 日付 を 変えれば 過去 日 の 記録 も 追加 可能。 ※ 個人ツール、 他のメンバーには見えません。</div>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📈 推移</div>
      <div id="hl-chart" style="overflow-x:auto"></div>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📜 履歴</div>
      <div id="hl-list" class="list"></div>
    </div>
  `;
  document.getElementById('hl-days').addEventListener('change', refresh);
  document.getElementById('hl-save').addEventListener('click', save);
  // v690 #274 日付 入力 を 今日 に 初期化 + 「今日」 ボタン
  // v747 #358 toISOString は UTC ベース なので JST の 朝 (UTC 前日) は「今日」が 前日扱い に なる
  //   bug を 修正。 ローカル時刻で 計算 (= 単純 に YYYY-MM-DD を 組み立て)。
  const dateEl = document.getElementById('hl-date');
  const setToday = () => { dateEl.value = todayLocal(); };
  setToday();
  document.getElementById('hl-date-today').addEventListener('click', setToday);
  await refresh();
}

async function refresh() {
  const days = Number(document.getElementById('hl-days').value || 90);
  try {
    const [s, r] = await Promise.all([
      get('/api/health/summary'),
      get('/api/health/records', { days }),
    ]);
    paintSummary(s);
    paintList(r.items || []);
    paintChart(r.items || []);
  } catch (e) {
    document.getElementById('hl-summary').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function save() {
  const w = document.getElementById('hl-weight').value.trim();
  const h = document.getElementById('hl-height').value.trim();
  const b = document.getElementById('hl-bf').value.trim();
  const m = document.getElementById('hl-memo').value.trim();
  const dStr = document.getElementById('hl-date').value.trim();
  if (!w && !h && !b) { toast('1 つは入力してください'); return; }
  // v690 #274 日付 を 過去 日 で 指定 する 場合 は その日 の 23:59:59 で 送る
  //   (server で DateTime parse 通る)。 今日 の 場合 は recorded_at を 渡さず NOW() に 任せる。
  // v747 #358 todayStr は ローカル時刻 で 計算 (UTC ベース だと JST 朝 に 別日 と 比較 が ズレる)。
  const todayStr = todayLocal();
  const payload = {
    weight_kg: w || null,
    height_cm: h || null,
    body_fat_pct: b || null,
    memo: m || null,
  };
  if (dStr && dStr !== todayStr) {
    payload.recorded_at = dStr + ' 23:59:59';
  }
  try {
    await post('/api/health/record', payload);
    document.getElementById('hl-weight').value = '';
    document.getElementById('hl-bf').value = '';
    document.getElementById('hl-memo').value = '';
    document.getElementById('hl-date').value = todayStr;
    toast(dStr === todayStr ? '記録しました' : `${dStr} の 記録 として 保存 しました`);
    await refresh();
  } catch (e) { toast('失敗: ' + e.message); }
}

function paintSummary(s) {
  if (!s) return;
  const root = document.getElementById('hl-summary');
  if (!root) return;
  const items = [];
  if (s.height_cm) items.push(`身長: <span class="bold">${s.height_cm} cm</span>`);
  if (s.latest_weight) {
    let diff = '';
    if (s.prev_weight !== null && s.prev_weight !== undefined) {
      const d = (s.latest_weight - s.prev_weight).toFixed(1);
      const sign = d >= 0 ? '+' : '';
      const color = d > 0 ? '#c62828' : d < 0 ? '#15803d' : '#666';
      diff = ` <span style="color:${color}; font-size:13px">(${sign}${d}kg)</span>`;
    }
    items.push(`体重: <span class="bold">${s.latest_weight} kg</span>${diff}`);
  }
  if (s.bmi !== null && s.bmi !== undefined) {
    let bmiLabel = '';
    if (s.bmi < 18.5) bmiLabel = '<span class="tag" style="background:#dbeafe; color:#1d4ed8">やせ</span>';
    else if (s.bmi < 25) bmiLabel = '<span class="tag" style="background:#dcfce7; color:#15803d">標準</span>';
    else if (s.bmi < 30) bmiLabel = '<span class="tag" style="background:#fef3c7; color:#a16207">肥満1</span>';
    else bmiLabel = '<span class="tag" style="background:#fecaca; color:#b91c1c">肥満2+</span>';
    items.push(`BMI: <span class="bold">${s.bmi}</span> ${bmiLabel}`);
  }
  if (!items.length) {
    root.innerHTML = '<div class="muted">まだ記録がありません。 下の入力フォームから始めましょう。</div>';
    return;
  }
  root.innerHTML = `<div style="font-size:14px; line-height:1.6">${items.join(' · ')}</div>
    <div class="hint-sm" style="margin-top:4px; font-size:11px">記録総数: ${s.total_records} 件</div>`;
}

function paintList(items) {
  const root = document.getElementById('hl-list');
  if (!root) return;
  if (!items.length) { root.innerHTML = '<div class="empty">期間内の記録はありません</div>'; return; }
  // 新しい順に
  const sorted = [...items].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)).slice(0, 50);
  root.innerHTML = sorted.map(r => {
    const parts = [];
    if (r.weight_kg)    parts.push(`<span class="bold">${r.weight_kg}kg</span>`);
    if (r.body_fat_pct) parts.push(`体脂肪 ${r.body_fat_pct}%`);
    if (r.height_cm)    parts.push(`身長 ${r.height_cm}cm`);
    return `
      <div class="list-item" style="align-items:flex-start; gap:8px">
        <div class="grow">
          <div style="font-size:13px">${parts.join(' · ')}</div>
          ${r.memo ? `<div class="meta" style="font-size:12px">📝 ${escapeHtml(r.memo)}</div>` : ''}
          <div class="meta" style="font-size:11px">${escapeHtml(r.recorded_at)}</div>
        </div>
        <button class="btn danger" data-rm="${r.id}" style="font-size:11px; padding:2px 8px">×</button>
      </div>`;
  }).join('');
  root.querySelectorAll('[data-rm]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('この記録を削除しますか?')) return;
      try { await del('/api/health/record/' + b.dataset.rm); await refresh(); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  });
}

// 体重の折れ線グラフ。 SVG で 軽量に。 d3 を使わない。
function paintChart(items) {
  const root = document.getElementById('hl-chart');
  if (!root) return;
  const weighted = items.filter(r => r.weight_kg != null);
  if (weighted.length < 2) {
    root.innerHTML = '<div class="muted" style="font-size:12px; padding:6px">体重を 2 件以上記録すると 折れ線グラフが出ます</div>';
    return;
  }
  const w = Math.max(280, Math.min(720, weighted.length * 18 + 60));
  const h = 180;
  const pad = { l: 40, r: 10, t: 10, b: 24 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const ws = weighted.map(r => r.weight_kg);
  const minW = Math.floor(Math.min(...ws) - 1);
  const maxW = Math.ceil(Math.max(...ws) + 1);
  const range = Math.max(1, maxW - minW);
  const minT = new Date(weighted[0].recorded_at.replace(' ', 'T')).getTime();
  const maxT = new Date(weighted[weighted.length - 1].recorded_at.replace(' ', 'T')).getTime();
  const tRange = Math.max(1, maxT - minT);
  const x = (t) => pad.l + (t - minT) / tRange * innerW;
  const y = (kg) => pad.t + innerH - (kg - minW) / range * innerH;
  const pts = weighted.map(r => {
    const t = new Date(r.recorded_at.replace(' ', 'T')).getTime();
    return [x(t), y(r.weight_kg)];
  });
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  // Y 軸: min / max
  const yLabels = [minW, Math.round((minW + maxW) / 2), maxW];
  const yMarks = yLabels.map(v => `
    <line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eee"/>
    <text x="${pad.l - 4}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#888">${v}</text>`).join('');
  const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="#7b3fa0"/>`).join('');
  root.innerHTML = `
    <svg width="${w}" height="${h}" style="display:block">
      ${yMarks}
      <path d="${path}" stroke="#7b3fa0" stroke-width="2" fill="none"/>
      ${dots}
    </svg>`;
}
