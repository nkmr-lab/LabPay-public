import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { LEDGER_TYPE_LABEL } from '../labels.js';

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
    <div class="card" id="supply-card">
      <h3 style="margin-top:0">流通ポイント</h3>
      <div id="supply" class="muted">読み込み中…</div>
      <div class="muted" style="font-size:11px; margin-top:8px">
        Admin 以外の保有量が増えすぎたらインフレ気味、減りすぎたら手数料/還流不足の目安。
      </div>
    </div>

    <div class="card">
      <h3>カレンダー</h3>
      <div class="row center">
        <div id="hol-status" class="muted" style="font-size:13px; flex:1">読み込み中…</div>
        <button id="hol-sync">国民の祝日を同期</button>
      </div>
      <div class="sep"></div>
      <div class="row center" style="gap:6px">
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
        <input id="rv-memo" type="text" placeholder="取消理由 (任意)" class="grow">
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
        <input id="is-memo" type="text" placeholder="メモ (任意)" class="grow">
        <button id="is-go" class="primary">発行</button>
      </div>
      <div class="muted" style="font-size:12px; margin-top:4px">
        全員配布の場合、許可リストの全ユーザーに同じポイント数が付与されます。
      </div>
    </div>

    <details class="card collapsible-form">
      <summary>詳細管理 (普段触らない設定など)</summary>
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
          <input id="rm-name" type="text" placeholder="表示名 (例: 10階研究室)" class="grow">
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

  // --- Supply (top-of-page inflation guard) + Dashboard ---
  // Both views consume the same /api/admin/dashboard payload — fetch once, render twice.
  let dash = null;
  try { dash = await get('/api/admin/dashboard'); }
  catch (e) {
    document.getElementById('supply').textContent = '取得失敗: ' + e.message;
    document.getElementById('dash').textContent = '取得失敗: ' + e.message;
  }
  if (dash) renderSupply(dash);
  if (dash) renderDashboard(dash);

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

  // --- Users (with inline grade + gender editors) ---
  await loadTable('users', async (el) => {
    const u = await get('/api/admin/users');
    const gradeOpts = ['', 'D', 'M2', 'M1', 'B4', 'B3'];
    const genderOpts = [['', '—'], ['M', '男'], ['F', '女'], ['X', '他']];
    el.innerHTML = `
      <table class="table">
        <thead><tr><th>id</th><th>name</th><th>email</th><th>role</th><th>学年</th><th>性別</th><th class="right">balance</th></tr></thead>
        <tbody>${u.items.map(x => `
          <tr>
            <td class="mono right">${x.id}</td>
            <td>${escapeHtml(x.display_name)}</td>
            <td class="muted mono">${escapeHtml(x.email)}</td>
            <td>${escapeHtml(x.role)}</td>
            <td><select data-edit="grade" data-uid="${x.id}">
              ${gradeOpts.map(g => `<option value="${g}" ${(x.grade ?? '') === g ? 'selected' : ''}>${g || '—'}</option>`).join('')}
            </select></td>
            <td><select data-edit="gender" data-uid="${x.id}">
              ${genderOpts.map(([v, lbl]) => `<option value="${v}" ${(x.gender ?? '') === v ? 'selected' : ''}>${lbl}</option>`).join('')}
            </select></td>
            <td class="right mono">${(x.balance ?? 0).toLocaleString()}</td>
          </tr>`).join('')}</tbody>
      </table>`;
    el.querySelectorAll('[data-edit]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const uid = Number(sel.dataset.uid);
        const field = sel.dataset.edit;
        const value = sel.value || null;
        try {
          await patch(`/api/admin/users/${uid}`, { [field]: value });
          toast('更新しました');
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
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
      showTokenModal({
        title: `部屋 "${id}" を作成しました`,
        body: 'scanner_token (一度しか表示されません):',
        token: res.scanner_token,
        footer: 'この値を scanner の設定 (scanner.config.json or install_scanner.ps1) に入れてください。',
      });
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

// Render the prominent "circulating supply" summary card at the top of the admin page.
// Shows admin vs non-admin balances side by side so inflation pressure (members holding
// runaway pt) is visible at a glance. Per-capita averages help spot skew vs accumulation.
function renderSupply(d) {
  const el = document.getElementById('supply');
  if (!el) return;
  const fmt = n => Number(n).toLocaleString();
  const safeDiv = (a, b) => (b > 0 ? Math.round(a / b) : 0);
  // 「流通中」= 人 (admin + 一般) が持っている合計。double-entry なので
  // system_balance は負の値 (= 純発行量の符号反転) になるため、流通量を
  // (system + escrow + held) で出すと常に 0 になってしまい意味がない。
  // 代わりに、held_by_users をそのまま流通量とし、発行純額 (-system_balance)
  // を文脈として併記する。
  const circulating  = d.held_by_users;
  const netIssued    = -d.system_balance; // = held_by_users + escrow_balance
  const memberShare  = circulating > 0
    ? ((d.held_by_members / circulating) * 100).toFixed(1)
    : '0.0';
  const adminAvg  = safeDiv(d.held_by_admins,  d.admin_count);
  const memberAvg = safeDiv(d.held_by_members, d.member_count);
  el.innerHTML = `
    <div class="supply-grid">
      <div class="supply-cell">
        <div class="supply-label">流通中 (admin + 一般)</div>
        <div class="supply-value">${fmt(circulating)}</div>
        <div class="supply-sub">発行純額 ${fmt(netIssued)} / ESCROW ${fmt(d.escrow_balance)}</div>
      </div>
      <div class="supply-cell supply-admin">
        <div class="supply-label">Admin 保有</div>
        <div class="supply-value">${fmt(d.held_by_admins)}</div>
        <div class="supply-sub">${d.admin_count}人 / 平均 ${fmt(adminAvg)} pt</div>
      </div>
      <div class="supply-cell supply-member">
        <div class="supply-label">一般 保有</div>
        <div class="supply-value">${fmt(d.held_by_members)}</div>
        <div class="supply-sub">${d.member_count}人 / 平均 ${fmt(memberAvg)} pt</div>
      </div>
      <div class="supply-cell">
        <div class="supply-label">一般保有 / 流通中</div>
        <div class="supply-value">${memberShare}<span style="font-size:14px">%</span></div>
        <div class="supply-sub">手数料総額 ${fmt(d.total_fees)} pt</div>
      </div>
    </div>
  `;
}

function renderDashboard(d) {
  const el = document.getElementById('dash');
  if (!el) return;
  el.innerHTML = `
    <table class="table">
      <tr><th>SYSTEM残高</th><td class="right mono">${d.system_balance.toLocaleString()}</td>
          <th>ESCROW残高</th><td class="right mono">${d.escrow_balance.toLocaleString()}</td></tr>
      <tr><th>総発行 (initial+checkin)</th><td class="right mono">${d.total_minted.toLocaleString()}</td>
          <th>手数料総額</th><td class="right mono">${d.total_fees.toLocaleString()}</td></tr>
      <tr><th>ユーザー保有合計</th><td class="right mono">${d.held_by_users.toLocaleString()}</td>
          <th>取引数</th><td class="right mono">${d.purchase_count.toLocaleString()}</td></tr>
      <tr><th>うち Admin 保有</th><td class="right mono">${d.held_by_admins.toLocaleString()}</td>
          <th>うち 一般 保有</th><td class="right mono">${d.held_by_members.toLocaleString()}</td></tr>
      <tr><th>取扱高 (購入合計)</th><td class="right mono">${d.turnover.toLocaleString()}</td>
          <th>商品マスタ数</th><td class="right mono">${d.product_count.toLocaleString()}</td></tr>
      <tr><th>有効許可ユーザー</th><td class="right mono">${d.allowlist_active.toLocaleString()}</td>
          <th>稼働中出品</th><td class="right mono">${d.listings_active.toLocaleString()}</td></tr>
    </table>
  `;
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
      <div class="grow">
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
        <td class="hint-sm">${escapeHtml(x.last_scan_at ?? '(未スキャン)')}</td>
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
        const roomId = decodeURIComponent(b.dataset.rotate);
        if (!confirm('token を再発行すると古い token は無効になります。続行しますか?')) return;
        try {
          const res = await post('/api/admin/rooms/' + b.dataset.rotate + '/rotate_token', {});
          showTokenModal({
            title: `部屋 "${roomId}" の token を再発行しました`,
            body: '新しい scanner_token (一度しか表示されません):',
            token: res.scanner_token,
            footer: '古い token は無効になりました。この値を scanner の設定に入れ直してください。',
          });
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

// Modal for one-shot secrets (scanner_token). The browser's native alert() doesn't
// let users select the text, which makes copying impossible on iOS Safari. This shows
// the token inside a selectable monospace box with an explicit COPY button that
// uses the Clipboard API (with a fallback to manual selection if denied).
function showTokenModal({ title, body, token, footer }) {
  const existing = document.getElementById('token-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'token-modal';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:14px; max-width:480px; width:100%; padding:20px; box-shadow:0 12px 40px rgba(0,0,0,0.3)">
      <h3 style="margin:0 0 8px; color:var(--primary)">${escapeHtml(title)}</h3>
      <p style="margin:0 0 10px; font-size:14px; color:#444">${escapeHtml(body)}</p>
      <textarea id="token-modal-text" readonly
                style="width:100%; box-sizing:border-box; font-family:Consolas,Menlo,monospace; font-size:13px; padding:10px; border:1px solid var(--line); border-radius:8px; word-break:break-all; resize:none; height:60px; background:#f6f3fa"
                onclick="this.select()">${escapeHtml(token)}</textarea>
      <p style="margin:8px 0 14px; font-size:12px; color:#666">${escapeHtml(footer)}</p>
      <div id="token-modal-status" class="muted" style="font-size:12px; margin-bottom:8px; min-height:16px"></div>
      <div style="display:flex; gap:8px; justify-content:flex-end">
        <button id="token-modal-close">閉じる</button>
        <button id="token-modal-copy" class="primary">📋 コピー</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const ta = overlay.querySelector('#token-modal-text');
  const status = overlay.querySelector('#token-modal-status');
  ta.focus();
  ta.select();

  overlay.querySelector('#token-modal-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(token);
      status.textContent = '✓ クリップボードにコピーしました';
      status.style.color = 'var(--primary)';
    } catch (e) {
      ta.select();
      status.textContent = 'クリップボード API 拒否。テキストを選択したので Ctrl+C / Cmd+C でコピーしてください';
      status.style.color = 'var(--warn)';
    }
  });

  const close = () => overlay.remove();
  overlay.querySelector('#token-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}
