// /#/text-roulette — 任意テキストでの汎用ルーレット (「どこ行く」 「何食べる」 等)。
// メンバー連動の通知付き roulette とは別物で、 サーバには何も保存しない
// 純粋なクライアント側ツール。 入力履歴だけ localStorage に保存する。

import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

const SLICE_COLORS = [
  '#7b3fbf', '#0e7c63', '#b54708', '#1f5238', '#4a106d', '#b71c50',
  '#8a2a23', '#3c5a99', '#cd853f', '#2e7d32', '#5e35b1', '#c2185b',
];

const PRESETS_KEY = 'labpay-text-roulette-presets';
const LAST_KEY    = 'labpay-text-roulette-last';

let options = [];     // 現在の候補配列
let spinning = false;
let lastWinner = null;

function loadPresets() {
  try {
    const j = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
    return Array.isArray(j) ? j.filter(p => p && typeof p.name === 'string' && Array.isArray(p.options)) : [];
  } catch { return []; }
}
function savePresets(arr) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(arr)); } catch {}
}
function loadLast() {
  try {
    const j = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    return Array.isArray(j) ? j : null;
  } catch { return null; }
}
function saveLast(arr) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(arr)); } catch {}
}

export async function renderTextRoulette() {
  const last = loadLast();
  options = last && last.length ? last.slice() : ['北京餃子', '丸亀製麺', 'ラーメン', '回転寿司'];
  lastWinner = null;
  spinning = false;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0">どこ行くルーレット</h2>
      <p class="card-subtitle">
        昼飯どこ行く / 何食べる / どの店行く みたいなのを一発で決めるためのやつ。
        候補を 1 行ずつ書いて、 回すボタン。 メンバー連動の <a href="#/roulette">通常ルーレット</a> とは別物 — サーバには何も残らない。
      </p>
    </div>

    <div class="card">
      <label class="field">
        <span class="lbl">候補 (1 行に 1 つ)</span>
        <textarea id="tr-options" rows="6" placeholder="例:&#10;一蘭&#10;すき家&#10;松屋&#10;サイゼリヤ">${escapeHtml(options.join('\n'))}</textarea>
      </label>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:4px">
        <button id="tr-save-preset" class="btn">この候補をプリセットに保存</button>
        <button id="tr-clear" class="btn">クリア</button>
      </div>
      <div id="tr-presets" class="row" style="gap:6px; flex-wrap:wrap; margin-top:6px"></div>
    </div>

    <div class="card" style="text-align:center">
      <div id="tr-wheel-wrap" style="position:relative; width:280px; height:280px; margin:0 auto">
        <div style="position:absolute; top:-4px; left:50%; transform:translateX(-50%); font-size:24px; z-index:2">▼</div>
        <svg id="tr-wheel" viewBox="-150 -150 300 300" width="280" height="280"
             style="display:block; transition:transform 14s cubic-bezier(.22,.04,.08,1)">
          <circle cx="0" cy="0" r="140" fill="#e9eaee"></circle>
        </svg>
      </div>
      <button id="tr-spin" class="primary" style="margin-top:14px; min-width:160px">回す!</button>
      <div id="tr-result" style="margin-top:10px; min-height:24px; font-weight:700; font-size:18px"></div>
    </div>
  `;
  document.getElementById('tr-options').addEventListener('input', onOptionsChange);
  document.getElementById('tr-spin').addEventListener('click', onSpin);
  document.getElementById('tr-clear').addEventListener('click', () => {
    document.getElementById('tr-options').value = '';
    options = [];
    redrawWheel();
  });
  document.getElementById('tr-save-preset').addEventListener('click', onSavePreset);
  renderPresets();
  redrawWheel();
}

function onOptionsChange(ev) {
  options = parseOptions(ev.target.value);
  redrawWheel();
}

function parseOptions(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .slice(0, 30);   // 30 個も並んだら読めない。 上限。
}

function renderPresets() {
  const root = document.getElementById('tr-presets');
  if (!root) return;
  const presets = loadPresets();
  if (!presets.length) {
    root.innerHTML = '<div class="hint-sm">プリセット無し。 候補を整えて 「保存」 で覚えられる。</div>';
    return;
  }
  root.innerHTML = presets.map((p, i) => `
    <span style="display:inline-flex; align-items:center; gap:2px">
      <button type="button" class="btn" data-preset="${i}" style="padding:2px 10px; font-size:12px">${escapeHtml(p.name)}</button>
      <button type="button" data-preset-rm="${i}" style="border:none; background:none; color:var(--muted); cursor:pointer; padding:0 2px; font-size:11px" title="このプリセットを削除">×</button>
    </span>`).join('');
  root.querySelectorAll('[data-preset]').forEach(b => {
    b.addEventListener('click', () => {
      const p = presets[Number(b.dataset.preset)];
      if (!p) return;
      document.getElementById('tr-options').value = p.options.join('\n');
      options = p.options.slice();
      redrawWheel();
    });
  });
  root.querySelectorAll('[data-preset-rm]').forEach(b => {
    b.addEventListener('click', () => {
      const idx = Number(b.dataset.presetRm);
      const arr = loadPresets();
      const name = arr[idx]?.name;
      if (!confirm(`プリセット 「${name}」 を消しますか?`)) return;
      arr.splice(idx, 1);
      savePresets(arr);
      renderPresets();
    });
  });
}

function onSavePreset() {
  if (!options.length) { toast('保存する候補がありません'); return; }
  const name = (prompt('プリセット名を入力 (例: 昼飯, 飲み屋)') || '').trim();
  if (!name) return;
  if (name.length > 40) { toast('名前が長すぎます'); return; }
  const arr = loadPresets();
  const existing = arr.findIndex(p => p.name === name);
  if (existing >= 0) {
    if (!confirm(`「${name}」 は既にあります。 上書きしますか?`)) return;
    arr[existing] = { name, options: options.slice() };
  } else {
    if (arr.length >= 12) { toast('プリセット上限 (12 個) に達しました'); return; }
    arr.push({ name, options: options.slice() });
  }
  savePresets(arr);
  renderPresets();
  toast('保存しました');
}

function compact(s, n) {
  s = String(s || '');
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function redrawWheel() {
  const svg = document.getElementById('tr-wheel');
  if (!svg) return;
  svg.style.transition = 'none';
  svg.style.transform = 'rotate(0deg)';

  if (options.length < 2) {
    svg.innerHTML = `
      <circle cx="0" cy="0" r="140" fill="#e9eaee"></circle>
      <text x="0" y="5" text-anchor="middle" font-size="13" fill="#666">2 つ以上書いてください</text>`;
    return;
  }
  const N = options.length;
  const sliceDeg = 360 / N;
  // 候補数が増えると文字長が読めないので動的に短縮。
  const maxLen = N <= 4 ? 12 : N <= 8 ? 8 : N <= 14 ? 5 : 4;

  const slices = options.map((label, i) => {
    const a0 = (i * sliceDeg - 90) * Math.PI / 180;
    const a1 = ((i + 1) * sliceDeg - 90) * Math.PI / 180;
    const x0 = 140 * Math.cos(a0), y0 = 140 * Math.sin(a0);
    const x1 = 140 * Math.cos(a1), y1 = 140 * Math.sin(a1);
    const large = sliceDeg > 180 ? 1 : 0;
    const color = SLICE_COLORS[i % SLICE_COLORS.length];
    const path = `M 0 0 L ${x0.toFixed(1)} ${y0.toFixed(1)} A 140 140 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
    const am = ((i + 0.5) * sliceDeg - 90) * Math.PI / 180;
    const tx = 80 * Math.cos(am), ty = 80 * Math.sin(am);
    const ROT = (i + 0.5) * sliceDeg;
    return `
      <path d="${path}" fill="${color}" stroke="white" stroke-width="2"></path>
      <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
            font-size="12" fill="white" font-weight="700"
            transform="rotate(${ROT} ${tx.toFixed(1)} ${ty.toFixed(1)})">${escapeHtml(compact(label, maxLen))}</text>`;
  }).join('');
  svg.innerHTML = `${slices}<circle cx="0" cy="0" r="14" fill="white" stroke="#999" stroke-width="2"></circle>`;
}

