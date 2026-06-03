import { get, post } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { refreshMe, state, toast } from '../app.js';
import { ledgerTypeLabel } from '../labels.js';
import { coverListItem } from './groups.js';

// 残高ヒーロー以外のホームカード一覧 (上から下の表示既定順)。設定の
// 「ホームのカスタマイズ」 でユーザーごとに並び順・非表示を変えられる。
// データは localStorage に保存し、サーバ側には送らない。
export const HOME_CARDS = [
  { id: 'presence',       title: '今ラボにいる人' },
  { id: 'calendar',       title: '今日の予定' },
  { id: 'groups',         title: 'あなたのグループ' },
  { id: 'fresh-listings', title: '新規入荷' },
  { id: 'my-claims',      title: 'あなたが引き受け中のタスク' },
  { id: 'fresh-tasks',    title: '新規タスク' },
  { id: 'invitations',    title: '募集' },
  { id: 'history',        title: '履歴' },
];

const HOME_LAYOUT_KEY = 'labpay-home-layout';
export function readHomeLayout() {
  try {
    const j = JSON.parse(localStorage.getItem(HOME_LAYOUT_KEY) || '{}');
    return {
      order:  Array.isArray(j.order)  ? j.order  : [],
      hidden: Array.isArray(j.hidden) ? j.hidden : [],
    };
  } catch { return { order: [], hidden: [] }; }
}
export function writeHomeLayout(layout) {
  try {
    localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify({
      order:  Array.isArray(layout.order)  ? layout.order  : [],
      hidden: Array.isArray(layout.hidden) ? layout.hidden : [],
    }));
  } catch {}
}

// 初期 render 後に呼ぶ。 #home-cards-region の中の data-card-id 持ち要素を
// 保存された order に並び替え + hidden 指定のものに .home-card-user-hidden を付与。
function applyHomeLayout() {
  const region = document.getElementById('home-cards-region');
  if (!region) return;
  const layout = readHomeLayout();
  const cards = Array.from(region.querySelectorAll(':scope > [data-card-id]'));
  const knownIds = cards.map(c => c.dataset.cardId);
  // 保存 order に無いカード (新規追加された機能など) は既定順のまま末尾に。
  const orderedKnown = [
    ...layout.order.filter(id => knownIds.includes(id)),
    ...knownIds.filter(id => !layout.order.includes(id)),
  ];
  for (const id of orderedKnown) {
    const el = cards.find(c => c.dataset.cardId === id);
    if (el) region.appendChild(el);
  }
  for (const card of cards) {
    card.classList.toggle('home-card-user-hidden', layout.hidden.includes(card.dataset.cardId));
  }
}

