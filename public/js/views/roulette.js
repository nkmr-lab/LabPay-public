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
        <span class="lbl">ルーレットのタイトル</span>
        <input type="text" id="rl-title" maxlength="200" placeholder="例: 今日のゴミ捨て当番">
      </label>
      <label class="field">
        <span class="lbl">当たった人にあなたからポイントを送る (任意・空欄 = 送らない)</span>
        <input type="number" id="rl-reward" min="0" max="1000000" placeholder="例: 100">
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0 6px">
        <span class="switch">
          <input type="checkbox" id="rl-dry" checked>
          <span class="slider"></span>
        </span>
        <span>🧪 テストモード <span class="muted" style="font-size:12px">— ON の時は結果だけ表示、pt 移動・通知・履歴なし</span></span>
      </label>
      <div id="rl-dry-warn" hidden
           style="background:#fff8e6; border:1px solid #f5d089; border-radius:8px;
                  padding:8px 10px; margin:0 0 10px; font-size:12px; color:#b54708">
        ⚠️ テストモードが OFF です。「回す!」を押すと <b>ルーレットの結果が対象者全員に通知</b>されます (履歴にも残ります)。
      </div>
      <div class="field">
        <span class="lbl">参加メンバー (2 人以上)</span>
        <div id="rl-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px"></div>
        <div id="rl-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
    </div>

    <div class="card" style="text-align:center">
      <div id="rl-wheel-wrap" style="position:relative; width:280px; height:280px; margin:0 auto">
        <div id="rl-pointer" style="position:absolute; top:-4px; left:50%; transform:translateX(-50%); font-size:24px; z-index:2">▼</div>
        <svg id="rl-wheel" viewBox="-150 -150 300 300" width="280" height="280"
             style="display:block; transition:transform 8s cubic-bezier(.32,.08,.18,1)">
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
  // Toggle the warning callout in sync with the テストモード switch — keeps the
  // 'about to broadcast' reminder visible whenever the user has armed a real
  // spin.
  const dryToggle = document.getElementById('rl-dry');
  const dryWarn   = document.getElementById('rl-dry-warn');
  const syncWarn  = () => { dryWarn.hidden = dryToggle.checked; };
  dryToggle.addEventListener('change', syncWarn);
  syncWarn();
  await loadMembers();
  await loadHistory();
}

// Cached after first /api/users so bulk-select buttons can flip checkboxes
// without re-fetching.
let ALL_USERS = [];

// Grade ordering: B3 → B4 → M1 → M2 → D → (no grade). Same ordering rule
// drives both the member chip list and the bulk-select bar.
const GRADE_ORDER = ['B3','B4','M1','M2','D',''];
function gradeRank(g) {
  const i = GRADE_ORDER.indexOf(g || '');
  return i < 0 ? GRADE_ORDER.length : i;
}

