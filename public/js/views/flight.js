// v586 フライト 応援 アプリ (完全オフライン)。
//   出発時刻 と 到着時刻 を 入力すると、 全体の 何% 進んだか / 残り時間 /
//   経過時間 を 大きく可視化。 機内 (ネット無し) で 動く前提。
//   設定は localStorage に 保存 (= ブラウザ閉じても 復元)。
//   Wake Lock API で 画面が 消えないように。

import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

const KEY = 'labpay-flight-config';

function loadConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}
function saveConfig(c) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (_) {}
}
function clearConfig() {
  try { localStorage.removeItem(KEY); } catch (_) {}
}

let tickTimer = null;
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { /* released by system */ });
  } catch (_) {}
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch (_) {}
  wakeLock = null;
}

function fmtHM(ms) {
  if (ms < 0) return '0:00';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}:${String(m).padStart(2, '0')}`;
}
function fmtHMS(ms) {
  if (ms < 0) return '0:00:00';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function renderFlight() {
  // Wake lock release on navigation
  window.addEventListener('hashchange', releaseWakeLock, { once: true });

  const app = document.getElementById('app');
  const cfg = loadConfig();
  if (!cfg) {
    renderSetup(app);
    return;
  }
  renderProgress(app, cfg);
}

function renderSetup(app) {
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 6px">✈️ フライト応援</h2>
      <p class="hint" style="font-size:13px">
        出発 と 到着 を 入力すると、 進捗 / 残り時間 を 大きく 可視化します。
        オフライン 対応 (機内で動きます)。 画面は 自動で 消えません。
      </p>
      <label style="display:block; margin-top:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">出発 (現地時刻)</div>
        <input id="fl-dep" type="datetime-local" class="input">
      </label>
      <label style="display:block; margin-top:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">到着 (現地時刻)</div>
        <input id="fl-arr" type="datetime-local" class="input">
      </label>
      <label style="display:block; margin-top:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">便名 (任意)</div>
        <input id="fl-name" class="input" maxlength="40" placeholder="例: NH106">
      </label>
      <label style="display:block; margin-top:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">区間 (任意)</div>
        <input id="fl-route" class="input" maxlength="60" placeholder="例: 羽田 → サンフランシスコ">
      </label>
      <div style="margin-top:14px; display:flex; gap:8px; justify-content:flex-end">
        <button id="fl-start" class="btn primary">開始</button>
      </div>
    </div>
  `;
  document.getElementById('fl-start').addEventListener('click', () => {
    const dep = document.getElementById('fl-dep').value;
    const arr = document.getElementById('fl-arr').value;
    if (!dep || !arr) { toast('出発 と 到着 を 入力してください'); return; }
    const depMs = new Date(dep.replace(' ', 'T')).getTime();
    const arrMs = new Date(arr.replace(' ', 'T')).getTime();
    if (!(arrMs > depMs)) { toast('到着は 出発より後 にしてください'); return; }
    const cfg = {
      dep: depMs,
      arr: arrMs,
      name:  document.getElementById('fl-name').value.trim(),
      route: document.getElementById('fl-route').value.trim(),
    };
    saveConfig(cfg);
    renderFlight();
  });
}

