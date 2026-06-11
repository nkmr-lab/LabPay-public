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

// v536 #192 都道府県を地理位置っぽい配置で並べた 「日本地図風」 表示。
//   visited は塗り、 未訪は薄色。 タップでトグル。
function renderJpMap() {
  // 14 cols × 16 rows
  const COLS = 14;
  const ROWS = 16;
  const prefMap = Object.fromEntries(PREFECTURES.map(p => [p.code, p]));
  // 名前→short label (2 文字目までで認識しやすく)
  const shortLabel = (name) => name.replace(/[都道府県]$/, '');
  const cells = JP_MAP_LAYOUT.map(([col, row, code]) => {
    const p = prefMap[code];
    if (!p) return '';
    const visited = visitedSet.has(`prefecture:${code}`);
    const bg = visited ? 'var(--primary, #4a106d)' : '#fafafa';
    const fg = visited ? '#fff' : '#888';
    const border = visited ? 'var(--primary, #4a106d)' : '#ddd';
    return `<button class="rg-map-cell" data-code="${code}" title="${escapeHtml(p.name)}"
              style="grid-column:${col + 1}; grid-row:${row + 1}; padding:0; border:1.5px solid ${border}; background:${bg}; color:${fg}; border-radius:4px; font-size:9px; font-weight:${visited ? '700' : '500'}; cursor:pointer; overflow:hidden; line-height:1; text-align:center; min-height:0; transition:transform 0.1s">${escapeHtml(shortLabel(p.name))}</button>`;
  }).join('');
  return `
    <div style="margin-top:14px; padding:10px; background:linear-gradient(180deg, #e0f2fe, #f0f9ff); border-radius:10px">
      <div class="hint-sm" style="font-size:11px; text-align:center; margin-bottom:6px; color:#1d4ed8">🗾 日本地図 (スタイライズ — タップで トグル)</div>
      <div style="display:grid; grid-template-columns:repeat(${COLS}, minmax(0, 1fr)); grid-template-rows:repeat(${ROWS}, 26px); gap:2px; max-width:420px; margin:0 auto">
        ${cells}
      </div>
    </div>`;
}
