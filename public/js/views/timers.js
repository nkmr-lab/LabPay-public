// /#/timers — 共有タイマー。 参加者全員に同じカウントダウンを見せる。
// 同期戦略: server から server_now を毎回受け取って ローカル時計とのオフセットを
// 計算 → 自前で 1 秒刻みでカウントダウン。 開始直後は頻繁 (3s) に再 sync して
// ズレを早めに正す。 残りが少なくなるほど精度が大事なので 終盤も 3s。
// 中盤は 15s に間引く。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { tag, participantPill } from '../format.js';
import { createMemberPicker } from '../member_picker.js';
import { acquireWakeLock, releaseWakeLock } from '../wakelock.js';

// v448 学会タイマー の ベル は ルーレット の 境界通過音 / 終了音 と 同じ
// オシレータ生成 を 共有モジュール 経由で 使用。 MP3 不要、 設定 不要、 ユーザ
// クリップ 割当 不要。 audio_unlock の install で 任意の タップ 直後 から 通る。
import { playBoundaryTick, playEndDing, unlockAudio } from '../audio_unlock.js';

const GRADE_ORDER = ['B3','B4','M1','M2','D',''];
const gradeRank = g => {
  const i = GRADE_ORDER.indexOf(g || '');
  return i < 0 ? GRADE_ORDER.length : i;
};

// v449 学会タイマー プリセット。 「1鈴 / 2鈴 / 3鈴 / 終了」 を 一括 埋め。
// 終了 = end_bell_index (1/2/3)。 単位は 分。
const ACADEMIC_PRESETS = [
  { label: '一般 (12/14/15、 3鈴=終了)',  bells: [12, 14, 15], end: 3 },
  { label: '招待 (20/24/25、 3鈴=終了)',  bells: [20, 24, 25], end: 3 },
  { label: 'ライトニング (4/4.5/5、 3鈴=終了)', bells: [4, 4.5, 5], end: 3 },
  { label: 'ポモドーロ (25 分、 1鈴=終了)', bells: [25, null, null], end: 1 },
  { label: '休憩 (5 分、 1鈴=終了)',       bells: [5, null, null], end: 1 },
];

function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

