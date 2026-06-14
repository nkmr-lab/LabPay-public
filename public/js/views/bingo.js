// v588 ビンゴ。 週次 5x5、 自動判定、 リーチ / ビンゴ で 演出。

import { get } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';

export async function renderBingo(ctx) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  // ?week=YYYY-MM-DD で過去週を表示
  const weekParam = (ctx?.query?.week || (location.hash.match(/[?&]week=([^&]+)/)?.[1])) || null;
  let d, lb, hist;
  try {
    if (weekParam) {
      d = await get('/api/bingo/week/' + encodeURIComponent(weekParam));
      lb = { earliest: [], most_lines: [] };
    } else {
      [d, lb] = await Promise.all([
        get('/api/bingo/me'),
        get('/api/bingo/leaderboard'),
      ]);
    }
    hist = await get('/api/bingo/history').catch(() => ({ items: [] }));
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="hint">読み込み失敗: ${escapeHtml(e?.message || e)}</div></div>`;
    return;
  }
  const isPast = !!weekParam;

  const reachLines = computeReachLines(d.completed);
  const isBingo = d.bingo_lines > 0;

  app.innerHTML = `
    <div class="card page-header">
      <div style="display:flex; align-items:center; gap:8px">
        <h2 style="margin:0; flex:1">🎰 ビンゴ ${isPast ? `(${escapeHtml(d.week_start)})` : ''}</h2>
        ${isPast ? `<a href="#/bingo" class="btn" style="font-size:12px">今週へ</a>` : ''}
      </div>
      ${isPast ? '' : `<p class="hint" style="margin:6px 0 0; font-size:13px">
        週次 5x5 マス。 毎週 日曜 0:00 リセット → 土曜 23:59 終了。
        平日 (月-金) の 行動 が 自動 カウント。 自分の カード だけ 見えます。
      </p>`}
      <p style="margin:8px 0 0; font-size:13px">
        ${isPast ? '対象週' : '今週'}: <b>${escapeHtml(d.week_start)}</b> 開始 ・
        ビンゴ数: <b style="font-size:18px; color:${isBingo ? '#dc2626' : '#888'}">${d.bingo_lines}</b> 本 ・
        達成: ${d.completed.length} / 25
        ${d.first_bingo_at ? ` ・ 初ビンゴ: ${escapeHtml(d.first_bingo_at)}` : ''}
      </p>
    </div>

    ${isBingo ? `
      <div id="bingo-banner" class="card" style="background:linear-gradient(135deg, #f59e0b, #ef4444, #ec4899); color:#fff; text-align:center; padding:18px; animation:bingoPulse 2s ease-in-out infinite">
        <div style="font-size:36px; font-weight:900; text-shadow:0 2px 8px rgba(0,0,0,0.3)">🎉 BINGO! 🎉</div>
        <div style="font-size:18px; margin-top:4px">${d.bingo_lines} 本 達成中</div>
      </div>
      <style>@keyframes bingoPulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.02); } }</style>
    ` : (reachLines.length > 0 ? `
      <div class="card" style="background:#fef3c7; color:#946d00; text-align:center; padding:12px">
        <div style="font-size:22px; font-weight:800">⚡ リーチ! あと 1 マス で ビンゴ × ${reachLines.length}</div>
      </div>
    ` : '')}

    <div class="card" style="padding:6px">
      <div id="bingo-grid" style="display:grid; grid-template-columns:repeat(5, 1fr); gap:4px; max-width:480px; margin:0 auto">
        ${d.cells.map((c, i) => {
          const done = d.completed.includes(i);
          const isReachCell = !done && reachLines.some(line => line.includes(i));
          return `
            <div style="aspect-ratio:1/1; border:2px solid ${done ? '#dc2626' : (isReachCell ? '#f59e0b' : '#ddd')}; border-radius:8px;
                  background:${done ? 'linear-gradient(145deg, #fecaca, #fca5a5)' : (isReachCell ? '#fef3c7' : '#fff')};
                  display:flex; flex-direction:column; align-items:center; justify-content:center;
                  text-align:center; padding:4px; font-size:11px; line-height:1.2; position:relative">
              ${done ? '<div style="position:absolute; font-size:54px; color:rgba(220,38,38,0.5); pointer-events:none; line-height:1">⭕</div>' : ''}
              <div style="font-size:18px">${escapeHtml(c.icon || '')}</div>
              <div style="font-size:10px; margin-top:2px">${escapeHtml(c.label)}</div>
            </div>`;
        }).join('')}
      </div>
    </div>

    ${(hist?.items?.length || 0) > 1 ? `
    <div class="card">
      <h3 style="margin:0 0 6px">📅 過去の週</h3>
      <div style="display:flex; gap:6px; flex-wrap:wrap">
        ${hist.items.filter(it => it.week_start !== d.week_start).map(it => `
          <a class="btn" href="#/bingo?week=${escapeHtml(it.week_start)}"
             style="font-size:12px; padding:4px 8px; ${it.bingo_lines > 0 ? 'background:#fef3c7; color:#946d00' : ''}">
            ${escapeHtml(it.week_start)} ・${it.completed_count}/25 ・${it.bingo_lines} 本
          </a>
        `).join('')}
      </div>
    </div>` : ''}

    ${isPast ? '' : `
    <div class="card">
      <h3 style="margin:0 0 6px">🏆 リーダーボード (今週)</h3>
      <div style="display:flex; gap:14px; flex-wrap:wrap">
        <div style="flex:1; min-width:200px">
          <div class="bold" style="font-size:13px; color:#946d00">🥇 ビンゴ 一番乗り</div>
          ${(lb.earliest || []).length ? (lb.earliest.map((r, i) => `
            <div style="display:flex; gap:6px; align-items:center; padding:4px 0">
              <span style="font-size:16px">${['🥇','🥈','🥉'][i]}</span>
              <span class="bold">${escapeHtml(r.display_name)}</span>
              <span class="hint-sm">${escapeHtml(r.first_bingo_at)}</span>
            </div>`).join('')) : '<div class="hint-sm">まだ誰も ビンゴ なし</div>'}
        </div>
        <div style="flex:1; min-width:200px">
          <div class="bold" style="font-size:13px; color:#946d00">🔥 ライン数 ランキング</div>
          ${(lb.most_lines || []).length ? (lb.most_lines.map((r, i) => `
            <div style="display:flex; gap:6px; align-items:center; padding:4px 0">
              <span style="font-size:16px">${['🥇','🥈','🥉'][i]}</span>
              <span class="bold">${escapeHtml(r.display_name)}</span>
              <span class="hint-sm">${r.bingo_lines} 本</span>
            </div>`).join('')) : '<div class="hint-sm">まだ ランキング なし</div>'}
        </div>
      </div>
    </div>`}
  `;

  // 新規達成 / 新規ビンゴ の 演出
  if (d.newly_bingoed) {
    triggerBingoCelebration();
  } else if ((d.newly_completed || []).length > 0) {
    toast('🎯 マス 達成! 残り ' + (25 - d.completed.length));
  }
}

function computeReachLines(completed) {
  const set = new Set(completed);
  const all = [];
  // 横
  for (let r = 0; r < 5; r++) {
    const line = [r*5, r*5+1, r*5+2, r*5+3, r*5+4];
    if (line.filter(i => !set.has(i)).length === 1) all.push(line);
  }
  // 縦
  for (let c = 0; c < 5; c++) {
    const line = [c, c+5, c+10, c+15, c+20];
    if (line.filter(i => !set.has(i)).length === 1) all.push(line);
  }
  // 斜め
  const d1 = [0,6,12,18,24];
  if (d1.filter(i => !set.has(i)).length === 1) all.push(d1);
  const d2 = [4,8,12,16,20];
  if (d2.filter(i => !set.has(i)).length === 1) all.push(d2);
  return all;
}

function triggerBingoCelebration() {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed; inset:0; z-index:9999; pointer-events:none; display:flex; align-items:center; justify-content:center';
  div.innerHTML = `
    <div style="font-size:120px; font-weight:900; color:#fff; text-shadow:0 0 20px #f59e0b, 0 0 40px #ef4444; animation:bingoZoom 2.5s ease-out forwards">
      🎉 BINGO! 🎉
    </div>
    <style>
      @keyframes bingoZoom {
        0% { transform:scale(0.3); opacity:0; }
        20% { transform:scale(1.2); opacity:1; }
        70% { transform:scale(1); opacity:1; }
        100% { transform:scale(1.1); opacity:0; }
      }
    </style>
  `;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}
