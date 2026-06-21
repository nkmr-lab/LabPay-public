// v740 BingoFit 盤面ビュー: 5x5 着回しビンゴ。 タップでマスを開ける / 取り消す。
// 完成ライン (横 / 縦 / 斜め) は枠ハイライト + 「ビンゴ N!」 をヘッダーに。

import { get, post, del } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

export async function renderBingofitBoard() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div style="max-width:720px; margin:0 auto; padding:12px">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
        <h2 style="margin:0; font-size:18px">🎯 今週の着回しビンゴ</h2>
        <a href="#/bingofit/closet" style="font-size:12px; color:#4a106d">👕 クローゼット</a>
      </div>
      <div id="bf-board-meta" style="font-size:12px; color:#666; margin-bottom:10px"></div>
      <div id="bf-board-root">読み込み中...</div>
    </div>
  `;
  await loadAndRender();
}

export async function renderBingofitHistory() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div style="max-width:720px; margin:0 auto; padding:12px">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
        <h2 style="margin:0; font-size:18px">📊 着回しビンゴ - 履歴</h2>
        <a href="#/bingofit/closet" style="font-size:12px; color:#4a106d">👕 クローゼット</a>
      </div>
      <div id="bf-history">読み込み中...</div>
    </div>
  `;
  try {
    const d = await get('/api/bingofit/history');
    const root = document.getElementById('bf-history');
    if (!d.items || !d.items.length) {
      root.innerHTML = `<div style="color:#9ca3af; padding:20px; text-align:center">過去の盤がまだありません</div>`;
      return;
    }
    root.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px">
        ${d.items.map(it => `
          <a href="#/bingofit/board?week=${encodeURIComponent(it.week_start)}" class="list-item" style="padding:10px; border:1px solid #e5e7eb; border-radius:8px; text-decoration:none; color:inherit; display:flex; justify-content:space-between; align-items:center">
            <div>
              <div style="font-weight:600">${escapeHtml(it.week_start)} 〜</div>
              <div style="font-size:12px; color:#666">${it.opened_count}/25 マス開け</div>
            </div>
            <div style="font-size:20px; font-weight:700; color:${it.bingo_lines>0?'#7b3fa0':'#9ca3af'}">${it.bingo_lines > 0 ? '🎯 ' + it.bingo_lines : '—'}</div>
          </a>
        `).join('')}
      </div>`;
  } catch (e) {
    document.getElementById('bf-history').innerHTML = `<div style="color:#c00; padding:12px">取得 失敗: ${escapeHtml(String(e))}</div>`;
  }
}

async function loadAndRender() {
  // querystring から week を拾う (#/bingofit/board?week=YYYY-MM-DD)
  let week = null;
  const m = location.hash.match(/[?&]week=([\d-]+)/);
  if (m) week = m[1];
  try {
    const d = await get('/api/bingofit/board' + (week ? '?week=' + encodeURIComponent(week) : ''));
    renderBoard(d);
  } catch (e) {
    document.getElementById('bf-board-root').innerHTML = `<div style="color:#c00; padding:12px">取得 失敗: ${escapeHtml(String(e))}</div>`;
  }
}

function renderBoard(d) {
  document.getElementById('bf-board-meta').textContent =
    `${d.week_start} 〜 (日曜始まり) ・ ${d.is_current === false ? '過去週 (タップ不可)' : '今週'}`;

  const root = document.getElementById('bf-board-root');
  if (d.need_items !== undefined && d.need_items > 0) {
    root.innerHTML = `
      <div style="text-align:center; padding:24px; background:#fef3c7; border:1px solid #fde68a; border-radius:10px">
        <div style="font-size:14px; margin-bottom:8px">あと <b style="font-size:24px; color:#92400e">${d.need_items}</b> 着 登録すると盤が作られます</div>
        <div style="font-size:11px; color:#92400e">現在 ${d.active_count} 着 / 必要 25 着</div>
        <div style="margin-top:14px">
          <a href="#/bingofit/closet" style="display:inline-block; padding:10px 20px; background:#4a106d; color:#fff; text-decoration:none; border-radius:6px; font-weight:600">👕 クローゼットへ</a>
        </div>
      </div>`;
    return;
  }
  if (!d.cells || d.cells.length === 0) {
    root.innerHTML = `<div style="padding:16px; color:#9ca3af; text-align:center">この週の盤はありません</div>`;
    return;
  }
  const opens = d.opens || {};
  const isCurrent = d.is_current !== false;
  const lines = d.bingo_lines || 0;
  const opened = Object.keys(opens).map(Number);
  const litCells = computeLitCells(opened);

  root.innerHTML = `
    <div style="text-align:center; margin-bottom:8px">
      <span style="display:inline-block; padding:6px 14px; background:${lines>0?'#7b3fa0':'#ede4f3'}; color:${lines>0?'#fff':'#4a106d'}; border-radius:20px; font-weight:600">
        ${lines > 0 ? '🎯 ' + lines + ' ビンゴ!' : `${opened.length}/25 マス開け`}
      </span>
    </div>
    <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:4px; max-width:520px; margin:0 auto; aspect-ratio:1">
      ${d.cells.map(c => cellHtml(c, opens[c.index], litCells.has(c.index), isCurrent)).join('')}
    </div>
    <div style="font-size:11px; color:#9ca3af; text-align:center; margin-top:12px">タップ = 「今日 着た」 / 再タップで取消</div>
  `;
  if (isCurrent) {
    root.querySelectorAll('[data-bf-cell]').forEach(el => {
      el.addEventListener('click', () => onCellClick(parseInt(el.dataset.bfCell, 10), el.dataset.bfOpen === '1'));
    });
  }
}

function cellHtml(c, openedAt, lit, isCurrent) {
  const opened = !!openedAt;
  const url = c.image_url_transparent || c.image_url;
  const isPending = c.bg_status === 'pending';
  const bg = lit ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : (opened ? 'linear-gradient(135deg,#a78bfa,#7b3fa0)' : 'linear-gradient(135deg,#fafaf5,#ede4f3)');
  const cursor = isCurrent ? 'cursor:pointer' : 'cursor:default';
  return `
    <div data-bf-cell="${c.index}" data-bf-open="${opened?1:0}" style="${cursor}; position:relative; border-radius:6px; overflow:hidden; background:${bg}; border:1px solid ${lit?'#d97706':'#e5e7eb'}; aspect-ratio:1">
      ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(c.label||'')}" loading="lazy" style="position:absolute; inset:0; width:100%; height:100%; object-fit:contain; padding:3px; ${isPending?'opacity:0.4':''}">` : `<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#9ca3af; font-size:10px">(画像なし)</div>`}
      ${opened ? `<div style="position:absolute; inset:0; background:rgba(123,63,160,${lit?0.15:0.35}); display:flex; align-items:center; justify-content:center"><div style="font-size:28px">${lit?'⭐':'✓'}</div></div>` : ''}
      ${isPending && !opened ? `<div style="position:absolute; left:0; right:0; bottom:0; background:rgba(0,0,0,0.55); color:#fff; font-size:9px; text-align:center; padding:1px">🪄</div>` : ''}
    </div>`;
}

