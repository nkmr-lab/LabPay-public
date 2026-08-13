// v1299 🏆 Ranking (#/rankings) — 全メンバー横断 の 各種 top 10 を 1 ページ に カード 並び。
//   従来 は #/streak-ranking の 1 種類 だけ。 中村さん要望「オープナー回数、徹夜回数のランキング
//   も示したい。 Ranking機能を作ると良い」で ハブ化。
//   NOTE: .row の 子要素 は style.css:398 で flex:1 が 効いて いる ので、 側要素 は
//     flex:0 0 幅 shorthand で grow を pin する 必要 が ある (streak_ranking.js と 同じ 罠)。

import { get } from '../api.js';
import { escapeHtml } from '../router.js';

const CARDS = [
  { key: 'streak',      title: '🔥 最長連続ラボイン',  unit: '日', desc: '連続 で ラボ に 来た 最長 記録 日数' },
  { key: 'checkins',    title: '🏠 累計ラボイン',      unit: '日', desc: 'これ まで の 総 checkin 日数' },
  { key: 'opener',      title: '🔓 オープナー',         unit: '日', desc: 'その日 最初 に ラボ に 入った 日数 (前夜 泊まり 除外)' },
  { key: 'closer',      title: '🌃 クローザー',         unit: '日', desc: 'その日 最後 に ラボ を 出た 日数 (その夜 泊まり 除外)' },
  { key: 'early_bird',  title: '🌅 早起きラボ',         unit: '日', desc: '朝 7:00〜8:30 に ラボ に いた 日数 (泊まり 除外)' },
  { key: 'night_use',   title: '🌙 夜間ラボ族',         unit: '日', desc: '夜 23:00〜25:00 に ラボ に いた 日数' },
  { key: 'all_nighter', title: '🛌 徹夜',                unit: '日', desc: '日付 を またぐ 在室 (0:00 越え) の 日数' },
];

export async function renderRankings() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🏆 Ranking</h2>
      <div class="hint-sm" style="color:#666; font-size:11px; margin-top:2px">
        各 top 10。 意味論 は 実績ページ の 対応バッジ と 揃えて います。
      </div>
    </div>
    <div class="list apps-grid-2col" id="rk-grid">
      ${CARDS.map(c => `
        <div class="card" data-rk="${c.key}">
          <div class="row center" style="gap:6px; margin-bottom:4px">
            <h3 style="margin:0; flex:1 1 auto; font-size:15px">${c.title}</h3>
          </div>
          <div class="hint-sm" style="color:#666; font-size:11px; margin-bottom:6px">${escapeHtml(c.desc)}</div>
          <div id="rk-body-${c.key}" class="muted" style="font-size:12px">読み込み中…</div>
        </div>
      `).join('')}
    </div>
  `;

  try {
    const d = await get('/api/rankings');
    const rk = d.rankings || {};
    for (const c of CARDS) {
      const body = document.getElementById('rk-body-' + c.key);
      if (!body) continue;
      const rows = rk[c.key] || [];
      if (!rows.length) {
        body.innerHTML = '<div class="hint">まだ 記録 なし</div>';
        continue;
      }
      body.innerHTML = rows.map((r, i) => renderRow(r, i, c.unit)).join('');
    }
  } catch (e) {
    for (const c of CARDS) {
      const body = document.getElementById('rk-body-' + c.key);
      if (body) body.innerHTML = `<div class="hint" style="color:#c00">取得失敗: ${escapeHtml(e.message)}</div>`;
    }
  }
}

function renderRow(r, i, unit) {
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
  const av = r.avatar_url
    ? `<img src="${escapeHtml(r.avatar_url)}" alt=""
         style="width:26px; height:26px; border-radius:50%; object-fit:cover; flex:0 0 26px; display:block">`
    : `<div style="width:26px; height:26px; border-radius:50%; background:#eee; flex:0 0 26px"></div>`;
  return `
    <a href="#/users/${r.user_id}" class="row center"
       style="gap:8px; padding:5px 2px; border-bottom:1px solid var(--line);
              text-decoration:none; color:inherit">
      <span style="flex:0 0 28px; font-weight:600; color:#666; text-align:right; font-size:12px">${medal}</span>
      ${av}
      <div style="flex:1 1 0; min-width:0; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
        ${escapeHtml(r.display_name)}
      </div>
      <div style="flex:0 0 auto; text-align:right; font-weight:700; color:#7b3fa0; font-size:14px">
        ${r.count}<span style="font-size:10px; color:#666; font-weight:400; margin-left:2px">${unit}</span>
      </div>
    </a>
  `;
}
