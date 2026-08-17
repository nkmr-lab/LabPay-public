// /#/timers — 共有タイマー。参加者全員に同じカウントダウンを見せる。
// 同期戦略: server から server_now を毎回受け取ってローカル時計とのオフセットを
// 計算 → 自前で 1 秒刻みでカウントダウン。開始直後は頻繁 (3s) に再 sync して
// ズレを早めに正す。残りが少なくなるほど精度が大事なので終盤も 3s。
// 中盤は 15s に間引く。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { uploadImage } from '../upload.js';   // v1335 タイマー画像
import { tag, participantPill } from '../format.js';
import { createMemberPicker } from '../member_picker.js';
import { acquireWakeLock, releaseWakeLock } from '../wakelock.js';

// v448 学会タイマーのベルはルーレットの境界通過音 / 終了音と同じ
// オシレータ生成を共有モジュール経由で使用。 MP3 不要、設定不要、ユーザ
// クリップ割当不要。 audio_unlock の install で任意のタップ直後から通る。
import { playBoundaryTick, playEndDing, unlockAudio } from '../audio_unlock.js';

const GRADE_ORDER = ['B3','B4','M1','M2','D',''];
const gradeRank = g => {
  const i = GRADE_ORDER.indexOf(g || '');
  return i < 0 ? GRADE_ORDER.length : i;
};

