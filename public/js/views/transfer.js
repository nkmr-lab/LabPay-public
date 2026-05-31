import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';
import { startScanner, genQrSvg } from '../scan.js';

let qrScanner = null;

export async function renderTransfer() {
  await stopQrScan();

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card balance-strip">
      <span class="muted">残高</span>
      <span class="bold" id="send-balance" style="color:var(--primary)">— pt</span>
    </div>

    <div class="card">
      <h2>送る</h2>
      <p class="muted" style="font-size:13px">他のメンバーにポイントを渡します。</p>
    </div>

    <div class="card">
      <h3>選んで送金</h3>
      <div class="row">
        <select id="xfer-to" style="flex:1"><option value="">— 受取人 —</option></select>
        <input type="number" id="xfer-amt" min="1" placeholder="pt" style="max-width:120px">
      </div>
      <input type="text" id="xfer-memo" placeholder="メモ (任意)" maxlength="255" style="margin-top:6px">
      <button id="xfer-send" class="primary" style="margin-top:6px">送金</button>
    </div>

    <div class="card">
      <h3>QR コードで送金</h3>
      <div class="row" style="gap:8px">
        <button id="qr-show">自分の QR を表示</button>
        <button id="qr-scan-start" class="primary">相手の QR を読み取る</button>
      </div>
      <div id="qr-display" hidden style="margin-top:10px; text-align:center"></div>
      <div id="qr-scan-wrap" hidden style="margin-top:10px; text-align:center">
        <video id="qr-video" playsinline style="width:100%; max-width:280px; border-radius:12px; background:#000"></video>
        <div><button id="qr-scan-stop" style="margin-top:6px">停止</button></div>
      </div>
    </div>
  `;

  // Balance strip
  get('/api/me').then(d => {
    const el = document.getElementById('send-balance');
    if (el) el.textContent = (d.balance ?? 0).toLocaleString() + ' pt';
  }).catch(() => {});

  await loadRecipients();

  document.getElementById('xfer-send').addEventListener('click', onSend);
  document.getElementById('qr-show').addEventListener('click', onShowQr);
  document.getElementById('qr-scan-start').addEventListener('click', onStartQrScan);
  document.getElementById('qr-scan-stop').addEventListener('click', stopQrScan);

  window.addEventListener('hashchange', stopQrScan, { once: true });
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
    toast(`${r.to_name} に ${amount}pt を送金しました (残高 ${r.new_balance.toLocaleString()}pt)`);
    document.getElementById('xfer-amt').value = '';
    document.getElementById('xfer-memo').value = '';
    document.getElementById('send-balance').textContent = r.new_balance.toLocaleString() + ' pt';
  } catch (e) { toast('失敗: ' + e.message); }
}

// ---------------- QR ----------------

async function onShowQr() {
  if (!state.me) return;
  const wrap = document.getElementById('qr-display');
  wrap.hidden = false;
  const uri = `labpay:transfer?to=${state.me.id}&name=${encodeURIComponent(state.me.display_name || '')}`;
  try {
    const svg = await genQrSvg(uri, 220);
    wrap.innerHTML = '';
    wrap.appendChild(svg);
    const cap = document.createElement('div');
    cap.className = 'muted';
    cap.style.fontSize = '12px';
    cap.textContent = `${state.me.display_name} (id ${state.me.id}) — 相手に読み取ってもらってください`;
    wrap.appendChild(cap);
  } catch (e) { wrap.textContent = '失敗: ' + e.message; }
}

async function onStartQrScan() {
  await stopQrScan();
  const wrap = document.getElementById('qr-scan-wrap');
  wrap.hidden = false;
  const video = document.getElementById('qr-video');
  try {
    qrScanner = await startScanner(video, (text) => {
      stopQrScan();
      handleScannedQr(text);
    }, { formats: 'qr' });
  } catch (e) {
    toast('カメラ起動失敗: ' + e.message);
    wrap.hidden = true;
  }
}

async function stopQrScan() {
  if (qrScanner) { try { qrScanner.stop(); } catch (_) {} qrScanner = null; }
  const w = document.getElementById('qr-scan-wrap');
  if (w) w.hidden = true;
}

async function handleScannedQr(text) {
  if (!text || !text.startsWith('labpay:')) { toast('LabPay の QR ではありません'); return; }
  const m = text.match(/^labpay:transfer\?(.+)$/);
  if (!m) { toast('不明な QR コードです'); return; }
  const params = new URLSearchParams(m[1]);
  const to = Number(params.get('to'));
  const name = params.get('name') || '';
  if (!to || to === state.me?.id) { toast('自分には送金できません'); return; }

  const amountStr = prompt(`${name || ('id=' + to)} に送金する pt:`, '10');
  if (amountStr === null) return;
  const amount = Number(amountStr);
  if (!(amount > 0)) { toast('数字を入れてください'); return; }
  const memo = prompt('メモ (任意):', '') || null;
  if (!confirm(`${name || ('id=' + to)} に ${amount}pt 送金しますか?`)) return;
  try {
    const r = await post('/api/transfers', { to_user_id: to, amount, memo }, { withIdempotency: true });
    toast(`${r.to_name} に ${amount}pt 送金しました (残高 ${r.new_balance.toLocaleString()}pt)`);
    document.getElementById('send-balance').textContent = r.new_balance.toLocaleString() + ' pt';
  } catch (e) { toast('失敗: ' + e.message); }
}
