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
// roomId → Set of user_ids currently observed in that room. Populated from
// /api/presence at load time so the '10F に今いる人' buttons can flip those
// ids without an extra call.
let ROOM_USERS = {};

// When non-null, the picker is locked to this set of user_ids (e.g. coming
// from a group's "このメンバーでルーレット" shortcut). 他のユーザーは表示
// しないし、bulk ボタンも基本的にこの部分集合の中だけで動く。
let lockedIds = null;

export async function renderRoulette({ query } = {}) {
  selected = new Set();
  lockedIds = null;
  const raw = String(query?.members || '').trim();
  if (raw) {
    const ids = raw.split(',').map(Number).filter(Boolean);
    if (ids.length) lockedIds = new Set(ids);
  }
  // グループから飛んでくる時 title=<グループ名> 付き。 何も入っていない人間が
  // 「タイトル考えるの面倒」 で止まらないように初期値として埋める。
  const initialTitle = String(query?.title || '').trim();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0">ルーレット</h2>
      <p class="card-subtitle">
        誰かを決めたいときに。タイトルとメンバーを選んで、回すボタンで決まり。
        参加メンバーには通知で結果が届きます。
      </p>
    </div>

    <div class="card">
      <label class="field">
        <span class="lbl">ルーレットのタイトル</span>
        <input type="text" id="rl-title" maxlength="200" placeholder="例: 今日のゴミ捨て当番" value="${escapeHtml(initialTitle)}">
        <div id="rl-tag-row" class="row" style="gap:6px; flex-wrap:wrap; margin-top:6px"></div>
      </label>
      <label class="field">
        <span class="lbl">当たった人にあなたからポイントを送る (空欄 = 送らない)</span>
        <input type="number" id="rl-reward" min="0" max="1000000" placeholder="例: 100">
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0 10px">
        <span class="switch">
          <input type="checkbox" id="rl-dry">
          <span class="slider"></span>
        </span>
        <span>🧪 テストモード <span class="hint-sm">— ON の時は結果を送信しない</span></span>
      </label>
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
             style="display:block; transition:transform 14s cubic-bezier(.22,.04,.08,1)">
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
  await loadTags();
}

// ---------------- タグ (タイトル補助) ----------------
// admin が config.roulette_tags にカンマ区切りで持つ共通タグと、 ユーザが
// localStorage に持つ個人タグをマージしてチップで並べる。 タップで現在の
// タイトル末尾に半角スペース + タグを差し込む。 末尾に既にそのタグがあれば
// 重複追加しない。「＋」 で個人タグを追加可。 個人タグは右上に小さな
// × が出て削除できる。
const PERSONAL_TAGS_KEY = 'labpay-roulette-tags-personal';
function readPersonalTags() {
  try {
    const j = JSON.parse(localStorage.getItem(PERSONAL_TAGS_KEY) || '[]');
    return Array.isArray(j) ? j.filter(t => typeof t === 'string' && t.trim()) : [];
  } catch { return []; }
}
function writePersonalTags(arr) {
  try { localStorage.setItem(PERSONAL_TAGS_KEY, JSON.stringify(arr)); } catch {}
}
function normalizeTag(s) {
  const t = String(s || '').trim().replace(/\s+/g, '');
  if (!t) return '';
  return t.startsWith('#') ? t : '#' + t;
}

let SHARED_TAGS = [];
async function loadTags() {
  try {
    const d = await get('/api/roulettes/tags');
    SHARED_TAGS = Array.isArray(d.tags) ? d.tags : [];
  } catch { SHARED_TAGS = []; }
  renderTagRow();
}

function renderTagRow() {
  const row = document.getElementById('rl-tag-row');
  if (!row) return;
  const personal = readPersonalTags();
  // 共通タグは ×不可、 個人タグは × 付き。 重複時は共通を優先。
  const sharedSet = new Set(SHARED_TAGS);
  const personalOnly = personal.filter(t => !sharedSet.has(t));
  const chips = [
    ...SHARED_TAGS.map(t => `
      <button type="button" class="btn rl-tag" data-tag="${escapeHtml(t)}"
              style="padding:2px 10px; font-size:12px">${escapeHtml(t)}</button>`),
    ...personalOnly.map(t => `
      <span class="rl-tag-wrap" style="display:inline-flex; align-items:center; gap:2px">
        <button type="button" class="btn rl-tag" data-tag="${escapeHtml(t)}"
                style="padding:2px 10px; font-size:12px">${escapeHtml(t)}</button>
        <button type="button" class="rl-tag-rm" data-tag-rm="${escapeHtml(t)}"
                title="このタグを削除" style="border:none; background:none; color:var(--muted); cursor:pointer; padding:0 2px; font-size:11px">×</button>
      </span>`),
  ];
  row.innerHTML = chips.join('') + `
    <button type="button" id="rl-tag-add" class="btn"
            style="padding:2px 10px; font-size:12px; color:var(--muted)">＋ 追加</button>`;
  row.querySelectorAll('.rl-tag').forEach(b =>
    b.addEventListener('click', () => insertTagIntoTitle(b.dataset.tag)));
  row.querySelectorAll('.rl-tag-rm').forEach(b =>
    b.addEventListener('click', () => removePersonalTag(b.dataset.tagRm)));
  document.getElementById('rl-tag-add').addEventListener('click', onAddPersonalTag);
}