// v449 学会タイマープリセット。「1鈴 / 2鈴 / 3鈴 / 終了」を一括埋め。
// 終了 = end_bell_index (1/2/3)。単位は分。
const ACADEMIC_PRESETS = [
  // v727 #334 論文紹介を先頭に + end:3 だった bug を end:2 に修正 (= 2鈴 5分が発表終了)
  { label: '論文紹介 (4/5/10、 2鈴=発表終了)', bells: [4, 5, 10], end: 2 },
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
      // v446 paused を追加。 running は ends_at から残りを計算、 paused は
      // remaining_seconds をそのまま表示。
      let statusTag;
      if (t.status === 'running') {
        const ends = Date.parse(String(t.ends_at).replace(' ', 'T'));
        const remaining = Math.max(0, Math.floor((ends - (Date.now() + serverOffset)) / 1000));
        // v724 #324 発表終了後は質疑経過を表示 (止まってる感を消す)。
        if (remaining === 0) {
          const elapsedSinceEnd = Math.max(0, Math.floor(((Date.now() + serverOffset) - ends) / 1000));
          statusTag = `<span class="tag" style="background:#fef3c7; color:#b45309">🏁 質疑 ${fmtDuration(elapsedSinceEnd)}</span>`;
        } else {
          statusTag = `<span class="tag" style="background:#e3f2fd; color:#1565c0">▶ ${fmtDuration(remaining)} 残</span>`;
        }
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
  // v441 自分をデフォで追加 (?members= 指定があればそちら優先)
  const meId = Number(state.me?.id) || 0;
  const initialMembers = lockMembers ? presetMembers : (meId ? [meId] : []);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/timers" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">学会タイマーを作成</h2>
      <p class="hint-sm" style="margin:4px 0 0">
        1鈴 / 2鈴 / 3鈴の時刻を分単位 (小数可) で指定し、そのうちどれを「発表終了」
        とするか選んでください。終了 = 終了音 (チーン)、他は中間ベル (キン)。終了の
        後ろに置いたベルは質疑時間終了などの案内に使えます。
      </p>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル (任意 / 空欄なら「タイマー」)</span>
        <input type="text" id="tmn-title" maxlength="200" placeholder="例: 一般発表 / ポモドーロ" value="${escapeHtml(presetTitle)}" autofocus>
      </label>
      <span class="lbl">プリセット (タップで一括埋め)</span>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin:4px 0 10px">
        ${ACADEMIC_PRESETS.map((p, i) => `
          <button class="btn" data-preset-idx="${i}">${escapeHtml(p.label)}</button>
        `).join('')}
      </div>
      <span class="lbl">ベル設定 (空欄 = ベルなし)</span>
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
      <!-- v1335 タイマー画像 (ハッカソン 等 で 「今 何 を やっている か」 を 参加者 が 目視 で 分かる ように) -->
      <div class="field" style="margin-top:10px">
        <span class="lbl">画像 (任意・タップで撮影 or アルバム選択)</span>
        <input type="file" id="tmn-image-file" accept="image/*">
        <input type="hidden" id="tmn-image-url" value="">
        <img id="tmn-image-preview" alt="" hidden style="max-width:180px; max-height:180px; margin-top:6px; border-radius:8px; object-fit:contain; display:block">
        <div id="tmn-image-status" class="hint-sm"></div>
      </div>
      <div class="field" style="margin-top:10px">
        <span class="lbl">参加者${lockMembers ? ' (グループ内)' : ''}</span>
        <details id="tmn-picker-details" open style="margin-top:4px">
          <summary id="tmn-picker-summary" style="cursor:pointer; padding:4px 0; font-size:13px; user-select:none">
            👥 <span id="tmn-picker-count">0</span> 人選択中 — タップで一覧表示 / 非表示
          </summary>
          ${lockMembers ? '' : `<div id="tmn-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin:6px 0"></div>`}
          <div id="tmn-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
        </details>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/timers" class="btn">キャンセル</a>
        <button id="tmn-save" class="primary">＋ 作成</button>
      </div>
    </div>
  `;
  // v449 プリセットを押すと 3 つのベル時刻 + end radio が一括埋まる。
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

  // v383 picker が allUsers + selected を内部で管理。ここは preset の seed 用のみ。
  // v383 共有 member_picker
  // v677 #257 選択後は picker を折り畳む。 onChange で件数を summary に反映、
  //   最初の 1 回 (初期表示) 以外で選択が変わったら details を自動 close。
  let picker = null;
  let autoCollapseDone = false;
  const updateSummary = (sel) => {
    const el = document.getElementById('tmn-picker-count');
    if (el) el.textContent = String(sel ? sel.size : 0);
  };
  try {
    picker = await createMemberPicker({
      bulkContainer: lockMembers ? null : document.getElementById('tmn-bulk'),
      chipsContainer: document.getElementById('tmn-members'),
      initial: initialMembers,
      poolIds: lockMembers ? presetMembers : null,
      showGenderBulk: false,
      onChange: (sel) => {
        updateSummary(sel);
        // 1 人以上選んだ状態で変化があったら自動で畳む (= 1 回だけ)
        if (!autoCollapseDone && sel.size > 0) {
          autoCollapseDone = true;
          const d = document.getElementById('tmn-picker-details');
          if (d) d.open = false;
        }
      },
    });
    updateSummary(picker.getSelected());
    // 初期メンバーがあるなら最初から畳んでおく
    if (initialMembers.length > 0) {
      const d = document.getElementById('tmn-picker-details');
      if (d) d.open = false;
      autoCollapseDone = true;
    }
  } catch (e) {
    document.getElementById('tmn-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }

  // v1335 タイマー画像 の アップロード hook
  document.getElementById('tmn-image-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const status = document.getElementById('tmn-image-status');
    status.textContent = 'アップロード中…';
    try {
      const data = await uploadImage(f);
      document.getElementById('tmn-image-url').value = data.url;
      const prev = document.getElementById('tmn-image-preview');
      prev.src = data.url; prev.hidden = false;
      status.textContent = 'アップロードしました';
    } catch (e) {
      status.textContent = '失敗: ' + e.message;
    }
  });

  document.getElementById('tmn-save').addEventListener('click', async () => {
    const btn = document.getElementById('tmn-save');
    let title = document.getElementById('tmn-title').value.trim();
    // v449 学会タイマーモデル: ベル時刻を分単位 (小数可) で受け、 end_bell_index で
    // 「発表終了」を指定。 duration_seconds はサーバ側で end_bell の値から自動算出。
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
      toast(`「終了」に選んだ ${endBellIdx}鈴の時刻を入れてください`);
      return;
    }
    if (endBellVal < 5) {
      toast(`${endBellIdx}鈴 (= 終了) は 5 秒以上にしてください`);
      return;
    }
    btn.disabled = true;
    if (!title) {
      btn.textContent = '🤖 タイトル生成中…';
      const part = picker ? [...picker.getSelected()].length : 1;
      const endMin = Math.round(endBellVal / 60 * 10) / 10;
      const ctx = `共有学会タイマーを今 ${part} 人で開始します。発表終了は ${endMin} 分後。用途はたぶん学会発表・ゼミ・ライトニングトーク・ポモドーロなど。ピッタリな短いタイトルを 1 つ。`;
      try {
        const r = await post('/api/ai/short_title', { context: ctx });
        title = r.title || 'タイマー';
      } catch (_) {
        title = 'タイマー';
      }
    }
    btn.textContent = '＋ 作成中…';
    const repeatMax = Math.max(0, Math.min(100, parseInt(document.getElementById('tmn-repeat').value, 10) || 0));
    const imageUrl = document.getElementById('tmn-image-url').value || null;   // v1335
    try {
      const r = await post('/api/timers', {
        title,
        image_url: imageUrl,
        participant_ids: picker ? [...picker.getSelected()] : [],
        bell1_seconds: bell1,
        bell2_seconds: bell2,
        bell3_seconds: bell3,
        end_bell_index: endBellIdx,
        repeat_max: repeatMax,
      });
      toast('タイマーを作成しました — ▶ 開始を押してカウントダウン');
      navigate('#/timers/' + r.id);
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = '＋ 作成';
    }
  });
}

let tmTickTimer = null;
let tmSyncTimer = null;
let tmVisHandler = null;  // v915 タブ 可視化 時に 即 sync する リスナ の 参照 (剥がす 用)
// v408 「ちょうど 0 になった瞬間」を 1 回だけ鳴らすためのフラグ。
// resync で復活してしまうので必要。リピートでサーバが次サイクルに
// 切替えたら tmLastCycleIdx 変化で再 false 化 (下の loadTimerDetail で処理)。
let tmEndFiredOnce = false;
// v411 表示モード: 'remain' (カウントダウン / 超過は +N) or 'elapsed' (カウントアップ)
let tmDisplayMode = (() => {
  try { return localStorage.getItem('labpay-tm-display') || 'remain'; }
  catch (_) { return 'remain'; }
})();
let tmOffsetMs = 0;   // server_now_ms - client_now_at_recv_ms (= server からの遅延補正)
let tmEndsMs = 0;
let tmStartedMs = 0;
let tmClosedMs = 0;         // v453 cancelled/done 時の closed_at (停止時経過計算用)
let tmDurationSec = 0;
let tmRemainingSec = 0;     // v446 paused 時の残り秒数 (running/done では未使用)
let tmBells = [];           // [秒, ...] 開始からの秒数 (非 null だけ、終了ベル含む)
let tmEndBellSec = null;    // v449 終了ベルの秒数 (= duration)。これは ding 専用なので tick loop からは除外。
let tmBellsFired = new Set();
let tmRepeatMax = 0;
let tmRepeatIdx = 0;
let tmLastCycleIdx = -1;
let tmStatus = 'running';

function stopTimerLoops() {
  if (tmTickTimer) { clearInterval(tmTickTimer); tmTickTimer = null; }
  if (tmSyncTimer) { clearTimeout(tmSyncTimer); tmSyncTimer = null; }
  // v915 visibilitychange リスナ を 剥がす (別ページ に 遷移した時 の 漏れ 防止)。
  if (tmVisHandler) { document.removeEventListener('visibilitychange', tmVisHandler); tmVisHandler = null; }
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
        <button id="tmd-test-bell" class="btn" style="font-size:11px; padding:2px 8px" title="チーン (端末で鳴るか確認)">🔊 試聴</button>
        <button id="tmd-fs" class="btn" style="font-size:11px; padding:2px 8px" title="フルスクリーン (発表者に時間を見せる)">🖥 フル</button>
        <button id="tmd-public" class="btn" style="font-size:11px; padding:2px 8px" title="認証不要の公開 URL をコピー (タブレットに開いて演台に置く)">🔗 公開 URL</button>
        <!-- v1337 公開 URL の QR コード。 中村さん要望「自分のスマホとかで見れるように、押すと画面の右側にでも QR を出す」 -->
        <button id="tmd-qr" class="btn" style="font-size:11px; padding:2px 8px" title="公開 URL の QR コード (スマホでスキャンして開ける)">🔳 公開 QR</button>
      </div>
      <button id="tmd-fs-exit" type="button">✕ 終了</button>
      <div id="tmd-title-fs" class="hint-sm" hidden></div>
      <div id="tmd-count" title="タップでカウントダウン ⇄ カウントアップ"
           style="font-size:clamp(96px, 22vw, 180px); font-weight:800; font-variant-numeric:tabular-nums; line-height:1; margin:18px 0 6px; cursor:pointer; user-select:none; letter-spacing:-0.04em">--:--</div>
      <div id="tmd-mode" class="hint-sm" style="margin-top:-4px; margin-bottom:4px">残り時間</div>
      <div id="tmd-elapsed" class="hint-sm">経過 -- / 合計 --</div>
      <div style="background:#eee; height:10px; border-radius:5px; overflow:hidden; margin-top:14px">
        <div id="tmd-bar" style="background:var(--primary); height:100%; width:0%; transition:width 0.4s linear"></div>
      </div>
      <div id="tmd-status" style="margin-top:14px; font-weight:700"></div>
      <!-- v1335 タイマー画像 (ハッカソン 等 で 「今 何 を やっている か」 表示)。 fullscreen mode でも 一緒 に 大きく 表示 される。 -->
      <div id="tmd-image-wrap" hidden style="margin-top:14px">
        <img id="tmd-image" src="" alt="" style="max-width:100%; max-height:40vh; border-radius:8px; object-fit:contain">
      </div>
      <div id="tmd-image-ctrl" class="row no-print" style="gap:6px; justify-content:center; margin-top:6px" hidden>
        <input type="file" id="tmd-image-file" accept="image/*" hidden>
        <button id="tmd-image-change" class="btn" style="font-size:11px; padding:2px 8px">🖼 画像 追加/変更</button>
        <button id="tmd-image-remove" class="btn" style="font-size:11px; padding:2px 8px; color:#c00" hidden>🗑 削除</button>
      </div>
      <!-- v1337 公開 URL の QR コード 表示 area (toggle) -->
      <div id="tmd-qr-wrap" hidden style="margin-top:14px; display:flex; flex-direction:column; align-items:center; gap:6px">
        <div id="tmd-qr-svg" style="background:#fff; padding:12px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.1)"></div>
        <div class="hint-sm" style="text-align:center">スマホの カメラ で スキャン → 公開タイマー</div>
      </div>
    </div>
    <details class="card">
      <summary style="cursor:pointer; font-weight:700; user-select:none">参加者 (<span id="tmd-pcount">0</span>)</summary>
      <div id="tmd-participants" class="row" style="gap:6px; flex-wrap:wrap; margin-top:6px"></div>
    </details>
    <div class="card" id="tmd-ctrl-card">
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="tmd-start" class="primary" hidden>▶ 開始</button>
        <button id="tmd-pause" class="btn"     hidden>⏸ 一時停止</button>
        <button id="tmd-reset" class="btn"     hidden>↻ リセット</button>
        <!-- v1183 中村さん要望「タイマーから離脱する機能が欲しい」 -->
        <button id="tmd-leave" class="btn" hidden style="margin-left:auto; color:#c00">🚪 離脱</button>
      </div>
      <p class="hint-sm" style="margin:6px 0 0">操作は参加者全員 (起案者含む) が可能。 離脱すると自分だけ通知/表示対象から外れる。</p>
    </div>
    <div class="card" id="tmd-admin-card" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="tmd-del" class="danger">削除</button>
      </div>
      <p class="hint-sm" style="margin:6px 0 0">起案者のみ表示 (一時停止は上のボタンから、削除は完全削除)。</p>
    </div>
  `;
  stopTimerLoops();
  await loadTimerDetail(id);
  // 1 秒刻みで表示更新 (offset とサーバの終了時刻から計算)
  tmTickTimer = setInterval(() => tickTimer(), 1000);
  tickTimer();
  // v915 タブ が visible に 戻った 瞬間に 即 sync (background 中の 遅延を 一度に 追いつく)。
  //   これで 「他人が リセットしたのに 自分の 端末は 数秒 遅れる」 も 短縮。 renderTimerDetail が
  //   再エントリー されても 二重登録 防止のため 名前付きで、 stopTimerLoops で 剥がす。
  if (tmVisHandler) document.removeEventListener('visibilitychange', tmVisHandler);
  tmVisHandler = () => {
    if (document.hidden) return;
    if (!document.getElementById('tmd-count')) return;
    if (tmStatus === 'cancelled') return;
    loadTimerDetail(id, { isResync: true }).catch(() => {});
  };
  document.addEventListener('visibilitychange', tmVisHandler);
  // v411 タップで残り ⇄ 経過切替
  document.getElementById('tmd-count')?.addEventListener('click', () => {
    tmDisplayMode = tmDisplayMode === 'remain' ? 'elapsed' : 'remain';
    try { localStorage.setItem('labpay-tm-display', tmDisplayMode); } catch (_) {}
    tickTimer();
  });
  // v453 試聴 — 「鳴らない」訴えの 1 次切り分け用。 click 内で鳴らすので
  // 必ず unlock 済みの状態で走る。鳴らないなら端末側 (silent / volume / etc) 問題。
  document.getElementById('tmd-test-bell')?.addEventListener('click', () => {
    unlockAudio();
    playBoundaryTick();
    setTimeout(() => playEndDing(), 600);
  });
  // v453 → v455 フルスクリーン — 学会タイマーで発表者に時間を見せる。
  // 「🖥 フル」 → 全画面化、「✕ 終了」 / ESC で解除。
  document.getElementById('tmd-fs')?.addEventListener('click', () => {
    enterTimerFullscreen();
  });
  document.getElementById('tmd-fs-exit')?.addEventListener('click', () => {
    exitTimerFullscreen();
  });
  // v676 #256 公開 URL: 認証不要・タブレットで演台に置く用 (タップでクリップボードコピー)
  document.getElementById('tmd-public')?.addEventListener('click', async () => {
    const url = location.origin + '/#/public-timer/' + id;
    try {
      await navigator.clipboard?.writeText?.(url);
      toast('公開 URL をコピーしました: ' + url);
    } catch (_) {
      prompt('この URL をコピーしてタブレットで開いてください:', url);
    }
  });
  // v1337 公開 URL の QR コード (toggle 表示、 スマホ で スキャン して 開く)
  document.getElementById('tmd-qr')?.addEventListener('click', async () => {
    const wrap = document.getElementById('tmd-qr-wrap');
    const svgHost = document.getElementById('tmd-qr-svg');
    if (!wrap.hidden) { wrap.hidden = true; return; }
    svgHost.innerHTML = '<div class="hint-sm">QR 生成中…</div>';
    wrap.hidden = false;
    try {
      const q = await loadQrLib();
      const url = location.origin + '/#/public-timer/' + id;
      const qr = q(0, 'M');
      qr.addData(url);
      qr.make();
      svgHost.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 10, scalable: true });
      const svg = svgHost.querySelector('svg');
      if (svg) { svg.style.width = '220px'; svg.style.height = '220px'; svg.style.display = 'block'; }
    } catch (e) {
      svgHost.innerHTML = '<div class="hint-sm" style="color:#c00">QR 生成失敗: ' + escapeHtml(e.message) + '</div>';
    }
  });
}