export async function renderTimers() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">⏱️ タイマー</h2>
        <a class="btn primary" href="#/timers/new">＋ 新規</a>
      </div>
      <p class="card-subtitle" style="margin:6px 0 0">
        参加者全員に 同じカウントダウンを共有。
      </p>
    </div>
    <div id="tm-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/timers');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('tm-list').innerHTML = '<div class="empty">タイマーはまだありません</div>';
      return;
    }
    const serverOffset = Date.parse(String(d.server_now).replace(' ', 'T')) - Date.now();
    document.getElementById('tm-list').innerHTML = items.map(t => {
      const isMine = Number(t.creator_user_id) === Number(state.me?.id);
      // v446 paused を 追加。 running は ends_at から 残りを 計算、 paused は
      // remaining_seconds を そのまま 表示。
      let statusTag;
      if (t.status === 'running') {
        const ends = Date.parse(String(t.ends_at).replace(' ', 'T'));
        const remaining = Math.max(0, Math.floor((ends - (Date.now() + serverOffset)) / 1000));
        statusTag = `<span class="tag" style="background:#e3f2fd; color:#1565c0">▶ ${fmtDuration(remaining)} 残</span>`;
      } else if (t.status === 'paused') {
        const rem = Math.max(0, Number(t.remaining_seconds) || 0);
        statusTag = `<span class="tag" style="background:#fff3e0; color:#e65100">⏸ ${fmtDuration(rem)} 残</span>`;
      } else if (t.status === 'done') {
        statusTag = tag('ok', '完了');
      } else {
        statusTag = tag('muted', '中止');
      }
      return `
        <a class="list-item" href="#/timers/${t.id}">
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(t.title)}</div>
            <div class="meta">${statusTag} · ${fmtDuration(t.duration_seconds)} · 起案 ${escapeHtml(t.creator_name)}${isMine ? ' (自分)' : ''}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('tm-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderTimerNew({ query } = {}) {
  const presetMembers = String(query?.members || '').trim()
    .split(',').map(Number).filter(Boolean);
  const presetTitle = String(query?.title || '').trim();
  const lockMembers = presetMembers.length > 0;
  // v441 自分を デフォで 追加 (?members= 指定があれば そちら 優先)
  const meId = Number(state.me?.id) || 0;
  const initialMembers = lockMembers ? presetMembers : (meId ? [meId] : []);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/timers" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">学会タイマー を 作成</h2>
      <p class="hint-sm" style="margin:4px 0 0">
        1鈴 / 2鈴 / 3鈴 の 時刻 を 分単位 (小数可) で 指定し、 そのうち どれを 「発表終了」
        とするか 選んで ください。 終了 = 終了音 (チーン)、 他は 中間 ベル (キン)。 終了の
        後 ろ に 置いた ベル は 質疑時間 終了 などの 案内 に 使えます。
      </p>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル (任意 / 空欄なら 「タイマー」)</span>
        <input type="text" id="tmn-title" maxlength="200" placeholder="例: 一般発表 / ポモドーロ" value="${escapeHtml(presetTitle)}" autofocus>
      </label>
      <span class="lbl">プリセット (タップで 一括 埋め)</span>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin:4px 0 10px">
        ${ACADEMIC_PRESETS.map((p, i) => `
          <button class="btn" data-preset-idx="${i}">${escapeHtml(p.label)}</button>
        `).join('')}
      </div>
      <span class="lbl">ベル 設定 (空欄 = ベル なし)</span>
      <div style="display:grid; grid-template-columns:auto auto 1fr auto auto; gap:6px 8px; align-items:center; margin:6px 0">
        <label style="white-space:nowrap"><input type="radio" name="tmn-end" value="1"> 終了</label>
        <span class="bold">1鈴</span>
        <input type="number" id="tmn-bell1" min="0" step="0.5" placeholder="分" style="max-width:120px">
        <span class="muted">分後</span>
        <span></span>
        <label style="white-space:nowrap"><input type="radio" name="tmn-end" value="2"> 終了</label>
        <span class="bold">2鈴</span>
        <input type="number" id="tmn-bell2" min="0" step="0.5" placeholder="分" style="max-width:120px">
        <span class="muted">分後</span>
        <span></span>
        <label style="white-space:nowrap"><input type="radio" name="tmn-end" value="3" checked> 終了</label>
        <span class="bold">3鈴</span>
        <input type="number" id="tmn-bell3" min="0" step="0.5" placeholder="分" style="max-width:120px">
        <span class="muted">分後</span>
        <span></span>
      </div>
      <details style="margin-top:8px">
        <summary class="hint" style="cursor:pointer">🔁 リピート設定 (繰り返し)</summary>
        <div class="row" style="gap:6px; align-items:center; margin-top:6px">
          <label style="display:inline-flex; align-items:center; gap:4px">🔁 繰り返し: <input type="number" id="tmn-repeat" min="0" max="100" value="0" style="max-width:80px"> 回</label>
          <span class="muted" style="font-size:11px">(0 = 1 回きり)</span>
        </div>
      </details>
      <div class="field" style="margin-top:10px">
        <span class="lbl">参加者${lockMembers ? ' (グループ内)' : ''}</span>
        ${lockMembers ? '' : `<div id="tmn-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>`}
        <div id="tmn-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/timers" class="btn">キャンセル</a>
        <button id="tmn-save" class="primary">＋ 作成</button>
      </div>
    </div>
  `;
  // v449 プリセット を 押すと 3 つの ベル時刻 + end radio が 一括 埋まる。
  document.querySelectorAll('[data-preset-idx]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const p = ACADEMIC_PRESETS[Number(b.dataset.presetIdx)];
      if (!p) return;
      ['tmn-bell1','tmn-bell2','tmn-bell3'].forEach((id, i) => {
        const v = p.bells[i];
        document.getElementById(id).value = (v == null) ? '' : String(v);
      });
      const radio = document.querySelector(`input[name="tmn-end"][value="${p.end}"]`);
      if (radio) radio.checked = true;
    });
  });

  // v383 picker が allUsers + selected を 内部で管理。 ここは preset の seed 用のみ。
  // v383 共有 member_picker
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer: lockMembers ? null : document.getElementById('tmn-bulk'),
      chipsContainer: document.getElementById('tmn-members'),
      initial: initialMembers,
      poolIds: lockMembers ? presetMembers : null,
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('tmn-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }

  document.getElementById('tmn-save').addEventListener('click', async () => {
    const btn = document.getElementById('tmn-save');
    let title = document.getElementById('tmn-title').value.trim();
    // v449 学会タイマー モデル: ベル時刻 を 分単位 (小数可) で 受け、 end_bell_index で
    // 「発表終了」 を 指定。 duration_seconds は サーバ側で end_bell の 値 から 自動 算出。
    const toSec = (id) => {
      const v = parseFloat(document.getElementById(id).value);
      if (!Number.isFinite(v) || v <= 0) return null;
      return Math.round(v * 60);
    };
    const bell1 = toSec('tmn-bell1');
    const bell2 = toSec('tmn-bell2');
    const bell3 = toSec('tmn-bell3');
    const endRadio = document.querySelector('input[name="tmn-end"]:checked');
    const endBellIdx = endRadio ? Number(endRadio.value) : 3;
    const endBellVal = [bell1, bell2, bell3][endBellIdx - 1];
    if (endBellVal === null) {
      toast(`「終了」 に 選んだ ${endBellIdx}鈴 の 時刻 を 入れて ください`);
      return;
    }
    if (endBellVal < 5) {
      toast(`${endBellIdx}鈴 (= 終了) は 5 秒 以上 に して ください`);
      return;
    }
    btn.disabled = true;
    if (!title) {
      btn.textContent = '🤖 タイトル生成中…';
      const part = picker ? [...picker.getSelected()].length : 1;
      const endMin = Math.round(endBellVal / 60 * 10) / 10;
      const ctx = `共有 学会タイマー を 今 ${part} 人で 開始します。 発表終了 は ${endMin} 分後。 用途は たぶん 学会発表・ゼミ・ライトニングトーク・ポモドーロ など。 ピッタリな 短いタイトルを 1 つ。`;
      try {
        const r = await post('/api/ai/short_title', { context: ctx });
        title = r.title || 'タイマー';
      } catch (_) {
        title = 'タイマー';
      }
    }
    btn.textContent = '＋ 作成中…';
    const repeatMax = Math.max(0, Math.min(100, parseInt(document.getElementById('tmn-repeat').value, 10) || 0));
    try {
      const r = await post('/api/timers', {
        title,
        participant_ids: picker ? [...picker.getSelected()] : [],
        bell1_seconds: bell1,
        bell2_seconds: bell2,
        bell3_seconds: bell3,
        end_bell_index: endBellIdx,
        repeat_max: repeatMax,
      });
      toast('タイマーを作成しました — ▶ 開始 を 押して カウントダウン');
      navigate('#/timers/' + r.id);
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = '＋ 作成';
    }
  });
}

let tmTickTimer = null;
let tmSyncTimer = null;
// v408 「ちょうど 0 になった 瞬間」 を 1 回 だけ 鳴らす ための フラグ。
// resync で 復活して しまうので 必要。 リピート で サーバが 次サイクル に
// 切替えたら tmLastCycleIdx 変化で 再 false 化 (下の loadTimerDetail で 処理)。
let tmEndFiredOnce = false;
// v411 表示モード: 'remain' (カウントダウン / 超過は +N) or 'elapsed' (カウントアップ)
let tmDisplayMode = (() => {
  try { return localStorage.getItem('labpay-tm-display') || 'remain'; }
  catch (_) { return 'remain'; }
})();
let tmOffsetMs = 0;   // server_now_ms - client_now_at_recv_ms (= server からの遅延補正)
let tmEndsMs = 0;
let tmStartedMs = 0;
let tmClosedMs = 0;         // v453 cancelled/done 時の closed_at (停止時 経過 計算 用)
let tmDurationSec = 0;
let tmRemainingSec = 0;     // v446 paused 時の 残り秒数 (running/done では未使用)
let tmBells = [];           // [秒, ...] 開始からの 秒数 (非 null だけ、 終了ベル含む)
let tmEndBellSec = null;    // v449 終了ベル の 秒数 (= duration)。 これは ding 専用なので tick loop からは 除外。
let tmBellsFired = new Set();
let tmRepeatMax = 0;
let tmRepeatIdx = 0;
let tmLastCycleIdx = -1;
let tmStatus = 'running';

function stopTimerLoops() {
  if (tmTickTimer) { clearInterval(tmTickTimer); tmTickTimer = null; }
  if (tmSyncTimer) { clearTimeout(tmSyncTimer); tmSyncTimer = null; }
  // v405 wake lock release
  releaseWakeLock('timer');
}

export async function renderTimerDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/timers" class="hint">← 一覧</a>
      <div id="tmd-head"><div class="muted">読み込み中…</div></div>
    </div>
    <div class="card" id="tmd-display-card" style="text-align:center; position:relative">
      <div class="row" style="gap:6px; justify-content:flex-end; position:absolute; top:6px; right:6px">
        <button id="tmd-test-bell" class="btn" style="font-size:11px; padding:2px 8px" title="チーン (端末で 鳴る か 確認)">🔊 試聴</button>
        <button id="tmd-fs" class="btn" style="font-size:11px; padding:2px 8px" title="フルスクリーン (発表者に 時間を 見せる)">🖥 フル</button>
      </div>
      <button id="tmd-fs-exit" type="button">✕ 終了</button>
      <div id="tmd-title-fs" class="hint-sm" hidden></div>
      <div id="tmd-count" title="タップで カウントダウン ⇄ カウントアップ"
           style="font-size:64px; font-weight:700; font-variant-numeric:tabular-nums; line-height:1; margin:14px 0 6px; cursor:pointer; user-select:none">--:--</div>
      <div id="tmd-mode" class="hint-sm" style="margin-top:-4px; margin-bottom:4px">残り時間</div>
      <div id="tmd-elapsed" class="hint-sm">経過 -- / 合計 --</div>
      <div style="background:#eee; height:10px; border-radius:5px; overflow:hidden; margin-top:14px">
        <div id="tmd-bar" style="background:var(--primary); height:100%; width:0%; transition:width 0.4s linear"></div>
      </div>
      <div id="tmd-status" style="margin-top:14px; font-weight:700"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">参加者 (<span id="tmd-pcount">0</span>)</h3>
      <div id="tmd-participants" class="row" style="gap:6px; flex-wrap:wrap"></div>
    </div>
    <div class="card" id="tmd-ctrl-card">
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="tmd-start" class="primary" hidden>▶ 開始</button>
        <button id="tmd-pause" class="btn"     hidden>⏸ 一時停止</button>
        <button id="tmd-reset" class="btn"     hidden>↻ リセット</button>
      </div>
      <p class="hint-sm" style="margin:6px 0 0">操作は 参加者 全員 (起案者 含む) が 可能。</p>
    </div>
    <div class="card" id="tmd-admin-card" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="tmd-cancel" class="btn">⏹ 停止</button>
        <button id="tmd-del" class="danger">削除</button>
      </div>
      <p class="hint-sm" style="margin:6px 0 0">起案者 のみ 表示 (停止 = 中止状態 / 削除 = 完全削除)。</p>
    </div>
  `;
  stopTimerLoops();
  await loadTimerDetail(id);
  // 1 秒刻みで表示更新 (offset とサーバの終了時刻から計算)
  tmTickTimer = setInterval(() => tickTimer(), 1000);
  tickTimer();
  // v411 タップで 残り ⇄ 経過 切替
  document.getElementById('tmd-count')?.addEventListener('click', () => {
    tmDisplayMode = tmDisplayMode === 'remain' ? 'elapsed' : 'remain';
    try { localStorage.setItem('labpay-tm-display', tmDisplayMode); } catch (_) {}
    tickTimer();
  });
  // v453 試聴 — 「鳴らない」 訴え の 1 次切り分け 用。 click 内 で 鳴らす ので
  // 必ず unlock 済み の 状態で 走る。 鳴らない なら 端末側 (silent / volume / etc) 問題。
  document.getElementById('tmd-test-bell')?.addEventListener('click', () => {
    unlockAudio();
    playBoundaryTick();
    setTimeout(() => playEndDing(), 600);
  });
  // v453 → v455 フルスクリーン — 学会タイマー で 発表者 に 時間 を 見せる。
  // 「🖥 フル」 → 全画面化、 「✕ 終了」 / ESC で 解除。
  document.getElementById('tmd-fs')?.addEventListener('click', () => {
    enterTimerFullscreen();
  });
  document.getElementById('tmd-fs-exit')?.addEventListener('click', () => {
    exitTimerFullscreen();
  });
}

// v455 真の フルスクリーン (Fullscreen API + CSS フォールバック)。
// iOS Safari は 通常 要素 に は Fullscreen API を 認め ない ので 黒くなる だけに
// なる 問題 が あった → CSS で position:fixed + inset:0 + z-index で 全画面 を
// 模す ように。 Fullscreen API が 通る Chrome / Edge では 両方 適用 (害なし)。
function enterTimerFullscreen() {
  const card = document.getElementById('tmd-display-card');
  if (!card) return;
  card.classList.add('tmd-fs-on');
  // ブラウザネイティブ の Fullscreen が 使えるなら 使う (chrome 等)。 iOS は 拒否 で
  // 黙って 通る (CSS フォールバック だけ で 機能 する)。
  const req = card.requestFullscreen || card.webkitRequestFullscreen;
  if (req) {
    try { req.call(card).catch(() => {}); } catch (_) {}
  }
  // 外側 から ESC や OS の フルスクリーン解除 が 走ったら CSS の class も 外す。
  const handler = () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      // CSS class は そのまま 残す? — ユーザ が 終了 ボタン を 押した と 同義
      // に 扱う のが 自然。 残すと iOS の "黒い まま" になる。
      // ここでは class も 外して 通常 表示 に 戻す。
      card.classList.remove('tmd-fs-on');
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    }
  };
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
}
function exitTimerFullscreen() {
  const card = document.getElementById('tmd-display-card');
  if (!card) return;
  card.classList.remove('tmd-fs-on');
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch (_) {}
  }
}

