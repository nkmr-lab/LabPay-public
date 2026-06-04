// /#/meetups — 次の待ち合わせ。 集合時刻 + 場所 + メンバー を 全員に同期する軽量機能。
// タイマー的に 「あと N 分で」 の表示はするが、 個別応答は無し (シンプル)。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { loadLeaflet } from './group_map.js';
import { tag, fmtDateTime, participantPill } from '../format.js';
import { createMemberPicker } from '../member_picker.js';

// 場所文字列から 緯度,経度 を拾う。
//   * "35.6586,139.7454" / "35.6586, 139.7454" / "35.6586 139.7454"
//   * "(35.6586, 139.7454) 駅前ホテル" / "lat:35.65 lng:139.74"
// 範囲: 緯度 [-90, 90], 経度 [-180, 180]。 駅名や住所文字が混在しても
// 最初の lat/lng ペアを返す。 該当無しなら null。
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
function fmtRemaining(s) {
  if (!s) return '';
  const dt = new Date(String(s).replace(' ', 'T'));
  const diff = dt - new Date();
  if (diff <= 0) return '集合済';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'まもなく';
  if (min < 60) return `あと ${min} 分`;
  const h = Math.floor(min / 60);
  return `あと ${h}時間${min % 60}分`;
}
function fmtClock(s) {
  if (!s) return '';
  return String(s).slice(11, 16);
}

