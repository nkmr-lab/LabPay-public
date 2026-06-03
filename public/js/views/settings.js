import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast, refreshMe } from '../app.js';
import { uploadImage } from '../upload.js';

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
        <div id="profile-avatar-status" class="hint-sm"></div>
      </label>
      <div class="row" style="gap:6px">
        <button id="profile-save" class="primary">保存</button>
        <button id="profile-clear-avatar">アバター削除</button>
      </div>
    </div>

    <div class="card">
      <h3>自動検出 (おすすめ)</h3>
      <p class="hint">
        ラボ内 scanner が直近の数分間に観測した「まだ誰のものでもない MAC」一覧。<br>
        <span style="color:var(--primary); font-weight:700">📶 確実な見つけ方:</span><br>
        <span style="display:inline-block; margin-left:14px">1. スマホの WiFi をオフにする</span><br>
        <span style="display:inline-block; margin-left:14px">2. 数秒待ってからオンに戻す</span><br>
        <span style="display:inline-block; margin-left:14px">3. 30〜60秒待ってから下の「最新の観測を取得」を押す</span><br>
        <span style="display:inline-block; margin-left:14px">→ 自分の端末が <span class="tag" style="font-size:10px">NEW</span> タグ付きで一番上に出てくるはず</span>
      </p>
      <div class="row" style="margin-bottom:8px; gap:6px; align-items:center">
        <button id="reload-unreg">最新の観測を取得</button>
        <span class="hint-sm">または</span>
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
      <p class="hint-sm">
        スマホの「設定 → Wi-Fi → nkmr-lab-wifi → MAC アドレス」を直接入れる場合はこちら。
      </p>
      <div class="row">
        <input type="text" id="new-mac" placeholder="aa:bb:cc:dd:ee:ff" maxlength="32" style="flex:2">
        <input type="text" id="new-label" placeholder="ラベル (例: iPhone)" maxlength="100" class="grow">
        <button id="add-btn" class="primary">追加</button>
      </div>
    </div>

    <div class="card">
      <h3>Scrapbox 連携</h3>
      <p class="muted" style="font-size:13px; margin:4px 0 8px">
        nkmr-lab の Scrapbox に書き込んだ分が pt に変わります。
        Slack の #scrapbox 通知で見える <b>表示名</b> をそのまま追加してください
        (例: Latin と漢字の両方を使ってる場合は両方登録)。
      </p>
      <div id="sb-status" class="hint-sm"></div>
      <div id="sb-list" class="list" style="margin:8px 0"><div class="muted">読み込み中…</div></div>
      <div class="row">
        <input type="text" id="sb-new" placeholder="Scrapbox 表示名" maxlength="100" style="flex:2">
        <button id="sb-add" class="primary">追加</button>
      </div>
    </div>

    <div class="card">
      <h3>Google Calendar 連携</h3>
      <p class="hint">
        連携するとホームに「今日の予定」が出ます (calendar.readonly のみ)。
        どのカレンダーを表示するかは下で個別に切り替えられます。
      </p>
      <div id="cal-section"><div class="muted">読み込み中…</div></div>
      <div class="sep" style="margin:14px 0 10px"></div>
      <h3 style="margin:0">予定の非表示ルール</h3>
      <p class="hint">
        タイトルにこの文字列を含む予定はホームの「今日の予定」に出ない。
        正規表現も可 (チェック ON で <code>^MTG </code>、<code>(個人|サブ)</code> など)。
        どれか 1 ルールにでもマッチすれば hide。
      </p>
      <div id="cal-filter-section" style="margin-top:6px"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <h3>バグ報告 / 機能要望</h3>
      <p class="muted" style="font-size:12px; margin:4px 0 8px">
        気づいたバグや「こんな機能あったら」みたいなアイデアを管理者 (中村) に直接届けます。
      </p>
      <div class="row" style="margin-bottom:6px">
        <select id="fb-kind" style="max-width:140px">
          <option value="bug">🐛 バグ報告</option>
          <option value="feature">✨ 機能要望</option>
          <option value="other">💬 その他</option>
        </select>
      </div>
      <textarea id="fb-body" maxlength="4000" rows="4" placeholder="どんなバグか / どんな機能が欲しいか、具体的に書いてもらえると助かります"></textarea>
      <div class="row" style="margin-top:6px; gap:6px">
        <button id="fb-send" class="primary">送る</button>
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
  document.getElementById('sb-add').addEventListener('click', onScrapboxAdd);
  await loadScrapboxHandles();
  await loadCalendar();
  await loadCalendarFilterRules();

  document.getElementById('fb-send').addEventListener('click', async () => {
    const kind = document.getElementById('fb-kind').value;
    const body = document.getElementById('fb-body').value.trim();
    if (!body) { toast('内容を書いてください'); return; }
    try {
      await post('/api/feedback', { kind, body, url: location.hash });
      toast('送信しました!');
      document.getElementById('fb-body').value = '';
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

// ---------------- Google Calendar ----------------
// 連携状態を /api/me/calendar で取得し、未連携なら 「連携する」 ボタン
// (Google OAuth incremental authz)、連携済みなら calendar 一覧 + toggle + 解除 を出す。
async function loadCalendar() {
  const root = document.getElementById('cal-section');
  if (!root) return;
  try {
    const s = await get('/api/me/calendar');
    if (!s.connected) {
      root.innerHTML = `
        <p class="hint-sm">未連携です。下のボタンで Google の同意画面に遷移します。</p>
        <a href="/api/auth/calendar/connect" class="btn primary">📅 Google Calendar を連携する</a>`;
      return;
    }
    // 連携済み → calendar 一覧を出す。
    root.innerHTML = `
      <div class="hint-sm">${escapeHtml(s.connected_at ?? '')} に連携</div>
      <div id="cal-list" class="list" style="margin-top:8px"><div class="muted">カレンダー読み込み中…</div></div>
      <div class="row" style="margin-top:8px; gap:6px">
        <button id="cal-refresh">再取得</button>
        <button id="cal-disconnect" class="danger">連携を解除</button>
      </div>`;
    document.getElementById('cal-refresh').addEventListener('click', loadCalendar);
    document.getElementById('cal-disconnect').addEventListener('click', async () => {
      if (!confirm('Google Calendar の連携を解除しますか?')) return;
      try { await del('/api/me/calendar'); toast('解除しました'); await loadCalendar(); }
      catch (e) { toast('失敗: ' + e.message); }
    });

    let cals;
    try { cals = await get('/api/me/calendar/calendars'); }
    catch (e) {
      // 401/409 で 再連携を促されたら 「連携する」 に戻ったような表示に。
      document.getElementById('cal-list').innerHTML =
        `<div class="muted">${escapeHtml(e.message)}</div>`;
      return;
    }
    const selected = new Set(s.selected_ids?.length ? s.selected_ids : ['primary']);
    const items = cals.items || [];
    if (!items.length) {
      document.getElementById('cal-list').innerHTML =
        `<div class="empty">カレンダーが見つかりません</div>`;
      return;
    }
    document.getElementById('cal-list').innerHTML = items.map(c => `
      <label class="list-item" style="gap:8px; align-items:center; cursor:pointer">
        <input type="checkbox" data-cid="${escapeHtml(c.id)}"
               ${selected.has(c.id) || (c.primary && selected.has('primary')) ? 'checked' : ''}>
        <div class="grow">
          <div class="bold">${escapeHtml(c.summary)} ${c.primary ? '<span class="tag" style="font-size:10px">primary</span>' : ''}</div>
          <div class="meta mono" style="font-size:11px">${escapeHtml(c.id)}</div>
        </div>
        ${c.bg ? `<span style="width:14px; height:14px; border-radius:50%; background:${escapeHtml(c.bg)}"></span>` : ''}
      </label>`).join('');
    // チェック変更 → API に PATCH。primary は特別扱い: primary cal が選ばれてれば
    // 'primary' を ID リストに含める (API は primary alias を解釈する)。
    document.getElementById('cal-list').querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const ids = Array.from(document.querySelectorAll('#cal-list input[type=checkbox]:checked'))
          .map(b => b.dataset.cid);
        try {
          await patch('/api/me/calendar/selection', { ids });
          try { localStorage.removeItem('labpay-cal-events-cache'); } catch {}
          toast('表示対象を更新');
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ---------------- Calendar filter rules ----------------
// タイトル部分一致 / 正規表現で 「今日の予定」 カードに出さない予定を絞る。
// rules = [{pattern, regex?: true}, ...]
let cachedFilterRules = [];

async function loadCalendarFilterRules() {
  const root = document.getElementById('cal-filter-section');
  if (!root) return;
  try {
    const r = await get('/api/me/calendar/filter-rules');
    cachedFilterRules = Array.isArray(r.rules) ? r.rules : [];
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }
  renderCalendarFilterRules();
}

function renderCalendarFilterRules() {
  const root = document.getElementById('cal-filter-section');
  if (!root) return;
  const list = cachedFilterRules.length
    ? cachedFilterRules.map((r, i) => `
        <div class="list-item" style="padding:8px 12px; gap:6px; align-items:center">
          ${r.regex ? '<span class="tag" style="font-size:10px">regex</span>' : ''}
          <div class="bold mono grow" style="min-width:0; word-break:break-all">${escapeHtml(r.pattern)}</div>
          <button data-rm-rule="${i}" class="btn" style="padding:2px 8px; font-size:12px">削除</button>
        </div>`).join('')
    : `<div class="empty" style="padding:10px">ルールはまだありません</div>`;
  root.innerHTML = `
    <div class="list">${list}</div>
    <div class="row" style="margin-top:8px; gap:6px; align-items:center; flex-wrap:wrap">
      <input type="text" id="cal-rule-pat" maxlength="200" placeholder="例: w/o 先生 / ^個人 / (サブコミ|二重)" class="grow">
      <label class="hint-sm" style="display:inline-flex; align-items:center; gap:4px">
        <input type="checkbox" id="cal-rule-regex"> 正規表現
      </label>
      <button id="cal-rule-add" class="primary">追加</button>
    </div>
  `;
  document.getElementById('cal-rule-add').addEventListener('click', onCalendarRuleAdd);
  document.getElementById('cal-rule-pat').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onCalendarRuleAdd(); }
  });
  root.querySelectorAll('[data-rm-rule]').forEach(b => {
    b.addEventListener('click', () => onCalendarRuleRemove(Number(b.dataset.rmRule)));
  });
}

async function onCalendarRuleAdd() {
  const pat = document.getElementById('cal-rule-pat').value.trim();
  if (!pat) { toast('パターンを入力してください'); return; }
  const regex = !!document.getElementById('cal-rule-regex').checked;
  const newRule = regex ? { pattern: pat, regex: true } : { pattern: pat };
  const next = [...cachedFilterRules, newRule];
  try {
    const r = await patch('/api/me/calendar/filter-rules', { rules: next });
    cachedFilterRules = r.rules || next;
    toast('追加しました');
    renderCalendarFilterRules();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onCalendarRuleRemove(idx) {
  const next = cachedFilterRules.filter((_, i) => i !== idx);
  try {
    const r = await patch('/api/me/calendar/filter-rules', { rules: next });
    cachedFilterRules = r.rules || next;
    toast('削除しました');
    renderCalendarFilterRules();
  } catch (e) { toast('失敗: ' + e.message); }
}

// ---------------- Scrapbox handles ----------------
async function loadScrapboxHandles() {
  const list = document.getElementById('sb-list');
  const status = document.getElementById('sb-status');
  try {
    const r = await get('/api/me/scrapbox_handles');
    const s = r.recent_30d || { total_pts: 0, total_atts: 0, days: 0 };
    status.textContent = `直近 30 日: ${s.days} 日 / ${s.total_atts} 件で +${s.total_pts}pt`;
    if (!r.handles.length) {
      list.innerHTML = `<div class="muted">まだ登録なし。下の入力欄から追加してください。</div>`;
      return;
    }
    list.innerHTML = r.handles.map(h => `
      <div class="list-item">
        <div class="bold mono">${escapeHtml(h.scrapbox_name)}</div>
        <button data-sb-del="${encodeURIComponent(h.scrapbox_name)}">削除</button>
      </div>`).join('');
    list.querySelectorAll('[data-sb-del]').forEach(b => {
      b.addEventListener('click', async () => {
        try {
          await del('/api/me/scrapbox_handles/' + b.dataset.sbDel);
          toast('削除しました');
          await loadScrapboxHandles();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    list.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function onScrapboxAdd() {
  const input = document.getElementById('sb-new');
  const handle = input.value.trim();
  if (!handle) { toast('表示名を入力してください'); return; }
  try {
    await post('/api/me/scrapbox_handles', { handle });
    input.value = '';
    toast('追加しました');
    await loadScrapboxHandles();
  } catch (e) { toast('失敗: ' + e.message); }
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
  try {
    const data = await uploadImage(f);
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
      // Show 最終観測 only when it's different from 初観測 (single-shot observations
      // would otherwise duplicate the same timestamp twice).
      const lastTxt = (x.last_seen_at && x.last_seen_at !== x.first_seen_at)
        ? ` · 最終観測 ${escapeHtml(x.last_seen_at)}`
        : '';
      return `
      <div class="list-item" style="${borderStyle}">
        <div>
          <div class="bold mono">${roomTag}${escapeHtml(x.mac)}${mineTag}${newTag}${hintTag}</div>
          <div class="meta">${escapeHtml(x.room_name)} · IP ${ipHtml(x.ip)} · 初観測 ${escapeHtml(x.first_seen_at ?? '-')}${lastTxt}</div>
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
        // Pre-fill the label with "{自分の名前}スマートフォン" so the most common
        // case (= it's the user's own phone) takes 0 typing. Power users can
        // edit to "iPhone 16" / "iPad" / "サブ機" etc. inline.
        const defaultLabel = `${state.me?.display_name ?? ''}スマートフォン`;
        const label = prompt('この端末のラベル:', defaultLabel) || '';
        try {
          await post('/api/presence/devices', { mac, label: label || null });
          toast('登録しました');
          // Refresh global state so state.hasMac flips true immediately — without
          // this, navigating back to home would still show the onboarding card
          // until the next full page reload.
          await refreshMe();
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
