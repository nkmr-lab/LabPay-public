// /#/roulette — group lottery. Pick title + members, spin, see who's chosen.
// Server picks the winner; client animates the wheel so it ends on that index.

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

// Equally-spaced color palette so adjacent slices read as distinct.
const SLICE_COLORS = [
  '#7b3fbf', '#0e7c63', '#b54708', '#1f5238', '#4a106d', '#b71c50',
  '#8a2a23', '#3c5a99', '#cd853f', '#2e7d32', '#5e35b1', '#c2185b',
];

let lastResult = null;        // remembered between renders so the wheel stays on the winner
let spinning = false;
let selected = new Set();     // user_ids currently checked

export async function renderRoulette() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0">ルーレット</h2>
      <p class="muted" style="font-size:13px; margin:6px 0 0">
        誰かを決めたいときに。タイトルとメンバーを選んで、回すボタンで決まり。
        参加メンバーには通知で結果が届きます。
      </p>
    </div>

    <div class="card">
      <label class="field">
        <span class="lbl">タイトル</span>
        <input type="text" id="rl-title" maxlength="200" placeholder="例: 今日のゴミ捨て当番">
      </label>
      <div class="field">
        <span class="lbl">参加メンバー (2 人以上)</span>
        <div id="rl-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
    </div>

    <div class="card" style="text-align:center">
      <div id="rl-wheel-wrap" style="position:relative; width:280px; height:280px; margin:0 auto">
        <div id="rl-pointer" style="position:absolute; top:-4px; left:50%; transform:translateX(-50%); font-size:24px; z-index:2">▼</div>
        <svg id="rl-wheel" viewBox="-150 -150 300 300" width="280" height="280"
             style="display:block; transition:transform 4.5s cubic-bezier(.18,.85,.25,1)">
          <circle cx="0" cy="0" r="140" fill="#e9eaee"></circle>
          <text x="0" y="5" text-anchor="middle" font-size="14" fill="#666">メンバーを選択</text>
        </svg>
      </div>
      <button id="rl-spin" class="primary" style="margin-top:14px; min-width:160px">回す!</button>
      <div id="rl-result" style="margin-top:10px; min-height:24px; font-weight:700"></div>
    </div>

    <div class="card">
      <h3>最近の結果</h3>
      <div id="rl-history" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  document.getElementById('rl-spin').addEventListener('click', onSpin);
  await loadMembers();
  await loadHistory();
}