async function onSpin() {
  if (spinning) return;
  if (options.length < 2) { toast('2 つ以上の候補が必要です'); return; }
  spinning = true;
  document.getElementById('tr-spin').disabled = true;
  document.getElementById('tr-result').textContent = '';
  saveLast(options.slice());

  const N = options.length;
  const sliceDeg = 360 / N;
  // crypto.getRandomValues で偏りの少ない一様乱数。 0..N-1 の整数。
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const winnerIndex = buf[0] % N;
  lastWinner = options[winnerIndex];

  // 既存の roulette とおなじ視覚 / 音響パターン。
  const target = -(winnerIndex * sliceDeg + sliceDeg / 2);
  const total = 360 * 12 + target;
  const svg = document.getElementById('tr-wheel');
  svg.style.transition = 'transform 14s cubic-bezier(.22,.04,.08,1)';
  requestAnimationFrame(() => { svg.style.transform = `rotate(${total}deg)`; });
  playSpinSounds(N, total);
  setTimeout(() => {
    document.getElementById('tr-result').innerHTML =
      `🎯 <span style="color:var(--primary); font-size:22px">${escapeHtml(lastWinner)}</span>`;
    document.getElementById('tr-spin').disabled = false;
    spinning = false;
  }, 14100);
}

// ---- 音響 (roulette.js と同じ手法。 重複だが import 関係を増やしたくないので copy。)
function playSpinSounds(sliceCount, totalRotationDeg) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const totalSec = 14;
  const sliceDeg = 360 / sliceCount;
  const totalRot = Math.abs(totalRotationDeg);
  const numCrossings = Math.floor(totalRot / sliceDeg);
  const invBezier = bezierTimeForOutput(0.22, 0.04, 0.08, 1);
  for (let i = 1; i <= numCrossings; i++) {
    const rotDeg = i * sliceDeg;
    const y = rotDeg / totalRot;
    const x = invBezier(y);
    setTimeout(() => tick(ctx), x * totalSec * 1000);
  }
  setTimeout(() => ding(ctx), totalSec * 1000);
  setTimeout(() => { try { ctx.close(); } catch (_) {} }, (totalSec + 1.5) * 1000);
}
function bezierTimeForOutput(p1x, p1y, p2x, p2y) {
  return (yTarget) => {
    if (yTarget <= 0) return 0;
    if (yTarget >= 1) return 1;
    let lo = 0, hi = 1;
    for (let it = 0; it < 30; it++) {
      const u = (lo + hi) / 2;
      const v = 1 - u;
      const yu = 3 * v * v * u * p1y + 3 * v * u * u * p2y + u * u * u;
      if (yu < yTarget) lo = u; else hi = u;
    }
    const u = (lo + hi) / 2;
    const v = 1 - u;
    return 3 * v * v * u * p1x + 3 * v * u * u * p2x + u * u * u;
  };
}
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
  const root = 988;
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
