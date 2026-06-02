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
      <div class="muted" id="streak-line">連続ラボイン — 日 (最長 — 日)</div>
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
        <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px" class="muted">
          名前を表示
          <span class="switch">
            <input type="checkbox" id="presence-names-toggle">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <div id="presence" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
      <div class="muted" style="font-size:11px; margin-top:6px; line-height:1.5">
        🙈 スマホの Wi-Fi を OFF にしたり、MIND に接続すると検知されなくなります。
      </div>
      <div style="text-align:right; margin-top:8px">
        <a href="#/activity" class="muted" style="font-size:13px">活動マップ →</a>
      </div>
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
        <h2 style="flex:1; margin:0">履歴</h2>
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
      `連続ラボイン ${s.current_streak ?? 0} 日 (最長 ${s.longest_streak ?? 0} 日)`;
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
    // 今日の滞在時間 + ライブインジケータだけを 1 行で。詳しい内訳は草の
     // セルにホバーすれば日ごとに出るので、上の数値スタックは省略。
    root.innerHTML = `
      <div style="display:flex; align-items:baseline; gap:14px">
        <div>
          <div class="muted" style="font-size:11px">今日のラボ滞在</div>
          <div class="bold" style="font-size:18px; color:var(--primary)">${fmt(s.today_minutes)}</div>
        </div>
        <div style="flex:1; text-align:right">${live}</div>
      </div>
      <div id="presence-grass" style="margin-top:14px"></div>
    `;
    renderPresenceGrass();
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// GitHub-style daily contribution grid. Each cell = 1 day; columns = weeks
// (Mon..Sun rows). Color intensity scales with minutes_present that day:
//   0 → light grey, then 4 green steps up to "very long stay".
async function renderPresenceGrass() {
  const root = document.getElementById('presence-grass');
  if (!root) return;
  try {
    // 日本の学校年度 (4/1 - 翌 3/31)。今が 4 月以降なら今年、それより前なら去年が
    // 年度の起点。グリッドはその起点日から今日までを表示する。
    const now = new Date();
    const m = now.getMonth();          // 0=Jan..11=Dec
    const fiscalYear = m >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fiscalStart = new Date(fiscalYear, 3, 1); // April 1
    const daysSoFar = Math.min(366,
      Math.floor((now - fiscalStart) / 86400000) + 1);
    const c = await get('/api/me/contribution_calendar', { days: daysSoFar });
    if (!c.days.length) { root.innerHTML = ''; return; }
    // Pad so the first column starts on a Monday. dow: 1=Mon..0=Sun in JS;
    // we want Mon-first, so map (d.getDay()+6)%7 → 0=Mon..6=Sun.
    const cells = c.days.map(d => ({ ...d, dow: (new Date(d.date).getDay() + 6) % 7 }));
    const lead = cells[0].dow;
    const padded = [...Array(lead).fill(null), ...cells];
    // Pack into 7-row columns
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
    const max = Math.max(60, ...cells.map(d => d.minutes));  // floor at 60min so single-checkin days don't max the scale
    const color = m => {
      if (m <= 0) return '#ebedf0';
      const t = Math.min(1, m / max);
      if (t < 0.2) return '#c6e48b';
      if (t < 0.4) return '#7bc96f';
      if (t < 0.7) return '#239a3b';
      return '#196127';
    };
    const fmtMin = m => m < 60 ? `${m}分` : `${Math.floor(m/60)}時間${m%60?(m%60)+'分':''}`;
    const dayLabels = ['月','','水','','金','',''];  // sparse: Mon/Wed/Fri only
    const cellHtml = (d) => d
      ? `<div class="grass-cell" style="background:${color(d.minutes)}"
              title="${d.date}: ${d.minutes > 0 ? fmtMin(d.minutes) : '不在'}"></div>`
      : `<div class="grass-cell" style="background:transparent"></div>`;
    root.innerHTML = `
      <div class="muted" style="font-size:11px; margin-bottom:4px">${fiscalYear} 年度のラボ滞在</div>
      <div style="display:flex; gap:3px; overflow-x:auto; padding-bottom:2px">
        <div style="display:grid; grid-template-rows:repeat(7, 12px); gap:2px; padding-right:2px">
          ${dayLabels.map(l => `<div style="font-size:9px; color:var(--muted); line-height:12px">${l}</div>`).join('')}
        </div>
        ${weeks.map(w => `
          <div style="display:grid; grid-template-rows:repeat(7, 12px); gap:2px">
            ${[0,1,2,3,4,5,6].map(r => cellHtml(w[r] ?? null)).join('')}
          </div>`).join('')}
      </div>
      <div class="muted" style="font-size:10px; margin-top:4px; display:flex; align-items:center; gap:4px">
        少
        ${['#ebedf0','#c6e48b','#7bc96f','#239a3b','#196127'].map(c => `<span class="grass-cell" style="background:${c}; width:10px; height:10px"></span>`).join('')}
        多
      </div>
    `;
  } catch (e) {
    root.innerHTML = `<div class="muted" style="font-size:11px">${escapeHtml(e.message)}</div>`;
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
    // Onboarding banner: if the user has no registered MAC, surface a
    // prominent how-to right above the room list. Once any MAC is claimed,
    // state.hasMac flips true and the banner disappears.
    const banner = state.hasMac ? '' : `
      <div style="background:#fff8e6; border:1px solid #f5d089; border-radius:10px; padding:10px 12px; margin-bottom:10px">
        <div class="bold" style="color:#b54708; margin-bottom:4px">📱 スマホの MAC アドレスを登録してください</div>
        <div style="font-size:13px; line-height:1.6">
          無線 LAN を <b>nkmr-lab-wifi</b> に接続し、スマホのネットワーク設定から自身の IP アドレスをチェックしてください。
          <a href="#/settings" style="color:var(--primary); font-weight:600">設定</a> からそれに該当するものを見つけて <b>「これは私」</b> を押してください。
        </div>
        <div class="muted" style="font-size:11px; margin-top:6px">
          登録するまで在室検知・ラボインボーナス・購入が動きません。
        </div>
      </div>`;

    if (!pres.rooms.length) {
      presenceRoot.innerHTML = banner + `<div class="empty">部屋が登録されていません</div>`;
    } else {
      // Pass window_minutes through so each pill can fade based on its
      // last_seen_at age relative to the cutoff window.
      const win = Number(pres.window_minutes) || 3;
      presenceRoot.innerHTML = banner + pres.rooms.map(r => renderRoom(r, win)).join('');
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
      // 商品サムネ — 画像あれば 40px 角、無ければ商品名の頭文字を載せた灰色プレースホルダ。
      // 「タイル全部」じゃなく「左にちょこっと」入る程度に留めることで、テキスト中心の
      // 「新規入荷」リストの空気感を残しつつ "あ、これ何だっけ" の認知を助ける。
      const initial = (l.name || '?').trim().charAt(0).toUpperCase();
      const thumb = l.image_url
        ? `<img src="${escapeHtml(l.image_url)}" class="fresh-thumb" alt="">`
        : `<div class="fresh-thumb fresh-thumb-fallback">${escapeHtml(initial)}</div>`;
      return `
        <a class="list-item" href="#/product/${encodeURIComponent(l.jan)}" style="align-items:center; gap:10px">
          ${thumb}
          <div style="flex:1; min-width:0">
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
//  - Not yet, today is workday: passive message (Wi-Fi scanner handles it)
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
    root.innerHTML = `<div style="font-size:14px" class="muted">✓ 本日ラボイン済み (+${status.points_today}pt / 連続ラボイン ${status.current_streak} 日)</div>
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
    💰 ラボインボーナス: ベース <b>${base}</b>pt + 連続日数で上乗せ、最大 <b>${max_total}</b>pt
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

function renderRoom(r, windowMin) {
  // Fade-by-age: pills are fully opaque when last seen <30s ago, then ramp
  // linearly to 0.35 by the window edge (after which the API drops them).
  // This makes brief detection gaps visible without yanking the avatar out
  // of the list entirely.
  const now = Date.now();
  const parseJst = ts => Date.parse(ts.replace(' ', 'T') + '+09:00');
  // Two values per user: opacity 1.0→0.15 and grayscale 0→100%. Both ramp
  // linearly over [fresh, cutoff]. The grayscale is what really sells "this
  // is not a current observation" — opacity alone gets visually lost against
  // the white card background.
  const fadeFor = lastSeen => {
    if (!lastSeen) return { opacity: 1, gray: 0 };
    const ageSec = Math.max(0, (now - parseJst(lastSeen)) / 1000);
    const fresh = 15;                 // <15s = unmistakably fresh
    const cutoff = windowMin * 60;
    if (ageSec <= fresh)  return { opacity: 1,    gray: 0 };
    if (ageSec >= cutoff) return { opacity: 0.15, gray: 100 };
    const t = (ageSec - fresh) / Math.max(1, cutoff - fresh);
    return {
      opacity: Number((1 - 0.85 * t).toFixed(2)),
      gray:    Math.round(100 * t),
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
           const { opacity, gray } = fadeFor(u.last_seen_at);
           let dur = '';
           if (u.session_start_at && u.last_seen_at) {
             const mins = Math.max(0, Math.round(
               (parseJst(u.last_seen_at) - parseJst(u.session_start_at)) / 60000));
             dur = `滞在 ${formatDur(mins)}`;
           }
           const ageHint = opacity < 1 ? ' (検知途切れ気味)' : '';
           const tooltip = `${u.display_name}${dur ? ' — ' + dur : ''}${ageHint}`;
           const style = `opacity:${opacity}; filter:grayscale(${gray}%)`;
           return `
             <span class="presence-pill" title="${escapeHtml(tooltip)}" style="${style}">
               ${avatarHtml(u.display_name, u.avatar_url, 'sm')}
               <span class="presence-pill-name">${escapeHtml(u.display_name)}</span>
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

function labelFor(type) {
  return ({
    initial: '初期配布',
    checkin: 'ラボインボーナス',
    purchase: '購入',
    fee: '手数料',
    reversal: '取消',
    transfer: '送金',
    task_reward: 'タスク報酬',
    deposit: '預け入れ',
    refund: '返金',
    burn: '消却',
    scrapbox_reward: 'Scrapbox編集ボーナス',
  })[type] || type;
}