function renderProgress(app, cfg) {
  app.innerHTML = `
    <div class="card" style="background:linear-gradient(180deg, #1e293b, #0f172a); color:#fff; padding:18px">
      <div style="display:flex; align-items:center; gap:10px">
        <div style="flex:1">
          <div class="bold" style="font-size:18px">${escapeHtml(cfg.name || '✈️ フライト')}</div>
          ${cfg.route ? `<div style="font-size:13px; opacity:0.8">${escapeHtml(cfg.route)}</div>` : ''}
        </div>
        <button id="fl-end" class="btn" style="background:#ef4444; color:#fff; border:none">終了</button>
      </div>

      <div style="text-align:center; margin:24px 0 8px">
        <div id="fl-pct" style="font-size:72px; font-weight:900; line-height:1; text-shadow:0 2px 10px rgba(0,0,0,0.4)">—%</div>
        <div id="fl-state" style="font-size:14px; opacity:0.85; margin-top:6px">—</div>
      </div>

      <div style="height:14px; background:rgba(255,255,255,0.15); border-radius:99px; overflow:hidden; margin:18px 0">
        <div id="fl-bar" style="height:100%; width:0%; background:linear-gradient(90deg, #fbbf24, #fb923c, #ef4444); transition:width 1s linear"></div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-top:14px">
        <div style="padding:10px; background:rgba(255,255,255,0.06); border-radius:8px; text-align:center">
          <div style="font-size:11px; opacity:0.7">経過</div>
          <div id="fl-elapsed" style="font-size:20px; font-weight:700; font-variant-numeric:tabular-nums">—</div>
        </div>
        <div style="padding:10px; background:rgba(255,255,255,0.06); border-radius:8px; text-align:center">
          <div style="font-size:11px; opacity:0.7">残り</div>
          <div id="fl-remaining" style="font-size:20px; font-weight:700; font-variant-numeric:tabular-nums">—</div>
        </div>
        <div style="padding:10px; background:rgba(255,255,255,0.06); border-radius:8px; text-align:center">
          <div style="font-size:11px; opacity:0.7">総時間</div>
          <div id="fl-total" style="font-size:20px; font-weight:700; font-variant-numeric:tabular-nums">—</div>
        </div>
      </div>

      <div style="margin-top:14px; padding:10px; background:rgba(255,255,255,0.06); border-radius:8px; font-size:13px">
        <div style="display:flex; justify-content:space-between"><span>🛫 離陸</span><span id="fl-dep">—</span></div>
        <div style="display:flex; justify-content:space-between; margin-top:2px"><span>🛬 到着</span><span id="fl-arr">—</span></div>
      </div>

      <div id="fl-encourage" style="margin-top:14px; padding:10px; background:rgba(255,255,255,0.08); border-radius:8px; font-size:14px; text-align:center; line-height:1.5"></div>
    </div>
  `;
  document.getElementById('fl-end').addEventListener('click', () => {
    if (!confirm('フライト 応援を 終了しますか?')) return;
    releaseWakeLock();
    clearConfig();
    renderFlight();
  });
  // 初期描画 + ティック開始
  requestWakeLock();
  paintProgress(cfg);
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!document.getElementById('fl-pct')) {
      clearInterval(tickTimer); tickTimer = null;
      releaseWakeLock();
      return;
    }
    paintProgress(cfg);
  }, 1000);
}

const ENCOURAGE_MESSAGES = [
  { pct: [0, 10],   msg: ['🌟 出発おつかれさま!', '✈️ 良いフライトを', '🛫 安全運航 で 行きましょう'] },
  { pct: [10, 25],  msg: ['📚 本を 開く 時間', '🎧 お気に入りの 曲 を', '😴 一旦 眠るのも 良いかも'] },
  { pct: [25, 50],  msg: ['💪 半分前 まで 来ました', '🍽 機内食 を楽しんで', '☕ 水分 補給 を 忘れずに'] },
  { pct: [50, 65],  msg: ['🎉 折り返し!', '✨ 後半戦 スタート', '🌍 もう半分 来ました'] },
  { pct: [65, 85],  msg: ['🏁 ラスト 1/3', '🌟 もう少し!', '✈️ もうすぐ 到着 です'] },
  { pct: [85, 99],  msg: ['🛬 着陸態勢 へ', '🎊 もう ほぼ 到着!', '⛰ 街並み が 見えてくる頃'] },
  { pct: [99, 1000], msg: ['🎉 到着 おめでとうございます!', '🛬 着陸 完了'] },
];

function pickEncourage(pct) {
  for (const e of ENCOURAGE_MESSAGES) {
    if (pct >= e.pct[0] && pct < e.pct[1]) {
      const i = Math.floor(Date.now() / 60000) % e.msg.length; // 1 分 ごとに ローテ
      return e.msg[i];
    }
  }
  return '';
}

function paintProgress(cfg) {
  const total = cfg.arr - cfg.dep;
  const now = Date.now();
  const elapsed = Math.max(0, now - cfg.dep);
  const remaining = Math.max(0, cfg.arr - now);
  const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const $ = (id) => document.getElementById(id);
  if (!$('fl-pct')) return;
  $('fl-pct').textContent = pct.toFixed(1) + '%';
  $('fl-bar').style.width = pct + '%';
  $('fl-elapsed').textContent = fmtHMS(elapsed);
  $('fl-remaining').textContent = fmtHM(remaining);
  $('fl-total').textContent = fmtHM(total);
  $('fl-dep').textContent = new Date(cfg.dep).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
  $('fl-arr').textContent = new Date(cfg.arr).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
  let stateText;
  if (now < cfg.dep) stateText = `🛫 出発まで ${fmtHM(cfg.dep - now)}`;
  else if (pct >= 100) stateText = '🛬 到着しました!';
  else stateText = '✈️ 飛行中';
  $('fl-state').textContent = stateText;
  $('fl-encourage').textContent = pickEncourage(pct);
}
