import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

// Common fetch-into-element wrapper used by every admin sub-section.
// fetcher(el) does the actual GET + DOM build + event wiring; on throw we set a friendly message.
async function loadTable(elementId, fetcher) {
  const el = document.getElementById(elementId);
  if (!el) return;
  try { await fetcher(el); }
  catch (e) { el.textContent = '取得失敗: ' + e.message; }
}

export async function renderAdmin() {
  if (!state.me || state.me.role !== 'admin') {
    document.getElementById('app').innerHTML = `<div class="card"><h2>管理者専用</h2><p>権限がありません。</p></div>`;
    return;
  }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h3>カレンダー</h3>
      <div class="row" style="align-items:center">
        <div id="hol-status" class="muted" style="font-size:13px; flex:1">読み込み中…</div>
        <button id="hol-sync">国民の祝日を同期</button>
      </div>
      <div class="sep"></div>
      <div class="row" style="align-items:center; gap:6px">
        <button id="cal-prev">←</button>
        <div id="cal-title" class="bold" style="flex:1; text-align:center">読み込み中…</div>
        <button id="cal-next">→</button>
      </div>
      <div id="cal-grid" style="margin-top:8px"></div>
      <div class="muted" style="font-size:11px; margin-top:4px">
        <span class="cal-swatch cal-workday-swatch"></span>ラボ営業日 /
        <span class="cal-swatch cal-off-swatch"></span>ラボ休み &nbsp; (タップで切替)
      </div>
    </div>

    <div class="card">
      <h3>決済の取消</h3>
      <p class="muted" style="font-size:13px; margin:4px 0">最近の取引から、取り消す決済を選んでください。</p>
      <div class="row" style="margin-bottom:8px">
        <button id="rv-reload">最新の取引を読み込み</button>
        <input id="rv-memo" type="text" placeholder="取消理由 (任意)" style="flex:1">
      </div>
      <div id="rv-list" class="list"><div class="muted">「最新の取引を読み込み」を押してください</div></div>
    </div>

    <div class="card">
      <h3>ポイント発行</h3>
      <div class="row" style="gap:14px; margin-bottom:8px">
        <label style="display:inline-flex; align-items:center; gap:4px">
          <input type="radio" name="is-mode" value="all" id="is-mode-all" checked> 全員に配布
        </label>
        <label style="display:inline-flex; align-items:center; gap:4px">
          <input type="radio" name="is-mode" value="user" id="is-mode-user"> 個人を指定
        </label>
      </div>
      <div id="is-user-row" class="row" hidden>
        <select id="is-user" style="flex:1; max-width:260px">
          <option value="">— 受け取る人を選択 —</option>
        </select>
      </div>
      <div class="row">
        <input id="is-amount" type="number" placeholder="ポイント数" min="1" style="max-width:140px">
        <input id="is-memo" type="text" placeholder="メモ (任意)" style="flex:1">
        <button id="is-go" class="primary">発行</button>
      </div>
      <div class="muted" style="font-size:12px; margin-top:4px">
        全員配布の場合、許可リストの全ユーザーに同じポイント数が付与されます。
      </div>
    </div>

    <details class="card" style="padding: 12px 16px">
      <summary style="cursor:pointer; font-weight:700">詳細管理 (普段触らない設定など)</summary>
      <div style="margin-top:10px">
        <h3>管理ダッシュボード</h3>
        <div id="dash" class="muted">読み込み中…</div>
      </div>

      <div class="sep"></div>
      <h3>許可リスト</h3>
      <div id="allow" class="muted">読み込み中…</div>
      <details style="margin-top:8px">
        <summary>追加 / 更新</summary>
        <div class="row" style="margin-top:6px">
          <input id="al-email" type="email" placeholder="email">
          <input id="al-name" type="text" placeholder="display name">
          <select id="al-role"><option value="member">member</option><option value="admin">admin</option></select>
          <label class="muted"><input type="checkbox" id="al-active" checked> active</label>
          <button id="al-save" class="primary">保存</button>
        </div>
      </details>

      <div class="sep"></div>
      <h3>ユーザー残高</h3>
      <div id="users" class="muted">読み込み中…</div>

      <div class="sep"></div>
      <h3>部屋 (scanner 設定)</h3>
      <div id="rooms" class="muted">読み込み中…</div>
      <details style="margin-top:8px">
        <summary>部屋を追加</summary>
        <div class="row" style="margin-top:6px">
          <input id="rm-id" type="text" placeholder="id (例: 10F)" style="max-width:120px">
          <input id="rm-name" type="text" placeholder="表示名 (例: 10階研究室)" style="flex:1">
          <button id="rm-add" class="primary">作成</button>
        </div>
        <div class="muted" style="font-size:12px; margin-top:4px">
          作成すると scanner 用 token が一度だけ表示されます。座標は作成後に編集できます。
        </div>
      </details>

      <div class="sep"></div>
      <h3>設定 (ノブ)</h3>
      <div id="cfg" class="muted">読み込み中…</div>

      <div class="sep"></div>
      <h3>お知らせ (全員に通知)</h3>
      <textarea id="bc-body" maxlength="255" placeholder="本文"></textarea>
      <button id="bc-go" class="primary" style="margin-top:6px">送信</button>
    </details>
  `;

  // --- Dashboard ---
  await loadTable('dash', async (el) => {
    const d = await get('/api/admin/dashboard');
    el.innerHTML = `
      <table class="table">
        <tr><th>SYSTEM残高</th><td class="right mono">${d.system_balance.toLocaleString()}</td>
            <th>ESCROW残高</th><td class="right mono">${d.escrow_balance.toLocaleString()}</td></tr>
        <tr><th>総発行 (initial+checkin)</th><td class="right mono">${d.total_minted.toLocaleString()}</td>
            <th>手数料総額</th><td class="right mono">${d.total_fees.toLocaleString()}</td></tr>
        <tr><th>ユーザー保有合計</th><td class="right mono">${d.held_by_users.toLocaleString()}</td>
            <th>取引数</th><td class="right mono">${d.purchase_count.toLocaleString()}</td></tr>
        <tr><th>取扱高 (購入合計)</th><td class="right mono">${d.turnover.toLocaleString()}</td>
            <th>商品マスタ数</th><td class="right mono">${d.product_count.toLocaleString()}</td></tr>
        <tr><th>有効許可ユーザー</th><td class="right mono">${d.allowlist_active.toLocaleString()}</td>
            <th>稼働中出品</th><td class="right mono">${d.listings_active.toLocaleString()}</td></tr>
      </table>
    `;
  });

  // --- Allowlist ---
  await loadAllow();

  document.getElementById('al-save').addEventListener('click', async () => {
    try {
      await post('/api/admin/allowlist', {
        email: document.getElementById('al-email').value.trim(),
        display_name: document.getElementById('al-name').value.trim(),
        role: document.getElementById('al-role').value,
        active: document.getElementById('al-active').checked ? 1 : 0,
      });
      toast('保存しました');
      await loadAllow();
    } catch (e) { toast('失敗: ' + e.message); }
  });

  // --- Users ---
  await loadTable('users', async (el) => {
    const u = await get('/api/admin/users');
    el.innerHTML = `
      <table class="table">
        <thead><tr><th>id</th><th>name</th><th>email</th><th>role</th><th class="right">balance</th></tr></thead>
        <tbody>${u.items.map(x => `
          <tr>
            <td class="mono right">${x.id}</td>
            <td>${escapeHtml(x.display_name)}</td>
            <td class="muted mono">${escapeHtml(x.email)}</td>
            <td>${escapeHtml(x.role)}</td>
            <td class="right mono">${(x.balance ?? 0).toLocaleString()}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  });

  // --- Issue points (broadcast vs single user) ---
  await populateIssueUserPicker();
  function syncIssueMode() {
    const mode = document.querySelector('input[name="is-mode"]:checked').value;
    document.getElementById('is-user-row').hidden = (mode !== 'user');
  }
  document.querySelectorAll('input[name="is-mode"]').forEach(r => {
    r.addEventListener('change', syncIssueMode);
  });
  syncIssueMode();
  document.getElementById('is-go').addEventListener('click', async () => {
    const mode = document.querySelector('input[name="is-mode"]:checked').value;
    const amount = Number(document.getElementById('is-amount').value);
    const memo = document.getElementById('is-memo').value.trim() || null;
    if (!(amount > 0)) { toast('ポイント数を入力してください'); return; }
    let body = { mode, amount, memo };
    if (mode === 'user') {
      const uid = Number(document.getElementById('is-user').value);
      if (!(uid > 0)) { toast('受け取る人を選択してください'); return; }
      body.to_user_id = uid;
    } else {
      if (!confirm(`全員に ${amount}pt を配布します。よろしいですか?`)) return;
    }
    try {
      const res = await post('/api/admin/issue', body);
      if (res.mode === 'all') {
        const fc = Object.keys(res.failures || {}).length;
        toast(`発行しました (${res.recipients}人${fc ? ` / 失敗 ${fc}件` : ''})`);
      } else {
        toast('発行しました (ledger #' + res.ledger_id + ')');
      }
    } catch (e) { toast('失敗: ' + e.message); }
  });

  // --- Reversal (pick from recent ledger list) ---
  document.getElementById('rv-reload').addEventListener('click', loadReversalCandidates);

  // --- Config ---
  await loadTable('cfg', async (el) => {
    const c = await get('/api/admin/config');
    const inputs = c.items.map(it => `
      <div class="row" style="margin-bottom:6px; align-items:center">
        <label style="min-width:180px" class="muted">${escapeHtml(it.k)}</label>
        <input type="text" data-cfg="${escapeHtml(it.k)}" value="${escapeHtml(it.v)}">
      </div>
    `).join('');
    el.innerHTML = inputs + `<button id="cfg-save" class="primary">設定を保存</button>`;
    document.getElementById('cfg-save').addEventListener('click', async () => {
      const body = {};
      document.querySelectorAll('[data-cfg]').forEach(el => { body[el.dataset.cfg] = el.value; });
      try { await patch('/api/admin/config', body); toast('保存しました'); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  });

  // --- Calendar ---
  const calState = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  await loadHolidays();
  await renderCalendarGrid(calState.year, calState.month);
  document.getElementById('hol-sync').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const r = await post('/api/admin/holidays/sync', {});
      toast(`祝日 ${r.count} 件を同期しました`);
      await loadHolidays();
      await renderCalendarGrid(calState.year, calState.month);
    } catch (e) { toast('同期失敗: ' + e.message); }
    ev.currentTarget.disabled = false;
  });
  document.getElementById('cal-prev').addEventListener('click', async () => {
    calState.month -= 1;
    if (calState.month < 1) { calState.month = 12; calState.year -= 1; }
    await renderCalendarGrid(calState.year, calState.month);
  });
  document.getElementById('cal-next').addEventListener('click', async () => {
    calState.month += 1;
    if (calState.month > 12) { calState.month = 1; calState.year += 1; }
    await renderCalendarGrid(calState.year, calState.month);
  });

  // --- Rooms ---
  await loadRooms();
  document.getElementById('rm-add').addEventListener('click', async () => {
    const id = document.getElementById('rm-id').value.trim();
    const display_name = document.getElementById('rm-name').value.trim();
    if (!id || !display_name) { toast('id と表示名を入力してください'); return; }
    try {
      const res = await post('/api/admin/rooms', { id, display_name });
      const msg = `部屋 "${id}" を作成しました。\n\nscanner_token (一度しか表示されません):\n${res.scanner_token}\n\nこの値を scanner の設定に入れてください。`;
      alert(msg);
      document.getElementById('rm-id').value = '';
      document.getElementById('rm-name').value = '';
      await loadRooms();
    } catch (e) { toast('失敗: ' + e.message); }
  });

  // --- Broadcast ---
  document.getElementById('bc-go').addEventListener('click', async () => {
    const body = document.getElementById('bc-body').value.trim();
    if (!body) return;
    try {
      const r = await post('/api/admin/broadcast', { body });
      toast('送信しました (' + r.recipients + '人)');
      document.getElementById('bc-body').value = '';
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

// Populate the issue-points user dropdown from /api/users.
async function populateIssueUserPicker() {
  try {
    const u = await get('/api/users');
    const sel = document.getElementById('is-user');
    if (!sel) return;
    const opts = u.items.map(x =>
      `<option value="${x.id}">${escapeHtml(x.display_name)} (#${x.id})</option>`
    ).join('');
    sel.insertAdjacentHTML('beforeend', opts);
  } catch (e) { /* dropdown stays with just the placeholder option */ }
}

// Pretty label for ledger row type, matches home.js but kept local to avoid coupling.
const LEDGER_TYPE_LABEL = {
  initial: '初期/配布', checkin: '来室', purchase: '購入', fee: '手数料',
  reversal: '取消', transfer: '送金', task_reward: 'タスク報酬',
  deposit: '預け入れ', refund: '返金', burn: '消却',
};

// Fetch recent ledger candidates and render a clickable list. Clicking 取消 confirms,
// posts the reversal, then refreshes the list so the now-reversed row drops out.
async function loadReversalCandidates() {
  const root = document.getElementById('rv-list');
  if (!root) return;
  root.innerHTML = `<div class="muted">読み込み中…</div>`;
  try {
    const d = await get('/api/admin/ledger', { limit: 30 });
    if (!d.items.length) {
      root.innerHTML = `<div class="empty">取消可能な取引はありません</div>`;
      return;
    }
    root.innerHTML = d.items.map(rvRow).join('');
    root.querySelectorAll('[data-rv]').forEach(b => {
      b.addEventListener('click', () => onReverse(Number(b.dataset.rv), b));
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function rvRow(r) {
  const typeLabel = LEDGER_TYPE_LABEL[r.type] || r.type;
  const from = r.from_name || r.from_code || '?';
  const to   = r.to_name   || r.to_code   || '?';
  const sub  = r.product_name
    ? ` · ${escapeHtml(r.product_name)}`
    : (r.memo ? ` · ${escapeHtml(r.memo)}` : '');
  return `
    <div class="list-item">
      <div style="flex:1">
        <div class="bold">#${r.id} ${escapeHtml(typeLabel)} · ${r.amount.toLocaleString()}pt</div>
        <div class="meta">${escapeHtml(from)} → ${escapeHtml(to)}${sub}</div>
        <div class="meta">${escapeHtml(r.created_at)}</div>
      </div>
      <div><button class="danger" data-rv="${r.id}">取消</button></div>
    </div>`;
}

async function onReverse(ledgerId, btn) {
  if (!confirm(`ledger #${ledgerId} を取り消しますか? (購入の場合、手数料行もまとめて取消されます)`)) return;
  btn.disabled = true;
  const memo = document.getElementById('rv-memo').value.trim() || null;
  try {
    const res = await post('/api/admin/reversal', { ledger_id: ledgerId, memo });
    toast(`取消しました (reversal #${res.reversal_ids.join(', #')})`);
    await loadReversalCandidates();
  } catch (e) {
    toast('失敗: ' + e.message);
    btn.disabled = false;
  }
}

async function loadRooms() {
  await loadTable('rooms', async (el) => {
    const a = await get('/api/admin/rooms');
    const rows = a.items.map(x => `
      <tr data-room="${escapeHtml(x.id)}">
        <td class="mono">${escapeHtml(x.id)}</td>
        <td>${escapeHtml(x.display_name)}</td>
        <td class="muted" style="font-size:12px">${escapeHtml(x.last_scan_at ?? '(未スキャン)')}</td>
        <td>
          <input type="number" step="0.0000001" placeholder="lat" value="${x.lat ?? ''}" data-lat="${x.id}" style="width:110px">
          <input type="number" step="0.0000001" placeholder="lng" value="${x.lng ?? ''}" data-lng="${x.id}" style="width:110px">
          <input type="number" step="1" placeholder="半径m" value="${x.geo_radius_m ?? ''}" data-rad="${x.id}" style="width:80px">
          <button data-savegeo="${encodeURIComponent(x.id)}">座標保存</button>
        </td>
        <td>
          <button data-rotate="${encodeURIComponent(x.id)}">token 再発行</button>
          <button data-rmroom="${encodeURIComponent(x.id)}" class="danger">削除</button>
        </td>
      </tr>`).join('');
    el.innerHTML = `
      <table class="table">
        <thead><tr><th>id</th><th>名称</th><th>最終スキャン</th><th>座標 (lat/lng/半径m)</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">部屋がありません</td></tr>'}</tbody>
      </table>
      <div class="muted" style="font-size:12px; margin-top:4px">
        座標は Google Maps で建物の上を右クリック → 緯度経度をコピー。半径未指定なら 50m。
      </div>`;
    document.querySelectorAll('[data-savegeo]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = decodeURIComponent(b.dataset.savegeo);
        const lat = document.querySelector(`[data-lat="${id}"]`).value;
        const lng = document.querySelector(`[data-lng="${id}"]`).value;
        const rad = document.querySelector(`[data-rad="${id}"]`).value;
        try {
          await fetch('/api/admin/rooms/' + encodeURIComponent(id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'labpay' },
            credentials: 'same-origin',
            body: JSON.stringify({
              lat: lat === '' ? null : Number(lat),
              lng: lng === '' ? null : Number(lng),
              geo_radius_m: rad === '' ? null : Number(rad),
            }),
          }).then(async r => { if (!r.ok) throw new Error((await r.json()).error.message); });
          toast('座標を保存しました');
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
    document.querySelectorAll('[data-rotate]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('token を再発行すると古い token は無効になります。続行しますか?')) return;
        try {
          const res = await post('/api/admin/rooms/' + b.dataset.rotate + '/rotate_token', {});
          alert(`新しい scanner_token (一度しか表示されません):\n${res.scanner_token}`);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
    document.querySelectorAll('[data-rmroom]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この部屋を削除しますか?')) return;
        try { await del('/api/admin/rooms/' + b.dataset.rmroom); toast('削除しました'); await loadRooms(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  });
}

async function loadHolidays() {
  await loadTable('hol-status', async (el) => {
    const d = await get('/api/admin/holidays', { year: new Date().getFullYear() });
    el.innerHTML = d.items.length === 0
      ? '今年の祝日データはまだ同期されていません。「同期」を押してください。'
      : `今年の祝日 ${d.items.length} 件 (最終同期: ${escapeHtml(d.last_sync || '-')})`;
  });
}

// Render a month grid for tap-to-toggle calendar override editing.
// Single tap: weekday → lab_closed, weekend/holiday → lab_open, existing override → cleared.
async function renderCalendarGrid(year, month) {
  const grid = document.getElementById('cal-grid');
  const title = document.getElementById('cal-title');
  title.textContent = `${year} 年 ${month} 月`;
  grid.innerHTML = `<div class="muted">読み込み中…</div>`;

  let holidays = new Map(), overrides = new Map();
  try {
    const [h, o] = await Promise.all([
      get('/api/admin/holidays', { year }),
      get('/api/admin/calendar_overrides', { year }),
    ]);
    h.items.forEach(x => holidays.set(x.holiday_date, x.name));
    o.items.forEach(x => overrides.set(x.override_date, x));
  } catch (e) {
    grid.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  const firstDay = new Date(year, month - 1, 1);
  const lastDay  = new Date(year, month, 0);
  const startDow = firstDay.getDay();           // 0=Sun..6=Sat
  const daysInMonth = lastDay.getDate();

  // 7-column grid: weekday header + day cells (with leading blanks)
  const dowLabels = ['日','月','火','水','木','金','土'];
  let html = `<div class="cal-grid">`;
  for (const d of dowLabels) html += `<div class="cal-head">${d}</div>`;
  for (let i = 0; i < startDow; i++) html += `<div class="cal-cell cal-empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dow = new Date(year, month - 1, day).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const holName = holidays.get(date);
    const ov = overrides.get(date);
    const naturallyWorkday = !isWeekend && !holName;
    const effectiveWorkday = ov ? (ov.kind === 'lab_open') : naturallyWorkday;
    const cls = 'cal-cell ' + (effectiveWorkday ? 'cal-workday' : 'cal-off');
    const tip = holName ? holName : '';
    html += `<div class="${cls}" data-date="${date}" title="${escapeHtml(tip)}">${day}</div>`;
  }
  html += `</div>`;
  grid.innerHTML = html;

  grid.querySelectorAll('[data-date]').forEach(cell => {
    cell.addEventListener('click', () => onCalendarTap(cell, year, month, holidays, overrides));
  });
}

async function onCalendarTap(cell, year, month, holidays, overrides) {
  const date = cell.dataset.date;
  const dow = new Date(date).getDay();
  const isWeekend = dow === 0 || dow === 6;
  const isHoliday = holidays.has(date);
  const existing = overrides.get(date);
  const naturallyWorkday = !isWeekend && !isHoliday;
  try {
    if (existing) {
      // Currently overridden → tap reverts to natural state
      await del('/api/admin/calendar_overrides/' + date);
    } else {
      // No override → flip the natural state
      const kind = naturallyWorkday ? 'lab_closed' : 'lab_open';
      await post('/api/admin/calendar_overrides', { override_date: date, kind, label: null });
    }
    await renderCalendarGrid(year, month);
  } catch (e) {
    toast('失敗: ' + e.message);
  }
}

async function loadAllow() {
  await loadTable('allow', async (el) => {
    const a = await get('/api/admin/allowlist');
    el.innerHTML = `
      <table class="table">
        <thead><tr><th>email</th><th>name</th><th>role</th><th>active</th><th></th></tr></thead>
        <tbody>${a.items.map(x => `
          <tr>
            <td class="mono">${escapeHtml(x.email)}</td>
            <td>${escapeHtml(x.display_name)}</td>
            <td>${escapeHtml(x.role)}</td>
            <td>${x.active ? '✓' : '×'}</td>
            <td><button data-rm="${encodeURIComponent(x.email)}">無効化</button></td>
          </tr>`).join('')}</tbody>
      </table>`;
    el.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('このアカウントを無効化しますか?')) return;
        try { await del('/api/admin/allowlist/' + b.dataset.rm); toast('無効化しました'); await loadAllow(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  });
}
