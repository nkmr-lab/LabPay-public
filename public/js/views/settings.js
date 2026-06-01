import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast, refreshMe } from '../app.js';

export async function renderSettings() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2>設定</h2>
    </div>

    <div class="card">
      <h3>プロフィール</h3>
      <div id="profile-avatar-wrap" style="display:flex; justify-content:center; margin:8px 0 14px"></div>
      <label class="field">
        <span class="lbl">表示名</span>
        <input type="text" id="profile-name" maxlength="100">
      </label>
      <label class="field">
        <span class="lbl">アバター画像</span>
        <input type="file" id="profile-avatar-file" accept="image/*">
        <div id="profile-avatar-status" class="muted" style="font-size:12px"></div>
      </label>
      <div class="row" style="gap:6px">
        <button id="profile-save" class="primary">保存</button>
        <button id="profile-clear-avatar">アバター削除</button>
      </div>
    </div>

    <div class="card">
      <h3>自動検出 (おすすめ)</h3>
      <p class="muted" style="font-size:13px">
        ラボ内 scanner が直近の数分間に観測した「まだ誰のものでもない MAC」一覧。<br>
        <span style="color:var(--primary); font-weight:700">📶 確実な見つけ方:</span><br>
        <span style="display:inline-block; margin-left:14px">1. スマホの WiFi をオフにする</span><br>
        <span style="display:inline-block; margin-left:14px">2. 数秒待ってからオンに戻す</span><br>
        <span style="display:inline-block; margin-left:14px">3. 30〜60秒待ってから下の「最新の観測を取得」を押す</span><br>
        <span style="display:inline-block; margin-left:14px">→ 自分の端末が <span class="tag" style="font-size:10px">NEW</span> タグ付きで一番上に出てくるはず</span>
      </p>
      <div class="row" style="margin-bottom:8px; gap:6px; align-items:center">
        <button id="reload-unreg">最新の観測を取得</button>
        <span class="muted" style="font-size:12px">または</span>
        <input type="text" id="my-ip-input" placeholder="自分の IP (例 42 や 192.168.50.42)"
               inputmode="decimal" maxlength="15"
               style="flex:1; max-width:240px; font-family:Consolas,Menlo,monospace; font-size:13px">
        <span class="muted" style="font-size:11px">設定→WiFi→ネットワーク名で確認</span>
      </div>
      <div id="unreg-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <h3>自分の端末 (登録済み)</h3>
      <div id="dev-list" class="list"><div class="muted">読み込み中…</div></div>
      <div class="sep"></div>
      <h3 style="margin:6px 0">手動で追加</h3>
      <p class="muted" style="font-size:12px">
        スマホの「設定 → Wi-Fi → nkmr-lab-wifi → MAC アドレス」を直接入れる場合はこちら。
      </p>
      <div class="row">
        <input type="text" id="new-mac" placeholder="aa:bb:cc:dd:ee:ff" maxlength="32" style="flex:2">
        <input type="text" id="new-label" placeholder="ラベル (例: iPhone)" maxlength="100" style="flex:1">
        <button id="add-btn" class="primary">追加</button>
      </div>
    </div>

    <div class="card">
      <h3>その他</h3>
      <button id="logout-from-settings" class="danger">ログアウト</button>
    </div>
  `;

  await loadProfile();
  await load();
  // Pre-fill saved "my IP" if any so the user doesn't re-type each visit.
  const savedIp = localStorage.getItem('labpay-my-ip');
  if (savedIp) document.getElementById('my-ip-input').value = savedIp;
  await loadUnregistered();
  document.getElementById('add-btn').addEventListener('click', onAdd);
  document.getElementById('reload-unreg').addEventListener('click', loadUnregistered);
  // Re-render on every IP change so highlight updates live.
  document.getElementById('my-ip-input').addEventListener('input', (ev) => {
    const v = ev.target.value.trim();
    if (v === '') localStorage.removeItem('labpay-my-ip');
    else          localStorage.setItem('labpay-my-ip', v);
    loadUnregistered();
  });
  document.getElementById('profile-save').addEventListener('click', onProfileSave);
  document.getElementById('profile-clear-avatar').addEventListener('click', onProfileClearAvatar);
  document.getElementById('profile-avatar-file').addEventListener('change', onAvatarFile);
  document.getElementById('logout-from-settings')?.addEventListener('click', onLogoutFromSettings);
}

// ---------------- Profile ----------------
let pendingAvatarUrl = null; // staged URL after successful upload, written on save

async function loadProfile() {
  try {
    const me = await get('/api/me');
    document.getElementById('profile-name').value = me.user.display_name || '';
    document.getElementById('profile-avatar-wrap').innerHTML = avatarHtml(me.user.display_name, me.user.avatar_url, 'lg');
    pendingAvatarUrl = null;
  } catch (e) { toast('プロフィール取得失敗: ' + e.message); }
}

async function onProfileSave() {
  const display_name = document.getElementById('profile-name').value.trim();
  if (!display_name) { toast('表示名を入力してください'); return; }
  const body = { display_name };
  if (pendingAvatarUrl !== null) body.avatar_url = pendingAvatarUrl;
  try {
    await patch('/api/me', body);
    toast('保存しました');
    await refreshMe();
    await loadProfile();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onProfileClearAvatar() {
  if (!confirm('アバター画像を削除しますか?')) return;
  try {
    await patch('/api/me', { avatar_url: null });
    toast('削除しました');
    await refreshMe();
    await loadProfile();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onAvatarFile(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;
  const status = document.getElementById('profile-avatar-status');
  status.textContent = 'アップロード中…';
  const fd = new FormData(); fd.append('file', f);
  try {
    const res = await fetch('/api/uploads/image', {
      method: 'POST',
      headers: { 'X-Requested-With': 'labpay' },
      credentials: 'same-origin',
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'upload failed');
    pendingAvatarUrl = data.url;
    status.textContent = 'アップロード完了 — 「保存」で確定';
    // Preview using the just-uploaded URL
    document.getElementById('profile-avatar-wrap').innerHTML = avatarHtml(null, data.url, 'lg');
  } catch (e) { status.textContent = '失敗: ' + e.message; }
}

async function onLogoutFromSettings() {
  if (!confirm('ログアウトしますか?')) return;
  try { await post('/api/auth/logout', {}); } catch (_) {}
  state.me = null;
  state.balance = null;
  state.unread = 0;
  navigate('#/login');
}

async function load() {
  try {
    const data = await get('/api/presence/devices');
    const root = document.getElementById('dev-list');
    if (!data.items.length) {
      root.innerHTML = `<div class="empty">まだ登録されていません</div>`;
      return;
    }
    root.innerHTML = data.items.map(d => `
      <div class="list-item">
        <div>
          <div class="bold mono">${escapeHtml(d.mac)}</div>
          <div class="meta">${escapeHtml(d.label ?? '(ラベル無し)')} · ${escapeHtml(d.created_at)}</div>
        </div>
        <button data-rm="${d.id}" class="danger">削除</button>
      </div>
    `).join('');
    root.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この端末を削除しますか?')) return;
        try { await del('/api/presence/devices/' + b.dataset.rm); }
        catch (e) { toast('失敗: ' + e.message); return; }
        toast('削除しました');
        await load();
      });
    });
  } catch (e) {
    document.getElementById('dev-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function loadUnregistered() {
  const root = document.getElementById('unreg-list');
  if (!root) return;
  root.innerHTML = `<div class="muted">読み込み中…</div>`;
  try {
    const d = await get('/api/presence/unregistered_macs');
    if (!d.items.length) {
      root.innerHTML = `<div class="empty">最近 ${d.window_minutes} 分以内に観測された未登録 MAC はありません。<br>ラボに居て scanner が動いていれば、数十秒待ってからもう一度押してみてください。</div>`;
      return;
    }
    const now = Date.now();
    const isAdmin = state.me?.role === 'admin';
    const myIp = document.getElementById('my-ip-input')?.value.trim() || '';
    // Match rule:
    //   - "42"               → last octet exact match (so "42" matches .42 but NOT .142)
    //   - "50.42" / "192.168" → substring match (handles partial prefixes too)
    //   - full IP            → substring also handles exact
    const ipMatches = (candidate) => {
      if (!myIp || !candidate) return false;
      if (myIp.includes('.')) return candidate.includes(myIp);
      const parts = candidate.split('.');
      return parts[parts.length - 1] === myIp;
    };
    // Matching records float to the top, otherwise keep server-side first_seen_at DESC order.
    const items = d.items.slice().sort((a, b) => {
      const am = ipMatches(a.ip) ? 1 : 0;
      const bm = ipMatches(b.ip) ? 1 : 0;
      return bm - am;
    });
    // Distinct color per room so 7F/10F devices are visually separable at a glance.
    const ROOM_COLORS = {
      '10F': '#4a106d',   // shikon (primary purple)
      '7F':  '#0e7c63',   // teal
    };
    const roomColor = (rid) => ROOM_COLORS[rid] || '#999';
    // Split an IP and emphasize the last octet so it's easy to match against your phone's
    // "192.168.50.XX" value at a glance.
    const ipHtml = (ip) => {
      if (!ip) return '-';
      const parts = String(ip).split('.');
      if (parts.length < 2) return escapeHtml(ip);
      const head = parts.slice(0, -1).join('.');
      const tail = parts[parts.length - 1];
      return `<span style="color:#666">${escapeHtml(head)}.</span><span style="color:#c0392b; font-weight:700">${escapeHtml(tail)}</span>`;
    };

    root.innerHTML = items.map(x => {
      // "NEW" tag for MACs first observed in the last 90s — i.e., devices that just joined.
      const firstAgeSec = x.first_seen_at ? (now - new Date(x.first_seen_at.replace(' ', 'T') + '+09:00').getTime()) / 1000 : Infinity;
      const isFresh  = firstAgeSec >= 0 && firstAgeSec < 90;
      const isMine   = ipMatches(x.ip);
      const rc       = roomColor(x.room_id);
      const roomTag  = `<span class="tag" style="font-size:10px; margin-right:6px; background:${rc}; color:white">${escapeHtml(x.room_id)}</span>`;
      const newTag   = isFresh ? '<span class="tag" style="font-size:10px; margin-left:6px">NEW</span>' : '';
      const hintTag  = x.hint  ? `<span class="tag muted" style="font-size:10px; margin-left:6px">${escapeHtml(x.hint)}</span>` : '';
      const mineTag  = isMine
        ? '<span class="tag" style="font-size:10px; margin-left:6px; background:#fff8d6; color:#7a5a00">📱 あなた</span>'
        : '';
      const adminBtn = isAdmin
        ? `<button data-infra="${escapeHtml(x.mac)}" style="margin-left:4px">機材登録</button>`
        : '';
      // Border priority: IP match (yellow) > fresh (purple) > none.
      const borderStyle = isMine
        ? `border-left:4px solid #f2c700; background:#fffdf4`
        : (isFresh ? `border-left:4px solid ${rc}` : `border-left:4px solid ${rc}33`);
      const claimBtnCls = isMine ? 'primary' : 'primary';
      const claimBtnTxt = isMine ? 'これは私 ✓' : 'これは私';
      return `
      <div class="list-item" style="${borderStyle}">
        <div>
          <div class="bold mono">${roomTag}${escapeHtml(x.mac)}${mineTag}${newTag}${hintTag}</div>
          <div class="meta">${escapeHtml(x.room_name)} · IP ${ipHtml(x.ip)} · 初観測 ${escapeHtml(x.first_seen_at ?? '-')}</div>
        </div>
        <div>
          <button data-claim="${escapeHtml(x.mac)}" class="${claimBtnCls}">${claimBtnTxt}</button>
          ${adminBtn}
        </div>
      </div>`;
    }).join('');
    root.querySelectorAll('[data-claim]').forEach(b => {
      b.addEventListener('click', async () => {
        const mac = b.dataset.claim;
        const label = prompt('この端末のラベル (例: iPhone、空欄でも OK):', '') || '';
        try {
          await post('/api/presence/devices', { mac, label: label || null });
          toast('登録しました');
          await load();
          await loadUnregistered();
        } catch (e) {
          toast('失敗: ' + e.message);
        }
      });
    });
    root.querySelectorAll('[data-infra]').forEach(b => {
      b.addEventListener('click', async () => {
        const mac = b.dataset.infra;
        const label = prompt('機材ラベル (例: プリンタ、研究室PC1):', '');
        if (!label) return;
        try {
          await post('/api/admin/presence_infrastructure', { mac, label });
          toast('機材として登録 → 候補から除外されます');
          await loadUnregistered();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function onAdd() {
  const mac = document.getElementById('new-mac').value.trim();
  const label = document.getElementById('new-label').value.trim();
  if (!mac) { toast('MAC を入力してください'); return; }
  try {
    await post('/api/presence/devices', { mac, label: label || null });
    document.getElementById('new-mac').value = '';
    document.getElementById('new-label').value = '';
    toast('登録しました');
    await load();
  } catch (e) {
    toast('失敗: ' + e.message);
  }
}
