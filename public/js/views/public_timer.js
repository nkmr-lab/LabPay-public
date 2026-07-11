// /#/public-timer/:id — 認証不要で表示する公開タイマー (#256)。
// タブレットを演台に置いて学会 / 論文紹介で使う想定。残り時間を大きく表示。

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
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

async function fetchState(id) {
  // 認証不要で直接取得 (X-Requested-With も不要、 GET なので CSRF 対象外)
  const r = await fetch(`/api/timers/${encodeURIComponent(id)}/public`, {
    headers: { 'X-Requested-With': 'labpay' },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function renderPublicTimer({ params }) {
  stopAll();
  const id = Number(params.id);
  // v678 #258 公開タイマーのときは topbar / tabs (LabPay のメニュー) を隠す。
  //   タブレットに開いて演台に置く用途でメニューは邪魔。
  const topbar = document.getElementById('topbar');
  const tabs   = document.getElementById('tabs');
  if (topbar) topbar.hidden = true;
  if (tabs)   tabs.hidden = true;
  const app = document.getElementById('app');
  app.innerHTML = `
    <style>
      /* v685 #268 横が切れる bug 修正。 style.css の main#app { max-width:720px; padding:14px;
       * overflow-x:hidden } が 100vw を削っていた。公開タイマーでは viewport 全幅を使うため
       * 親 #app の制約を override。 */
      body { background:#0b0b0d !important; color:#fff; margin:0 }
      main#app { max-width:none !important; padding:0 !important; margin:0 !important;
                 width:100vw !important; overflow:visible !important }
      #pt-wrap { display:flex; flex-direction:column; align-items:center; justify-content:center;
                 min-height:100vh; width:100vw; box-sizing:border-box; padding:1vw;
                 font-family:Inter, system-ui, sans-serif; overflow:hidden }
      #pt-title { font-size:clamp(16px, 3vw, 32px); margin-bottom:8px; opacity:0.85; text-align:center }
      /* 5 文字 (MM:SS) or 6 文字 (+MM:SS) を想定。 monospace digit width ≈ 0.6em で
       * 6 文字だと約 3.6em 必要。 viewport 横 100vw / 3.6 ≈ 27vw が上限。安全マージン取って 26vw。 */
      #pt-time { font-size:min(26vw, 80vh); font-weight:900; font-family:ui-monospace, Menlo, monospace;
                 line-height:1; letter-spacing:-0.04em; transition:color 0.2s;
                 white-space:nowrap; text-align:center; width:100%; max-width:100vw }
      #pt-status { font-size:clamp(14px, 2vw, 22px); margin-top:14px; opacity:0.7; letter-spacing:0.04em; text-align:center }
      .bell-row { display:flex; gap:14px; margin-top:24px; font-size:clamp(12px, 1.5vw, 18px); opacity:0.55; flex-wrap:wrap; justify-content:center }
      .bell-row > div { padding:6px 12px; border:1px solid #444; border-radius:6px }
      .bell-row > div.cur { border-color:#fbbf24; color:#fbbf24; opacity:1 }
      /* v728 #336 プログレスバー */
      #pt-bar-bg { width:80vw; max-width:1100px; height:clamp(10px, 1.6vw, 22px);
                   margin:18px 0 4px; border-radius:8px; overflow:hidden; position:relative; background:#222 }
      #pt-bar-fill { height:100%; width:0%; transition:width 0.4s linear; background:#3b82f6 }
    </style>
    <div id="pt-wrap">
      <div id="pt-title">読み込み中…</div>
      <div id="pt-time">--:--</div>
      <div id="pt-status"></div>
      <div id="pt-bar-bg"><div id="pt-bar-fill"></div></div>
      <div class="bell-row" id="pt-bells"></div>
    </div>
  `;
  // v683 #266 タブレットを演台に置く想定なので常時 wake lock を取得
  acquireWakeLock('public-timer');
  try {
    const d = await fetchState(id);
    _state = d.timer;
    if (d.server_now) {
      const sn = Date.parse(String(d.server_now).replace(' ', 'T'));
      _serverOffsetMs = sn - Date.now();
    }
    render();
    _tickTimer = setInterval(() => {
      render();
      // v971.1 「画面 が スリープ してしまう」 対策: OS が sentinel を 解放 して いた 場合、
      //   毎 tick 見に行って 再取得 (acquire は cheap — 既に 保持 中 なら 即 return)。
      if (document.visibilityState === 'visible') acquireWakeLock('public-timer');
    }, 1000);
    // v971.1 poll を 5s → 2s に (「更新頻度 低い、 もう少し 上げて」)
    _pollTimer = setInterval(async () => {
      try {
        const d2 = await fetchState(id);
        _state = d2.timer;
        if (d2.server_now) {
          const sn = Date.parse(String(d2.server_now).replace(' ', 'T'));
          _serverOffsetMs = sn - Date.now();
        }
      } catch (_) {}
    }, 2000);
  } catch (e) {
    document.getElementById('pt-title').textContent = 'エラー: ' + e.message;
  }
  // ページ離脱で背景 + chrome を戻す + wake lock 解放
  window.addEventListener('hashchange', () => {
    if (!location.hash.includes('/public-timer/' + id)) {
      stopAll();
      releaseWakeLock('public-timer');
      document.body.style.background = '';
      // v678 #258 ログイン済なら chrome を戻す (renderChrome が再 dispatch 時に呼ぶ)
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

  // v684 #267 3 フェーズ表示:
  //   ① 発表終了 (= end_bell) まで: カウントダウン
  //   ② 発表終了 〜 最後のベル: 0:00 から上にカウント
  //   ③ 最後のベルを越えたら「+MM:SS」超過
  const allBells = [t.bell1_seconds, t.bell2_seconds, t.bell3_seconds];
  const bells = allBells.filter(b => b !== null && b !== undefined && b > 0);
  const maxBellSec = bells.length ? Math.max(...bells) : 0;
  const endBellSec = ((t.end_bell_index && allBells[t.end_bell_index - 1])
                      || t.duration_seconds || 0);

  let displayText = '--:--';
  let color = '#fff';
  let elapsed = 0;

  if (t.status === 'paused') {
    displayText = fmt(Number(t.remaining_seconds) || 0);
  } else if ((t.status === 'running' || t.status === 'done') && t.started_at) {
    const started = Date.parse(String(t.started_at).replace(' ', 'T'));
    elapsed = ((Date.now() + _serverOffsetMs) - started) / 1000;
    if (elapsed < endBellSec) {
      const remain = Math.ceil(endBellSec - elapsed);
      displayText = fmt(remain);
      if (remain <= 30) color = '#ef4444';
      else if (remain <= 60) color = '#f59e0b';
    } else if (elapsed < maxBellSec) {
      // ② 発表終了後、最後のベルまでは 0:00 からカウントアップ
      // v726 #331 質疑帯は鮮やかな黄色で目立たせる。
      displayText = fmt(Math.floor(elapsed - endBellSec));
      color = '#facc15';
    } else {
      // ③ 超過 — v724 #325 ハッキリ赤に (旧 #9ca3af では目立たない)
      displayText = '+' + fmt(Math.floor(elapsed - maxBellSec));
      color = '#ef4444';
    }
  }

  const elTime = document.getElementById('pt-time');
  elTime.textContent = displayText;
  elTime.style.color = color;

  const statusLabel = (() => {
    if (t.status === 'paused') return '⏸ 一時停止';
    if (t.status === 'cancelled') return '❌ キャンセル';
    if (elapsed >= maxBellSec && maxBellSec > 0) return '⚠ 超過';
    if (elapsed >= endBellSec && endBellSec > 0) return '🏁 発表終了 — 質疑';
    if (t.status === 'running') return '▶ 進行中';
    if (t.status === 'done')    return '🏁 終了';
    return t.status || '';
  })();
  document.getElementById('pt-status').textContent = statusLabel;

  // ベル位置表示 (= 現在通過したものはハイライト)
  document.getElementById('pt-bells').innerHTML = bells.map((b, i) => {
    const isEnd = (i + 1) === t.end_bell_index;
    const cur = elapsed >= b;
    const min = (b / 60).toFixed(b % 60 === 0 ? 0 : 1);
    return `<div class="${cur ? 'cur' : ''}">${i + 1}鈴 ${min}分${isEnd ? ' (終了)' : ''}</div>`;
  }).join('');

  // v728 #336 プログレスバー: 合計 = 最後のベル (= visualEndSec) 100%。
  //   発表終了帯 (青) / 質疑帯 (橙) で背景色分け、ベル位置に縦線 (最後のベルは端なので除外)。
  //   経過バーの色はフェーズ (発表中: 青 / 質疑: 黄 / 超過: 赤) に追従。
  const visualEndSec = Math.max(maxBellSec, endBellSec);
  const barBg = document.getElementById('pt-bar-bg');
  const barFill = document.getElementById('pt-bar-fill');
  if (barBg && barFill) {
    if (visualEndSec > 0) {
      const endPct = (endBellSec / visualEndSec) * 100;
      const linePcts = [];
      for (const b of bells) {
        if (b > 0 && b < visualEndSec) linePcts.push((b / visualEndSec) * 100);
      }
      const lines = linePcts.map(p => `transparent ${p - 0.3}%, rgba(255,255,255,0.7) ${p - 0.3}%, rgba(255,255,255,0.7) ${p + 0.3}%, transparent ${p + 0.3}%`).join(', ');
      const baseGradient = `linear-gradient(to right, #1e3a8a 0%, #1e3a8a ${endPct}%, #92400e ${endPct}%, #92400e 100%)`;
      barBg.style.backgroundImage = linePcts.length
        ? `linear-gradient(to right, ${lines}), ${baseGradient}`
        : baseGradient;
      const pct = Math.min(100, (elapsed / visualEndSec) * 100);
      barFill.style.width = pct.toFixed(1) + '%';
      const isOver = elapsed >= maxBellSec;
      const isPastEnd = elapsed >= endBellSec;
      barFill.style.background = isOver ? '#ef4444' : (isPastEnd ? '#facc15' : '#3b82f6');
    } else {
      barFill.style.width = '0%';
    }
  }
}
