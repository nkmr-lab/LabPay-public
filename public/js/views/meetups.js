// /#/meetups — 次の待ち合わせ。集合時刻 + 場所 + メンバーを全員に同期する軽量機能。
// タイマー的に「あと N 分で」の表示はするが、個別応答は無し (シンプル)。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { loadLeaflet } from './group_map.js';
import { tag, fmtDateTime, participantPill } from '../format.js';
import { createMemberPicker } from '../member_picker.js';
import { localDtToIso, isoToLocalDt, tzToggleHtml, bindTzToggle } from '../tz_helper.js';
import { copyShareUrl } from '../share_to_sns.js';

// 場所文字列から緯度,経度を拾う。
//   * "35.6586,139.7454" / "35.6586, 139.7454" / "35.6586 139.7454"
//   * "(35.6586, 139.7454) 駅前ホテル" / "lat:35.65 lng:139.74"
// 範囲: 緯度 [-90, 90], 経度 [-180, 180]。駅名や住所文字が混在しても
// 最初の lat/lng ペアを返す。該当無しなら null。
function parseLatLng(s) {
  if (!s) return null;
  const m = String(s).match(/(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

const GRADE_ORDER = ['B3','B4','M1','M2','D',''];
const gradeRank = g => {
  const i = GRADE_ORDER.indexOf(g || '');
  return i < 0 ? GRADE_ORDER.length : i;
};

// 残り時間文字列 (集合済 / まもなく / あと N 分 ...)。 fmtRelative とは独自ラベルなので残置。
// v450 kind=deadline は「集合済」 → 「期限超過」、長期 (>= 1 日) では日単位表示。
function fmtRemaining(s, kind = 'meetup') {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const diff = dt - new Date();
  const passed = kind === 'deadline' ? '⚠ 期限超過' : '集合済';
  if (diff <= 0) return passed;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'まもなく';
  if (min < 60) return `あと ${min} 分`;
  const h = Math.floor(min / 60);
  if (h < 24) return `あと ${h}時間${min % 60}分`;
  const d = Math.floor(h / 24);
  return `あと ${d} 日 ${h % 24} 時間`;
}
function fmtClock(s) {
  if (!s) return '';
  return String(s).slice(11, 16);
}
// 〆切など 1 日以上先の場合は月日も含めた表示。
function fmtClockOrDate(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  const pad = n => String(n).padStart(2, '0');
  if (sameDay) return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  return `${dt.getMonth() + 1}/${dt.getDate()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

const KIND_META = {
  meetup:   { icon: '🤝', label: '待ち合わせ', verb: '集合',   timeLabel: '集合時刻' },
  deadline: { icon: '📌', label: '〆切',       verb: '通知',   timeLabel: '〆切時刻' },
};

export async function renderMeetups({ query } = {}) {
  const kindFilter = (query?.kind === 'meetup' || query?.kind === 'deadline') ? query.kind : '';
  const meta = kindFilter ? KIND_META[kindFilter] : null;
  const app = document.getElementById('app');
  // v450 タイトル + サブ + 「＋ 新規」をフィルタにより切替。フィルタなしは両方表示。
  const headerTitle = meta ? `${meta.icon} ${meta.label}` : '🤝 待ち合わせ / 📌 〆切';
  const headerSub = meta?.label === '〆切'
    ? '〆切時刻 + 対象者を一発で全員に通知。 365 日先まで設定可。'
    : meta?.label === '待ち合わせ'
      ? '集合時刻 + 場所 + メンバーを一発で全員に通知。 180 日先まで。'
      : '集合時刻 / 〆切時刻を全員に通知 (タブで切替)。';
  const tabBtn = (k, txt) => {
    const active = (kindFilter === k) || (!kindFilter && k === '');
    return `<a class="btn ${active ? 'primary' : ''}" href="#/meetups${k ? `?kind=${k}` : ''}">${txt}</a>`;
  };
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">${headerTitle}</h2>
      </div>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:8px">
        ${tabBtn('',         '全部')}
        ${tabBtn('meetup',   '🤝 待ち合わせ')}
        ${tabBtn('deadline', '📌 〆切')}
        <span style="flex:1"></span>
        <a class="btn primary" href="#/meetups/new?kind=meetup">＋ 待ち合わせ</a>
        <a class="btn primary" href="#/meetups/new?kind=deadline">＋ 〆切</a>
      </div>
    </div>
    <div id="mu-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const url = kindFilter ? `/api/meetups?kind=${encodeURIComponent(kindFilter)}` : '/api/meetups';
    const d = await get(url);
    const items = d.items || [];
    if (!items.length) {
      const what = meta ? meta.label : 'アイテム';
      document.getElementById('mu-list').innerHTML = `<div class="empty">${escapeHtml(what)}はまだありません</div>`;
      return;
    }
    document.getElementById('mu-list').innerHTML = items.map(m => {
      const k = m.kind === 'deadline' ? 'deadline' : 'meetup';
      const km = KIND_META[k];
      const active = !m.cancelled_at && new Date(String(m.meetup_at).replace(' ', 'T')) > new Date();
      const statusTag = m.cancelled_at
        ? tag('muted', '取消')
        : active
          ? tag('ok', escapeHtml(fmtRemaining(m.meetup_at, k)))
          : tag('muted', k === 'deadline' ? '期限切れ' : '終了');
      const isMine = Number(m.creator_user_id) === Number(state.me?.id);
      const locPart = m.location ? ` @ ${escapeHtml(m.location)}` : '';
      return `
        <a class="list-item" href="#/meetups/${m.id}">
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${km.icon} ${escapeHtml(m.title || km.label)}</div>
            <div class="meta">${statusTag} · ${escapeHtml(fmtClockOrDate(m.meetup_at))}${locPart} · 起案 ${escapeHtml(m.creator_name)}${isMine ? ' (自分)' : ''}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('mu-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderMeetupNew({ query } = {}) {
  // v450 kind = 'meetup' (default) or 'deadline'
  const kind = (query?.kind === 'deadline') ? 'deadline' : 'meetup';
  const isDeadline = kind === 'deadline';
  const km = KIND_META[kind];
  const presetMembers = String(query?.members || '').trim()
    .split(',').map(Number).filter(Boolean);
  const lockMembers = presetMembers.length > 0;
  const presetTitle = String(query?.title || '').trim();
  const presetLoc = String(query?.location || '').trim();
  // when は "2026-06-04T18:30" の ISO 文字列を受け取り、 24h を超えるなら無視。
  const presetWhenRaw = String(query?.when || '').trim();
  // 〆切は場所欄を隠す (使いたい時は details 内で出す)。
  // プリセットは〆切は長めの期間をラインナップ。
  const presets = isDeadline
    ? [
        { label: '今日 23:59',      special: 'today2359' },
        { label: '明日 17:00',      special: 'tomorrow17' },
        { label: '明日 23:59',      special: 'tomorrow2359' },
        { label: '3 日後',          minutes: 3 * 24 * 60 },
        { label: '1 週間後',        minutes: 7 * 24 * 60 },
        { label: '2 週間後',        minutes: 14 * 24 * 60 },
      ]
    : [
        { label: '30 分後',         minutes: 30 },
        { label: '1 時間後',        minutes: 60 },
        { label: '2 時間後',        minutes: 120 },
        { label: '3 時間後',        minutes: 180 },
        { label: '明日 (24h)',     minutes: 1440 },
        { label: '1 週間後',        minutes: 10080 },
      ];
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/meetups${isDeadline ? '?kind=deadline' : ''}" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">${km.icon} ${km.label} を ${isDeadline ? '通知' : '作る'}</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル (任意)</span>
        <input type="text" id="mun-title" maxlength="200" placeholder="${isDeadline ? '例: スライド提出 / 申込締切' : '例: ランチ集合'}" value="${escapeHtml(presetTitle)}">
      </label>
      ${isDeadline ? `
      <details style="margin:8px 0">
        <summary class="hint" style="cursor:pointer">📍 場所 / メモ (任意)</summary>
        <label class="field" style="margin-top:6px"><span class="lbl">場所 / メモ</span>
          <input type="text" id="mun-loc" maxlength="500" placeholder="例: フォームURL / 部屋番号" value="${escapeHtml(presetLoc)}">
        </label>
      </details>
      ` : `
      <label class="field"><span class="lbl">場所 (任意)</span>
        <input type="text" id="mun-loc" maxlength="500" placeholder="例: 14F ロビー / 駅前 / 35.6586,139.7454" value="${escapeHtml(presetLoc)}">
        <span class="hint-sm" style="font-size:11px">緯度,経度 (例 35.6586,139.7454) を入れると地図表示されます</span>
      </label>
      `}
      <span class="lbl">${km.timeLabel}</span>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin:4px 0 6px">
        ${presets.map((p, i) => `<button class="btn" data-mu-preset-idx="${i}">${escapeHtml(p.label)}</button>`).join('')}
      </div>
      ${tzToggleHtml('mun-tz')}
      <div class="row" style="gap:6px; align-items:center">
        <input type="datetime-local" id="mun-when" style="flex:1; min-width:180px">
        <span class="hint-sm" id="mun-rem"></span>
      </div>
      <div class="field" style="margin-top:10px">
        <span class="lbl">参加者${lockMembers ? ' (グループ内)' : ''}</span>
        ${lockMembers ? '' : `<div id="mun-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>`}
        <div id="mun-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/meetups${isDeadline ? '?kind=deadline' : ''}" class="btn">キャンセル</a>
        <button id="mun-save" class="primary">${km.icon} ${isDeadline ? '〆切を通知' : '集合連絡'}</button>
      </div>
    </div>
  `;
  // プリセット時刻ボタン: 現在時刻 + N 分に datetime-local を埋める。
  const whenEl = document.getElementById('mun-when');
  const remEl = document.getElementById('mun-rem');
  const pad = n => String(n).padStart(2, '0');
  const formatLocal = (dt) =>
    `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  const applyPreset = (p) => {
    let dt;
    if (p.special === 'today2359') {
      dt = new Date(); dt.setHours(23, 59, 0, 0);
    } else if (p.special === 'tomorrow17') {
      dt = new Date(); dt.setDate(dt.getDate() + 1); dt.setHours(17, 0, 0, 0);
    } else if (p.special === 'tomorrow2359') {
      dt = new Date(); dt.setDate(dt.getDate() + 1); dt.setHours(23, 59, 0, 0);
    } else {
      dt = new Date(Date.now() + Number(p.minutes) * 60_000);
    }
    whenEl.value = formatLocal(dt);
    syncRem();
  };
  const syncRem = () => {
    if (!whenEl.value) { remEl.textContent = ''; return; }
    const diff = new Date(whenEl.value) - new Date();
    if (diff <= 0) remEl.textContent = '(過去です)';
    else if (diff < 60_000) remEl.textContent = '(まもなく)';
    else if (diff < 3600_000) remEl.textContent = `(あと ${Math.floor(diff/60000)} 分)`;
    else if (diff < 86400_000) remEl.textContent = `(あと ${Math.floor(diff/3600000)} 時間${Math.floor((diff%3600000)/60000)} 分)`;
    else remEl.textContent = `(あと ${Math.floor(diff/86400_000)} 日 ${Math.floor((diff%86400_000)/3600000)} 時間)`;
  };
  document.querySelectorAll('[data-mu-preset-idx]').forEach(b => {
    b.addEventListener('click', () => applyPreset(presets[Number(b.dataset.muPresetIdx)]));
  });
  whenEl.addEventListener('input', syncRem);
  // v560 #213 TZ toggle: 切替時に preset / 既存値の表示を再計算するため reload-relative
  //   な計算をするより、ボタンを再 click して埋め直す方が確実なので簡略実装
  bindTzToggle('mun-tz', () => {
    // 切替後はフォームの値が JST/ローカルどちらの解釈に変わるので、ユーザーが手動で
    //   合わせ直す前提 (ヒント文だけ更新)
    syncRem();
  });
  // URL 経由の preset 時刻を優先 (期限内かつ未来なら採用)。
  let usedPreset = false;
  const maxAheadMs = (isDeadline ? 365 : 180) * 86400_000;
  if (presetWhenRaw) {
    const t = new Date(presetWhenRaw).getTime();
    if (Number.isFinite(t) && t > Date.now() + 30_000 && t <= Date.now() + maxAheadMs) {
      whenEl.value = presetWhenRaw.length >= 16 ? presetWhenRaw.slice(0, 16) : presetWhenRaw;
      syncRem();
      usedPreset = true;
    }
  }
  if (!usedPreset) applyPreset(presets[0]); // デフォは先頭プリセット

  // v383 共有 member_picker を使用。 lockMembers の時は poolIds で表示を制限、
  //       bulk ボタンは出さない (= グループ内メンバーから選ぶだけ)。
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer: lockMembers ? null : document.getElementById('mun-bulk'),
      chipsContainer: document.getElementById('mun-members'),
      initial: presetMembers,
      poolIds: lockMembers ? presetMembers : null,
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('mun-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }

  document.getElementById('mun-save').addEventListener('click', async () => {
    const title = document.getElementById('mun-title').value.trim();
    const locEl = document.getElementById('mun-loc');
    const location = locEl ? locEl.value.trim() : '';
    const whenLocal = whenEl.value;
    if (!whenLocal) { toast(`${km.timeLabel}を入れてください`); return; }
    // v560 #213 タイムゾーン helper で「JST / ローカル」切替可能化
    const whenUtc = localDtToIso(whenLocal);
    const memberIds = picker ? [...picker.getSelected()] : [];
    if (!memberIds.length) { toast(`${isDeadline ? '対象者' : '参加者'}を 1 人以上`); return; }
    try {
      const r = await post('/api/meetups', {
        kind, title, location, meetup_at: whenUtc, member_ids: memberIds,
      });
      toast(isDeadline ? '〆切を通知しました' : '待ち合わせを連絡しました');
      navigate('#/meetups/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

let muCountdownTimer = null;
export async function renderMeetupDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/meetups" class="hint">← 一覧</a>
      <div id="mud-head"><div class="muted">読み込み中…</div></div>
    </div>
    <div class="card" style="text-align:center" id="mud-clock-card" hidden>
      <div id="mud-when" style="font-size:48px; font-weight:700; font-variant-numeric:tabular-nums">--:--</div>
      <div id="mud-rem" class="muted" style="font-size:13px; margin-top:4px">--</div>
      <div id="mud-loc" style="margin-top:8px; font-size:14px"></div>
      <div id="mud-map" style="margin-top:8px; border-radius:8px; overflow:hidden" hidden></div>
    </div>
    <div class="card">
      <div class="row center" style="margin-bottom:6px">
        <h3 style="margin:0">参加者 (<span id="mud-pn">0</span>)</h3>
        <button id="mud-add-mem" class="btn" style="margin-left:auto; font-size:11px; padding:2px 8px">＋ 追加</button>
      </div>
      <div id="mud-parts" class="row" style="gap:6px; flex-wrap:wrap"></div>
      <div id="mud-add-mem-form" hidden style="margin-top:8px"></div>
    </div>
    <div class="card" id="mud-admin" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="mud-edit"   class="btn primary">✏ 編集</button>
        <button id="mud-cancel" class="btn">❌ 取消</button>
        <button id="mud-del"    class="danger">削除</button>
      </div>
      <div id="mud-edit-form" hidden style="margin-top:8px"></div>
    </div>
    <!-- v482 #71 シェアメッセージ。「少し遅れます」「もう入ってます」等 -->
    <div class="card" id="mud-msg-card">
      <h3 style="margin:0 0 6px">💬 メッセージ (<span id="mud-mn">0</span>)</h3>
      <div id="mud-msgs" class="list" style="margin-bottom:8px"><div class="muted">読み込み中…</div></div>
      <div class="row" style="gap:6px">
        <input type="text" id="mud-msg-body" maxlength="1000" placeholder="少し遅れます / 先に中に入ってます等" style="flex:1">
        <button id="mud-msg-send" class="primary">送信</button>
      </div>
    </div>
  `;
  if (muCountdownTimer) { clearInterval(muCountdownTimer); muCountdownTimer = null; }
  try {
    const d = await get('/api/meetups/' + id);
    const m = d.meetup;
    const km = KIND_META[m.kind === 'deadline' ? 'deadline' : 'meetup'];
    document.getElementById('mud-head').innerHTML = `
      <div class="row center" style="gap:8px">
        <h2 style="margin:6px 0 0; flex:1">${km.icon} ${escapeHtml(m.title || km.label)}</h2>
        <button id="mud-copy-url" class="btn" style="font-size:12px; padding:4px 8px">🔗 URL</button>
      </div>
      <div class="meta">起案 ${escapeHtml(m.creator_name)}${m.cancelled_at ? ' · ' + tag('muted', '取消済') : ''}</div>
    `;
    document.getElementById('mud-copy-url')?.addEventListener('click', () => copyShareUrl(`#/meetups/${id}`));
    const cardClock = document.getElementById('mud-clock-card');
    cardClock.hidden = false;
    const updateClock = () => {
      const whenEl = document.getElementById('mud-when');
      const remEl = document.getElementById('mud-rem');
      const dt = new Date(String(m.meetup_at).replace(' ', 'T'));
      const pad = n => String(n).padStart(2, '0');
      if (whenEl) {
        // 〆切 / 待ち合わせいずれも表示は HH:MM。日付が違う場合のみ月/日も。
        const now = new Date();
        const sameDay = now.toDateString() === dt.toDateString();
        whenEl.textContent = sameDay
          ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}`
          : `${dt.getMonth() + 1}/${dt.getDate()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      }
      const remStr = m.cancelled_at ? '❌ 取消されました' : fmtRemaining(m.meetup_at, m.kind);
      if (remEl) remEl.textContent = remStr;
      if (m.cancelled_at) { clearInterval(muCountdownTimer); }
    };
    updateClock();
    muCountdownTimer = setInterval(updateClock, 1000);
    const locEl = document.getElementById('mud-loc');
    const ll = parseLatLng(m.location);
    if (locEl) {
      // 緯度/経度っぽい時は Google Maps を coord 形式に。そうでなければ住所/施設名検索。
      const href = ll
        ? `https://maps.google.com/?q=${ll.lat},${ll.lng}`
        : `https://maps.google.com/?q=${encodeURIComponent(m.location || '')}`;
      locEl.innerHTML = m.location
        ? `📍 <a href="${href}" target="_blank" rel="noopener" style="color:var(--primary)">${escapeHtml(m.location)}</a>`
        : '<span class="muted">場所未指定</span>';
    }
    // 緯度/経度が入っていれば Leaflet で小マップを差し込む。
    const mapBox = document.getElementById('mud-map');
    if (mapBox) {
      if (ll) {
        mapBox.hidden = false;
        try {
          const L = await loadLeaflet();
          if (mapBox._muMap) { mapBox._muMap.remove(); mapBox._muMap = null; }
          mapBox.style.height = '200px';
          const map = L.map(mapBox, { zoomControl: true }).setView([ll.lat, ll.lng], 16);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap', maxZoom: 19,
          }).addTo(map);
          L.marker([ll.lat, ll.lng]).addTo(map).bindPopup(escapeHtml(m.title || '集合場所'));
          mapBox._muMap = map;
        } catch (e) {
          mapBox.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
        }
      } else {
        mapBox.hidden = true;
      }
    }
    document.getElementById('mud-pn').textContent = d.participants.length;
    document.getElementById('mud-parts').innerHTML = d.participants.map(participantPill).join('');
    // v468 ＋追加ボタン (関係者全員が押せる — 起案者 + 既参加メンバー + admin)
    const meId = Number(state.me?.id);
    const isParticipant = (d.participants || []).some(p => Number(p.user_id) === meId);
    const canAddMember = d.is_creator || isParticipant || state.me?.role === 'admin';
    const addBtn = document.getElementById('mud-add-mem');
    if (addBtn) addBtn.style.display = canAddMember ? '' : 'none';
    if (canAddMember) {
      addBtn.addEventListener('click', async () => {
        const form = document.getElementById('mud-add-mem-form');
        if (!form.hidden) { form.hidden = true; return; }
        form.hidden = false;
        form.innerHTML = `
          <div id="mud-add-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
          <div id="mud-add-members" class="row" style="gap:6px; flex-wrap:wrap"></div>
          <div class="row" style="gap:6px; justify-content:flex-end; margin-top:6px">
            <button id="mud-add-cancel" class="btn">キャンセル</button>
            <button id="mud-add-save" class="primary">追加</button>
          </div>`;
        const existingIds = (d.participants || []).map(p => Number(p.user_id));
        let picker = null;
        try {
          picker = await createMemberPicker({
            bulkContainer: document.getElementById('mud-add-bulk'),
            chipsContainer: document.getElementById('mud-add-members'),
            initial: [],
            excludeIds: existingIds,   // 既参加は候補から除外
            showGenderBulk: false,
          });
        } catch (e) {
          document.getElementById('mud-add-members').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
        }
        document.getElementById('mud-add-cancel').onclick = () => { form.hidden = true; };
        document.getElementById('mud-add-save').onclick = async () => {
          const ids = picker ? [...picker.getSelected()] : [];
          if (!ids.length) { toast('追加するメンバーを選んでください'); return; }
          try {
            const r = await post(`/api/meetups/${id}/participants`, { member_ids: ids });
            toast(`${r.added} 人追加しました`);
            form.hidden = true;
            await renderMeetupDetail({ params: { id } });
          } catch (e) { toast('失敗: ' + e.message); }
        };
      });
    }
    if (d.is_creator) {
      const admin = document.getElementById('mud-admin');
      admin.hidden = false;
      // v468 ✏ 編集
      document.getElementById('mud-edit').addEventListener('click', () => {
        const form = document.getElementById('mud-edit-form');
        if (!form.hidden) { form.hidden = true; return; }
        form.hidden = false;
        const meetupLocal = (() => {
          if (!m.meetup_at) return '';
          const dt = new Date(String(m.meetup_at).replace(' ', 'T'));
          const pad = n => String(n).padStart(2, '0');
          return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        })();
        const isDeadline = m.kind === 'deadline';
        const km = KIND_META[isDeadline ? 'deadline' : 'meetup'];
        form.innerHTML = `
          <label class="field"><span class="lbl">タイトル</span>
            <input type="text" id="mud-edit-title" maxlength="200" value="${escapeHtml(m.title || '')}">
          </label>
          <label class="field"><span class="lbl">${escapeHtml(isDeadline ? '場所 / メモ (任意)' : '場所 (任意)')}</span>
            <input type="text" id="mud-edit-loc" maxlength="500" value="${escapeHtml(m.location || '')}">
          </label>
          <label class="field"><span class="lbl">${escapeHtml(km.timeLabel)}</span>
            <input type="datetime-local" id="mud-edit-when" value="${escapeHtml(meetupLocal)}">
          </label>
          <div class="row" style="gap:6px; justify-content:flex-end; margin-top:6px">
            <button id="mud-edit-cancel" class="btn">キャンセル</button>
            <button id="mud-edit-save" class="primary">保存</button>
          </div>`;
        document.getElementById('mud-edit-cancel').onclick = () => { form.hidden = true; };
        document.getElementById('mud-edit-save').onclick = async () => {
          const title = document.getElementById('mud-edit-title').value.trim();
          const loc   = document.getElementById('mud-edit-loc').value.trim();
          const whenLocal = document.getElementById('mud-edit-when').value;
          if (!whenLocal) { toast(`${km.timeLabel}を入れてください`); return; }
          // v560 #213 TZ helper 経由
          const when = localDtToIso(whenLocal);
          try {
            await patch(`/api/meetups/${id}`, { title, location: loc, meetup_at: when });
            toast('保存しました');
            await renderMeetupDetail({ params: { id } });
          } catch (e) { toast('失敗: ' + e.message); }
        };
      });
      document.getElementById('mud-cancel').disabled = !!m.cancelled_at;
      document.getElementById('mud-cancel').addEventListener('click', async () => {
        if (!confirm('待ち合わせを取消しますか? (参加者全員に通知が飛びます)')) return;
        try { await patch(`/api/meetups/${id}/cancel`, {}); toast('取消しました'); await renderMeetupDetail({ params: { id } }); }
        catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('mud-del').addEventListener('click', async () => {
        if (!confirm('削除しますか?')) return;
        try { await del('/api/meetups/' + id); toast('削除しました'); navigate('#/meetups'); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    }
    // v482 #71 シェアメッセージ
    await loadMeetupMessages(id);
    document.getElementById('mud-msg-send').addEventListener('click', async () => {
      const input = document.getElementById('mud-msg-body');
      const text = input.value.trim();
      if (!text) { toast('本文を入れてください'); return; }
      try {
        await post(`/api/meetups/${id}/messages`, { body: text });
        input.value = '';
        await loadMeetupMessages(id);
      } catch (e) { toast('失敗: ' + e.message); }
    });
    document.getElementById('mud-msg-body').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) {
        ev.preventDefault();
        document.getElementById('mud-msg-send').click();
      }
    });
  } catch (e) {
    document.getElementById('mud-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function loadMeetupMessages(meetupId) {
  const root = document.getElementById('mud-msgs');
  if (!root) return;
  try {
    const d = await get(`/api/meetups/${meetupId}/messages`);
    const items = d.items || [];
    document.getElementById('mud-mn').textContent = items.length;
    if (!items.length) {
      root.innerHTML = '<div class="empty" style="padding:6px; font-size:12px">まだメッセージなし</div>';
      return;
    }
    root.innerHTML = items.map(m => {
      const dt = new Date(String(m.created_at).replace(' ', 'T'));
      const pad = n => String(n).padStart(2, '0');
      const t = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      return `
        <div class="list-item" style="align-items:flex-start; gap:6px; padding:6px 4px">
          ${m.avatar_url
            ? `<img src="${escapeHtml(m.avatar_url)}" alt="" style="flex:none; width:22px; height:22px; border-radius:50%; object-fit:cover">`
            : `<div style="flex:none; width:22px; height:22px; border-radius:50%; background:#ede4f3; color:#4a106d; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:11px">${escapeHtml((m.display_name || '?').trim().charAt(0).toUpperCase())}</div>`}
          <div class="grow" style="min-width:0">
            <div class="row" style="gap:6px; align-items:baseline">
              <span class="bold" style="font-size:13px">${escapeHtml(m.display_name)}</span>
              <span class="hint" style="font-size:11px">${t}</span>
            </div>
            <div style="font-size:13.5px; line-height:1.45; white-space:pre-wrap">${escapeHtml(m.body)}</div>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
