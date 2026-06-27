// /#/regions — 行った国 / 都道府県 を 登録 + 可視化 (制覇マップ)。
// v531 #163。 2 タブ (🇯🇵 都道府県 / 🌏 国) で それぞれグリッド表示、
//   タップで トグル、 進捗バー + 件数表示。 他メンバーの集計 (ラボ全体) も
//   各セルに 「N 人訪問」 と 控えめに 表示。

import { get, post, del } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';
import { PREFECTURES, COUNTRIES, JP_MAP_LAYOUT } from '../data/regions_data.js';

let visitedSet = null;  // 'kind:code' Set
let labStats   = { country: {}, prefecture: {} };
let activeTab  = 'prefecture';
// v859 #442 第二段: geolonia/japanese-prefectures (MIT) の 47 都道府県 polygon SVG を
//   /img/jp-prefectures.svg に 配置、 ここ で 1 回 fetch + parse して キャッシュ。
//   paint() の renderJpMap で cloneNode して 色 を 塗り替える。
let cachedJpSvgEl = null;

async function ensureJpSvg() {
  if (cachedJpSvgEl) return;
  try {
    const r = await fetch('/img/jp-prefectures.svg', { cache: 'force-cache' });
    if (!r.ok) throw new Error('地図 SVG fetch 失敗 (' + r.status + ')');
    const txt = await r.text();
    const wrap = document.createElement('div');
    wrap.innerHTML = txt;
    cachedJpSvgEl = wrap.querySelector('svg');
  } catch (_) { cachedJpSvgEl = null; }
}

