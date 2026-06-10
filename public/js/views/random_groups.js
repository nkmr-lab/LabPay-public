// /#/random-groups — メンバーから N 個のチームをランダム生成。
// 学年 / 性別 を「できるだけ均等」に配慮するオプション付き (バケット分け
// → 各バケット内シャッフル → ラウンドロビンで分配)。純粋なローカル計算で、
// DB には書き込まない。結果は「このメンバーでグループ一括作成」で
// 「グループ1」 「グループ2」 … という名前で順に実体化できる。

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast, refreshHasGroups } from '../app.js';

const GRADE_ORDER = ['D','M2','M1','B4','B3',''];

let allUsers = [];
const picked = new Set();

export async function renderRandomGroups() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/apps" class="hint">← アプリ</a>
      <h2 style="margin:6px 0 0">ランダムグループ生成</h2>
    </div>

    <div class="card">
      <h3>メンバーを選ぶ</h3>
      <div id="rg-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px"></div>
      <div id="rg-picker" class="row" style="gap:6px; flex-wrap:wrap"></div>
      <div id="rg-count" class="muted" style="font-size:12px; margin-top:6px">0 人選択中</div>
    </div>

    <div class="card">
      <h3>条件</h3>
      <label class="field">
        <span class="lbl">名前 (空欄なら日付で自動)</span>
        <input type="text" id="rg-title" maxlength="200" placeholder="例: 新歓 班分け">
      </label>
      <label class="field">
        <span class="lbl">グループ数</span>
        <input type="number" id="rg-n" min="2" max="20" value="2" style="max-width:120px">
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:6px 0">
        <span class="switch"><input type="checkbox" id="rg-grade"><span class="slider"></span></span>
        <span>学年を考慮 <span class="hint-sm">— 各グループに学年がばらつくようにする</span></span>
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:6px 0">
        <span class="switch"><input type="checkbox" id="rg-gender"><span class="slider"></span></span>
        <span>男女を考慮 <span class="hint-sm">— 各グループに男女がばらつくようにする</span></span>
      </label>
      <div class="row" style="gap:6px; margin-top:8px">
        <button id="rg-go" class="primary">ランダムに分ける</button>
        <button id="rg-reshuffle" disabled>再シャッフル</button>
      </div>
    </div>

    <div class="card" id="rg-result-card" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h3 id="rg-result-title" class="row-title">結果</h3>
      </div>
      <div class="row" style="gap:6px; margin-bottom:10px; flex-wrap:wrap">
        <button id="rg-bulk-create" class="primary">このメンバーでグループ一括作成</button>
        <button id="rg-notify">📢 結果を全員に通知</button>
      </div>
      <div id="rg-result"></div>
    </div>
  `;
  await populatePicker();
  document.getElementById('rg-go').addEventListener('click', () => runShuffle());
  document.getElementById('rg-reshuffle').addEventListener('click', () => runShuffle());
  document.getElementById('rg-notify').addEventListener('click', () => onNotifyAll());
  document.getElementById('rg-bulk-create').addEventListener('click', () => onBulkCreate());
}

// Last successful partition result, kept here so 「全員に通知」 can re-use it
// without re-shuffling.
let lastResult = null;
let lastTitle = '';

function autoTitle() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `グループ分け ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function populatePicker() {
  const u = await get('/api/users');
  picked.clear();
  allUsers = [...u.items].sort((a, b) => {
    const ga = GRADE_ORDER.indexOf(a.grade || '');
    const gb = GRADE_ORDER.indexOf(b.grade || '');
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) ||
      (a.display_name || '').localeCompare(b.display_name || '', 'ja');
  });

  const grades = [...new Set(allUsers.map(u => u.grade).filter(Boolean))]
    .sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  const bulk = document.getElementById('rg-bulk');
  bulk.innerHTML = `
    <button data-bulk="all"  class="btn">全員</button>
    ${grades.map(g => `<button data-bulk="grade:${g}" class="btn">${g}</button>`).join('')}
    <button data-bulk="gender:M" class="btn">男</button>
    <button data-bulk="gender:F" class="btn">女</button>
    <button data-bulk="clear" class="btn">クリア</button>
  `;
  bulk.querySelectorAll('[data-bulk]').forEach(b => {
    b.addEventListener('click', () => applyBulk(b.dataset.bulk));
  });

  const picker = document.getElementById('rg-picker');
  picker.innerHTML = allUsers.map(x => `
    <span class="rl-chip" data-uid="${x.id}">
      ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
      <span>${escapeHtml(x.display_name)}</span>
      ${x.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(x.grade)}]</span>` : ''}
    </span>`).join('');
  picker.querySelectorAll('.rl-chip').forEach(c => {
    c.addEventListener('click', () => togglePick(Number(c.dataset.uid)));
  });
  refreshChips();
}

function memberMatches(user, key) {
  if (key === 'all') return true;
  if (key.startsWith('grade:')) return (user.grade || '') === key.slice(6);
  if (key.startsWith('gender:')) return (user.gender || '') === key.slice(7);
  return false;
}

function applyBulk(key) {
  if (key === 'clear') { picked.clear(); refreshChips(); return; }
  const targets = allUsers.filter(u => memberMatches(u, key));
  const allOn = targets.every(u => picked.has(u.id));
  if (allOn) targets.forEach(u => picked.delete(u.id));
  else       targets.forEach(u => picked.add(u.id));
  refreshChips();
}

function togglePick(uid) {
  if (picked.has(uid)) picked.delete(uid);
  else picked.add(uid);
  refreshChips();
}

function refreshChips() {
  document.querySelectorAll('#rg-picker .rl-chip').forEach(c => {
    const on = picked.has(Number(c.dataset.uid));
    c.style.background = on ? 'var(--primary-soft, #efeafa)' : '';
    c.style.borderColor = on ? 'var(--primary)' : '';
  });
  document.getElementById('rg-count').textContent = `${picked.size} 人選択中`;
}

// ─── shuffling ────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Phase 1: bucket → round-robin で 大まかに均等に配置。
// Phase 2: ランダム 2-swap を 200 回試行し、 不均衡スコアが下がる時だけ
// 採用する貪欲法で安定解に近づける。 何の attribute を考えるかは
// considerGrade / considerGender / 常に size でカウント。
function partition(members, numGroups, considerGrade, considerGender) {
  const groups = phase1Initial(members, numGroups, considerGrade, considerGender);
  if (!considerGrade && !considerGender) {
    // size の変動だけなら round-robin で完璧均等。 swap 最適化 不要。
    return groups;
  }
  return phase2Swap(groups, considerGrade, considerGender, 200);
}

function phase1Initial(members, numGroups, considerGrade, considerGender) {
  if (!considerGrade && !considerGender) {
    const groups = Array.from({ length: numGroups }, () => []);
    shuffle(members).forEach((m, i) => groups[i % numGroups].push(m));
    return groups;
  }
  const buckets = new Map();
  for (const m of members) {
    const key = [
      considerGrade  ? (m.grade  || '_') : '',
      considerGender ? (m.gender || '_') : '',
    ].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }
  const groups = Array.from({ length: numGroups }, () => []);
  let cursor = 0;
  const ordered = [...buckets.values()].sort((a, b) => b.length - a.length);
  for (const arr of ordered) {
    shuffle(arr).forEach((m, i) => groups[(cursor + i) % numGroups].push(m));
    cursor = (cursor + arr.length) % numGroups;
  }
  return groups;
}

// 全 group × 全 attribute 値 のカウントが平均にどれだけ近いかを 2 乗誤差で
// 評価。 小さいほど均等。 size の変動も常に評価に含める。
function imbalanceScore(groups, considerGrade, considerGender) {
  let score = 0;
  const addAttr = (getter) => {
    const values = new Set();
    groups.forEach(g => g.forEach(m => values.add(getter(m))));
    for (const v of values) {
      const counts = groups.map(g => g.reduce((s, m) => s + (getter(m) === v ? 1 : 0), 0));
      const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
      score += counts.reduce((s, c) => s + (c - mean) ** 2, 0);
    }
  };
  if (considerGrade)  addAttr(m => m.grade  || '_');
  if (considerGender) addAttr(m => m.gender || '_');
  const sizes = groups.map(g => g.length);
  const meanSize = sizes.reduce((s, c) => s + c, 0) / sizes.length;
  score += sizes.reduce((s, c) => s + (c - meanSize) ** 2, 0);
  return score;
}

function phase2Swap(initial, considerGrade, considerGender, iterations) {
  const current = initial.map(g => g.slice());
  let best = imbalanceScore(current, considerGrade, considerGender);
  for (let it = 0; it < iterations; it++) {
    if (best === 0) break; // 完全均等到達
    const gi = Math.floor(Math.random() * current.length);
    let gj = Math.floor(Math.random() * current.length);
    if (gi === gj) gj = (gj + 1) % current.length;
    if (!current[gi].length || !current[gj].length) continue;
    const mi = Math.floor(Math.random() * current[gi].length);
    const mj = Math.floor(Math.random() * current[gj].length);
    // try swap
    [current[gi][mi], current[gj][mj]] = [current[gj][mj], current[gi][mi]];
    const ns = imbalanceScore(current, considerGrade, considerGender);
    if (ns < best) {
      best = ns; // 採用
    } else {
      // 戻す
      [current[gi][mi], current[gj][mj]] = [current[gj][mj], current[gi][mi]];
    }
  }
  return current;
}

function runShuffle() {
  const n = Math.max(2, Math.min(20, Number(document.getElementById('rg-n').value) || 2));
  const considerGrade  = document.getElementById('rg-grade').checked;
  const considerGender = document.getElementById('rg-gender').checked;
  const ids = [...picked];
  if (ids.length < n) {
    toast(`メンバー ${ids.length} 人ではグループ数 ${n} に届きません`);
    return;
  }
  const members = allUsers.filter(u => picked.has(u.id));
  const groups = partition(members, n, considerGrade, considerGender);
  lastResult = groups;
  lastTitle = document.getElementById('rg-title').value.trim() || autoTitle();
  renderResult(groups, lastTitle);
  document.getElementById('rg-reshuffle').disabled = false;
}

function renderResult(groups, title) {
  document.getElementById('rg-result-card').hidden = false;
  document.getElementById('rg-result-title').textContent = title;
  const root = document.getElementById('rg-result');
  root.innerHTML = groups.map((g, idx) => {
    const counts = countByGrade(g);
    const memberHtml = g.map(m => `
      <span class="rl-chip" style="background:var(--primary-soft,#efeafa); border-color:var(--primary)">
        ${avatarHtml(m.display_name, m.avatar_url, 'sm')}
        <span>${escapeHtml(m.display_name)}</span>
        ${m.grade ? `<span class="muted" style="font-size:10px">[${escapeHtml(m.grade)}]</span>` : ''}
      </span>`).join('');
    return `
      <div class="card" style="margin:8px 0; background:#faf7fd">
        <div class="row center" style="margin-bottom:6px">
          <h4 class="row-title">グループ${idx + 1} <span class="hint-sm">(${g.length}人${counts ? ' · ' + counts : ''})</span></h4>
        </div>
        <div class="row" style="gap:6px; flex-wrap:wrap">${memberHtml}</div>
      </div>`;
  }).join('');
}

function countByGrade(members) {
  const counts = {};
  members.forEach(m => { const g = m.grade || '?'; counts[g] = (counts[g] || 0) + 1; });
  return GRADE_ORDER.filter(g => g && counts[g]).map(g => `${g}:${counts[g]}`).join(' ');
}

async function onNotifyAll() {
  if (!lastResult) { toast('まず分けてください'); return; }
  const title = lastTitle || autoTitle();
  const total = lastResult.reduce((s, g) => s + g.length, 0);
  if (!confirm(`「${title}」の結果を ${total} 人に通知します。よろしいですか?`)) return;
  const groups = lastResult.map(g => g.map(m => m.id));
  try {
    const r = await post('/api/random-groups/notify', { title, groups });
    toast(`${r.sent} 人に通知しました`);
  } catch (e) { toast('失敗: ' + e.message); }
}

// 「グループN」 という名前で全グループを順番に作成。 1 つでも失敗したら
// 進行状況を toast で報せつつ続行する。
async function onBulkCreate() {
  if (!lastResult || !lastResult.length) { toast('まず分けてください'); return; }
  const n = lastResult.length;
  if (!confirm(`グループ1〜グループ${n} の ${n} 個を一括作成します。よろしいですか?`)) return;
  let ok = 0;
  const errors = [];
  for (let i = 0; i < lastResult.length; i++) {
    const title = `グループ${i + 1}`;
    const memberIds = lastResult[i].map(m => m.id);
    try {
      await post('/api/groups', { title, member_ids: memberIds });
      ok++;
    } catch (e) {
      errors.push(`${title}: ${e.message}`);
    }
  }
  if (ok > 0) refreshHasGroups();
  if (errors.length === 0) {
    toast(`${ok} 個のグループを作成しました`);
    location.hash = '#/groups';
  } else {
    toast(`完了 ${ok}/${n}。 失敗: ${errors[0]}`);
  }
}
