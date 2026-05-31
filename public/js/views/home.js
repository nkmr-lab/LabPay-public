import { get, post } from '../api.js';
import { escapeHtml, navigate, avatarHtml } from '../router.js';
import { refreshMe, refreshUnread, state, toast } from '../app.js';

export async function renderHome() {
  if (!state.me) await refreshMe();
  if (!state.me) { navigate('#/login'); return; }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card balance-hero">
      <div class="lbl">残高</div>
      <div class="num" id="home-balance">— pt</div>
      <div class="muted" id="streak-line">連続来室 — 日 (最長 — 日)</div>
      <div id="checkin-area" style="margin-top:10px"></div>
      <div style="margin-top:14px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap">
        <a class="btn primary" href="#/buy">買う</a>
        <a class="btn" href="#/sell">売る</a>
        <a class="btn" href="#/tasks">タスク</a>
        <a class="btn" href="#/send">送る</a>
      </div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center; margin-bottom:6px">
        <h2 style="flex:1; margin:0">実績</h2>
        <a href="#/achievements" class="muted" style="font-size:13px">すべて見る →</a>
      </div>
      <div id="ach-summary"><div class="muted">読み込み中…</div></div>
    </div>
    <div class="card">
      <h2>今ラボにいる人</h2>
      <div id="presence"><div class="muted">読み込み中…</div></div>
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
  let me;
  try {
    me = await get('/api/me');
    document.getElementById('home-balance').textContent = (me.balance ?? 0).toLocaleString() + ' pt';
    const s = me.streak || {};
    document.getElementById('streak-line').textContent =
      `連続来室 ${s.current_streak ?? 0} 日 (最長 ${s.longest_streak ?? 0} 日)`;
    state.balance = me.balance;
  } catch (e) {
    toast('情報の取得に失敗: ' + e.message);
  }

  // Render the contextual check-in area
  await renderCheckinArea();

  // Achievement summary
  try {
    const ach = await get('/api/me/achievements');
    document.getElementById('ach-summary').innerHTML = renderAchSummary(ach.items);
  } catch (e) {
    document.getElementById('ach-summary').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }

  // Presence (今ラボにいる人)
  try {
    const pres = await get('/api/presence');
    const root = document.getElementById('presence');
    if (!pres.rooms.length) {
      root.innerHTML = `<div class="empty">部屋が登録されていません</div>`;
    } else {
      root.innerHTML = pres.rooms.map(renderRoom).join('');
    }
  } catch (e) {
    document.getElementById('presence').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }

  // Recent tx
  try {
    const tx = await get('/api/me/transactions', { limit: 5 });
    const root = document.getElementById('recent');
    if (!tx.items.length) {
      root.innerHTML = `<div class="empty">まだ取引がありません</div>`;
    } else {
      root.innerHTML = tx.items.map(renderTxItem).join('');
    }
  } catch (e) {
    document.getElementById('recent').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
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
  if (status.checked_in_today) {
    root.innerHTML = `<div style="font-size:14px" class="muted">✓ 本日来室済み (+${status.points_today}pt / 連続来室 ${status.current_streak} 日)</div>`;
    return;
  }
  if (status.today_is_workday) {
    root.innerHTML = `
      <button class="btn" id="geo-checkin-btn">📍 来室する (位置情報)</button>
      <div class="muted" style="font-size:12px; margin-top:4px">通常は WiFi で自動チェックインされます。検知されないときだけ使ってください。</div>
    `;
    document.getElementById('geo-checkin-btn').addEventListener('click', onGeoCheckin);
  } else {
    root.innerHTML = `<div class="muted" style="font-size:13px">今日はラボの稼働日ではないため、streak には影響しません。</div>`;
  }
}

function onGeoCheckin(ev) {
  const btn = ev.currentTarget;
  btn.disabled = true;
  btn.textContent = '位置情報取得中…';
  if (!('geolocation' in navigator)) {
    toast('このブラウザは位置情報をサポートしていません'); btn.disabled = false; btn.textContent = '📍 来室する (位置情報)';
    return;
  }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const res = await post('/api/checkins/geo', {
        lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy,
      });
      if (res.already_checked_in) toast('既に本日来室済みでした');
      else toast(`+${res.points}pt 来室確認 (距離 ${res.distance_m}m / 連続来室 ${res.current_streak} 日)`);
      await refreshMe();
      await renderHome();
    } catch (e) {
      const dist = e.details && e.details.distance_m ? ` (現在地は ${e.details.distance_m}m 離れています)` : '';
      toast('チェックイン失敗: ' + e.message + dist);
      btn.disabled = false; btn.textContent = '📍 来室する (位置情報)';
    }
  }, (err) => {
    toast('位置情報の取得に失敗: ' + err.message);
    btn.disabled = false; btn.textContent = '📍 来室する (位置情報)';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

function renderAchSummary(items) {
  // Show: medals strip (one per achievement, dimmed if not earned), top 3 nearest-to-next
  const earnedCount = items.filter(a => a.earned_tier > 0).length;
  const medalsRow = items.map(a => {
    const m = a.earned ? a.earned.medal : '⚪';
    const cls = a.earned ? '' : 'style="opacity:.3"';
    return `<span ${cls} title="${escapeHtml(a.title)}: ${escapeHtml(a.earned ? a.earned.label : '未獲得')}" style="font-size:22px">${m}</span>`;
  }).join(' ');

  // Top 3 by progress toward next (excluding maxed)
  const next = items
    .filter(a => !a.is_maxed)
    .sort((x, y) => (y.next_progress || 0) - (x.next_progress || 0))
    .slice(0, 3);
  const progressHtml = next.map(a => {
    const tier = a.next.label;
    const pct  = Math.round((a.next_progress || 0) * 100);
    return `
      <div style="margin-top:6px">
        <div class="meta" style="font-size:12px">${escapeHtml(a.title)} → ${escapeHtml(tier)} (${a.value} / ${a.next.count} ${escapeHtml(a.unit)})</div>
        <div style="height:6px; background:var(--line); border-radius:99px; overflow:hidden">
          <div style="height:100%; width:${pct}%; background:var(--primary)"></div>
        </div>
      </div>`;
  }).join('');

  return `
    <div style="text-align:center; line-height:1.7">${medalsRow}</div>
    <div class="meta" style="text-align:center; font-size:12px; margin-top:4px">獲得 ${earnedCount} / ${items.length}</div>
    ${progressHtml}
  `;
}

function renderRoom(r) {
  const peopleHtml = r.users.length
    ? r.users.map(u => `
        <span style="display:inline-flex; align-items:center; gap:6px; margin:2px 6px 2px 0; padding:2px 8px 2px 2px; background:var(--primary-soft); border-radius:99px">
          ${avatarHtml(u.display_name, u.avatar_url, 'sm')}
          <span style="font-size:13px">${escapeHtml(u.display_name)}</span>
        </span>`).join('')
    : `<span class="muted" style="font-size:13px">誰も検知されていません</span>`;
  const scan = r.last_scan_at ? `· 最終スキャン ${escapeHtml(r.last_scan_at)}` : '· 未スキャン';
  return `
    <div style="margin-bottom:10px">
      <div class="bold">${escapeHtml(r.display_name)} (${r.users.length}人) <span class="muted" style="font-weight:normal; font-size:12px">${scan}</span></div>
      <div style="margin-top:4px">${peopleHtml}</div>
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
      <div style="color:${color}; font-weight:800">${sign}${t.signed_amount.toLocaleString()} pt</div>
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