export async function renderHome() {
  if (!state.me) await refreshMe();
  if (!state.me) { navigate('#/login'); return; }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card balance-hero">
      <a href="#/history" class="balance-line" id="home-balance-link"
         style="display:block; text-decoration:none; color:inherit; cursor:pointer">
        <span class="lbl">残高</span>
        <span class="num" id="home-balance">— pt</span>
      </a>
      <div class="muted" id="streak-line">連続ラボイン — 日 (最長 — 日)</div>
      <a id="home-medals" href="#/achievements" class="home-medals" title="実績"></a>
      <div id="checkin-area" style="margin-top:10px"></div>
      <div style="margin-top:14px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap">
        <a class="btn" href="#/buy">買う</a>
        <a class="btn" href="#/sell">売る</a>
        <a class="btn" href="#/tasks?new=request">頼む</a>
        <a class="btn" href="#/send">送る</a>
      </div>
    </div>

    <div id="home-cards-region">
    <div class="card" data-card-id="presence">
      <div class="row center">
        <h2 class="row-title">今ラボにいる人</h2>
        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px" class="muted">
          名前を表示
          <span class="switch">
            <input type="checkbox" id="presence-names-toggle">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <div id="presence" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
      <div style="text-align:right; margin-top:8px">
        <a href="#/activity" class="hint">ラボ滞在・活動マップ →</a>
      </div>
    </div>

    <div class="card" id="home-calendar-card" data-card-id="calendar" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">今日の予定</h2>
      </div>
      <div id="home-calendar" class="list"></div>
    </div>
    <div id="home-mtg-modal" hidden></div>

    <div class="card" id="home-groups-card" data-card-id="groups" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">あなたのグループ</h2>
        <a href="#/groups" class="hint">グループ一覧 →</a>
      </div>
      <div id="home-groups" class="list"></div>
    </div>

    <div class="card" data-card-id="fresh-listings">
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">新規入荷</h2>
        <a href="#/buy" class="hint">商品一覧 →</a>
      </div>
      <div id="home-fresh-listings" class="list"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card" id="home-my-claims-card" data-card-id="my-claims" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">あなたが引き受け中のタスク</h2>
      </div>
      <div id="home-my-claims" class="list"></div>
    </div>

    <div class="card" data-card-id="fresh-tasks">
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">新規タスク</h2>
        <a href="#/tasks" class="hint">一覧 →</a>
      </div>
      <div id="home-fresh-tasks" class="list"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card" id="home-invs-card" data-card-id="invitations">
      <div class="row center" style="margin-bottom:6px">
        <h2 class="row-title">募集</h2>
        <a href="#/invitations" class="hint">一覧 →</a>
      </div>
      <div id="home-invs" class="list"><div class="muted">読み込み中…</div></div>
    </div>

    <details class="card" data-card-id="history">
      <summary style="cursor:pointer; font-weight:700; font-size:var(--text-lg); list-style:none">
        履歴 <a href="#/history" class="hint" style="font-weight:400; margin-left:6px" onclick="event.stopPropagation()">すべて見る →</a>
      </summary>
      <div id="recent" class="list" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
    </details>
    </div>
  `;
  applyHomeLayout();

  await refreshFinancials({ silent: false });
  await renderCheckinArea();
  await renderMedalsStrip();
  await renderPresence();
  await renderCalendarEvents();
  await renderMyGroups();
  await renderFreshInvitations();
  await renderFreshListings();
  await renderFreshTasks();
  await renderRecentTx();

  // Home polling: 1 分ごとに各カードを 「静かに」 リロード。
  // - 「読み込み中…」 placeholder は出さない (各 render は初期 HTML を持つ
  //   ので、再 fetch 中は前回の値を見せたまま、結果が届いたら DOM 差し替え)
  // - ページが非表示 (タブ裏 / 画面ロック) のときは skip
  // - 戻ってきた瞬間 (visibilitychange → visible) に即 1 回ポーリング
  // - home から離れたら timer 停止 (#home-balance 消失で検知)
  startHomePolling();
}

// Module-scoped: 単一の home polling 用 timer + visibilitychange handler。
// renderHome() が再度呼ばれたら start で reset、home から離れたら次の tick で
// stop する。
let homePollTimer = null;
let homeVisHandler = null;

function stopHomePolling() {
  if (homePollTimer) { clearInterval(homePollTimer); homePollTimer = null; }
  if (homeVisHandler) {
    document.removeEventListener('visibilitychange', homeVisHandler);
    homeVisHandler = null;
  }
}

async function doHomePoll() {
  // home が unmount されたら停止 (router が他の view に差し替えた目印)。
  if (!document.getElementById('home-balance')) {
    stopHomePolling();
    return;
  }
  if (document.hidden) return;
  // Promise.allSettled: 1 つのカードが失敗しても残りは更新される。
  await Promise.allSettled([
    refreshFinancials({ silent: true }),
    fetchAndRenderPresence(),     // 「今ラボにいる人」 (renderPresence の内部関数)
    renderCalendarEvents(),
    renderMyGroups(),
    renderFreshInvitations(),
    renderFreshListings(),
    renderFreshTasks(),
    renderRecentTx(),
  ]);
}

function startHomePolling() {
  stopHomePolling();
  homePollTimer = setInterval(doHomePoll, 60_000);
  homeVisHandler = () => { if (!document.hidden) doHomePoll(); };
  document.addEventListener('visibilitychange', homeVisHandler);
}

async function refreshFinancials({ silent }) {
  try {
    const me = await get('/api/me');
    const bal = document.getElementById('home-balance');
    // 数字は大きく、単位 pt は小さくサブ的に。CSS .balance-hero .num .num-unit。
    if (bal) bal.innerHTML = `${(me.balance ?? 0).toLocaleString()}<span class="num-unit">pt</span>`;
    const sl = document.getElementById('streak-line');
    if (sl) {
      const s = me.streak || {};
      sl.textContent = `連続ラボイン ${s.current_streak ?? 0} 日 (最長 ${s.longest_streak ?? 0} 日)`;
    }
    state.balance = me.balance;
  } catch (e) {
    if (!silent) toast('情報の取得に失敗: ' + e.message);
  }
}

// Compact medals strip rendered inside the balance-hero. Each earned achievement is a
// solid emoji, unearned ones are dimmed. Tapping the strip opens /achievements.
async function renderMedalsStrip() {
  const root = document.getElementById('home-medals');
  if (!root) return;
  try {
    const ach = await get('/api/me/achievements');
    const items = ach.items || [];
    if (!items.length) { root.innerHTML = ''; return; }
    const earned = items.filter(a => a.earned_tier > 0).length;
    const medals = items.map(a => {
      const m = a.earned ? a.earned.medal : '⚪';
      const lbl = a.earned ? a.earned.label : '未獲得';
      const dim = a.earned ? '' : 'opacity:.3';
      return `<span title="${escapeHtml(a.title)}: ${escapeHtml(lbl)}" style="font-size:20px; ${dim}">${m}</span>`;
    }).join(' ');
    root.innerHTML = `${medals} <span class="muted" style="font-size:11px">${earned}/${items.length}</span>`;
  } catch (e) { root.innerHTML = ''; }
}

async function fetchAndRenderPresence() {
  const presenceRoot = document.getElementById('presence');
  if (!presenceRoot) return;

  // If the user hasn't claimed a MAC, the in-lab list is hidden entirely and
  // replaced with the onboarding instructions. This works as a stronger nudge
  // than a banner above the list — they can't peek at who's in the lab
  // until they register, which gives them a concrete reason to do it.
  if (!state.hasMac) {
    // Entire card is a tappable link straight to 設定 so a one-tap onboarding
    // path exists from the home page.
    presenceRoot.innerHTML = `
      <a href="#/settings" style="display:block; text-decoration:none; color:inherit;
              background:#fff8e6; border:1px solid #f5d089; border-radius:10px;
              padding:12px 14px; -webkit-tap-highlight-color:rgba(245,208,137,0.3)">
        <div class="bold" style="color:#b54708; margin-bottom:6px">📱 スマホの MAC アドレスを登録すると、ここに表示されるようになります</div>
        <div style="font-size:13px; line-height:1.7">
          1. 無線 LAN を <b>nkmr-lab-wifi</b> に接続する<br>
          2. スマホのネットワーク設定から自身の IP アドレスをチェック<br>
          3. このカードをタップ → 設定でそれに該当するものを見つけて <b>「これは私」</b> を押す
        </div>
        <div class="muted" style="font-size:11px; margin-top:8px">
          登録するまで在室検知・ラボインボーナス・購入が動きません。タップで設定へ →
        </div>
      </a>`;
    return;
  }

  try {
    const pres = await get('/api/presence');
    if (!pres.rooms.length) {
      presenceRoot.innerHTML = `<div class="empty">部屋が登録されていません</div>`;
    } else {
      // Pass window_minutes through so each pill can fade based on its
      // last_seen_at age relative to the cutoff window.
      const win = Number(pres.window_minutes) || 3;
      presenceRoot.innerHTML = pres.rooms.map(r => renderRoom(r, win)).join('');
    }
  } catch (e) {
    presenceRoot.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function renderPresence() {
  const toggle = document.getElementById('presence-names-toggle');
  if (!toggle) return;
  const SHOW_NAMES_KEY = 'labpay-presence-show-names';
  const showNames = localStorage.getItem(SHOW_NAMES_KEY) !== '0';
  toggle.checked = showNames;
  applyPresenceMode(showNames);
  toggle.addEventListener('change', () => {
    localStorage.setItem(SHOW_NAMES_KEY, toggle.checked ? '1' : '0');
    applyPresenceMode(toggle.checked);
  });

  await fetchAndRenderPresence();
  // 定期 refresh は startHomePolling() に集約 (旧 presenceTimer は撤去)。
}

// Google Calendar 予定。連携してない人にはカード自体を隠す。連携済みで
// 「今日 0:00 〜 明日 24:00」 に予定があれば 5 件まで表示。Zoom/Meet URL
// が拾えればその場でタップして join できるようリンクボタンを出す。
//
// 1 分ごとの auto-refresh で毎回 Google API を叩くと重いので
// localStorage に { items, etags, timestamp } を 5 分 TTL で保存:
//   - TTL 内 → サーバ問合せ skip、cache をそのまま使う
//   - TTL 切れ → サーバへ /events?etags=<JSON> を投げ、サーバが
//     Google に If-None-Match で revalidate。 全 cal 変更なしなら
//     {not_modified:true} で返り cache を続投、変更あれば新 items + 新 etags。
const CAL_CACHE_KEY = 'labpay-cal-events-cache';
const CAL_CACHE_TTL_MS = 5 * 60 * 1000;
function readCalCache() {
  try {
    const raw = localStorage.getItem(CAL_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.items)) return null;
    return c;
  } catch { return null; }
}
function writeCalCache(items, etags) {
  try {
    localStorage.setItem(CAL_CACHE_KEY, JSON.stringify({
      items, etags: etags || {}, timestamp: Date.now()
    }));
  } catch {}
}

async function renderCalendarEvents() {
  const card = document.getElementById('home-calendar-card');
  const root = document.getElementById('home-calendar');
  if (!card || !root) return;
  let items = null;
  try {
    const cache = readCalCache();
    const fresh = cache && (Date.now() - cache.timestamp < CAL_CACHE_TTL_MS);
    if (fresh) {
      items = cache.items;
    } else {
      const etagsQuery = (cache && cache.etags && Object.keys(cache.etags).length)
        ? JSON.stringify(cache.etags) : undefined;
      const data = await get('/api/me/calendar/events',
        etagsQuery ? { etags: etagsQuery } : undefined);
      if (data && data.not_modified && cache) {
        writeCalCache(cache.items, cache.etags); // bump timestamp
        items = cache.items;
      } else {
        items = (data && data.items) || [];
        writeCalCache(items, (data && data.etags) || {});
      }
    }
  } catch (e) {
    // 未連携 / fetch 失敗 / offline などはここに来る。
    // cache が残ってればそれを使う、無ければカード非表示。
    const cache = readCalCache();
    if (cache && cache.items && cache.items.length) {
      items = cache.items;
    } else {
      card.hidden = true;
      return;
    }
  }
  items = items.slice(0, 5);
  try {
    if (!items.length) {
      // 連携はしてるけど予定なし → 「今日は予定なし」 と出す価値あり (連携が
      // 効いてることが分かる)。完全に隠すのではなく empty で表示。 add-row は
      // 後で追記される。
      card.hidden = false;
      // ここで return しない: 下で renderCalendarEvents 末尾の add-row もくっつける
    }
    card.hidden = false;
    // タスク/募集と同じノリで、 カード末尾に 「＋ MTG を立てる」 行を常設。
    const addRow = `
      <div class="list-item add-row" id="home-mtg-add" style="cursor:pointer">
        <div class="grow bold" style="color:var(--primary)">＋ MTG を立てる</div>
        <div class="hint">→</div>
      </div>`;
    const fmtTime = (s, allDay) => {
      if (allDay) return '終日';
      const d = new Date(s);
      const h = d.getHours(), m = d.getMinutes();
      const today = new Date().toDateString() === d.toDateString();
      const prefix = today ? '' : '明日 ';
      return `${prefix}${h}:${String(m).padStart(2,'0')}`;
    };
    // 各予定の状態を 4 つに分類:
    //   過去 (終了済み)       → 半透明 + grayscale
    //   進行中 (start ≤ now < end) → 強い primary 色 + 左バー
    //   次の予定 (今日未来の最初) → 薄い黄色 + amber 左バー
    //   翌日                  → 薄い青 + blue 左バー
    const nowMs = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const tomorrowStartMs = todayStart.getTime() + 86400000;
    const withFlags = items.map(ev => {
      const startMs = ev.start ? Date.parse(ev.start) : NaN;
      const endMs   = ev.end   ? Date.parse(ev.end)   : (isNaN(startMs) ? NaN : startMs + 3600000);
      const isPast       = !isNaN(endMs) && endMs < nowMs;
      const isInProgress = !isPast && !isNaN(startMs) && startMs <= nowMs && nowMs < endMs;
      const isTomorrow   = !isNaN(startMs) && startMs >= tomorrowStartMs;
      return { ...ev, _isPast: isPast, _isInProgress: isInProgress, _isTomorrow: isTomorrow };
    });
    // 「次の予定」 は 今日の未来で 進行中じゃない最初。 翌日は別扱い。
    const nextIdx = withFlags.findIndex(e => !e._isPast && !e._isInProgress && !e._isTomorrow);
    const eventsHtml = !items.length
      ? `<div class="empty">今日は予定なし</div>`
      : withFlags.map((ev, idx) => {
      const locIsUrl = ev.location && /^https?:\/\//i.test(ev.location.trim());
      const loc = (ev.location && !locIsUrl) ? `<div class="meta">📍 ${escapeHtml(ev.location)}</div>` : '';
      const titleHtml = ev.html_url
        ? `<a class="bold" href="${escapeHtml(ev.html_url)}" target="_blank" rel="noopener" style="text-decoration:none; color:inherit">${escapeHtml(ev.title)}</a>`
        : `<span class="bold">${escapeHtml(ev.title)}</span>`;
      // 既に MTG URL がある: 参加ボタン。 無い + 終日でない: Zoom 追加ボタン。
      let zoomBtn = '';
      if (ev.url) {
        zoomBtn = `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener" class="btn primary" style="padding:4px 10px; font-size:12px; margin-top:6px; align-self:flex-start">📹 参加する</a>`;
      } else if (!ev.all_day) {
        zoomBtn = `<button class="btn" data-add-zoom="${escapeHtml(ev.id)}" data-cal="${escapeHtml(ev.calendar || 'primary')}" style="padding:4px 10px; font-size:12px; margin-top:6px; align-self:flex-start; color:var(--primary)">＋ Zoom を追加</button>`;
      }
      const isNext = idx === nextIdx;
      // box-shadow:inset で左バーを描く (border-left を使うと content が右に
      // ずれて他の行と縦が揃わなくなるので)。 優先順位は 過去 → 進行中 → 次 → 翌日。
      const styles = [
        'align-items:flex-start',
        'gap:8px',
      ];
      if (ev._isPast) {
        styles.push('opacity:0.5', 'filter:grayscale(60%)');
      } else if (ev._isInProgress) {
        styles.push('background:var(--primary-soft)', 'box-shadow:inset 4px 0 0 var(--primary)');
      } else if (isNext) {
        styles.push('background:#fff7d6', 'box-shadow:inset 4px 0 0 #d4a017');
      } else if (ev._isTomorrow) {
        styles.push('background:#e8f0fd', 'box-shadow:inset 4px 0 0 #4a8ce5');
      }
      return `
        <div class="list-item" style="${styles.join('; ')}">
          <div style="min-width:64px; font-weight:700; color:var(--primary); padding-top:1px">${fmtTime(ev.start, ev.all_day)}</div>
          <div class="grow" style="display:flex; flex-direction:column">
            ${titleHtml}
            ${loc}
            ${zoomBtn}
          </div>
        </div>`;
    }).join('');
    root.innerHTML = eventsHtml + addRow;
    document.getElementById('home-mtg-add')?.addEventListener('click', openMtgModal);
    // 「＋ Zoom を追加」 ボタンの click ハンドラ。 押下中はラベル変更 + disable。
    root.querySelectorAll('[data-add-zoom]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const eventId = btn.dataset.addZoom;
        const calId   = btn.dataset.cal || 'primary';
        if (!eventId) return;
        const original = btn.textContent;
        btn.disabled = true; btn.textContent = '作成中…';
        try {
          const r = await post(
            `/api/me/calendar/events/${encodeURIComponent(eventId)}/zoom`,
            { calendar_id: calId });
          if (r?.invalidate_calendar_cache) {
            try { localStorage.removeItem('labpay-cal-events-cache'); } catch {}
          }
          toast('Zoom MTG を追加しました');
          await renderCalendarEvents();
        } catch (e) {
          toast('失敗: ' + (e.message || String(e)));
          btn.disabled = false; btn.textContent = original;
        }
      });
    });
  } catch (e) {
    // render 中の例外 (DOM 破壊 etc) は無視して隠す。
    card.hidden = true;
  }
}

