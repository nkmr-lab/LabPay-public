// /#/screen-shares — v718 #314 一時的な画像共有 (「とにかく今これ見て」用)。
//   ラボ全体 or 自分のグループ向けに画像 + 短文を投稿。 expires_at まで大きく表示。

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

export async function renderScreenShares() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🖼 一時画像 共有</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        ラボ全体 or グループ宛に画像 (+ 短文) を投げて、 期限内はみんなにすぐ表示されます。
        スマホで写真を撮って共有、 PC で画面ショットを撮って共有、 等。
      </p>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">＋ 投稿</h3>
      <div class="row" style="gap:6px; margin-bottom:6px; align-items:center; flex-wrap:wrap">
        <input type="file" id="ss-img" accept="image/*">
        <span class="hint-sm" id="ss-img-status"></span>
      </div>
      <img id="ss-img-preview" hidden style="max-width:300px; max-height:300px; border-radius:8px; margin-bottom:6px">
      <label class="field"><span class="lbl">ひとこと (任意)</span>
        <input type="text" id="ss-body" maxlength="1000" placeholder="例: この図みて / 急ぎでチェック">
      </label>
      <div class="field">
        <span class="lbl">宛先</span>
        <div class="row" style="gap:8px; margin-bottom:6px; flex-wrap:wrap">
          <label style="font-size:13px"><input type="radio" name="ss-target-mode" value="all" checked> 📢 ラボ全体</label>
          <label style="font-size:13px"><input type="radio" name="ss-target-mode" value="group"> 👥 グループ</label>
          <label style="font-size:13px"><input type="radio" name="ss-target-mode" value="users"> 👤 個人 (複数 選択 可)</label>
        </div>
        <select id="ss-group" hidden style="margin-bottom:6px"></select>
        <div id="ss-users-wrap" hidden>
          <div id="ss-users-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
          <div id="ss-users-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
        </div>
      </div>
      <label class="field"><span class="lbl">期限</span>
        <select id="ss-expires">
          <option value="15">15 分</option>
          <option value="60" selected>1 時間</option>
          <option value="180">3 時間</option>
          <option value="720">12 時間</option>
          <option value="1440">24 時間</option>
        </select>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="ss-submit" class="primary">投稿</button>
      </div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">アクティブ</h3>
      <div id="ss-list"><div class="hint">読み込み中…</div></div>
    </div>
  `;
  await loadGroups();
  await wireTargetMode();
  wireUploader();
  await loadActive();
}

async function loadGroups() {
  try {
    const d = await get('/api/groups', { mine: 1 });
    const sel = document.getElementById('ss-group');
    sel.innerHTML = '';
    (d.items || d.groups || []).forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `👥 ${g.name || g.title || ('グループ #' + g.id)}`;
      sel.appendChild(opt);
    });
  } catch (_) { /* グループ取得失敗は致命的でない */ }
}

// v742 #353 宛先モード (全体 / グループ / 個人) で UI を 出し分け。
//   個人モード では 共通 member picker を 遅延 ロード。
let _userPicker = null;
async function wireTargetMode() {
  const grpSel = document.getElementById('ss-group');
  const usersWrap = document.getElementById('ss-users-wrap');
  const radios = document.querySelectorAll('input[name="ss-target-mode"]');
  const apply = async () => {
    const v = document.querySelector('input[name="ss-target-mode"]:checked')?.value || 'all';
    grpSel.hidden = (v !== 'group');
    usersWrap.hidden = (v !== 'users');
    if (v === 'users' && !_userPicker) {
      try {
        const { createMemberPicker } = await import('../member_picker.js');
        _userPicker = await createMemberPicker({
          bulkContainer: document.getElementById('ss-users-bulk'),
          chipsContainer: document.getElementById('ss-users-chips'),
          initial: [],
          excludeIds: [Number(state.me?.id)],
          showGenderBulk: false,
        });
      } catch (e) { console.error('[ss] picker init failed:', e); }
    }
  };
  radios.forEach(r => r.addEventListener('change', apply));
  await apply();
}

let uploadedImageUrl = null;
function wireUploader() {
  const input = document.getElementById('ss-img');
  const status = document.getElementById('ss-img-status');
  const prev = document.getElementById('ss-img-preview');
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) { uploadedImageUrl = null; status.textContent = ''; prev.hidden = true; return; }
    status.textContent = 'アップロード中…';
    const fd = new FormData();
    fd.append('file', f);
    try {
      const resp = await fetch('/api/uploads/image', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      uploadedImageUrl = j.url || j.path;
      prev.src = uploadedImageUrl;
      prev.hidden = false;
      status.innerHTML = '<span style="color:#0e7c63">✓ アップロード完了</span>';
    } catch (e) { status.textContent = '失敗: ' + (e?.message || e); }
  });
  document.getElementById('ss-submit').addEventListener('click', async () => {
    if (!uploadedImageUrl) { toast('画像を選んでください'); return; }
    const body = document.getElementById('ss-body').value.trim() || null;
    const mode = document.querySelector('input[name="ss-target-mode"]:checked')?.value || 'all';
    let groupId = null;
    let targetUserIds = null;
    if (mode === 'group') {
      const gv = document.getElementById('ss-group').value;
      if (!gv) { toast('グループを選んでください'); return; }
      groupId = Number(gv);
    } else if (mode === 'users') {
      const sel = _userPicker ? [..._userPicker.getSelected()] : [];
      if (!sel.length) { toast('宛先を 1 人以上 選んで ください'); return; }
      targetUserIds = sel;
    }
    const expires = Number(document.getElementById('ss-expires').value) || 60;
    try {
      await post('/api/screen-shares', {
        image_url: uploadedImageUrl,
        body,
        group_id: groupId,
        target_user_ids: targetUserIds,
        expires_in_min: expires,
      });
      toast('共有しました');
      document.getElementById('ss-img').value = '';
      document.getElementById('ss-body').value = '';
      uploadedImageUrl = null;
      document.getElementById('ss-img-status').textContent = '';
      document.getElementById('ss-img-preview').hidden = true;
      if (_userPicker) _userPicker.setSelected([]);
      await loadActive();
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

async function loadActive() {
  const root = document.getElementById('ss-list');
  try {
    const d = await get('/api/screen-shares/active');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">いまアクティブな共有はありません</div>';
      return;
    }
    root.innerHTML = items.map(s => {
      // v742 #353 個人 (複数) 宛 を 表示
      let target;
      if (s.target_user_names && s.target_user_names.length) {
        target = `👤 ${s.target_user_names.map(escapeHtml).join(' / ')}`;
      } else if (s.group_name) {
        target = `👥 ${escapeHtml(s.group_name)}`;
      } else {
        target = '📢 ラボ全体';
      }
      const exp = new Date(String(s.expires_at).replace(' ', 'T'));
      const remMin = Math.max(0, Math.floor((exp - new Date()) / 60000));
      const remStr = remMin < 60 ? `あと ${remMin} 分` : `あと ${Math.floor(remMin/60)} 時間 ${remMin%60} 分`;
      return `
        <div class="card" style="background:#fafafa; margin-bottom:10px; padding:10px">
          <div class="row center" style="gap:6px; margin-bottom:6px; font-size:12px">
            ${avatarHtml(s.creator_name, s.creator_avatar_url, 'sm')}
            <span class="bold">${escapeHtml(s.creator_name)}</span>
            <span class="hint">${target} ・ ${remStr}</span>
            ${s.is_mine ? `<button class="btn danger" data-rm="${s.id}" style="margin-left:auto; font-size:11px; padding:2px 8px">削除</button>` : ''}
          </div>
          ${s.body ? `<div style="white-space:pre-wrap; margin-bottom:6px">${escapeHtml(s.body)}</div>` : ''}
          <a href="${escapeHtml(s.image_url)}" target="_blank" rel="noopener">
            <img src="${escapeHtml(s.image_url)}" style="max-width:100%; max-height:600px; border-radius:8px; display:block">
          </a>
        </div>`;
    }).join('');
    root.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この共有を削除しますか?')) return;
        try { await del('/api/screen-shares/' + b.dataset.rm); toast('削除しました'); await loadActive(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">取得失敗: ${escapeHtml(e.message)}</div>`;
  }
}
