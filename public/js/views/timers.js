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
      const ends = Date.parse(String(t.ends_at).replace(' ', 'T'));
      const remaining = Math.max(0, Math.floor((ends - (Date.now() + serverOffset)) / 1000));
      const isMine = Number(t.creator_user_id) === Number(state.me?.id);
      const tag = t.status === 'running'
        ? `<span class="tag" style="background:#e3f2fd; color:#1565c0">${fmtDuration(remaining)} 残</span>`
        : t.status === 'done'
        ? tag('ok', '完了')
        : tag('muted', '中止');
      return `
        <a class="list-item" href="#/timers/${t.id}">
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(t.title)}</div>
            <div class="meta">${tag} · ${fmtDuration(t.duration_seconds)} · 起案 ${escapeHtml(t.creator_name)}${isMine ? ' (自分)' : ''}</div>
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
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/timers" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">タイマーを始める</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル</span>
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
          <div class="hint-sm" style="margin-bottom:4px">タイマー開始から N 秒後に 効果音 (設定 → 効果音 → ルーレット用のものが鳴ります)。 空欄 = ベル無し。</div>
          <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px">
            <label style="display:inline-flex; align-items:center; gap:4px">1ベル: <input type="number" id="tmn-bell1" min="0" placeholder="秒" style="max-width:90px"> 秒後</label>
            <label style="display:inline-flex; align-items:center; gap:4px">2ベル: <input type="number" id="tmn-bell2" min="0" placeholder="秒" style="max-width:90px"> 秒後</label>
            <label style="display:inline-flex; align-items:center; gap:4px">3ベル: <input type="number" id="tmn-bell3" min="0" placeholder="秒" style="max-width:90px"> 秒後</label>
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
        <button id="tmn-save" class="primary">⏱️ 開始</button>
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
      initial: presetMembers,
      poolIds: lockMembers ? presetMembers : null,
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('tmn-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }

  document.getElementById('tmn-save').addEventListener('click', async () => {
    const title = document.getElementById('tmn-title').value.trim();
    const min = Math.max(0, parseInt(document.getElementById('tmn-min').value, 10) || 0);
    const sec = Math.max(0, Math.min(59, parseInt(document.getElementById('tmn-sec').value, 10) || 0));
    const total = min * 60 + sec;
    if (!title) { toast('タイトル必須'); return; }
    if (total < 5) { toast('5 秒以上にしてください'); return; }
    const bell1 = parseInt(document.getElementById('tmn-bell1').value, 10);
    const bell2 = parseInt(document.getElementById('tmn-bell2').value, 10);
    const bell3 = parseInt(document.getElementById('tmn-bell3').value, 10);
    const repeatMax = Math.max(0, Math.min(100, parseInt(document.getElementById('tmn-repeat').value, 10) || 0));
    for (const b of [bell1, bell2, bell3]) {
      if (Number.isFinite(b) && (b < 1 || b >= total)) {
        toast(`ベル時刻は 1 秒以上 / 合計未満 (${total}秒) に`); return;
      }
    }
    try {
      const r = await post('/api/timers', {
        title, duration_seconds: total, participant_ids: picker ? [...picker.getSelected()] : [],
        bell1_seconds: Number.isFinite(bell1) ? bell1 : null,
        bell2_seconds: Number.isFinite(bell2) ? bell2 : null,
        bell3_seconds: Number.isFinite(bell3) ? bell3 : null,
        repeat_max: repeatMax,
      });
      toast('タイマーを開始しました');
      navigate('#/timers/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

let tmTickTimer = null;
let tmSyncTimer = null;
let tmOffsetMs = 0;   // server_now_ms - client_now_at_recv_ms (= server からの遅延補正)
let tmEndsMs = 0;
let tmStartedMs = 0;
let tmDurationSec = 0;
let tmBells = [];           // [秒, ...] 開始からの 秒数
let tmBellsFired = new Set();
let tmRepeatMax = 0;
let tmRepeatIdx = 0;
let tmLastCycleIdx = -1;
let tmStatus = 'running';

function stopTimerLoops() {
  if (tmTickTimer) { clearInterval(tmTickTimer); tmTickTimer = null; }
  if (tmSyncTimer) { clearTimeout(tmSyncTimer); tmSyncTimer = null; }
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
      <div id="tmd-count" style="font-size:64px; font-weight:700; font-variant-numeric:tabular-nums; line-height:1; margin:14px 0 6px">--:--</div>
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
    <div class="card" id="tmd-admin-card" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="tmd-cancel" class="btn">⏹ 停止</button>
        <button id="tmd-del" class="danger">削除</button>
      </div>
    </div>
  `;
  stopTimerLoops();
  await loadTimerDetail(id);
  // 1 秒刻みで表示更新 (offset とサーバの終了時刻から計算)
  tmTickTimer = setInterval(() => tickTimer(), 1000);
  tickTimer();
}