// ──── 「＋ MTG」 modal ─────────────────────────────────────────────────
// 出先で 「今 30 分後に 30 分の MTG やろう」 を 1 タップで作るための簡易フォーム。
// 今 / +15 / +30 / +60 分後 のショートカット + タイトル + 長さ + 登録先カレンダー
// + 「Zoom も付ける」 toggle。 Zoom OFF にすれば 普通の Google Calendar 予定だけ作成。
let CACHED_CALENDARS = null;
async function getCalendarsCached() {
  if (CACHED_CALENDARS) return CACHED_CALENDARS;
  try {
    const d = await get('/api/me/calendar/calendars');
    CACHED_CALENDARS = Array.isArray(d.items) ? d.items : [];
  } catch { CACHED_CALENDARS = []; }
  return CACHED_CALENDARS;
}
function openMtgModal() {
  const root = document.getElementById('home-mtg-modal');
  if (!root) return;
  const now = new Date();
  const round5 = new Date(Math.ceil(now.getTime() / (5 * 60 * 1000)) * 5 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  root.hidden = false;
  root.innerHTML = `
    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto"
         id="mtg-overlay">
      <div style="background:#fff; border-radius:14px; max-width:480px; width:100%; padding:20px">
        <div class="row center">
          <h3 class="row-title">MTG を立てる</h3>
          <button id="mtg-close">×</button>
        </div>
        <label class="field" style="margin-top:8px">
          <span class="lbl">タイトル</span>
          <input type="text" id="mtg-topic" maxlength="200" placeholder="例: 中村と打合せ" autofocus>
        </label>
        <label class="field">
          <span class="lbl">開始</span>
          <div class="row" style="gap:4px; flex-wrap:wrap">
            <button class="btn" data-quick="0">今すぐ</button>
            <button class="btn" data-quick="15">+15分</button>
            <button class="btn" data-quick="30">+30分</button>
            <button class="btn" data-quick="60">+1時間</button>
          </div>
          <input type="datetime-local" id="mtg-start" value="${fmtLocal(round5)}" style="margin-top:6px">
        </label>
        <label class="field">
          <span class="lbl">長さ</span>
          <select id="mtg-duration">
            <option value="15">15 分</option>
            <option value="30" selected>30 分</option>
            <option value="45">45 分</option>
            <option value="60">1 時間</option>
            <option value="90">1.5 時間</option>
            <option value="120">2 時間</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">登録先カレンダー</span>
          <select id="mtg-calendar">
            <option value="primary">(読み込み中…)</option>
          </select>
        </label>
        <label style="display:flex; align-items:center; gap:10px; margin:4px 0 10px">
          <span class="switch">
            <input type="checkbox" id="mtg-zoom" checked>
            <span class="slider"></span>
          </span>
          <span>📹 Zoom MTG を含める <span class="hint-sm">— OFF なら予定だけ作成</span></span>
        </label>
        <div id="mtg-error" class="muted" style="color:var(--danger); margin:6px 0; min-height:18px"></div>
        <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
          <button id="mtg-cancel">キャンセル</button>
          <button id="mtg-create" class="primary">作成</button>
        </div>
      </div>
    </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  document.getElementById('mtg-close').addEventListener('click', close);
  document.getElementById('mtg-cancel').addEventListener('click', close);
  document.getElementById('mtg-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'mtg-overlay') close();
  });
  root.querySelectorAll('[data-quick]').forEach(b => {
    b.addEventListener('click', () => {
      const add = Number(b.dataset.quick) || 0;
      const t = new Date(Date.now() + add * 60 * 1000);
      // 5 分単位に丸める。
      t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5, 0, 0);
      document.getElementById('mtg-start').value = fmtLocal(t);
    });
  });
  // カレンダー一覧を非同期で埋める。 modal はすぐ出して 「読み込み中…」 を後で
  // 置換する流れにし、 ネットワーク遅延でフォーム操作が止まらないように。
  (async () => {
    const cals = await getCalendarsCached();
    const sel = document.getElementById('mtg-calendar');
    if (!sel) return; // modal 閉じられた
    if (!cals.length) {
      sel.innerHTML = `<option value="primary">primary</option>`;
      return;
    }
    // primary を先頭、 残りは name 順。
    const sorted = [...cals].sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return (a.summary || '').localeCompare(b.summary || '', 'ja');
    });
    sel.innerHTML = sorted.map(c => {
      const label = (c.summary || c.id) + (c.primary ? ' (メイン)' : '');
      return `<option value="${escapeHtml(c.id)}">${escapeHtml(label)}</option>`;
    }).join('');
  })();
  document.getElementById('mtg-create').addEventListener('click', async () => {
    const btn   = document.getElementById('mtg-create');
    const errEl = document.getElementById('mtg-error');
    errEl.textContent = '';
    const topic       = document.getElementById('mtg-topic').value.trim();
    const startRaw    = document.getElementById('mtg-start').value;
    const duration    = Number(document.getElementById('mtg-duration').value);
    const calendar_id = document.getElementById('mtg-calendar').value || 'primary';
    const with_zoom   = document.getElementById('mtg-zoom').checked;
    if (!topic)    { errEl.textContent = 'タイトルを入れてください'; return; }
    if (!startRaw) { errEl.textContent = '開始時刻を入れてください'; return; }
    const start = startRaw + ':00+09:00';
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      const r = await post('/api/me/calendar/events',
        { topic, start, duration_minutes: duration, calendar_id, with_zoom });
      if (r.invalidate_calendar_cache) {
        try { localStorage.removeItem('labpay-cal-events-cache'); } catch {}
      }
      toast(with_zoom ? 'Zoom MTG を作成しました' : '予定を作成しました');
      close();
      await renderCalendarEvents();
    } catch (e) {
      errEl.textContent = e.message || String(e);
      btn.disabled = false; btn.textContent = '作成';
    }
  });
}

// Newest listings (top 5 by created_at). Server returns sorted by price ASC + created_at ASC
// for /api/listings — we re-sort by created_at DESC client-side for "新規入荷".
async function renderMyGroups() {
  const card = document.getElementById('home-groups-card');
  const root = document.getElementById('home-groups');
  if (!card || !root) return;
  try {
    const d = await get('/api/groups');
    const items = d.items || [];
    if (!items.length) { card.hidden = true; return; }
    card.hidden = false;
    // groups.js の coverListItem を共有 (avatar 行 + 表紙画像のオン/オフが
    // 同じロジックでまとまる)。 closed は [終了] バッジ付きで同じカードに混ぜる。
    root.innerHTML = items.slice(0, 5).map(g => coverListItem({
      href:      '#/groups/' + escapeHtml(g.slug || g.id),
      image_url: g.image_url,
      title:     escapeHtml(g.title) + (g.closed_at ? ' <span class="tag muted">終了</span>' : ''),
      meta:      `${escapeHtml(g.creator_name)} · ${g.member_count}人`,
      members:   g.members || [],
    })).join('');
  } catch (_) {
    card.hidden = true;
  }
}

async function renderFreshInvitations() {
  const card = document.getElementById('home-invs-card');
  const root = document.getElementById('home-invs');
  if (!card || !root) return;
  try {
    const d = await get('/api/invitations', { status: 'open' });
    const open = d.items || [];
    // ゼロでもカードは消さない (「＋ 新しく募集する」 動線を残すため)。
    const addLink = `
      <a class="list-item add-row" href="#/invitations">
        <div class="grow bold" style="color:var(--primary)">＋ 新しく募集する</div>
        <div class="hint">→</div>
      </a>`;
    if (!open.length) {
      root.innerHTML = addLink;
      return;
    }
    root.innerHTML = open.slice(0, 5).map(i => {
      const when  = i.starts_at ? `🕒 ${escapeHtml(i.starts_at)} ・` : '';
      const where = i.location  ? `📍 ${escapeHtml(i.location)} ・` : '';
      const cap   = i.capacity  ? `${i.join_count}/${i.capacity}人` : `${i.join_count}人`;
      const joined = Number(i.i_joined) === 1 ? ' <span class="tag ok">✓参加</span>' : '';
      const title = `${escapeHtml(i.title)}${joined}`;
      const meta  = `${when}${where}${cap} · ${escapeHtml(i.creator_name)}`;
      const href  = '#/invitations/' + i.id;
      if (i.image_url) {
        return `
          <a class="list-item with-cover" href="${href}">
            <div class="cover-img" style="background-image:url('${escapeHtml(i.image_url)}')"></div>
            <div class="grow">
              <div class="bold">${title}</div>
              <div class="meta">${meta}</div>
            </div>
          </a>`;
      }
      return `
        <a class="list-item" href="${href}">
          <div class="grow">
            <div class="bold">${title}</div>
            <div class="meta">${meta}</div>
          </div>
          <div class="hint">→</div>
        </a>`;
    }).join('') + addLink;
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function renderFreshListings() {
  const root = document.getElementById('home-fresh-listings');
  if (!root) return; // 非同期 await 中にユーザが home から離れて DOM が消えてるケース
  try {
    const d = await get('/api/listings', { limit: 50 });
    const items = (d.items || [])
      .slice()
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 3);
    if (!items.length) {
      root.innerHTML = `<div class="empty">まだ出品はありません</div>`;
      return;
    }
    // グループ / 募集と同じ with-cover レイアウト (左 110px の表紙画像) で
    // 新規入荷も大きく見せる。 残数が分かるようメタ行に 「在庫 N」 を入れる。
    root.innerHTML = items.map(l => {
      const priceTag = l.is_gift
        ? `<div class="bold" style="color:#b71c50; white-space:nowrap; padding:8px 12px 0 0">🎁 これどうぞ</div>`
        : `<div class="bold" style="color:var(--primary); white-space:nowrap; padding:8px 12px 0 0">${l.price.toLocaleString()} pt</div>`;
      // 在庫数: 2 個以上の時だけ表示。 1 個は 「言うまでもない」 のでノイズ削減。
      const qtyTag = (typeof l.qty === 'number' && l.qty >= 2) ? ` · 在庫 ${l.qty}` : '';
      // created_at は 'YYYY-MM-DD HH:MM:SS' 形式。 秒は要らないので 16 文字で切る。
      const when = (l.created_at || '').slice(0, 16);
      const meta = `${escapeHtml(l.seller_name)}${l.location ? ' · 📍 ' + escapeHtml(l.location) : ''}${qtyTag} · ${escapeHtml(when)}`;
      const href = `#/product/${encodeURIComponent(l.jan)}`;
      if (l.image_url) {
        return `
          <a class="list-item with-cover" href="${href}">
            <div class="cover-img" style="background-image:url('${escapeHtml(l.image_url)}')"></div>
            <div class="grow">
              <div class="bold">${escapeHtml(l.name)}</div>
              <div class="meta">${meta}</div>
            </div>
            ${priceTag}
          </a>`;
      }
      // 画像なし: 頭文字プレースホルダを cover サイズに引き伸ばす。
      const initial = (l.name || '?').trim().charAt(0).toUpperCase();
      return `
        <a class="list-item with-cover" href="${href}">
          <div class="cover-img cover-img-fallback">${escapeHtml(initial)}</div>
          <div class="grow">
            <div class="bold">${escapeHtml(l.name)}</div>
            <div class="meta">${meta}</div>
          </div>
          ${priceTag}
        </a>`;
    }).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// Open tasks I can apply for (top 5 by id DESC). Also splits out tasks the