// v1337 QR ライブラリ の 遅延 ロード (公開 QR button を 押した 時 のみ vendor/qrcode-generator.min.js を fetch)。
//   MIT license 、 純 JS 、 依存 なし 、 ~20KB。 window.qrcode を 露出 する UMD/plain script。
let _qrLibPromise = null;
function loadQrLib() {
  if (_qrLibPromise) return _qrLibPromise;
  _qrLibPromise = new Promise((resolve, reject) => {
    if (window.qrcode) return resolve(window.qrcode);
    const s = document.createElement('script');
    s.src = '/vendor/qrcode-generator.min.js';
    s.async = true;
    s.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error('qrcode global not found'));
    s.onerror = () => { _qrLibPromise = null; reject(new Error('lib load failed')); };
    document.head.appendChild(s);
  });
  return _qrLibPromise;
}

// v455 真のフルスクリーン (Fullscreen API + CSS フォールバック)。
// iOS Safari は通常要素には Fullscreen API を認めないので黒くなるだけに
// なる問題があった → CSS で position:fixed + inset:0 + z-index で全画面を
// 模すように。 Fullscreen API が通る Chrome / Edge では両方適用 (害なし)。
function enterTimerFullscreen() {
  const card = document.getElementById('tmd-display-card');
  if (!card) return;
  card.classList.add('tmd-fs-on');
  // ブラウザネイティブの Fullscreen が使えるなら使う (chrome 等)。 iOS は拒否で
  // 黙って通る (CSS フォールバックだけで機能する)。
  const req = card.requestFullscreen || card.webkitRequestFullscreen;
  if (req) {
    try { req.call(card).catch(() => {}); } catch (_) {}
  }
  // 外側から ESC や OS のフルスクリーン解除が走ったら CSS の class も外す。
  const handler = () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      // CSS class はそのまま残す? — ユーザが終了ボタンを押したと同義
      // に扱うのが自然。残すと iOS の "黒いまま" になる。
      // ここでは class も外して通常表示に戻す。
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
    // v446 paused は started_at/ends_at が NULL。 NaN を避けるため三項で 0 に。
    tmEndsMs      = t.ends_at    ? Date.parse(String(t.ends_at).replace(' ', 'T'))    : 0;
    tmStartedMs   = t.started_at ? Date.parse(String(t.started_at).replace(' ', 'T')) : 0;
    tmClosedMs    = t.closed_at  ? Date.parse(String(t.closed_at).replace(' ', 'T'))  : 0;
    tmDurationSec = t.duration_seconds;
    tmRemainingSec = Math.max(0, Number(t.remaining_seconds) || 0);
    tmStatus      = t.status;
    // ベル / リピート情報 (resync 時も更新)。 v449 end_bell_index で指定された
    // ベルは ding 専用として別途持ち、 tick loop からは除外。
    const bellArr = [t.bell1_seconds, t.bell2_seconds, t.bell3_seconds];
    tmBells       = bellArr.filter(Number.isFinite);
    tmEndBellSec  = (t.end_bell_index && bellArr[t.end_bell_index - 1])
                      ? Number(bellArr[t.end_bell_index - 1]) : null;
    tmRepeatMax   = t.repeat_max || 0;
    tmRepeatIdx   = t.repeat_idx || 0;
    if (!isResync) tmBellsFired = new Set();
    // v405 running 中はスクリーンを起こし続ける
    // v683 #266 done でも超過視覚表示が続くので wake lock を保持
    if (tmStatus === 'running' || tmStatus === 'done') acquireWakeLock('timer');
    else releaseWakeLock('timer');
    // サイクルが進んだら fired をリセット (リピート 2 周目で再度鳴らす)
    if (tmLastCycleIdx !== tmRepeatIdx) {
      tmBellsFired = new Set();
      tmLastCycleIdx = tmRepeatIdx;
      tmEndFiredOnce = false;  // v408 サイクル切替で終了音も再有効化
    }
    if (!isResync) {
      // v449 ベルの一覧 (1鈴/2鈴/3鈴 + 終了印) をヘッダに表示。
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
      // v1183 中村さん要望「タイマーから離脱する機能が欲しい」→ 参加者なら誰でも離脱可
      if (d.is_participant) {
        const leaveBtn = document.getElementById('tmd-leave');
        if (leaveBtn) {
          leaveBtn.hidden = false;
          leaveBtn.addEventListener('click', async () => {
            if (!confirm('このタイマーから離脱しますか? (通知や表示対象から外れます、 他の参加者は影響なし)')) return;
            try {
              await del(`/api/timers/${id}/leave`);
              toast('離脱しました');
              navigate('#/timers');
            } catch (e) { toast('失敗: ' + e.message); }
          });
        }
      }
      // v446 start/pause/reset は参加者 (含起案者) なら押せる。
      if (d.is_participant || d.is_creator) {
        document.getElementById('tmd-start').addEventListener('click', async () => {
          unlockAudio();  // v453 明示 unlock 「鳴らない」対策 (グローバル unlock のバックアップ)
          try { await patch(`/api/timers/${id}/start`, {}); toast('開始しました'); await loadTimerDetail(id, { isResync: true }); tickTimer(); }
          catch (e) { toast('失敗: ' + e.message); }
        });
        document.getElementById('tmd-pause').addEventListener('click', async () => {
          try { await patch(`/api/timers/${id}/pause`, {}); toast('一時停止しました'); await loadTimerDetail(id, { isResync: true }); tickTimer(); }
          catch (e) { toast('失敗: ' + e.message); }
        });
        document.getElementById('tmd-reset').addEventListener('click', async () => {
          if (!confirm('タイマーを元の長さに戻しますか?')) return;
          try { await patch(`/api/timers/${id}/reset`, {}); toast('リセットしました'); await loadTimerDetail(id, { isResync: true }); tickTimer(); }
          catch (e) { toast('失敗: ' + e.message); }
        });
      }
      if (d.is_creator) {
        document.getElementById('tmd-admin-card').hidden = false;
        // v723 #320 「⏹ 停止」ボタンは「⏸ 一時停止」と紛らわしいので削除。中止したければ削除で。
        document.getElementById('tmd-del').addEventListener('click', async () => {
          if (!confirm('削除しますか?')) return;
          try { await del('/api/timers/' + id); toast('削除しました'); navigate('#/timers'); }
          catch (e) { toast('失敗: ' + e.message); }
        });
        // v1335 画像 の 追加/変更/削除 (作成者 のみ)。 change → 実 file input を発火。
        document.getElementById('tmd-image-ctrl').hidden = false;
        const fileInput = document.getElementById('tmd-image-file');
        document.getElementById('tmd-image-change').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (ev) => {
          const f = ev.target.files?.[0];
          if (!f) return;
          try {
            const up = await uploadImage(f);
            await patch(`/api/timers/${id}/image`, { image_url: up.url });
            toast('画像を設定しました');
            await loadTimerDetail(id, { isResync: true });
          } catch (e) { toast('失敗: ' + e.message); }
        });
        document.getElementById('tmd-image-remove').addEventListener('click', async () => {
          if (!confirm('画像を削除しますか?')) return;
          try {
            await patch(`/api/timers/${id}/image`, { image_url: null });
            toast('画像を削除しました');
            await loadTimerDetail(id, { isResync: true });
          } catch (e) { toast('失敗: ' + e.message); }
        });
      }
      // v1335 画像 URL の 反映 (作成者 でなくても 表示 だけ は 全参加者)。
      const imgWrap = document.getElementById('tmd-image-wrap');
      const imgEl   = document.getElementById('tmd-image');
      const rmBtn   = document.getElementById('tmd-image-remove');
      const chBtn   = document.getElementById('tmd-image-change');
      if (d.timer.image_url) {
        imgEl.src = d.timer.image_url;
        imgWrap.hidden = false;
        if (rmBtn) rmBtn.hidden = false;
        if (chBtn) chBtn.textContent = '🖼 画像 変更';
      } else {
        imgWrap.hidden = true;
        if (rmBtn) rmBtn.hidden = true;
        if (chBtn) chBtn.textContent = '🖼 画像 追加';
      }
    }
    // v446 ボタン表示の出し分けは resync でも走らせる (status 変化を反映)。
    const btnStart = document.getElementById('tmd-start');
    const btnPause = document.getElementById('tmd-pause');
    const btnReset = document.getElementById('tmd-reset');
    if (btnStart && btnPause && btnReset) {
      btnStart.hidden = !(tmStatus === 'paused');
      btnPause.hidden = !(tmStatus === 'running');
      // リセットは削除以外全状態で押せる (running / paused / done / cancelled)。
      btnReset.hidden = false;
    }
    // 次の sync をスケジューリング。残りが少ない時 + 開始直後は頻繁に。
    scheduleSyncNext(id);
  } catch (e) {
    document.getElementById('tmd-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function pickSyncIntervalMs() {
  const now = Date.now() + tmOffsetMs;
  const since = (now - tmStartedMs) / 1000;
  const remaining = (tmEndsMs - now) / 1000;
  // v915 「タイマー超過中や paused 中に 他人が リセットした のを 拾えず、 自分の端末だけ 延々 超過表示 が進む」
  //   問題を修正 (ユーザ報告)。 cancelled 以外は 全部 定期 sync に。 これで 誰かが reset/start/pause した
  //   のを 数秒 内に 全端末が 検知して 追随する。
  if (tmStatus === 'cancelled') return 0;    // 中止済 は 変化しない (削除しか ない)
  // ユーザ要望: 停止中 / リセット後 は 「他人が スタートしたら すぐ 把握」 したいので 1s ポーリング。
  if (tmStatus === 'paused')    return 1_000;
  if (tmStatus === 'done')      return 1_000;  // done 状態 も 誰かが reset → paused に 遷移する 可能性
  // running 中:
  if (remaining <= 0)  return 3_000;  // 超過中 は 3 秒 (他人リセット 追随 + 遅れ ずれ 補正)
  if (since < 30)      return 3_000;  // 開始直後 30 秒 は 3 秒 (ズレ補正)
  if (remaining < 30)  return 3_000;  // 終了直前 30 秒 も 3 秒 (精度大事)
  return 15_000;                      // それ以外 は 15 秒
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
  // ベル発火: 経過秒がベル設定値を越えたら 1 回鳴らす。
  // v449 終了ベル (= duration と同一) は ding 専用なので tick loop から除外。
  // running / done どちらでも鳴らす (= 終了後の質疑時間ベルも通る)。
  // paused 中は started_at が null なので tmStartedMs=0、 elapsed が巨大になる
  // → status guard で skip。
  if ((tmStatus === 'running' || tmStatus === 'done') && tmBells.length && tmStartedMs) {
    const elapsed = Math.floor((now - tmStartedMs) / 1000);
    for (const b of tmBells) {
      if (b === tmEndBellSec) continue;            // 終了ベルは ding 側で鳴る
      if (elapsed >= b && !tmBellsFired.has(b)) {
        tmBellsFired.add(b);
        playBoundaryTick();
      }
    }
  }
  if (tmStatus === 'cancelled') {
    // v453 停止時の経過秒を残す — 「何分何秒で止めたか」が重要な記録になる。
    // closed_at - started_at で復元。 progress バーもそのまま残す。
    let stoppedSec = 0;
    if (tmStartedMs && tmClosedMs) {
      stoppedSec = Math.max(0, Math.floor((tmClosedMs - tmStartedMs) / 1000));
    }
    countEl.textContent = fmtDuration(stoppedSec);
    countEl.style.color = '#888';
    const pct = tmDurationSec ? Math.min(100, (stoppedSec / tmDurationSec) * 100) : 0;
    barEl.style.width = pct.toFixed(1) + '%';
    barEl.style.background = '#888';
    elEl.textContent = `停止時経過 ${fmtDuration(stoppedSec)} / 合計 ${fmtDuration(tmDurationSec)}`;
    stEl.textContent = `⏹ ${fmtDuration(stoppedSec)} で停止 — ↻ リセットで戻せます`;
    return;
  }
  // v446 paused: 残りを固定表示。 tick で減らさない。
  if (tmStatus === 'paused') {
    const modeEl = document.getElementById('tmd-mode');
    countEl.textContent = fmtDuration(tmRemainingSec);
    // v725 #329 paused の数字色を橙 #e65100 → 落ち着いた緑 #0e7c63 に。赤い感じが気を引きすぎるため。
    countEl.style.color = '#0e7c63';
    if (modeEl) modeEl.textContent = '⏸ 一時停止中 — ▶ 開始を押すとカウントダウン';
    elEl.textContent = `残り ${fmtDuration(tmRemainingSec)} / 合計 ${fmtDuration(tmDurationSec)}`;
    const usedSec = Math.max(0, tmDurationSec - tmRemainingSec);
    const pct = tmDurationSec ? Math.min(100, (usedSec / tmDurationSec) * 100) : 0;
    barEl.style.width = pct.toFixed(1) + '%';
    barEl.style.background = 'var(--primary)';
    stEl.textContent = '';
    return;
  }
  // v684 #267 3 フェーズ表示:
  //   ① 発表終了 (= end_bell) まで: 通常のカウントダウン
  //   ② 発表終了 〜 最後のベル: カウントアップモードではそのまま経過、カウントダウン
  //      モードでは 0:00 から上にカウント (= 質疑時間等の経過)
  //   ③ 最後のベルを越えたら「+MM:SS 超過」
  const maxBellSec    = tmBells.length ? Math.max(...tmBells) : 0;
  const endBellSec    = (tmEndBellSec ?? tmDurationSec) || 0;
  const visualEndSec  = Math.max(maxBellSec, endBellSec);
  const elapsed       = (now - tmStartedMs) / 1000;
  const elapsedSec    = Math.max(0, Math.floor(elapsed));
  const remainToEndSec = Math.ceil(endBellSec - elapsed);
  const isOver        = elapsed >= maxBellSec;
  const isPastEnd     = elapsed >= endBellSec;
  const modeEl = document.getElementById('tmd-mode');
  if (tmDisplayMode === 'elapsed') {
    if (isOver) {
      countEl.textContent = '+' + fmtDuration(Math.floor(elapsed - maxBellSec)) + ' 超過';
      countEl.style.color = '#c62828';
    } else {
      countEl.textContent = fmtDuration(elapsedSec);
      countEl.style.color = '';
    }
    if (modeEl) modeEl.textContent = '↑ 経過時間 (タップで残り時間)';
  } else if (isOver) {
    countEl.textContent = '+' + fmtDuration(Math.floor(elapsed - maxBellSec)) + ' 超過';
    countEl.style.color = '#c62828';
    if (modeEl) modeEl.textContent = '↓ 残り時間 (タップで経過時間)';
  } else if (isPastEnd) {
    // ② 発表終了後、最後のベルまでは 0:00 から上にカウント
    // v726 #331 質疑帯は黄色 (#ca8a04 amber) で発表中と区別。
    countEl.textContent = fmtDuration(Math.floor(elapsed - endBellSec));
    countEl.style.color = '#ca8a04';
    if (modeEl) modeEl.textContent = '↓ 残り時間 (タップで経過時間)';
  } else {
    countEl.textContent = fmtDuration(remainToEndSec);
    countEl.style.color = remainToEndSec === 0 ? 'var(--primary)'
                        : remainToEndSec < 10 ? '#c62828'
                        : '';
    if (modeEl) modeEl.textContent = '↓ 残り時間 (タップで経過時間)';
  }
  elEl.textContent = `経過 ${fmtDuration(elapsedSec)} / 合計 ${fmtDuration(visualEndSec)}`;
  // v726 #326 プログレスバー再設計: 合計 = 最後のベル位置を 100%。
  //   発表終了まではベース色 (primary)、質疑帯 (発表終了〜最後のベル) は橙系、超過は赤。
  //   背景に縦線で一鈴 / 二鈴 / 発表終了を示す (= tickStyle inline gradient で表示)。
  const pct = visualEndSec ? Math.min(100, (elapsedSec / visualEndSec) * 100) : 0;
  barEl.style.width = pct.toFixed(1) + '%';
  // v917 「発表終了 後は 全部 黄色に なってしまう / ベル区切り が 消える」 修正 (ユーザ報告)。
  //   従来: bar 全体を 1 色 (primary → 発表終了で 一気に 全部 orange → 超過で 全部 red) に 塗ってた。
  //     視覚的に 「発表中の 進捗 (=青)」 が 質疑帯 に 入った 瞬間 消えて 混乱。
  //   修正: bar 内部を multi-color gradient に。 0 → endBell は primary、 endBell → maxBell は orange、
  //     maxBell → tip は red。 加えて ベル区切り 縦線 (parent の 背景 で 描いていた もの) を bar coord に 再マップして
  //     bar の 上にも 重ねる → 進捗が 塗り 潰しても 区切り が 消えない。
  {
    const primaryCol = 'var(--primary)';
    const orangeCol  = '#f59e0b';
    const redCol     = '#c62828';
    const barWidthSec = Math.min(elapsedSec, visualEndSec);
    let colorGradient;
    if (barWidthSec <= 0) {
      colorGradient = `${primaryCol} 0%, ${primaryCol} 100%`;
    } else if (!isPastEnd) {
      // 発表中: 全部 primary
      colorGradient = `${primaryCol} 0%, ${primaryCol} 100%`;
    } else if (!isOver) {
      // 質疑帯: primary (0 → endBell in bar coord) + orange (残り)
      const endInBar = Math.min(100, (endBellSec / barWidthSec) * 100);
      colorGradient = `${primaryCol} 0%, ${primaryCol} ${endInBar.toFixed(2)}%, ${orangeCol} ${endInBar.toFixed(2)}%, ${orangeCol} 100%`;
    } else {
      // 超過: primary + orange + red (bar は 100% 幅 = visualEndSec)
      const endInBar = Math.min(100, (endBellSec / visualEndSec) * 100);
      const maxInBar = Math.min(100, (maxBellSec / visualEndSec) * 100);
      if (maxInBar >= 99.5) {
        // maxBell == visualEnd の 一般ケース: red 区間 は ゼロ (bar 上に 超過 は 出ない、 数字 だけが 赤に)
        colorGradient = `${primaryCol} 0%, ${primaryCol} ${endInBar.toFixed(2)}%, ${orangeCol} ${endInBar.toFixed(2)}%, ${orangeCol} 100%`;
      } else {
        colorGradient = `${primaryCol} 0%, ${primaryCol} ${endInBar.toFixed(2)}%, ${orangeCol} ${endInBar.toFixed(2)}%, ${orangeCol} ${maxInBar.toFixed(2)}%, ${redCol} ${maxInBar.toFixed(2)}%, ${redCol} 100%`;
      }
    }
    // ベル区切り縦線 を bar 内部 に 再マップ。 bar の 幅 = barWidthSec に 対する 相対位置。
    const barTicks = [];
    if (tmBells && tmBells.length && barWidthSec > 0) {
      for (const b of tmBells) {
        if (b > 0 && b < barWidthSec) barTicks.push((b / barWidthSec) * 100);
      }
    }
    const tickLines = barTicks.map(p =>
      `transparent ${(p - 0.4).toFixed(2)}%, #1e293b ${(p - 0.4).toFixed(2)}%, #1e293b ${(p + 0.4).toFixed(2)}%, transparent ${(p + 0.4).toFixed(2)}%`
    ).join(', ');
    if (tickLines) {
      barEl.style.background =
        `linear-gradient(to right, ${tickLines}),` +
        `linear-gradient(to right, ${colorGradient})`;
    } else {
      barEl.style.background = `linear-gradient(to right, ${colorGradient})`;
    }
  }
  // 背景: 発表終了で切替 + ベル位置に縦線。
  const bgEl = barEl.parentElement;
  if (bgEl && visualEndSec) {
    const endPct = (endBellSec / visualEndSec) * 100;
    const linePcts = [];
    if (tmBells && tmBells.length) {
      // v727 #335 最後のベル (= visualEndSec の位置 = 100%) には線を入れない (端なので不要)。
      for (const b of tmBells) {
        if (b > 0 && b < visualEndSec) linePcts.push((b / visualEndSec) * 100);
      }
    }
    const lines = linePcts.map(p => `transparent ${p - 0.4}%, #333 ${p - 0.4}%, #333 ${p + 0.4}%, transparent ${p + 0.4}%`).join(', ');
    bgEl.style.background = `linear-gradient(to right, #dbeafe 0%, #dbeafe ${endPct}%, #fef3c7 ${endPct}%, #fef3c7 100%)`;
    if (linePcts.length) {
      bgEl.style.backgroundImage =
        `linear-gradient(to right, ${lines}),` +
        `linear-gradient(to right, #dbeafe 0%, #dbeafe ${endPct}%, #fef3c7 ${endPct}%, #fef3c7 100%)`;
    }
  }
  // 発表終了ベルの ding は elapsed が endBellSec を跨いだ瞬間で 1 回のみ。
  if (remainToEndSec === 0 && tmStatus === 'running' && !tmEndFiredOnce) {
    tmEndFiredOnce = true;
    if (tmRepeatMax > 0 && tmRepeatIdx < tmRepeatMax) {
      stEl.textContent = `🔁 リピート ${tmRepeatIdx + 1}/${tmRepeatMax} 回目切替中…`;
    } else {
      stEl.textContent = '🎉 終了!';
      playEndDing();
      // v683 #266 終了後も表示を続けるので wake lock は解放しない
    }
  } else if (tmStatus === 'done') {
    if (isOver) {
      stEl.textContent = `🎉 終了 + 超過 ${fmtDuration(Math.floor(elapsed - maxBellSec))} 経過中`;
    } else if (isPastEnd) {
      stEl.textContent = `🎉 終了 — 質疑 ${fmtDuration(Math.floor(elapsed - endBellSec))}`;
    } else {
      stEl.textContent = '🎉 終了';
    }
  } else if (isOver) {
    stEl.textContent = `⚠ 超過 ${fmtDuration(Math.floor(elapsed - maxBellSec))} 経過中`;
  } else if (isPastEnd) {
    stEl.textContent = `🏁 発表終了 — 質疑 ${fmtDuration(Math.floor(elapsed - endBellSec))}`;
  } else if (tmRepeatMax > 0) {
    stEl.textContent = `🔁 ${tmRepeatIdx + 1}/${tmRepeatMax + 1} 回目`;
  } else {
    stEl.textContent = '';
  }
}
