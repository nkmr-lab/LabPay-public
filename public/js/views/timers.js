// /#/timers — 共有タイマー。 参加者全員に同じカウントダウンを見せる。
// 同期戦略: server から server_now を毎回受け取って ローカル時計とのオフセットを
// 計算 → 自前で 1 秒刻みでカウントダウン。 開始直後は頻繁 (3s) に再 sync して
// ズレを早めに正す。 残りが少なくなるほど精度が大事なので 終盤も 3s。
// 中盤は 15s に間引く。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { playSound } from '../sounds.js';
import { tag, participantPill } from '../format.js';
import { createMemberPicker } from '../member_picker.js';
import { acquireWakeLock, releaseWakeLock } from '../wakelock.js';

const GRADE_ORDER = ['B3','B4','M1','M2','D',''];
const gradeRank = g => {
  const i = GRADE_ORDER.indexOf(g || '');
  return i < 0 ? GRADE_ORDER.length : i;
};

const PRESETS = [
  { label: '5 分',  seconds: 300 },
  { label: '10 分', seconds: 600 },
  { label: '15 分', seconds: 900 },
  { label: '25 分', seconds: 1500 },  // ポモドーロ
  { label: '30 分', seconds: 1800 },
  { label: '60 分', seconds: 3600 },
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
      <h2 style="margin:6px 0 0">タイマーを作成</h2>
      <p class="hint-sm" style="margin:4px 0 0">作成後 ▶ 開始 を 押す まで カウントダウン は 始まりません。</p>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル (任意 / 空欄なら 「タイマー」)</span>
        <input type="text" id="tmn-title" maxlength="200" placeholder="例: ポモドーロ / 作業時間" value="${escapeHtml(presetTitle)}" autofocus>
      </label>
      <span class="lbl">長さ</span>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin:4px 0 6px">
        ${PRESETS.map((p, i) => `
          <button class="btn" data-preset-sec="${p.seconds}">${escapeHtml(p.label)}</button>
        `).join('')}
      </div>
      <div class="row" style="gap:6px; align-items:center">
        <input type="number" id="tmn-min" min="0" max="1440" placeholder="分" style="max-width:90px">
        <span class="muted">分</span>
        <input type="number" id="tmn-sec" min="0" max="59" placeholder="秒" style="max-width:90px">
        <span class="muted">秒</span>
      </div>
      <details style="margin-top:10px">
        <summary class="hint" style="cursor:pointer">🔔 中間ベル + 🔁 リピート設定</summary>
        <div style="margin-top:6px">
          <div class="hint-sm" style="margin-bottom:4px">タイマー開始から N 分後に 効果音 (設定 → 効果音 → ルーレット用のものが鳴ります)。 空欄 = ベル無し。 小数 (例 1.5 = 1 分 30 秒) も 可。</div>
          <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px">
            <label style="display:inline-flex; align-items:center; gap:4px">1ベル: <input type="number" id="tmn-bell1" min="0" step="0.5" placeholder="分" style="max-width:90px"> 分後</label>
            <label style="display:inline-flex; align-items:center; gap:4px">2ベル: <input type="number" id="tmn-bell2" min="0" step="0.5" placeholder="分" style="max-width:90px"> 分後</label>
            <label style="display:inline-flex; align-items:center; gap:4px">3ベル: <input type="number" id="tmn-bell3" min="0" step="0.5" placeholder="分" style="max-width:90px"> 分後</label>
          </div>
          <div class="row" style="gap:6px; align-items:center">
            <label style="display:inline-flex; align-items:center; gap:4px">🔁 繰り返し: <input type="number" id="tmn-repeat" min="0" max="100" value="0" style="max-width:80px"> 回</label>
            <span class="muted" style="font-size:11px">(0 = 1 回きり)</span>
          </div>
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
  document.querySelectorAll('[data-preset-sec]').forEach(b => {
    b.addEventListener('click', () => {
      const sec = Number(b.dataset.presetSec);
      document.getElementById('tmn-min').value = Math.floor(sec / 60);
      document.getElementById('tmn-sec').value = sec % 60;
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
    const min = Math.max(0, parseInt(document.getElementById('tmn-min').value, 10) || 0);
    const sec = Math.max(0, Math.min(59, parseInt(document.getElementById('tmn-sec').value, 10) || 0));
    const total = min * 60 + sec;
    if (total < 5) { toast('5 秒以上にしてください'); return; }
    btn.disabled = true;
    // v442 タイトル空欄なら AI に 短いタイトル を 生成 させる
    if (!title) {
      btn.textContent = '🤖 タイトル生成中…';
      const part = picker ? [...picker.getSelected()].length : 1;
      const totalMin = Math.round(total / 60 * 10) / 10;
      const ctx = `共有 タイマー (カウントダウン) を 今 ${part} 人で 開始します。 長さは ${totalMin} 分。 用途は たぶん ポモドーロ・作業セット・休憩・会議 など。 ピッタリな 短いタイトルを 1 つ。`;
      try {
        const r = await post('/api/ai/short_title', { context: ctx });
        title = r.title || 'タイマー';
      } catch (_) {
        title = 'タイマー';
      }
    }
    btn.textContent = '＋ 作成中…';
    // v404 ベル入力は 分単位 (小数可) に。 backend は秒で 保持するので *60 して送る。
    const toSec = (id) => {
      const v = parseFloat(document.getElementById(id).value);
      if (!Number.isFinite(v) || v <= 0) return null;
      return Math.round(v * 60);
    };
    const bell1 = toSec('tmn-bell1');
    const bell2 = toSec('tmn-bell2');
    const bell3 = toSec('tmn-bell3');
    const repeatMax = Math.max(0, Math.min(100, parseInt(document.getElementById('tmn-repeat').value, 10) || 0));
    for (const b of [bell1, bell2, bell3]) {
      if (b !== null && (b < 1 || b >= total)) {
        toast(`ベル時刻は 0 分超 / 合計未満 (${(total/60).toFixed(1)}分) に`); return;
      }
    }
    try {
      const r = await post('/api/timers', {
        title, duration_seconds: total, participant_ids: picker ? [...picker.getSelected()] : [],
        bell1_seconds: bell1,
        bell2_seconds: bell2,
        bell3_seconds: bell3,
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
let tmDurationSec = 0;
let tmRemainingSec = 0;     // v446 paused 時の 残り秒数 (running/done では未使用)
let tmBells = [];           // [秒, ...] 開始からの 秒数
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
    <div class="card" style="text-align:center">
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
    tmDurationSec = t.duration_seconds;
    tmRemainingSec = Math.max(0, Number(t.remaining_seconds) || 0);
    tmStatus      = t.status;
    // ベル / リピート 情報 (resync 時も更新)
    tmBells       = [t.bell1_seconds, t.bell2_seconds, t.bell3_seconds].filter(Number.isFinite);
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
      document.getElementById('tmd-head').innerHTML = `
        <h2 style="margin:6px 0 0">${escapeHtml(t.title)}</h2>
        <div class="meta">起案 ${escapeHtml(t.creator_name)} · 合計 ${fmtDuration(t.duration_seconds)}</div>
      `;
      document.getElementById('tmd-pcount').textContent = d.participants.length;
      document.getElementById('tmd-participants').innerHTML = d.participants.map(participantPill).join('');
      // v446 start/pause/reset は 参加者 (含 起案者) なら 押せる。
      if (d.is_participant || d.is_creator) {
        document.getElementById('tmd-start').addEventListener('click', async () => {
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
  // ベル 発火: 開始からの 経過秒数が ベル 設定値を 越えたら 1 回鳴らす。
  if (tmStatus === 'running' && tmBells.length) {
    const elapsed = Math.floor((now - tmStartedMs) / 1000);
    for (const b of tmBells) {
      if (elapsed >= b && !tmBellsFired.has(b)) {
        tmBellsFired.add(b);
        playSound('roulette_spin');  // 共用 (まだ 専用 event_key を切ってない)
      }
    }
  }
  if (tmStatus === 'cancelled') {
    countEl.textContent = '停止';
    countEl.style.color = '#888';
    barEl.style.width = '0%';
    stEl.textContent = '⏹ 起案者により停止されました — ↻ リセット で 戻せます';
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
      playSound('roulette_spin');
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