// ライン揃ったマスを取得 (= 強調表示用)
function computeLitCells(opened) {
  const set = new Set(opened);
  const lit = new Set();
  // 横
  for (let r = 0; r < 5; r++) {
    let ok = true;
    for (let c = 0; c < 5; c++) if (!set.has(r*5+c)) { ok = false; break; }
    if (ok) for (let c = 0; c < 5; c++) lit.add(r*5+c);
  }
  // 縦
  for (let c = 0; c < 5; c++) {
    let ok = true;
    for (let r = 0; r < 5; r++) if (!set.has(r*5+c)) { ok = false; break; }
    if (ok) for (let r = 0; r < 5; r++) lit.add(r*5+c);
  }
  // 斜め
  let ok = true; for (let i = 0; i < 5; i++) if (!set.has(i*5+i)) { ok = false; break; }
  if (ok) for (let i = 0; i < 5; i++) lit.add(i*5+i);
  ok = true; for (let i = 0; i < 5; i++) if (!set.has(i*5+(4-i))) { ok = false; break; }
  if (ok) for (let i = 0; i < 5; i++) lit.add(i*5+(4-i));
  return lit;
}

async function onCellClick(idx, currentlyOpen) {
  try {
    if (currentlyOpen) {
      await del('/api/bingofit/board/cells/' + idx + '/open');
    } else {
      await post('/api/bingofit/board/cells/' + idx + '/open', {});
    }
    await loadAndRender();
  } catch (e) {
    toast('更新 失敗: ' + (e?.message || e));
  }
}