async function loadMembers() {
  try {
    const u = await get('/api/users');
    const root = document.getElementById('rl-members');
    const me = state.me?.id;
    root.innerHTML = u.items.map(x => {
      const checked = selected.has(x.id) ? 'checked' : '';
      // Default: include self so a "ルーレットで誰がやる?" naturally has you in
      const auto = (selected.size === 0 && x.id === me) ? 'checked' : '';
      if (auto) selected.add(x.id);
      return `
        <label class="rl-chip">
          <input type="checkbox" data-uid="${x.id}" ${checked || auto}>
          ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
          <span>${escapeHtml(x.display_name)}</span>
        </label>`;
    }).join('');
    root.querySelectorAll('input[data-uid]').forEach(cb => {
      cb.addEventListener('change', () => {
        const uid = Number(cb.dataset.uid);
        if (cb.checked) selected.add(uid);
        else            selected.delete(uid);
        redrawWheel();
      });
    });
    redrawWheel();
  } catch (e) {
    document.getElementById('rl-members').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function redrawWheel() {
  const svg = document.getElementById('rl-wheel');
  const wrap = document.getElementById('rl-wheel-wrap');
  if (!svg || !wrap) return;
  // Reset rotation between draws so we don't accumulate.
  svg.style.transform = 'rotate(0deg)';
  svg.style.transition = 'none';

  // Look up names for selected ids from the checkbox labels we already rendered.
  const labels = {};
  document.querySelectorAll('#rl-members input[data-uid]').forEach(cb => {
    const text = cb.parentElement?.querySelector('span')?.textContent || '?';
    labels[Number(cb.dataset.uid)] = text;
  });
  const ids = [...selected];
  if (ids.length < 2) {
    svg.innerHTML = `
      <circle cx="0" cy="0" r="140" fill="#e9eaee"></circle>
      <text x="0" y="5" text-anchor="middle" font-size="13" fill="#666">2人以上選んでください</text>`;
    return;
  }
  const N = ids.length;
  const sliceDeg = 360 / N;
  const slices = ids.map((uid, i) => {
    const a0 = (i * sliceDeg - 90) * Math.PI / 180;
    const a1 = ((i + 1) * sliceDeg - 90) * Math.PI / 180;
    const x0 = 140 * Math.cos(a0), y0 = 140 * Math.sin(a0);
    const x1 = 140 * Math.cos(a1), y1 = 140 * Math.sin(a1);
    const large = sliceDeg > 180 ? 1 : 0;
    const color = SLICE_COLORS[i % SLICE_COLORS.length];
    const path = `M 0 0 L ${x0.toFixed(1)} ${y0.toFixed(1)} A 140 140 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
    // Label: center of slice at 95px radius
    const am = ((i + 0.5) * sliceDeg - 90) * Math.PI / 180;
    const tx = 95 * Math.cos(am), ty = 95 * Math.sin(am);
    const name = labels[uid] || '?';
    // Truncate to keep slices readable
    const short = name.length > 6 ? name.slice(0, 5) + '…' : name;
    return `
      <path d="${path}" fill="${color}" stroke="white" stroke-width="2"></path>
      <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
            font-size="11" fill="white" font-weight="700"
            transform="rotate(${(i + 0.5) * sliceDeg} ${tx.toFixed(1)} ${ty.toFixed(1)})">${escapeHtml(short)}</text>`;
  }).join('');
  svg.innerHTML = `
    ${slices}
    <circle cx="0" cy="0" r="14" fill="white" stroke="#999" stroke-width="2"></circle>`;
}

async function onSpin() {
  if (spinning) return;
  const title = document.getElementById('rl-title').value.trim();
  if (!title) { toast('タイトルを入れてください'); return; }
  const ids = [...selected];
  if (ids.length < 2) { toast('2 人以上選んでください'); return; }

  spinning = true;
  document.getElementById('rl-spin').disabled = true;
  document.getElementById('rl-result').textContent = '';

  try {
    const r = await post('/api/roulettes', { title, member_ids: ids });
    lastResult = r;
    // Animate: spin many full turns, ending with the pointer over the winning slice.
    // Pointer is fixed at the top (-90° in SVG). Slice i covers [i*sliceDeg, (i+1)*sliceDeg)
    // measured clockwise from the top. To land on slice i's center, the wheel
    // should rotate so that center sits at the top (= total rotation
    // = -(i*sliceDeg + sliceDeg/2) plus N full turns to make the spin visible).
    const N = ids.length;
    const sliceDeg = 360 / N;
    const target = -(r.winner_index * sliceDeg + sliceDeg / 2);
    const total = 360 * 5 + target;  // 5 full spins
    const svg = document.getElementById('rl-wheel');
    svg.style.transition = 'transform 4.5s cubic-bezier(.18,.85,.25,1)';
    requestAnimationFrame(() => {
      svg.style.transform = `rotate(${total}deg)`;
    });
    // Reveal result after animation completes (matches the CSS transition).
    setTimeout(() => {
      document.getElementById('rl-result').innerHTML =
        `🎯 <span style="color:var(--primary); font-size:18px">${escapeHtml(r.winner_name)}</span> さん!`;
      document.getElementById('rl-spin').disabled = false;
      spinning = false;
      loadHistory();
    }, 4600);
  } catch (e) {
    toast('失敗: ' + e.message);
    document.getElementById('rl-spin').disabled = false;
    spinning = false;
  }
}

async function loadHistory() {
  try {
    const d = await get('/api/roulettes');
    const root = document.getElementById('rl-history');
    if (!d.items.length) {
      root.innerHTML = `<div class="empty">まだ履歴はありません</div>`;
      return;
    }
    root.innerHTML = d.items.map(r => `
      <div class="list-item">
        <div style="flex:1">
          <div class="bold">${escapeHtml(r.title)}</div>
          <div class="meta">候補 ${r.member_ids.length} 人 · ${escapeHtml(r.created_at)} · 起案 ${escapeHtml(r.creator_name)}</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px">
          ${avatarHtml(r.winner_name, r.winner_avatar_url, 'sm')}
          <span class="bold" style="color:var(--primary)">${escapeHtml(r.winner_name)}</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('rl-history').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