export async function renderMeetups() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">🤝 待ち合わせ</h2>
        <a class="btn primary" href="#/meetups/new">＋ 新規</a>
      </div>
      <p class="card-subtitle" style="margin:6px 0 0">
        集合時刻 + 場所 + メンバー を 一発で全員に通知。
      </p>
    </div>
    <div id="mu-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/meetups');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('mu-list').innerHTML = '<div class="empty">待ち合わせはまだありません</div>';
      return;
    }
    document.getElementById('mu-list').innerHTML = items.map(m => {
      const active = !m.cancelled_at && new Date(String(m.meetup_at).replace(' ', 'T')) > new Date();
      const statusTag = m.cancelled_at
        ? tag('muted', '取消')
        : active
          ? tag('ok', escapeHtml(fmtRemaining(m.meetup_at)))
          : tag('muted', '終了');
      const isMine = Number(m.creator_user_id) === Number(state.me?.id);
      const locPart = m.location ? ` @ ${escapeHtml(m.location)}` : '';
      return `
        <a class="list-item" href="#/meetups/${m.id}">
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(m.title || '待ち合わせ')}</div>
            <div class="meta">${statusTag} · ${escapeHtml(fmtClock(m.meetup_at))}${locPart} · 起案 ${escapeHtml(m.creator_name)}${isMine ? ' (自分)' : ''}</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('mu-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderMeetupNew({ query } = {}) {
  const presetMembers = String(query?.members || '').trim()
    .split(',').map(Number).filter(Boolean);
  const lockMembers = presetMembers.length > 0;
  const presetTitle = String(query?.title || '').trim();
  const presetLoc = String(query?.location || '').trim();
  // when は "2026-06-04T18:30" の ISO 文字列を受け取り、 24h を超えるなら無視。
  const presetWhenRaw = String(query?.when || '').trim();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/meetups" class="hint">← 一覧</a>
      <h2 style="margin:6px 0 0">🤝 待ち合わせを作る</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">タイトル (任意)</span>
        <input type="text" id="mun-title" maxlength="200" placeholder="例: ランチ集合" value="${escapeHtml(presetTitle)}">
      </label>
      <label class="field"><span class="lbl">場所 (任意)</span>
        <input type="text" id="mun-loc" maxlength="500" placeholder="例: 14F ロビー / 駅前 / 35.6586,139.7454" value="${escapeHtml(presetLoc)}">
        <span class="hint-sm" style="font-size:11px">緯度,経度 (例 35.6586,139.7454) を入れると地図表示されます</span>
      </label>
      <span class="lbl">集合時刻</span>
      <div class="row" style="gap:6px; flex-wrap:wrap; margin:4px 0 6px">
        <button class="btn" data-mu-preset="30">30 分後</button>
        <button class="btn" data-mu-preset="60">1 時間後</button>
        <button class="btn" data-mu-preset="120">2 時間後</button>
        <button class="btn" data-mu-preset="180">3 時間後</button>
      </div>
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
        <a href="#/meetups" class="btn">キャンセル</a>
        <button id="mun-save" class="primary">🤝 集合連絡</button>
      </div>
    </div>
  `;
  // プリセット時刻ボタン: 現在時刻 + N 分 に datetime-local を埋める。
  const whenEl = document.getElementById('mun-when');
  const remEl = document.getElementById('mun-rem');
  const setPreset = (mins) => {
    const dt = new Date(Date.now() + mins * 60_000);
    const pad = n => String(n).padStart(2, '0');
    whenEl.value = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    syncRem();
  };
  const syncRem = () => {
    if (!whenEl.value) { remEl.textContent = ''; return; }
    const diff = new Date(whenEl.value) - new Date();
    if (diff <= 0) remEl.textContent = '(過去です)';
    else if (diff < 60_000) remEl.textContent = '(まもなく)';
    else if (diff < 3600_000) remEl.textContent = `(あと ${Math.floor(diff/60000)} 分)`;
    else remEl.textContent = `(あと ${Math.floor(diff/3600000)} 時間${Math.floor((diff%3600000)/60000)} 分)`;
  };
  document.querySelectorAll('[data-mu-preset]').forEach(b => {
    b.addEventListener('click', () => setPreset(Number(b.dataset.muPreset)));
  });
  whenEl.addEventListener('input', syncRem);
  // URL 経由の preset 時刻を 優先 (24h 以内かつ未来時刻なら採用)。
  let usedPreset = false;
  if (presetWhenRaw) {
    const t = new Date(presetWhenRaw).getTime();
    if (Number.isFinite(t) && t > Date.now() + 30_000 && t <= Date.now() + 24 * 3600_000) {
      whenEl.value = presetWhenRaw.length >= 16 ? presetWhenRaw.slice(0, 16) : presetWhenRaw;
      syncRem();
      usedPreset = true;
    }
  }
  if (!usedPreset) setPreset(30); // デフォは 30 分後

  // v383 共有 member_picker を 使用。 lockMembers の時は poolIds で 表示を制限、
  //       bulk ボタンは 出さない (= グループ内 メンバーから選ぶだけ)。
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
    const location = document.getElementById('mun-loc').value.trim();
    const when = whenEl.value;
    if (!when) { toast('集合時刻を入れてください'); return; }
    const memberIds = picker ? [...picker.getSelected()] : [];
    if (!memberIds.length) { toast('参加者を 1 人以上'); return; }
    try {
      const r = await post('/api/meetups', {
        title, location, meetup_at: when, member_ids: memberIds,
      });
      toast('待ち合わせを連絡しました');
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
      <h3 style="margin:0 0 6px">参加者 (<span id="mud-pn">0</span>)</h3>
      <div id="mud-parts" class="row" style="gap:6px; flex-wrap:wrap"></div>
    </div>
    <div class="card" id="mud-admin" hidden>
      <div class="row" style="gap:6px; flex-wrap:wrap">
        <button id="mud-cancel" class="btn">❌ 取消</button>
        <button id="mud-del" class="danger">削除</button>
      </div>
    </div>
  `;
  if (muCountdownTimer) { clearInterval(muCountdownTimer); muCountdownTimer = null; }
  try {
    const d = await get('/api/meetups/' + id);
    const m = d.meetup;
    document.getElementById('mud-head').innerHTML = `
      <h2 style="margin:6px 0 0">${escapeHtml(m.title || '待ち合わせ')}</h2>
      <div class="meta">起案 ${escapeHtml(m.creator_name)}${m.cancelled_at ? ' · ' + tag('muted', '取消済') : ''}</div>
    `;
    const cardClock = document.getElementById('mud-clock-card');
    cardClock.hidden = false;
    const updateClock = () => {
      const whenEl = document.getElementById('mud-when');
      const remEl = document.getElementById('mud-rem');
      const dt = new Date(String(m.meetup_at).replace(' ', 'T'));
      const pad = n => String(n).padStart(2, '0');
      if (whenEl) whenEl.textContent = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      const remStr = m.cancelled_at ? '❌ 取消されました' : fmtRemaining(m.meetup_at);
      if (remEl) remEl.textContent = remStr;
      if (m.cancelled_at) { clearInterval(muCountdownTimer); }
    };
    updateClock();
    muCountdownTimer = setInterval(updateClock, 1000);
    const locEl = document.getElementById('mud-loc');
    const ll = parseLatLng(m.location);
    if (locEl) {
      // 緯度/経度っぽい時は Google Maps を coord 形式に。 そうでなければ住所/施設名検索。
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
    if (d.is_creator) {
      const admin = document.getElementById('mud-admin');
      admin.hidden = false;
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
  } catch (e) {
    document.getElementById('mud-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