function insertTagIntoTitle(tag) {
  const input = document.getElementById('rl-title');
  if (!input) return;
  const cur = input.value;
  // 既に末尾にそのタグがあれば付け足さない (連打防止)。
  if (cur.trimEnd().endsWith(tag)) return;
  input.value = cur ? cur.trimEnd() + ' ' + tag : tag;
  input.focus();
}

function onAddPersonalTag() {
  const raw = prompt('追加するタグを入力 (# 不要、ハッシュは自動付与)\n例: 当番');
  const t = normalizeTag(raw);
  if (!t) return;
  if (t.length > 30) { toast('タグが長すぎます'); return; }
  const cur = readPersonalTags();
  if (cur.includes(t) || SHARED_TAGS.includes(t)) { toast('既に登録済み'); return; }
  writePersonalTags([...cur, t]);
  renderTagRow();
}

function removePersonalTag(t) {
  if (!confirm(`タグ ${t} を消しますか?`)) return;
  writePersonalTags(readPersonalTags().filter(x => x !== t));
  renderTagRow();
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
    const [u, p] = await Promise.all([
      get('/api/users'),
      // Presence is best-effort — if it fails we still want member chips to
      // render. Catch and fall back to empty so the room buttons just become
      // no-ops.
      get('/api/presence').catch(() => ({ rooms: [] })),
    ]);
    // Sort by grade, then alphabetically inside each grade. The API returns
    // alphabetical already, so a stable sort by gradeRank preserves that order
    // within each group.
    let pool = u.items;
    if (lockedIds) {
      pool = pool.filter(x => lockedIds.has(Number(x.id)));
      // Pre-select everyone in the locked set so the wheel is ready to spin.
      pool.forEach(x => selected.add(Number(x.id)));
    }
    ALL_USERS = [...pool].sort((a, b) => {
      const d = gradeRank(a.grade) - gradeRank(b.grade);
      if (d !== 0) return d;
      return (a.display_name || '').localeCompare(b.display_name || '', 'ja');
    });
    // Build the room-occupant map. Only rooms with at least one observed user
    // get a bulk button so we don't show '7F に今いる人 (0)'.
    ROOM_USERS = {};
    (p.rooms || []).forEach(r => {
      if (r.users && r.users.length) {
        ROOM_USERS[r.id] = new Set(r.users.map(x => Number(x.id)));
      }
    });
    const root = document.getElementById('rl-members');
    const me = state.me?.id;
    const presentGrades = [...new Set(ALL_USERS.map(x => x.grade || ''))];
    const sortedGrades = GRADE_ORDER.filter(g => g !== '' && presentGrades.includes(g));
    const roomButtons = (p.rooms || [])
      .filter(r => ROOM_USERS[r.id])
      .map(r => `<button class="btn" data-bulk="room" data-room="${escapeHtml(r.id)}">${escapeHtml(r.id)}にいる (${ROOM_USERS[r.id].size})</button>`)
      .join('');
    const bulkRoot = document.getElementById('rl-bulk');
    // メンバーが 5 人以下なら bulk select の出番はないので隠す
    // (全員・学年・部屋 を出しても結局個別チェックが速い)。
    if (ALL_USERS.length <= 5) {
      bulkRoot.innerHTML = '';
      bulkRoot.style.display = 'none';
    } else {
      bulkRoot.style.display = '';
      bulkRoot.innerHTML = `
        <button class="btn" data-bulk="all">全員</button>
        ${sortedGrades.map(g => `<button class="btn" data-bulk="grade" data-grade="${g}">${g}</button>`).join('')}
        ${roomButtons}
      `;
      bulkRoot.querySelectorAll('[data-bulk]').forEach(b => {
        b.addEventListener('click', () => onBulk(b.dataset.bulk, b.dataset.grade || b.dataset.room));
      });
    }

    root.innerHTML = ALL_USERS.map(x => {
      const checked = selected.has(x.id) ? 'checked' : '';
      const gradeBadge = x.grade
        ? `<span class="muted" style="font-size:11px">[${escapeHtml(x.grade)}]</span>`
        : '';
      return `
        <label class="rl-chip">
          <input type="checkbox" data-uid="${x.id}" ${checked}>
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

// Bulk toggles. 'all' and 'room' buttons use 'are EVERYONE in this set on?'
// semantics: turn on whenever anyone in the set is still off, turn off only
// when every member is already on. Means the first tap from a partial state
// is always 'select all of this set' — what the user reaches for when they
// tap '10F にいる'. Grade buttons keep the simpler 'any-checked → off' toggle
// since grades are bigger swaths and the alternate intent (start from one
// grade, swap to a different one) is one-tap away anyway.
function onBulk(kind, key) {
  let target;
  if (kind === 'grade') {
    target = ALL_USERS.filter(x => (x.grade || '') === key);
  } else if (kind === 'room') {
    const ids = ROOM_USERS[key] || new Set();
    target = ALL_USERS.filter(x => ids.has(x.id));
  } else {
    target = ALL_USERS;
  }
  if (!target.length) return;
  let turnOn;
  if (kind === 'grade') {
    const anyOn = target.some(x => selected.has(x.id));
    turnOn = !anyOn;
  } else {
    const allOn = target.every(x => selected.has(x.id));
    turnOn = !allOn;
  }
  if (turnOn) target.forEach(x => selected.add(x.id));
  else        target.forEach(x => selected.delete(x.id));
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

  // Real spins push notifications to every selected member + (optionally)
  // move pt — confirm before pulling the trigger so a misclick can't broadcast.
  if (!dryRun) {
    const rewardLine = reward > 0
      ? `\n(あなたから当選者に ${reward}pt が送られます)`
      : '';
    const ok = confirm(`本番モードです。ルーレットの結果が対象者全員 (${ids.length}人) に通知されます。${rewardLine}\n実行しますか?`);
    if (!ok) return;
  }

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
    // 12 full turns + the offset to land on the winner. The bezier
    // (.22, .04, .08, 1) starts very gently — barely creeps off the line —
    // then carries plenty of momentum through the middle, then trails off in
    // a long smooth deceleration. Total time tuned with the rotation amount
    // so the final degree-per-second is slow enough to read each name as it
    // passes the pointer.
    const total = 360 * 12 + target;
    const svg = document.getElementById('rl-wheel');
    svg.style.transition = 'transform 14s cubic-bezier(.22,.04,.08,1)';
    requestAnimationFrame(() => {
      svg.style.transform = `rotate(${total}deg)`;
    });
    // Sound: tick once for every slice that passes the pointer during the spin
    // (modelled by the same bezier the visuals use). Final ding! when the
    // wheel stops. AudioContext can only be created after a user gesture, so
    // this call lives inside the click handler.
    playSpinSounds(N, total);
    // Reveal result after animation completes (matches the CSS transition).
    setTimeout(() => {
      let prize = '';
      if (r.dry_run) {
        prize = ' <span class="muted">(テストモード: pt は動いてません)</span>';
      } else if (r.reward > 0 && r.winner_user_id !== state.me?.id) {
        prize = ` <span class="text-primary">+${r.reward}pt</span>`;
      } else if (r.reward > 0) {
        prize = ' <span class="muted">(自分が当選: pt 移動なし)</span>';
      }
      let html = `🎯 <span style="color:var(--primary); font-size:18px">${escapeHtml(r.winner_name)}</span> さん!${prize}`;
      // In test mode, also show the would-be notification per participant so the
      // user can sanity-check the message text before doing it for real.
      if (r.dry_run && Array.isArray(r.notifications_preview)) {
        const rows = r.notifications_preview.map(n => `
          <div class="list-item" style="padding:6px 10px; ${n.is_winner ? 'border-left:3px solid var(--primary); background:#faf6ff' : ''}">
            <div class="grow">
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
    }, 14100);
  } catch (e) {
    toast('失敗: ' + e.message);
    document.getElementById('rl-spin').disabled = false;
    spinning = false;
  }
}

