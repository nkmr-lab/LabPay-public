import { get, post } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { refreshMe, state, toast } from '../app.js';

export async function renderHome() {
  if (!state.me) await refreshMe();
  if (!state.me) { navigate('#/login'); return; }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card balance-hero">
      <div class="lbl">残高</div>
      <div class="num" id="home-balance">— pt</div>
      <div class="muted" id="streak-line">連続来室 — 日 (最長 — 日)</div>
      <a id="home-medals" href="#/achievements" class="home-medals" title="実績"></a>
      <div id="checkin-area" style="margin-top:10px"></div>
      <div style="margin-top:14px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap">
        <a class="btn primary" href="#/buy">買う</a>
        <a class="btn" href="#/sell">売る</a>
        <a class="btn" href="#/tasks">タスク</a>
        <a class="btn" href="#/send">送る</a>
      </div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center">
        <h2 style="flex:1; margin:0">今ラボにいる人</h2>
        <a href="#/activity" class="muted" style="font-size:13px; margin-right:10px">活動マップ →</a>
        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px" class="muted">
          名前を表示
          <span class="switch">
            <input type="checkbox" id="presence-names-toggle">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <div id="presence" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center; margin-bottom:6px">
        <h2 style="flex:1; margin:0">新規入荷</h2>
        <a href="#/buy" class="muted" style="font-size:13px">買う →</a>
      </div>
      <div id="home-fresh-listings" class="list"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center; margin-bottom:6px">
        <h2 style="flex:1; margin:0">新規タスク</h2>
        <a href="#/tasks" class="muted" style="font-size:13px">一覧 →</a>
      </div>
      <div id="home-fresh-tasks" class="list"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center; margin-bottom:6px">
        <h2 style="flex:1; margin:0">あなたのラボ滞在</h2>
      </div>
      <div id="presence-summary" class="muted" style="font-size:13px">読み込み中…</div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center; margin-bottom:6px">
        <h2 style="flex:1; margin:0">最近の取引</h2>
        <a href="#/history" class="muted" style="font-size:13px">すべて見る →</a>
      </div>
      <div id="recent" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;

  // Fill balance + streak from /api/me
  try {
    const me = await get('/api/me');
    document.getElementById('home-balance').textContent = (me.balance ?? 0).toLocaleString() + ' pt';
    const s = me.streak || {};
    document.getElementById('streak-line').textContent =
      `連続来室 ${s.current_streak ?? 0} 日 (最長 ${s.longest_streak ?? 0} 日)`;
    state.balance = me.balance;
  } catch (e) {
    toast('情報の取得に失敗: ' + e.message);
  }

  await renderCheckinArea();
  await renderMedalsStrip();
  await renderPresence();
  await renderFreshListings();
  await renderFreshTasks();
  await renderPresenceSummary();
  await renderRecentTx();
}

