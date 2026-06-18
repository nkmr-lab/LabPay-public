// /#/public-timer/:id — 認証 不要 で 表示 する 公開 タイマー (#256)。
// タブレット を 演台 に 置いて 学会 / 論文紹介 で 使う 想定。 残り 時間 を 大きく 表示。

import { escapeHtml } from '../router.js';
import { acquireWakeLock, releaseWakeLock } from '../wakelock.js';

let _tickTimer = null;
let _pollTimer = null;
let _state = null;
let _serverOffsetMs = 0;

function stopAll() {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function fmt(sec) {
  if (sec === null || sec === undefined) return '--:--';
  const neg = sec < 0;
  const s = Math.abs(Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (neg ? '+' : '') + `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

async function fetchState(id) {
  // 認証 不要 で 直接 取得 (X-Requested-With も 不要、 GET なので CSRF 対象 外)
  const r = await fetch(`/api/timers/${encodeURIComponent(id)}/public`, {
    headers: { 'X-Requested-With': 'labpay' },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function renderPublicTimer({ params }) {
  stopAll();
  const id = Number(params.id);
  // v678 #258 公開 タイマー の とき は topbar / tabs (LabPay の メニュー) を 隠す。
  //   タブレット に 開いて 演台 に 置く 用 途 で メニュー は 邪魔。
  const topbar = document.getElementById('topbar');
  const tabs   = document.getElementById('tabs');
  if (topbar) topbar.hidden = true;
  if (tabs)   tabs.hidden = true;
  const app = document.getElementById('app');
  app.innerHTML = `
    <style>
      body { background:#0b0b0d !important; color:#fff; margin:0 }
      #pt-wrap { display:flex; flex-direction:column; align-items:center; justify-content:center;
                 min-height:100vh; width:100vw; box-sizing:border-box; padding:2vw;
                 font-family:Inter, system-ui, sans-serif; overflow:hidden }
      #pt-title { font-size:clamp(16px, 3vw, 32px); margin-bottom:8px; opacity:0.85; text-align:center }
      /* v681 #261 数字 を できる だけ 大きく。 viewport 横幅 35% or 縦幅 90% の min で 決定、
       * 5 文字 (MM:SS) を 想定 して 横幅 が 切れない 範囲 で 最大化。 */
      #pt-time { font-size:min(35vw, 90vh); font-weight:900; font-family:ui-monospace, Menlo, monospace;
                 line-height:1; letter-spacing:-0.05em; transition:color 0.2s;
                 white-space:nowrap; text-align:center; width:100% }
      #pt-status { font-size:clamp(14px, 2vw, 22px); margin-top:14px; opacity:0.7; letter-spacing:0.04em; text-align:center }
      .bell-row { display:flex; gap:14px; margin-top:24px; font-size:clamp(12px, 1.5vw, 18px); opacity:0.55; flex-wrap:wrap; justify-content:center }
      .bell-row > div { padding:6px 12px; border:1px solid #444; border-radius:6px }
      .bell-row > div.cur { border-color:#fbbf24; color:#fbbf24; opacity:1 }
    </style>
    <div id="pt-wrap">
      <div id="pt-title">読み込み中…</div>
      <div id="pt-time">--:--</div>
      <div id="pt-status"></div>
      <div class="bell-row" id="pt-bells"></div>
    </div>
  `;
  // v683 #266 タブレット を 演台 に 置く 想定 なので 常時 wake lock を 取得
  acquireWakeLock('public-timer');
  try {
    const d = await fetchState(id);
    _state = d.timer;
    if (d.server_now) {
      const sn = Date.parse(String(d.server_now).replace(' ', 'T'));
      _serverOffsetMs = sn - Date.now();
    }
    render();
    // 1 秒 で 表示 を 更新
    _tickTimer = setInterval(render, 1000);
    // 5 秒 ごと に server から 状態 を 再 fetch (操作 が 別 端末 で あった とき も 追従)
    _pollTimer = setInterval(async () => {
      try {
        const d2 = await fetchState(id);
        _state = d2.timer;
        if (d2.server_now) {
          const sn = Date.parse(String(d2.server_now).replace(' ', 'T'));
          _serverOffsetMs = sn - Date.now();
        }
      } catch (_) {}
    }, 5000);
  } catch (e) {
    document.getElementById('pt-title').textContent = 'エラー: ' + e.message;
  }
  // ページ 離脱 で 背景 + chrome を 戻す + wake lock 解放
  window.addEventListener('hashchange', () => {
    if (!location.hash.includes('/public-timer/' + id)) {
      stopAll();
      releaseWakeLock('public-timer');
      document.body.style.background = '';
      // v678 #258 ログイン 済 なら chrome を 戻す (renderChrome が 再 dispatch 時 に 呼ぶ)
      const topbar = document.getElementById('topbar');
      const tabs   = document.getElementById('tabs');
      if (topbar) topbar.hidden = false;
      if (tabs)   tabs.hidden = false;
    }
  }, { once: true });
}

function render() {
  if (!_state) return;
  const t = _state;
  document.getElementById('pt-title').textContent = t.title || '🛎 タイマー';

  // v682 #264 視覚 的 「終了」 は 最後 の ベル 位置 (server 側 の duration が 端 で 終わって も、 ベル が 続く なら そこ まで)
  const bells = [t.bell1_seconds, t.bell2_seconds, t.bell3_seconds].filter(b => b !== null && b !== undefined && b > 0);
  const maxBellSec = bells.length ? Math.max(...bells) : 0;
  const visualEndSec = Math.max(maxBellSec, t.duration_seconds || 0);
  let remaining = null;
  if (t.status === 'running' && t.started_at) {
    const started = Date.parse(String(t.started_at).replace(' ', 'T'));
    const visualEnd = started + visualEndSec * 1000;
    remaining = (visualEnd - (Date.now() + _serverOffsetMs)) / 1000;
  } else if (t.status === 'paused') {
    remaining = Number(t.remaining_seconds) || 0;
  } else if (t.status === 'done' && t.started_at) {
    // done で も 視覚 的 終了 まで 表示 続ける
    const started = Date.parse(String(t.started_at).replace(' ', 'T'));
    const visualEnd = started + visualEndSec * 1000;
    remaining = (visualEnd - (Date.now() + _serverOffsetMs)) / 1000;
  }

  const elTime = document.getElementById('pt-time');
  elTime.textContent = fmt(remaining);

  // 色: 残り 60秒以下 で 赤、 30秒以下 で 明赤、 終了 で グレー
  let color = '#fff';
  if (t.status === 'done' || (remaining !== null && remaining <= 0)) color = '#9ca3af';
  else if (remaining !== null && remaining <= 30) color = '#ef4444';
  else if (remaining !== null && remaining <= 60) color = '#f59e0b';
  elTime.style.color = color;

  const statusLabel = {
    running: '▶ 進行中',
    paused: '⏸ 一時停止',
    done: '🏁 終了',
    cancelled: '❌ キャンセル',
  }[t.status] || t.status;
  document.getElementById('pt-status').textContent = statusLabel;

  // ベル 位置 表示 (= 現在 通過 した もの は ハイライト)
  const bells = [t.bell1_seconds, t.bell2_seconds, t.bell3_seconds].filter(b => b !== null && b !== undefined && b > 0);
  const totalDur = t.duration_seconds || 0;
  const elapsed = totalDur - (remaining ?? 0);
  document.getElementById('pt-bells').innerHTML = bells.map((b, i) => {
    const isEnd = (i + 1) === t.end_bell_index;
    const cur = elapsed >= b;
    const min = (b / 60).toFixed(b % 60 === 0 ? 0 : 1);
    return `<div class="${cur ? 'cur' : ''}">${i + 1}鈴 ${min}分${isEnd ? ' (終了)' : ''}</div>`;
  }).join('');
}