// /#/roulette/{id} — read-only result page. Linked from notification taps so
// every participant (winner or not) can see the wheel as it stopped, the
// member list, and the prize.
export async function renderRouletteResult({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/roulette" class="hint">← 新しいルーレットを回す</a>
      <h2 style="margin:6px 0 0">ルーレット結果</h2>
      <div id="rl-detail" class="muted" style="margin-top:8px">読み込み中…</div>
    </div>
    <div class="card" style="text-align:center" id="rl-detail-wheel-card" hidden>
      <svg id="rl-detail-wheel" viewBox="-150 -150 300 300" width="280" height="280" style="display:block; margin:0 auto"></svg>
      <div id="rl-detail-pointer" style="position:relative; margin-top:-280px; height:0">
        <div style="position:relative; top:-12px; text-align:center; font-size:22px">▼</div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">候補メンバー</h3>
      <div id="rl-detail-members" class="muted">—</div>
    </div>
  `;
  try {
    const r = await get('/api/roulettes/' + id);
    const wcard = document.getElementById('rl-detail-wheel-card');
    const detail = document.getElementById('rl-detail');
    const meId = state.me?.id;
    const prizeText = r.reward > 0
      ? (Number(r.winner_user_id) === Number(r.creator_user_id)
          ? ` (賞金 ${r.reward}pt · 主催者が当選なので移動なし)`
          : ` (+${r.reward}pt が ${escapeHtml(r.creator_name)} → ${escapeHtml(r.winner_name)})`)
      : '';
    detail.innerHTML = `
      <div class="bold" style="font-size:16px">${escapeHtml(r.title)}</div>
      <div class="meta">${escapeHtml(r.created_at)} · 起案 ${escapeHtml(r.creator_name)}</div>
      <div style="margin-top:8px; font-size:18px">
        🎯 当選: <span class=" bold text-primary">${escapeHtml(r.winner_name)}</span>
        ${Number(meId) === Number(r.winner_user_id) ? ' <span class="tag">あなた</span>' : ''}
      </div>
      <div class="muted" style="font-size:13px; margin-top:4px">候補 ${r.members.length} 人${prizeText}</div>`;
    // Draw the wheel stopped at the winner's slice (no animation, just position).
    drawStaticWheel(r);
    wcard.hidden = false;
    document.getElementById('rl-detail-members').innerHTML = r.members.map(m =>
      `<span class="presence-pill" style="${Number(m.id) === Number(r.winner_user_id) ? 'background:var(--primary-soft); border:1px solid var(--primary)' : ''}">
        ${avatarHtml(m.display_name, m.avatar_url, 'sm')}
        <span class="presence-pill-name">${escapeHtml(m.display_name)}</span>
      </span>`).join(' ');
  } catch (e) {
    document.getElementById('rl-detail').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function drawStaticWheel(r) {
  const svg = document.getElementById('rl-detail-wheel');
  if (!svg) return;
  const N = r.members.length;
  if (N < 2) {
    svg.innerHTML = `<circle cx="0" cy="0" r="140" fill="#e9eaee"></circle>`;
    return;
  }
  const sliceDeg = 360 / N;
  // Reuse the same slice-rendering math as the live wheel. Stop with the
  // pointer over the winner's slice by rotating the whole <svg> in CSS.
  const target = -(r.winner_index * sliceDeg + sliceDeg / 2);
  svg.style.transform = `rotate(${target}deg)`;
  const slices = r.members.map((u, i) => {
    const a0 = (i * sliceDeg - 90) * Math.PI / 180;
    const a1 = ((i + 1) * sliceDeg - 90) * Math.PI / 180;
    const x0 = 140 * Math.cos(a0), y0 = 140 * Math.sin(a0);
    const x1 = 140 * Math.cos(a1), y1 = 140 * Math.sin(a1);
    const large = sliceDeg > 180 ? 1 : 0;
    const color = SLICE_COLORS[i % SLICE_COLORS.length];
    const path = `M 0 0 L ${x0.toFixed(1)} ${y0.toFixed(1)} A 140 140 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
    const am = ((i + 0.5) * sliceDeg - 90) * Math.PI / 180;
    const ax = 95 * Math.cos(am), ay = 95 * Math.sin(am);
    const tx = 60 * Math.cos(am), ty = 60 * Math.sin(am);
    const ROT = (i + 0.5) * sliceDeg;
    const initial = (u.display_name || '?').trim().charAt(0).toUpperCase();
    const compact = (u.display_name || '?').length > 5 ? u.display_name.slice(0, 4) + '…' : (u.display_name || '?');
    const r2 = 16;
    const clipId = `rl-clip-d-${u.id}`;
    const isWinner = Number(u.id) === Number(r.winner_user_id);
    const winnerRing = isWinner
      ? `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${r2 + 3}" fill="none" stroke="#ffd700" stroke-width="3"></circle>` : '';
    const avatar = u.avatar_url
      ? `<defs><clipPath id="${clipId}"><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${r2}"></circle></clipPath></defs>
         <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${r2}" fill="white" stroke="white" stroke-width="2"></circle>
         <image href="${escapeHtml(u.avatar_url)}" x="${(ax - r2).toFixed(1)}" y="${(ay - r2).toFixed(1)}" width="${r2 * 2}" height="${r2 * 2}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"></image>${winnerRing}`
      : `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${r2}" fill="white" stroke="white" stroke-width="2"></circle>
         <text x="${ax.toFixed(1)}" y="${(ay + 5).toFixed(1)}" text-anchor="middle" font-size="16" font-weight="700" fill="${color}">${escapeHtml(initial)}</text>${winnerRing}`;
    return `
      <path d="${path}" fill="${color}" stroke="white" stroke-width="2"></path>
      ${avatar}
      <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
            font-size="10" fill="white" font-weight="700"
            transform="rotate(${ROT} ${tx.toFixed(1)} ${ty.toFixed(1)})">${escapeHtml(compact)}</text>`;
  }).join('');
  svg.innerHTML = `${slices}<circle cx="0" cy="0" r="14" fill="white" stroke="#999" stroke-width="2"></circle>`;
}