async function loadTimerDetail(id, { isResync = false } = {}) {
  try {
    const recvMs = Date.now();
    const d = await get('/api/timers/' + id);
    const t = d.timer;
    tmOffsetMs    = Date.parse(String(d.server_now).replace(' ', 'T')) - recvMs;
    // v446 paused は started_at/ends_at が NULL。 NaN を 避けるため 三項で 0 に。
    tmEndsMs      = t.ends_at    ? Date.parse(String(t.ends_at).replace(' ', 'T'))    : 0;
    tmStartedMs   = t.started_at ? Date.parse(String(t.started_at).replace(' ', 'T')) : 0;
    tmClosedMs    = t.closed_at  ? Date.parse(String(t.closed_at).replace(' ', 'T'))  : 0;
    tmDurationSec = t.duration_seconds;
    tmRemainingSec = Math.max(0, Number(t.remaining_seconds) || 0);
    tmStatus      = t.status;
    // ベル / リピート 情報 (resync 時も更新)。 v449 end_bell_index で 指定された
    // ベル は ding 専用 として 別途 持ち、 tick loop からは 除外。
    const bellArr = [t.bell1_seconds, t.bell2_seconds, t.bell3_seconds];
    tmBells       = bellArr.filter(Number.isFinite);
    tmEndBellSec  = (t.end_bell_index && bellArr[t.end_bell_index - 1])
                      ? Number(bellArr[t.end_bell_index - 1]) : null;
    tmRepeatMax   = t.repeat_max || 0;
    tmRepeatIdx   = t.repeat_idx || 0;
    if (!isResync) tmBellsFired = new Set();
    // v405 running 中は スクリーンを 起こし続ける
    if (tmStatus === 'running') acquireWakeLock('timer');
    else releaseWakeLock('timer');
    // サイクルが進んだら fired をリセット (リピート 2 周目で 再度鳴らす)
    if (tmLastCycleIdx !== tmRepeatIdx) {
      tmBellsFired = new Set();
      tmLastCycleIdx = tmRepeatIdx;
      tmEndFiredOnce = false;  // v408 サイクル切替で 終了音も 再有効化
    }
    if (!isResync) {
      // v449 ベル の 一覧 (1鈴/2鈴/3鈴 + 終了印) を ヘッダに 表示。
      const bellArrForDisplay = [t.bell1_seconds, t.bell2_seconds, t.bell3_seconds];
      const bellLine = bellArrForDisplay
        .map((sec, i) => sec ? `${i + 1}鈴 ${fmtDuration(sec)}${t.end_bell_index === (i + 1) ? ' 🏁終了' : ''}` : null)
        .filter(Boolean).join(' · ');
      document.getElementById('tmd-head').innerHTML = `
        <h2 style="margin:6px 0 0">${escapeHtml(t.title)}</h2>
        <div class="meta">起案 ${escapeHtml(t.creator_name)} · 合計 ${fmtDuration(t.duration_seconds)}</div>
        ${bellLine ? `<div class="meta" style="margin-top:2px">🔔 ${escapeHtml(bellLine)}</div>` : ''}
      `;
      document.getElementById('tmd-pcount').textContent = d.participants.length;
      document.getElementById('tmd-participants').innerHTML = d.participants.map(participantPill).join('');
      // v446 start/pause/reset は 参加者 (含 起案者) なら 押せる。
      if (d.is_participant || d.is_creator) {
        document.getElementById('tmd-start').addEventListener('click', async () => {
          unlockAudio();  // v453 明示 unlock 「鳴らない」 対策 (グローバル unlock の バックアップ)
          try { await patch(`/api/timers/${id}/start`, {}); toast('開始しました'); await loadTimerDetail(id, { isResync: true }); tickTimer(); }
          catch (e) { toast('失敗: ' + e.message); }
        });
        document.getElementById('tmd-pause').addEventListener('click', async () => {
          try { await patch(`/api/timers/${id}/pause`, {}); toast('一時停止しました'); await loadTimerDetail(id, { isResync: true }); tickTimer(); }
          catch (e) { toast('失敗: ' + e.message); }
        });
        document.getElementById('tmd-reset').addEventListener('click', async () => {
          if (!confirm('タイマーを 元の長さ に 戻しますか?')) return;
          try { await patch(`/api/timers/${id}/reset`, {}); toast('リセットしました'); await loadTimerDetail(id, { isResync: true }); tickTimer(); }
          catch (e) { toast('失敗: ' + e.message); }
        });
      }
      if (d.is_creator) {
        document.getElementById('tmd-admin-card').hidden = false;
        document.getElementById('tmd-cancel').addEventListener('click', async () => {
          if (!confirm('タイマーを停止しますか?')) return;
          try { await patch(`/api/timers/${id}/cancel`, {}); toast('停止しました'); await loadTimerDetail(id, { isResync: true }); tickTimer(); }
          catch (e) { toast('失敗: ' + e.message); }
        });
        document.getElementById('tmd-del').addEventListener('click', async () => {
          if (!confirm('削除しますか?')) return;
          try { await del('/api/timers/' + id); toast('削除しました'); navigate('#/timers'); }
          catch (e) { toast('失敗: ' + e.message); }
        });
      }
    }
    // v446 ボタン 表示の 出し分けは resync でも 走らせる (status 変化を 反映)。
    const btnStart = document.getElementById('tmd-start');
    const btnPause = document.getElementById('tmd-pause');
    const btnReset = document.getElementById('tmd-reset');
    if (btnStart && btnPause && btnReset) {
      btnStart.hidden = !(tmStatus === 'paused');
      btnPause.hidden = !(tmStatus === 'running');
      // リセット は 削除以外 全状態 で 押せる (running / paused / done / cancelled)。
      btnReset.hidden = false;
    }
    // 次の sync をスケジューリング。 残りが少ない時 + 開始直後は頻繁に。
    scheduleSyncNext(id);
  } catch (e) {
    document.getElementById('tmd-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function pickSyncIntervalMs() {
  const now = Date.now() + tmOffsetMs;
  const since = (now - tmStartedMs) / 1000;
  const remaining = (tmEndsMs - now) / 1000;
  if (tmStatus !== 'running') return 0;
  if (remaining <= 0) return 0;
  if (since < 30) return 3_000;       // 開始直後 30 秒は 3 秒間隔 (ズレ補正)
  if (remaining < 30) return 3_000;   // 終了直前 30 秒も 3 秒間隔 (精度大事)
  return 15_000;                      // それ以外は 15 秒間隔
}

function scheduleSyncNext(id) {
  if (tmSyncTimer) { clearTimeout(tmSyncTimer); tmSyncTimer = null; }
  const ms = pickSyncIntervalMs();
  if (!ms) return;
  tmSyncTimer = setTimeout(async () => {
    if (!document.getElementById('tmd-count')) { stopTimerLoops(); return; }
    if (document.hidden) { scheduleSyncNext(id); return; }
    await loadTimerDetail(id, { isResync: true });
  }, ms);
}

function tickTimer() {
  const countEl = document.getElementById('tmd-count');
  const barEl   = document.getElementById('tmd-bar');
  const elEl    = document.getElementById('tmd-elapsed');
  const stEl    = document.getElementById('tmd-status');
  if (!countEl) { stopTimerLoops(); return; }
  const now = Date.now() + tmOffsetMs;
  // ベル 発火: 経過秒 が ベル設定値 を 越えたら 1 回 鳴らす。
  // v449 終了ベル (= duration と 同一) は ding 専用 なので tick loop から 除外。
  // running / done どちら でも 鳴らす (= 終了 後 の 質疑時間 ベル も 通る)。
  // paused 中 は started_at が null なので tmStartedMs=0、 elapsed が 巨大 になる
  // → status guard で skip。
  if ((tmStatus === 'running' || tmStatus === 'done') && tmBells.length && tmStartedMs) {
    const elapsed = Math.floor((now - tmStartedMs) / 1000);
    for (const b of tmBells) {
      if (b === tmEndBellSec) continue;            // 終了ベル は ding 側で 鳴る
      if (elapsed >= b && !tmBellsFired.has(b)) {
        tmBellsFired.add(b);
        playBoundaryTick();
      }
    }
  }
  if (tmStatus === 'cancelled') {
    // v453 停止時 の 経過秒 を 残す — 「何分何秒 で 止めたか」 が 重要な 記録 になる。
    // closed_at - started_at で 復元。 progress バー も そのまま 残す。
    let stoppedSec = 0;
    if (tmStartedMs && tmClosedMs) {
      stoppedSec = Math.max(0, Math.floor((tmClosedMs - tmStartedMs) / 1000));
    }
    countEl.textContent = fmtDuration(stoppedSec);
    countEl.style.color = '#888';
    const pct = tmDurationSec ? Math.min(100, (stoppedSec / tmDurationSec) * 100) : 0;
    barEl.style.width = pct.toFixed(1) + '%';
    barEl.style.background = '#888';
    elEl.textContent = `停止時 経過 ${fmtDuration(stoppedSec)} / 合計 ${fmtDuration(tmDurationSec)}`;
    stEl.textContent = `⏹ ${fmtDuration(stoppedSec)} で 停止 — ↻ リセット で 戻せます`;
    return;
  }
  // v446 paused: 残り を 固定表示。 tick で 減らさない。
  if (tmStatus === 'paused') {
    const modeEl = document.getElementById('tmd-mode');
    countEl.textContent = fmtDuration(tmRemainingSec);
    countEl.style.color = '#e65100';
    if (modeEl) modeEl.textContent = '⏸ 一時停止中 — ▶ 開始 を 押すと カウントダウン';
    elEl.textContent = `残り ${fmtDuration(tmRemainingSec)} / 合計 ${fmtDuration(tmDurationSec)}`;
    const usedSec = Math.max(0, tmDurationSec - tmRemainingSec);
    const pct = tmDurationSec ? Math.min(100, (usedSec / tmDurationSec) * 100) : 0;
    barEl.style.width = pct.toFixed(1) + '%';
    barEl.style.background = 'var(--primary)';
    stEl.textContent = '';
    return;
  }
  // v408 超過 表示。 remainingSec は 0 で 止めず、 マイナスに 突入させて
  // 「+MM:SS 超過」 を 出す。 elapsed も そのまま 加算 (合計超え可)。
  // v411 tmDisplayMode で カウントダウン (残り) ⇄ カウントアップ (経過) を 切替。
  const signedRemain = Math.ceil((tmEndsMs - now) / 1000);
  const elapsedSec   = Math.max(0, Math.floor((now - tmStartedMs) / 1000));
  const isOver = signedRemain < 0;
  const modeEl = document.getElementById('tmd-mode');
  if (tmDisplayMode === 'elapsed') {
    countEl.textContent = fmtDuration(elapsedSec);
    countEl.style.color = isOver ? '#c62828' : '';
    if (modeEl) modeEl.textContent = '↑ 経過時間 (タップで 残り時間)';
  } else if (isOver) {
    countEl.textContent = '+' + fmtDuration(-signedRemain) + ' 超過';
    countEl.style.color = '#c62828';
    if (modeEl) modeEl.textContent = '↓ 残り時間 (タップで 経過時間)';
  } else {
    countEl.textContent = fmtDuration(signedRemain);
    countEl.style.color = signedRemain === 0 ? 'var(--primary)'
                        : signedRemain < 10 ? '#c62828'
                        : '';
    if (modeEl) modeEl.textContent = '↓ 残り時間 (タップで 経過時間)';
  }
  elEl.textContent = `経過 ${fmtDuration(elapsedSec)} / 合計 ${fmtDuration(tmDurationSec)}`;
  const pct = tmDurationSec ? Math.min(100, (elapsedSec / tmDurationSec) * 100) : 0;
  barEl.style.width = pct.toFixed(1) + '%';
  if (isOver) barEl.style.background = '#c62828';
  // 終了 瞬間 (= signedRemain が 0 を 跨いだ 直後 1 tick) で 一度だけ
  // 終了音 + ローカル fired フラグ。 以後 サーバ done が 来るまで 超過表示。
  if (signedRemain === 0 && tmStatus === 'running' && !tmEndFiredOnce) {
    tmEndFiredOnce = true;
    if (tmRepeatMax > 0 && tmRepeatIdx < tmRepeatMax) {
      stEl.textContent = `🔁 リピート ${tmRepeatIdx + 1}/${tmRepeatMax} 回目 切替中…`;
    } else {
      stEl.textContent = '🎉 終了!';
      playEndDing();
      releaseWakeLock('timer');
    }
  } else if (tmStatus === 'done') {
    stEl.textContent = isOver ? `🎉 終了 (+${fmtDuration(-signedRemain)} 超過)` : '🎉 終了';
  } else if (isOver) {
    stEl.textContent = '⚠ 超過中 — 必要なら ⏹ 停止';
  } else if (tmRepeatMax > 0) {
    stEl.textContent = `🔁 ${tmRepeatIdx + 1}/${tmRepeatMax + 1} 回目`;
  } else {
    stEl.textContent = '';
  }
}