async function loadTimerDetail(id, { isResync = false } = {}) {
  try {
    const recvMs = Date.now();
    const d = await get('/api/timers/' + id);
    const t = d.timer;
    tmOffsetMs    = Date.parse(String(d.server_now).replace(' ', 'T')) - recvMs;
    tmEndsMs      = Date.parse(String(t.ends_at).replace(' ', 'T'));
    tmStartedMs   = Date.parse(String(t.started_at).replace(' ', 'T'));
    tmDurationSec = t.duration_seconds;
    tmStatus      = t.status;
    // ベル / リピート 情報 (resync 時も更新)
    tmBells       = [t.bell1_seconds, t.bell2_seconds, t.bell3_seconds].filter(Number.isFinite);
    tmRepeatMax   = t.repeat_max || 0;
    tmRepeatIdx   = t.repeat_idx || 0;
    if (!isResync) tmBellsFired = new Set();
    // サイクルが進んだら fired をリセット (リピート 2 周目で 再度鳴らす)
    if (tmLastCycleIdx !== tmRepeatIdx) {
      tmBellsFired = new Set();
      tmLastCycleIdx = tmRepeatIdx;
    }
    if (!isResync) {
      document.getElementById('tmd-head').innerHTML = `
        <h2 style="margin:6px 0 0">${escapeHtml(t.title)}</h2>
        <div class="meta">起案 ${escapeHtml(t.creator_name)} · 合計 ${fmtDuration(t.duration_seconds)}</div>
      `;
      document.getElementById('tmd-pcount').textContent = d.participants.length;
      document.getElementById('tmd-participants').innerHTML = d.participants.map(participantPill).join('');
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
    stEl.textContent = '⏹ 起案者により停止されました';
    return;
  }
  const remainingSec = Math.max(0, Math.ceil((tmEndsMs - now) / 1000));
  const elapsedSec   = Math.max(0, Math.min(tmDurationSec, Math.floor((now - tmStartedMs) / 1000)));
  countEl.textContent = fmtDuration(remainingSec);
  countEl.style.color = remainingSec === 0 ? 'var(--primary)'
                      : remainingSec < 10 ? '#c62828'
                      : '';
  elEl.textContent = `経過 ${fmtDuration(elapsedSec)} / 合計 ${fmtDuration(tmDurationSec)}`;
  const pct = tmDurationSec ? Math.min(100, (elapsedSec / tmDurationSec) * 100) : 0;
  barEl.style.width = pct.toFixed(1) + '%';
  if (remainingSec === 0 && tmStatus === 'running') {
    // リピート残あり: サーバの autoclose が 次サイクルにスライドさせるので、
    // ローカルでは status を done に変えず、 次の sync を待つ。
    if (tmRepeatMax > 0 && tmRepeatIdx < tmRepeatMax) {
      stEl.textContent = `🔁 リピート ${tmRepeatIdx + 1}/${tmRepeatMax} 回目 切替中…`;
    } else {
      stEl.textContent = '🎉 終了!';
      playSound('roulette_spin');  // 終了音
      tmStatus = 'done';
      stopTimerLoops();
    }
  } else if (tmStatus === 'done') {
    stEl.textContent = '🎉 終了';
  } else if (tmRepeatMax > 0) {
    stEl.textContent = `🔁 ${tmRepeatIdx + 1}/${tmRepeatMax + 1} 回目`;
  } else {
    stEl.textContent = '';
  }
}