async function loadMembers() {
  try {
    const u = await get('/api/users');
    // Sort by grade, then alphabetically inside each grade. The API returns
    // alphabetical already, so a stable sort by gradeRank preserves that order
    // within each group.
    ALL_USERS = [...u.items].sort((a, b) => {
      const d = gradeRank(a.grade) - gradeRank(b.grade);
      if (d !== 0) return d;
      return (a.display_name || '').localeCompare(b.display_name || '', 'ja');
    });
    const root = document.getElementById('rl-members');
    const me = state.me?.id;
    // Bulk-select toolbar — render once based on the unique grades present in
    // the directory. Skip the empty-grade case ("その他") on purpose: a single
    // button labeled 'その他' for the ungraded leftovers wasn't useful in
    // practice; users still get pulled in via '全員'.
    const presentGrades = [...new Set(ALL_USERS.map(x => x.grade || ''))];
    const sortedGrades = GRADE_ORDER.filter(g => g !== '' && presentGrades.includes(g));
    const bulkRoot = document.getElementById('rl-bulk');
    bulkRoot.innerHTML = `
      <button class="btn" data-bulk="all">全員 ON / OFF</button>
      ${sortedGrades.map(g => `<button class="btn" data-bulk="grade" data-grade="${g}">${g}</button>`).join('')}
    `;
    bulkRoot.querySelectorAll('[data-bulk]').forEach(b => {
      b.addEventListener('click', () => onBulk(b.dataset.bulk, b.dataset.grade));
    });

    root.innerHTML = ALL_USERS.map(x => {
      const checked = selected.has(x.id) ? 'checked' : '';
      // Default: include self so a "ルーレットで誰がやる?" naturally has you in
      const auto = (selected.size === 0 && x.id === me) ? 'checked' : '';
      if (auto) selected.add(x.id);
      const gradeBadge = x.grade
        ? `<span class="muted" style="font-size:11px">[${escapeHtml(x.grade)}]</span>`
        : '';
      return `
        <label class="rl-chip">
          <input type="checkbox" data-uid="${x.id}" ${checked || auto}>
          ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
          <span>${escapeHtml(x.display_name)}</span>
          ${gradeBadge}
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

// Toggle behavior: if any member of the target set is already checked,
// the click DESELECTS the whole set. Otherwise it SELECTS the whole set.
// Matches '全員 ON / OFF' wording — same button handles both directions
// depending on current state.
function onBulk(kind, grade) {
  const target = kind === 'grade'
    ? ALL_USERS.filter(x => (x.grade || '') === grade)
    : ALL_USERS;
  const anySelected = target.some(x => selected.has(x.id));
  if (anySelected) {
    target.forEach(x => selected.delete(x.id));
  } else {
    target.forEach(x => selected.add(x.id));
  }
  // Reflect into the DOM checkboxes.
  document.querySelectorAll('#rl-members input[data-uid]').forEach(cb => {
    cb.checked = selected.has(Number(cb.dataset.uid));
  });
  redrawWheel();
}

function redrawWheel() {
  const svg = document.getElementById('rl-wheel');
  const wrap = document.getElementById('rl-wheel-wrap');
  if (!svg || !wrap) return;
  svg.style.transform = 'rotate(0deg)';
  svg.style.transition = 'none';

  // Build a quick id → user map so each slice can pick up avatar_url.
  const byId = {};
  ALL_USERS.forEach(u => { byId[u.id] = u; });

  const ids = [...selected];
  if (ids.length < 2) {
    svg.innerHTML = `
      <circle cx="0" cy="0" r="140" fill="#e9eaee"></circle>
      <text x="0" y="5" text-anchor="middle" font-size="13" fill="#666">2人以上選んでください</text>`;
    return;
  }
  const N = ids.length;
  const sliceDeg = 360 / N;
  // Compact name (limit length so text fits even on dense wheels).
  const compact = (s) => (s || '?').length > 5 ? s.slice(0, 4) + '…' : (s || '?');

  const slices = ids.map((uid, i) => {
    const user = byId[uid] || { display_name: '?', avatar_url: null };
    const a0 = (i * sliceDeg - 90) * Math.PI / 180;
    const a1 = ((i + 1) * sliceDeg - 90) * Math.PI / 180;
    const x0 = 140 * Math.cos(a0), y0 = 140 * Math.sin(a0);
    const x1 = 140 * Math.cos(a1), y1 = 140 * Math.sin(a1);
    const large = sliceDeg > 180 ? 1 : 0;
    const color = SLICE_COLORS[i % SLICE_COLORS.length];
    const path = `M 0 0 L ${x0.toFixed(1)} ${y0.toFixed(1)} A 140 140 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
    // Slice midline angle (in screen coords, -90° offset to put 0 at top).
    const am = ((i + 0.5) * sliceDeg - 90) * Math.PI / 180;
    // Avatar near the outer edge (~r=95), name a little closer to center (~r=60).
    const ax = 95 * Math.cos(am), ay = 95 * Math.sin(am);
    const tx = 60 * Math.cos(am), ty = 60 * Math.sin(am);
    const ROT = (i + 0.5) * sliceDeg;
    const initial = (user.display_name || '?').trim().charAt(0).toUpperCase();
    // Avatar: SVG <image> clipped to a per-user circle. Fall back to a colored
    // initial bubble when there's no avatar_url. Background white so PNGs with
    // alpha don't show the slice color through transparent pixels.
    const r = 16;
    const clipId = `rl-clip-${uid}`;
    const avatarChunk = user.avatar_url
      ? `<defs><clipPath id="${clipId}"><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${r}"></circle></clipPath></defs>
         <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${r}" fill="white" stroke="white" stroke-width="2"></circle>
         <image href="${escapeHtml(user.avatar_url)}" x="${(ax - r).toFixed(1)}" y="${(ay - r).toFixed(1)}"
                width="${r * 2}" height="${r * 2}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"></image>`
      : `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${r}" fill="white" stroke="white" stroke-width="2"></circle>
         <text x="${ax.toFixed(1)}" y="${(ay + 5).toFixed(1)}" text-anchor="middle" font-size="16" font-weight="700" fill="${color}">${escapeHtml(initial)}</text>`;
    return `
      <path d="${path}" fill="${color}" stroke="white" stroke-width="2"></path>
      ${avatarChunk}
      <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
            font-size="10" fill="white" font-weight="700"
            transform="rotate(${ROT} ${tx.toFixed(1)} ${ty.toFixed(1)})">${escapeHtml(compact(user.display_name))}</text>`;
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
  const rewardRaw = document.getElementById('rl-reward').value.trim();
  const reward = rewardRaw ? Math.max(0, Math.floor(Number(rewardRaw))) : 0;
  const dryRun = document.getElementById('rl-dry').checked;

  spinning = true;
  document.getElementById('rl-spin').disabled = true;
  document.getElementById('rl-result').textContent = '';

  try {
    const r = await post('/api/roulettes', { title, member_ids: ids, reward, dry_run: dryRun });
    lastResult = r;
    // Animate: spin many full turns, ending with the pointer over the winning slice.
    // Pointer is fixed at the top (-90° in SVG). Slice i covers [i*sliceDeg, (i+1)*sliceDeg)
    // measured clockwise from the top. To land on slice i's center, the wheel
    // should rotate so that center sits at the top (= total rotation
    // = -(i*sliceDeg + sliceDeg/2) plus N full turns to make the spin visible).
    const N = ids.length;
    const sliceDeg = 360 / N;
    const target = -(r.winner_index * sliceDeg + sliceDeg / 2);
    // 8 full spins + the offset to land on the winner. cubic-bezier(.32,.08,.18,1)
    // starts gently (the original was too snappy off the line), holds speed
    // through the middle, then decelerates smoothly into place — feels like a
    // slot-machine wheel rather than a spring.
    const total = 360 * 8 + target;
    const svg = document.getElementById('rl-wheel');
    svg.style.transition = 'transform 8s cubic-bezier(.32,.08,.18,1)';
    requestAnimationFrame(() => {
      svg.style.transform = `rotate(${total}deg)`;
    });
    // Reveal result after animation completes (matches the CSS transition).
    setTimeout(() => {
      let prize = '';
      if (r.dry_run) {
        prize = ' <span class="muted">(テストモード: pt は動いてません)</span>';
      } else if (r.reward > 0 && r.winner_user_id !== state.me?.id) {
        prize = ` <span style="color:var(--primary)">+${r.reward}pt</span>`;
      } else if (r.reward > 0) {
        prize = ' <span class="muted">(自分が当選: pt 移動なし)</span>';
      }
      let html = `🎯 <span style="color:var(--primary); font-size:18px">${escapeHtml(r.winner_name)}</span> さん!${prize}`;
      // In test mode, also show the would-be notification per participant so the
      // user can sanity-check the message text before doing it for real.
      if (r.dry_run && Array.isArray(r.notifications_preview)) {
        const rows = r.notifications_preview.map(n => `
          <div class="list-item" style="padding:6px 10px; ${n.is_winner ? 'border-left:3px solid var(--primary); background:#faf6ff' : ''}">
            <div style="flex:1">
              <div class="bold" style="font-size:13px">→ ${escapeHtml(n.display_name)}${n.is_winner ? ' 🎯' : ''}</div>
              <div class="meta" style="white-space:pre-wrap">${escapeHtml(n.body)}</div>
            </div>
          </div>`).join('');
        html += `
          <div class="muted" style="font-size:12px; text-align:left; margin:14px 0 4px">
            ↓ テストモード OFF だと、以下の通知が各メンバーに届きます (${r.notifications_preview.length}人)
          </div>
          <div class="list" style="text-align:left">${rows}</div>`;
      }
      document.getElementById('rl-result').innerHTML = html;
      document.getElementById('rl-spin').disabled = false;
      spinning = false;
      if (!r.dry_run) loadHistory();
    }, 8100);
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
    root.innerHTML = d.items.map(r => {
      const rewardTag = r.reward > 0
        ? ` <span class="bold" style="color:var(--primary)">+${r.reward}pt</span>`
        : '';
      return `
        <div class="list-item">
          <div style="flex:1">
            <div class="bold">${escapeHtml(r.title)}${rewardTag}</div>
            <div class="meta">候補 ${r.member_ids.length} 人 · ${escapeHtml(r.created_at)} · 起案 ${escapeHtml(r.creator_name)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:6px">
            ${avatarHtml(r.winner_name, r.winner_avatar_url, 'sm')}
            <span class="bold" style="color:var(--primary)">${escapeHtml(r.winner_name)}</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('rl-history').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