// Personal lab-stay stat card. Aggregates closed sessions from presence_sessions
// plus the currently-open session if you're still here.
async function renderPresenceSummary() {
  const root = document.getElementById('presence-summary');
  if (!root) return;
  try {
    const s = await get('/api/me/presence_summary');
    const fmt = (m) => {
      if (m < 1) return '-';
      if (m < 60) return `${m}分`;
      const h = Math.floor(m / 60);
      const r = m % 60;
      return r === 0 ? `${h}時間` : `${h}時間${r}分`;
    };
    const live = s.currently_present
      ? `<div style="margin-top:6px; color:#0e7c63; font-weight:600">● いまラボに居ます</div>`
      : '';
    root.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; text-align:center">
        <div>
          <div class="muted" style="font-size:11px">今日</div>
          <div class="bold" style="font-size:18px; color:var(--primary)">${fmt(s.today_minutes)}</div>
        </div>
        <div>
          <div class="muted" style="font-size:11px">今週</div>
          <div class="bold" style="font-size:18px; color:var(--primary)">${fmt(s.week_minutes)}</div>
        </div>
        <div>
          <div class="muted" style="font-size:11px">今月</div>
          <div class="bold" style="font-size:18px; color:var(--primary)">${fmt(s.month_minutes)}</div>
        </div>
      </div>
      ${live}
    `;
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
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

// Held at module scope so the interval can be cleared when the user navigates away
// from the home page (otherwise it stacks up on repeated home renders).
let presenceTimer = null;

async function fetchAndRenderPresence() {
  const presenceRoot = document.getElementById('presence');
  if (!presenceRoot) return;
  try {
    const pres = await get('/api/presence');
    if (!pres.rooms.length) {
      presenceRoot.innerHTML = `<div class="empty">部屋が登録されていません</div>`;
    } else {
      presenceRoot.innerHTML = pres.rooms.map(renderRoom).join('');
    }
  } catch (e) {
    presenceRoot.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function renderPresence() {
  const toggle = document.getElementById('presence-names-toggle');
  const SHOW_NAMES_KEY = 'labpay-presence-show-names';
  const showNames = localStorage.getItem(SHOW_NAMES_KEY) !== '0';
  toggle.checked = showNames;
  applyPresenceMode(showNames);
  toggle.addEventListener('change', () => {
    localStorage.setItem(SHOW_NAMES_KEY, toggle.checked ? '1' : '0');
    applyPresenceMode(toggle.checked);
  });

  await fetchAndRenderPresence();

  // Refresh every 60s while the user is on the home view. Scanner pushes new
  // presence data roughly once a minute, so this keeps it ~live.
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(() => {
    if (document.getElementById('presence')) {
      fetchAndRenderPresence();
    } else {
      clearInterval(presenceTimer);
      presenceTimer = null;
    }
  }, 60_000);
}

// Newest listings (top 5 by created_at). Server returns sorted by price ASC + created_at ASC
// for /api/listings — we re-sort by created_at DESC client-side for "新規入荷".
async function renderFreshListings() {
  const root = document.getElementById('home-fresh-listings');
  try {
    const d = await get('/api/listings', { limit: 50 });
    const items = (d.items || [])
      .slice()
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 5);
    if (!items.length) {
      root.innerHTML = `<div class="empty">まだ出品はありません</div>`;
      return;
    }
    root.innerHTML = items.map(l => {
      const priceTag = l.is_gift
        ? `<div class="bold" style="color:#b71c50; white-space:nowrap">🎁 これどうぞ</div>`
        : `<div class="bold" style="color:var(--primary); white-space:nowrap">${l.price.toLocaleString()} pt</div>`;
      return `
        <a class="list-item" href="#/product/${encodeURIComponent(l.jan)}">
          <div>
            <div class="bold">${escapeHtml(l.name)}</div>
            <div class="meta">${escapeHtml(l.seller_name)}${l.location ? ' · 📍 ' + escapeHtml(l.location) : ''} · ${escapeHtml(l.created_at)}</div>
          </div>
          ${priceTag}
        </a>`;
    }).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// Open tasks I can apply for (top 5 by id DESC).
async function renderFreshTasks() {
  const root = document.getElementById('home-fresh-tasks');
  try {
    const d = await get('/api/tasks', { filter: 'available' });
    const items = (d.items || []).slice(0, 5);
    if (!items.length) {
      root.innerHTML = `<div class="empty">受けられるタスクはありません</div>`;
      return;
    }
    root.innerHTML = items.map(t => `
      <a class="list-item" href="#/tasks/${t.id}">
        <div style="display:flex; align-items:center; gap:8px; flex:1">
          ${avatarHtml(t.requester_name, t.requester_avatar_url, 'sm')}
          <div>
            <div class="bold">${escapeHtml(t.title)}</div>
            <div class="meta">${escapeHtml(t.requester_name)} · 残 ${t.remaining ?? '-'}人${t.deadline ? ' · 締切 ' + escapeHtml(t.deadline) : ''}</div>
          </div>
        </div>
        <div class="bold" style="color:var(--primary)">${t.reward}pt</div>
      </a>
    `).join('');
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function renderRecentTx() {
  const root = document.getElementById('recent');
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
//  - Not yet, today is workday: "位置情報で来室" button (geolocation)
//  - Not yet, not workday:   inert message, but still allow optional checkin
async function renderCheckinArea() {
  const root = document.getElementById('checkin-area');
  if (!root) return;
  let status;
  try { status = await get('/api/checkins/status'); }
  catch (e) {
    root.innerHTML = `<div class="muted" style="font-size:13px">${escapeHtml(e.message)}</div>`;
    return;
  }
  // Check-in happens entirely via the lab Wi-Fi scanner — no manual UI here.
  // Show today's state + the bonus rule explainer, nothing actionable.
  if (status.checked_in_today) {
    root.innerHTML = `<div style="font-size:14px" class="muted">✓ 本日来室済み (+${status.points_today}pt / 連続来室 ${status.current_streak} 日)</div>
      ${bonusRuleHtml(status.bonus_rule)}`;
    return;
  }
  if (status.today_is_workday) {
    root.innerHTML = `<div class="muted" style="font-size:13px">ラボの Wi-Fi に繋ぐと自動でチェックインされます。</div>
      ${bonusRuleHtml(status.bonus_rule)}`;
  } else {
    root.innerHTML = `<div class="muted" style="font-size:13px">今日はラボの稼働日ではないため、streak には影響しません。</div>
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
    💰 来室ボーナス: ベース <b>${base}</b>pt + 連続日数で上乗せ、最大 <b>${max_total}</b>pt
    (${days_to_max} 日連続で上限到達)
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

function renderRoom(r) {
  const peopleHtml = r.users.length
    ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px">
         ${r.users.map(u => `
           <span class="presence-pill" title="${escapeHtml(u.display_name)}">
             ${avatarHtml(u.display_name, u.avatar_url, 'sm')}
             <span class="presence-pill-name">${escapeHtml(u.display_name)}</span>
           </span>`).join('')}
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

function labelFor(type) {
  return ({
    initial: '初期配布',
    checkin: '来室',
    purchase: '購入',
    fee: '手数料',
    reversal: '取消',
    transfer: '送金',
    task_reward: 'タスク報酬',
    deposit: '預け入れ',
    refund: '返金',
    burn: '消却',
  })[type] || type;
}