export async function renderRegions() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">🗺 制覇マップ</h2>
        <span style="flex:1"></span>
      </div>
    </div>
    <div class="card" style="padding:6px 10px">
      <div class="row" style="gap:6px">
        <button id="rg-tab-pref" class="btn primary" style="flex:1; padding:6px 10px; font-size:13px">🇯🇵 都道府県</button>
        <button id="rg-tab-cnt"  class="btn"         style="flex:1; padding:6px 10px; font-size:13px">🌏 国</button>
      </div>
    </div>
    <div class="card">
      <div id="rg-progress" class="muted" style="font-size:13px; margin-bottom:8px"></div>
      <div id="rg-grid"></div>
    </div>
  `;
  document.getElementById('rg-tab-pref').addEventListener('click', () => switchTab('prefecture'));
  document.getElementById('rg-tab-cnt' ).addEventListener('click', () => switchTab('country'));

  try {
    const [v, s] = await Promise.all([
      get('/api/regions/visited'),
      get('/api/regions/stats'),
      ensureJpSvg(),
    ]);
    visitedSet = new Set((v.items || []).map(it => `${it.kind}:${it.code}`));
    labStats   = s || { country: {}, prefecture: {} };
  } catch (e) {
    document.getElementById('rg-grid').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }
  paint();
}

function switchTab(tab) {
  activeTab = tab;
  document.getElementById('rg-tab-pref').classList.toggle('primary', tab === 'prefecture');
  document.getElementById('rg-tab-cnt' ).classList.toggle('primary', tab === 'country');
  paint();
}

function paint() {
  if (!visitedSet) return;
  const items = activeTab === 'prefecture' ? PREFECTURES : COUNTRIES;
  const total = items.length;
  let visitedN = 0;
  for (const it of items) {
    if (visitedSet.has(`${activeTab}:${it.code}`)) visitedN++;
  }
  const pct = total ? Math.round(visitedN * 100 / total) : 0;
  // v536 #192 都道府県タブ では 進捗バー の下に スタイライズ Japan マップ を表示。
  //   行った場所は塗りつぶし、 未訪は薄色。 タップでトグル。
  const mapBlock = activeTab === 'prefecture' ? renderJpMap() : '';
  document.getElementById('rg-progress').innerHTML = `
    <div class="bold" style="font-size:16px; color:var(--primary)">${visitedN} / ${total} 制覇 (${pct}%)</div>
    <div style="height:8px; background:#ede4f3; border-radius:99px; overflow:hidden; margin-top:6px">
      <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--primary), #b3a0e0)"></div>
    </div>
    ${mapBlock}`;

  // セルを 地方 (region) ごとに セクション分けして 表示
  const byRegion = {};
  for (const it of items) {
    if (!byRegion[it.region]) byRegion[it.region] = [];
    byRegion[it.region].push(it);
  }
  const html = Object.entries(byRegion).map(([region, list]) => {
    const cells = list.map(it => {
      const key = `${activeTab}:${it.code}`;
      const visited = visitedSet.has(key);
      const labN = labStats[activeTab]?.[it.code] || 0;
      const labLine = labN > 0 ? `<div class="hint" style="font-size:10px; margin-top:1px">${labN}人 訪問</div>` : '';
      const flag = it.flag ? `${it.flag} ` : '';
      return `
        <div class="rg-cell" data-code="${it.code}"
             style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:8px 4px; border:2px solid ${visited ? 'var(--primary)' : 'var(--line)'}; border-radius:8px; background:${visited ? 'var(--primary-soft, #ede4f3)' : '#fff'}; cursor:pointer; transition:all 0.2s; text-align:center">
          <div style="font-size:13px; font-weight:${visited ? '700' : '400'}; color:${visited ? 'var(--primary)' : 'inherit'}">${flag}${escapeHtml(it.name)}</div>
          <div style="font-size:18px; margin-top:2px">${visited ? '✓' : ''}</div>
          ${labLine}
        </div>`;
    }).join('');
    return `
      <div style="margin-top:14px">
        <div class="bold" style="font-size:13px; color:var(--muted); margin-bottom:6px">${escapeHtml(region)}</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(100px, 1fr)); gap:6px">
          ${cells}
        </div>
      </div>`;
  }).join('');
  document.getElementById('rg-grid').innerHTML = html;

  document.querySelectorAll('.rg-cell, .rg-map-cell').forEach(el => {
    el.addEventListener('click', async () => {
      const code = el.dataset.code;
      const key = `${activeTab}:${code}`;
      const wasVisited = visitedSet.has(key);
      try {
        if (wasVisited) {
          await del(`/api/regions/visit?kind=${activeTab}&code=${encodeURIComponent(code)}`);
          visitedSet.delete(key);
          if (labStats[activeTab][code]) labStats[activeTab][code] = Math.max(0, labStats[activeTab][code] - 1);
        } else {
          await post('/api/regions/visit', { kind: activeTab, code });
          visitedSet.add(key);
          labStats[activeTab][code] = (labStats[activeTab][code] || 0) + 1;
        }
        paint();
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
}

// v859 #442 第二段: geolonia/japanese-prefectures (MIT) の 実 polygon SVG を
//   使って 「本物 の 日本地図」 を 描画。 各 prefecture g に visited 色 を 塗り、
//   既存 の .rg-map-cell click handler に 乗せて トグル。 SVG は ensureJpSvg で
//   1 回 fetch 済み、 ここ では cloneNode して 状態 反映 だけ。
function renderJpMap() {
  if (cachedJpSvgEl) return renderJpMapSvg();
  return renderJpMapFallback();
}

function renderJpMapSvg() {
  const svg = cachedJpSvgEl.cloneNode(true);
  svg.removeAttribute('class');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('style', 'display:block; width:100%; max-width:560px; margin:0 auto');
  // 各 都道府県 g に 色 + class + dataset.code を 仕込む。
  // geolonia は data-code="1" 〜 "47" (ゼロパディング なし)、 LabPay は 'JP-01' 〜 'JP-47'。
  svg.querySelectorAll('g.prefecture').forEach(g => {
    const num = g.getAttribute('data-code');
    if (!num) return;
    const code = 'JP-' + String(num).padStart(2, '0');
    const visited = visitedSet.has(`prefecture:${code}`);
    g.setAttribute('fill', visited ? '#4a106d' : '#ffffff');
    g.setAttribute('stroke', visited ? '#2a063e' : '#a0a0a0');
    g.setAttribute('stroke-width', visited ? '1.2' : '0.8');
    g.style.cursor = 'pointer';
    g.classList.add('rg-map-cell');
    g.setAttribute('data-code', code);
  });
  return `
    <div style="margin-top:14px; padding:10px; background:linear-gradient(180deg, #bee5fb 0%, #e8f4fd 100%); border-radius:10px">
      <div class="hint-sm" style="font-size:11px; text-align:center; margin-bottom:6px; color:#1d4ed8">🗾 日本地図 (タップで トグル) — 地図 © <a href="https://github.com/geolonia/japanese-prefectures" target="_blank" rel="noopener" style="color:inherit; text-decoration:underline">Geolonia</a> (MIT)</div>
      ${svg.outerHTML}
    </div>`;
}

// fetch 失敗 時 の 退避 (旧 14×16 ダミー 配置 を 簡素 SVG で 描画)。
//   通常 は 発火 しない。 オフライン 初回 で SVG キャッシュ が 無い 等。
function renderJpMapFallback() {
  const SVG_W = 400, SVG_H = 540;
  const CELL_GAP = 26;
  const OFFSET_X = 18, OFFSET_Y = 18;
  const prefMap = Object.fromEntries(PREFECTURES.map(p => [p.code, p]));
  const shortLabel = (name) => name.replace(/[都道府県]$/, '').slice(0, 2);

  // 日本列島 を ざっくり 4 つ の 多角形 + 沖縄 楕円 で 近似。 正確 な 地図 では ない が、
  // 「海 と 島 の 形 が ある」 ことで 「ベクター な 地図」 として 機能 する。
  // 後 で 真 の GeoJSON 由来 polygon に 差し替え 予定 (別 バッチ)。
  const islandLayer = `
    <path d="M 250 30 Q 295 22, 340 38 Q 372 58, 372 95 Q 352 132, 305 142 Q 252 132, 232 102 Q 232 60, 250 30 Z"
          fill="#fcd6c0" stroke="#d99875" stroke-width="1.2"/>
    <path d="M 70 230 Q 105 198, 165 200 Q 232 222, 272 248 Q 322 254, 360 282 Q 380 320, 348 350 Q 290 362, 232 352 Q 168 342, 110 312 Q 58 282, 70 230 Z"
          fill="#fcd6c0" stroke="#d99875" stroke-width="1.2"/>
    <path d="M 170 380 Q 200 372, 240 376 Q 258 390, 248 408 Q 220 414, 190 405 Q 172 396, 170 380 Z"
          fill="#fcd6c0" stroke="#d99875" stroke-width="1.2"/>
    <path d="M 60 372 Q 100 366, 132 380 Q 152 412, 130 452 Q 100 472, 70 460 Q 40 432, 50 402 Q 55 380, 60 372 Z"
          fill="#fcd6c0" stroke="#d99875" stroke-width="1.2"/>
    <ellipse cx="40" cy="492" rx="24" ry="8" fill="#fcd6c0" stroke="#d99875" stroke-width="1.2"/>`;

  const dots = JP_MAP_LAYOUT.map(([col, row, code]) => {
    const p = prefMap[code]; if (!p) return '';
    const visited = visitedSet.has(`prefecture:${code}`);
    const cx = col * CELL_GAP + OFFSET_X;
    const cy = row * CELL_GAP + OFFSET_Y;
    const fill = visited ? '#4a106d' : 'rgba(255,255,255,0.92)';
    const stroke = visited ? '#4a106d' : '#a07090';
    const labelColor = visited ? '#fff' : '#5a3068';
    return `
      <g class="rg-map-cell" data-code="${code}" style="cursor:pointer">
        <title>${escapeHtml(p.name)}</title>
        <circle cx="${cx}" cy="${cy}" r="11.5" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>
        <text x="${cx}" y="${cy + 3.3}" text-anchor="middle" font-size="9" font-weight="${visited ? '700' : '500'}" fill="${labelColor}" pointer-events="none">${escapeHtml(shortLabel(p.name))}</text>
      </g>`;
  }).join('');

  return `
    <div style="margin-top:14px; padding:8px; background:linear-gradient(180deg, #bee5fb 0%, #e8f4fd 100%); border-radius:10px">
      <div class="hint-sm" style="font-size:11px; text-align:center; margin-bottom:6px; color:#1d4ed8">🗾 日本地図 (SVG ベクター — タップで トグル)</div>
      <svg viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="xMidYMid meet" style="display:block; width:100%; max-width:520px; margin:0 auto">
        ${islandLayer}
        ${dots}
      </svg>
    </div>`;
}
