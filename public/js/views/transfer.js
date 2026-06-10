import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';
import { playSound } from '../sounds.js';

export async function renderTransfer({ query } = {}) {
  // v477 ?to=:user_id で 受取人 を 自動 選択 (プロフィール → 「💸 LabPay で 送金」 経由)
  const presetTo = query?.to ? Number(query.to) : null;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card balance-strip">
      <span class="muted">残高</span>
      <span class="bold text-primary" id="send-balance">— pt</span>
    </div>

    <div class="card">
      <div class="row">
        <select id="xfer-to" class="grow"><option value="">— 受取人 —</option></select>
        <input type="number" id="xfer-amt" min="1" placeholder="pt" style="max-width:120px">
      </div>
      <input type="text" id="xfer-memo" placeholder="メモ (任意)" maxlength="255" style="margin-top:6px">
      <button id="xfer-send" class="primary" style="margin-top:6px">送金</button>
    </div>
  `;

  // Balance strip
  get('/api/me').then(d => {
    const el = document.getElementById('send-balance');
    if (el) el.textContent = (d.balance ?? 0).toLocaleString() + ' pt';
  }).catch(() => {});

  await loadRecipients();
  if (presetTo) {
    const sel = document.getElementById('xfer-to');
    if (sel && [...sel.options].some(o => Number(o.value) === presetTo)) {
      sel.value = String(presetTo);
      document.getElementById('xfer-amt')?.focus();
    }
  }

  document.getElementById('xfer-send').addEventListener('click', onSend);
}

async function loadRecipients() {
  try {
    const d = await get('/api/users');
    const sel = document.getElementById('xfer-to');
    sel.innerHTML = '<option value="">— 受取人 —</option>' +
      d.items.filter(u => u.id !== state.me?.id)
        .map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}${u.grade ? ' ('+escapeHtml(u.grade)+')' : ''}</option>`)
        .join('');
  } catch (_) {}
}

async function onSend() {
  const toUserId = Number(document.getElementById('xfer-to').value);
  const amount   = Number(document.getElementById('xfer-amt').value);
  const memo     = document.getElementById('xfer-memo').value.trim() || null;
  if (!toUserId || !(amount > 0)) { toast('受取人と金額を入力してください'); return; }
  if (!confirm(`${amount}pt を送金しますか?`)) return;
  try {
    const r = await post('/api/transfers', { to_user_id: toUserId, amount, memo }, { withIdempotency: true });
    playSound('payment');
    toast(`${r.to_name} に ${amount}pt を送金しました (残高 ${r.new_balance.toLocaleString()}pt)`);
    document.getElementById('xfer-amt').value = '';
    document.getElementById('xfer-memo').value = '';
    document.getElementById('send-balance').textContent = r.new_balance.toLocaleString() + ' pt';
  } catch (e) { toast('失敗: ' + e.message); }
}