// Synthesizes the spin's tick + ding entirely from oscillators so we don't
// have to ship audio assets. Ticks fire at the exact instants when each slice
// boundary crosses the pointer — computed by inverting the same CSS
// cubic-bezier(.22, .04, .08, 1) that drives the visual rotation.
function playSpinSounds(sliceCount, totalRotationDeg) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const totalSec = 14;
  const sliceDeg = 360 / sliceCount;
  const totalRot = Math.abs(totalRotationDeg);   // direction doesn't matter for tick timing
  const numCrossings = Math.floor(totalRot / sliceDeg);
  const invBezier = bezierTimeForOutput(0.22, 0.04, 0.08, 1);
  for (let i = 1; i <= numCrossings; i++) {
    const rotDeg = i * sliceDeg;
    const y = rotDeg / totalRot;        // fraction of total rotation traversed
    const x = invBezier(y);             // timeline fraction at which the bezier hits that y
    schedule(ctx, x * totalSec, () => tick(ctx));
  }
  schedule(ctx, totalSec, () => ding(ctx));
  // Tear down once the last sound is done playing.
  setTimeout(() => { try { ctx.close(); } catch (_) {} }, (totalSec + 1.5) * 1000);
}

// Invert the CSS cubic-bezier(p1x, p1y, p2x, p2y) with endpoints (0,0),(1,1):
// given a desired output y, return the timeline x such that the bezier maps
// x → y. Binary-searches the curve parameter u (≈30 iterations is plenty for
// audio-grade precision).
function bezierTimeForOutput(p1x, p1y, p2x, p2y) {
  return (yTarget) => {
    if (yTarget <= 0) return 0;
    if (yTarget >= 1) return 1;
    let lo = 0, hi = 1;
    for (let it = 0; it < 30; it++) {
      const u = (lo + hi) / 2;
      const v = 1 - u;
      // y(u) = 3v²u·p1y + 3v·u²·p2y + u³
      const yu = 3 * v * v * u * p1y + 3 * v * u * u * p2y + u * u * u;
      if (yu < yTarget) lo = u; else hi = u;
    }
    const u = (lo + hi) / 2;
    const v = 1 - u;
    return 3 * v * v * u * p1x + 3 * v * u * u * p2x + u * u * u;
  };
}

function schedule(ctx, sec, fn) { setTimeout(fn, sec * 1000); }

function tick(ctx) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.connect(g).connect(ctx.destination);
  osc.type = 'square';
  osc.frequency.value = 880;
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0.08, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  osc.start(now);
  osc.stop(now + 0.05);
}

function ding(ctx) {
  // Two-note 'taa-da' — root + perfect fifth above.
  const root = 988;   // ~B5
  [root, root * 1.5].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g).connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = ctx.currentTime + i * 0.18;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
    osc.start(start);
    osc.stop(start + 0.75);
  });
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
        ? ` <span class=" bold text-primary">+${r.reward}pt</span>`
        : '';
      return `
        <div class="list-item">
          <div class="grow">
            <div class="bold">${escapeHtml(r.title)}${rewardTag}</div>
            <div class="meta">候補 ${r.member_ids.length} 人 · ${escapeHtml(r.created_at)} · 起案 ${escapeHtml(r.creator_name)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:6px">
            ${avatarHtml(r.winner_name, r.winner_avatar_url, 'sm')}
            <span class=" bold text-primary">${escapeHtml(r.winner_name)}</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('rl-history').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