// user is CURRENTLY working on (my_status = claimed / reported) into a
// separate top-of-page card — without this, workers who claimed a task often
// forget to come back and report done because nothing on home reminded them.
async function renderFreshTasks() {
  const root = document.getElementById('home-fresh-tasks');
  const myCard = document.getElementById('home-my-claims-card');
  const myList = document.getElementById('home-my-claims');
  if (!root || !myCard || !myList) return;
  try {
    const d = await get('/api/tasks');
    const items = d.items || [];
    const myActive = items.filter(t => t.my_status === 'claimed' || t.my_status === 'reported');
    const available = items.filter(t => t.can_claim).slice(0, 5);

    if (myActive.length) {
      myCard.hidden = false;
      myList.innerHTML = myActive.map(t => {
        const statusTag = t.my_status === 'reported'
          ? '<span class="tag warn">承認待ち</span>'
          : '<span class="tag warn">引き受け中</span>';
        return `
          <a class="list-item" href="#/tasks/${t.id}" style="border-left:4px solid #b54708">
            <div style="display:flex; align-items:center; gap:8px; flex:1">
              ${avatarHtml(t.requester_name, t.requester_avatar_url, 'sm')}
              <div>
                <div class="bold">${escapeHtml(t.title)} ${statusTag}</div>
                <div class="meta">${escapeHtml(t.requester_name)} · ${t.reward}pt${t.deadline ? ' · 締切 ' + escapeHtml(t.deadline) : ''}</div>
                ${t.my_status === 'claimed'
                  ? '<div class="meta" style="color:#b54708">→ タップして完了報告</div>'
                  : '<div class="meta">依頼者の承認待ち</div>'}
              </div>
            </div>
          </a>`;
      }).join('');
    } else {
      myCard.hidden = true;
    }

    // 「＋ 新しくタスクを設定する」 は常に出す。受けられるタスクがゼロでも、
    // 「設定する」 という能動的な行動が一発でできるように。
    const addLink = `
      <a class="list-item add-row" href="#/tasks?new=request">
        <div class="grow bold" style="color:var(--primary)">＋ 新しくタスクを設定する</div>
        <div class="hint">→</div>
      </a>`;
    if (!available.length) {
      root.innerHTML = addLink;
      return;
    }
    root.innerHTML = available.map(t => `
      <a class="list-item" href="#/tasks/${t.id}">
        <div style="display:flex; align-items:center; gap:8px; flex:1">
          ${avatarHtml(t.requester_name, t.requester_avatar_url, 'sm')}
          <div>
            <div class="bold">${escapeHtml(t.title)}</div>
            <div class="meta">${escapeHtml(t.requester_name)} · 残 ${t.remaining ?? '-'}人${t.deadline ? ' · 締切 ' + escapeHtml(t.deadline) : ''}</div>
          </div>
        </div>
        <div class=" bold text-primary">${t.reward}pt</div>
      </a>
    `).join('') + addLink;
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function renderRecentTx() {
  const root = document.getElementById('recent');
  if (!root) return;
  try {
    const tx = await get('/api/me/transactions', { limit: 5 });
    if (!tx.items.length) {
      root.innerHTML = `<div class="empty">まだ取引がありません</div>`;
    } else {
      root.innerHTML = tx.items.map(renderTxItem).join('');
    }
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// Render the check-in area based on today's status:
//  - Already checked in:     subtle ✓ message
//  - Not yet, today is workday: passive message (Wi-Fi scanner handles it)
//  - Not yet, not workday:   inert message, but still allow optional checkin
async function renderCheckinArea() {
  const root = document.getElementById('checkin-area');
  if (!root) return;
  let status;
  try { status = await get('/api/checkins/status'); }
  catch (e) {
    root.innerHTML = `<div class="hint">${escapeHtml(e.message)}</div>`;
    return;
  }
  // Check-in happens entirely via the lab Wi-Fi scanner — no manual UI here.
  // Show today's state + the bonus rule explainer, nothing actionable.
  if (status.checked_in_today) {
    root.innerHTML = `<div style="font-size:14px" class="muted">✓ 本日ラボイン済み (+${status.points_today}pt / 連続ラボイン ${status.current_streak} 日)</div>
      ${bonusRuleHtml(status.bonus_rule)}`;
    return;
  }
  if (status.today_is_workday) {
    root.innerHTML = `<div class="hint">ラボの Wi-Fi に繋ぐと自動でチェックインされます。</div>
      ${bonusRuleHtml(status.bonus_rule)}`;
  } else {
    root.innerHTML = `<div class="hint">今日は稼働日ではないため、連続ボーナスには影響しません。</div>
      ${bonusRuleHtml(status.bonus_rule)}`;
  }
}

// Tiny inline explainer of the checkin bonus formula. Values come from /api/checkins/status
// so they survive admin tweaks without re-deploying. Returns '' when the API didn't
// include the field (older server, defensive).
function bonusRuleHtml(rule) {
  if (!rule) return '';
  const { base, max_total, days_to_max } = rule;
  return `<div class="muted" style="font-size:11px; margin-top:8px; line-height:1.5">
    💰 ラボインボーナス: ベース <b>${base}</b>pt + 連続日数で上乗せ、最大 <b>${max_total}</b>pt
  </div>`;
}

// Apply the icon/name display mode to the presence container.
// On = names visible (default), Off = icons only. Toggled by adding a class on the parent
// so the same DOM serves both modes — no re-render needed.
function applyPresenceMode(showNames) {
  const root = document.getElementById('presence');
  if (!root) return;
  root.classList.toggle('presence-icons-only', !showNames);
}

function applyDurationMode(showDuration) {
  const root = document.getElementById('presence');
  if (!root) return;
  root.classList.toggle('presence-show-duration', showDuration);
}

// Compute a short Japanese duration label from session_start_at (server timestamp,
// "YYYY-MM-DD HH:MM:SS" in JST). Returns "" if unavailable.
function formatStayDuration(sessionStartAt) {
  if (!sessionStartAt) return '';
  const start = new Date(sessionStartAt.replace(' ', 'T') + '+09:00').getTime();
  if (!Number.isFinite(start)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - start) / 60000));
  if (mins < 60) return `${mins}分`;
  const hours = Math.floor(mins / 60);
  const rem   = mins % 60;
  return rem === 0 ? `${hours}時間` : `${hours}時間${rem}分`;
}

function renderRoom(r, windowMin) {
  // Fade-by-age: pills are fully opaque when last seen <30s ago, then ramp
  // linearly to 0.35 by the window edge (after which the API drops them).
  // This makes brief detection gaps visible without yanking the avatar out
  // of the list entirely.
  const now = Date.now();
  const parseJst = ts => Date.parse(ts.replace(' ', 'T') + '+09:00');
  // Three values per user: opacity 1.0→0.15, grayscale 0→100%, and a bold
  // flag for the unmistakably-just-now case (≤30s). Bold on the name pulls
  // the eye to who's actively scanning right now; fade conveys "ago".
  const fadeFor = lastSeen => {
    if (!lastSeen) return { opacity: 1, gray: 0, isFresh: true };
    const ageSec = Math.max(0, (now - parseJst(lastSeen)) / 1000);
    const fresh = 30;
    const cutoff = windowMin * 60;
    if (ageSec <= fresh)  return { opacity: 1,    gray: 0,   isFresh: true  };
    if (ageSec >= cutoff) return { opacity: 0.15, gray: 100, isFresh: false };
    const t = (ageSec - fresh) / Math.max(1, cutoff - fresh);
    return {
      opacity: Number((1 - 0.85 * t).toFixed(2)),
      gray:    Math.round(100 * t),
      isFresh: false,
    };
  };
  const formatDur = mins => {
    if (mins < 1) return '1分未満';
    if (mins < 60) return `${mins}分`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m === 0 ? `${h}時間` : `${h}時間${m}分`;
  };
  const peopleHtml = r.users.length
    ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px">
         ${r.users.map(u => {
           const { opacity, gray, isFresh } = fadeFor(u.last_seen_at);
           let dur = '';
           let stayMinutes = 0;
           if (u.session_start_at && u.last_seen_at) {
             stayMinutes = Math.max(0, Math.round(
               (parseJst(u.last_seen_at) - parseJst(u.session_start_at)) / 60000));
           }
           // 24h+ 連続検知 = ほぼ間違いなくデバイス置き忘れ。化石化 (sepia + 重い
           // grayscale) して 🗿 を添える。本人がうっかり連泊してたら戻ってきた
           // 時に普通の色に戻るので false positive はそんなに痛くない。
           const isFossil = stayMinutes >= 24 * 60;
           // 化石化した場合の生の数値は意味がない (端末が一晩中つながり
           // っぱなしだっただけ) ので「24時間+」と頭打ちで表示。それ未満
           // は通常の「滞在 N時間Y分」。
           if (stayMinutes > 0) {
             dur = isFossil ? '滞在 24時間+' : `滞在 ${formatDur(stayMinutes)}`;
           }
           const ageHint = opacity < 1 ? ' (検知途切れ気味)' : '';
           const fossilHint = isFossil ? ' (24時間以上連続検知 — 端末忘れかも)' : '';
           const tooltip = `${u.display_name}${dur ? ' — ' + dur : ''}${ageHint}${fossilHint}`;
           const style = isFossil
             ? `opacity:0.5; filter:grayscale(100%) sepia(40%) brightness(.85)`
             : `opacity:${opacity}; filter:grayscale(${gray}%)`;
           const nameStyle = isFossil ? 'font-weight:400; color:#666' : (isFresh ? 'font-weight:700' : '');
           const fossilBadge = isFossil ? ' 🗿' : '';
           return `
             <span class="presence-pill" title="${escapeHtml(tooltip)}" style="${style}">
               ${avatarHtml(u.display_name, u.avatar_url, 'sm')}
               <span class="presence-pill-name" style="${nameStyle}">${escapeHtml(u.display_name)}${fossilBadge}</span>
             </span>`;
         }).join('')}
       </div>`
    : `<div class="muted" style="font-size:13px; margin-top:4px">誰も検知されていません</div>`;
  const scan = r.last_scan_at ? `· 最終スキャン ${escapeHtml(r.last_scan_at)}` : '· 未スキャン';
  return `
    <div style="margin-bottom:12px">
      <div class="bold">${escapeHtml(r.display_name)} (${r.users.length}人) <span class="muted" style="font-weight:normal; font-size:12px">${scan}</span></div>
      ${peopleHtml}
    </div>`;
}

function renderTxItem(t) {
  const sign = t.signed_amount > 0 ? '+' : '';
  const color = t.signed_amount > 0 ? 'var(--primary)' : 'var(--danger)';
  const label = labelFor(t.type) + (t.product_name ? ` · ${escapeHtml(t.product_name)}` : '');
  return `
    <div class="list-item">
      <div>
        <div class="bold">${label}</div>
        <div class="meta">${escapeHtml(t.counterparty ?? '')} · ${escapeHtml(t.created_at)}</div>
      </div>
      <div style="color:${color}; font-weight:800; white-space:nowrap">${sign}${t.signed_amount.toLocaleString()} pt</div>
    </div>`;
}

function labelFor(type) { return ledgerTypeLabel(type); }
