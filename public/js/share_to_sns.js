// v585 ワンボタンでらぼったー (SNS) に投稿する汎用ヘルパ。
//   引数: title (投稿冒頭メッセージ) と hashUrl ('#/predictions/1' など)。
//   POST /api/posts で「{title}\n\n{hashUrl}」形式で投げる。
//   既存の posts renderer (v562) が #/ で始まる URL を自動リンク化するので、
//   投稿された文章中に URL を書くとそのままタップで該当ページにジャンプ。
//
// v616 #237 prompt() ベースからモーダル UI に改修。
//   テキスト編集 textarea + 「現在地添付」チェック + 「らぼったーに投稿」/「キャンセル」ボタン。

import { post } from './api.js';
import { toast } from './app.js';
import { escapeHtml } from './router.js';

export async function shareToSns(title, hashUrl) {
  const url = hashUrl.startsWith('#') ? hashUrl : '#' + hashUrl;
  const defaultBody = `${title}\n\n${url}`;
  return new Promise((resolve) => {
    document.getElementById('share-sns-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'share-sns-modal';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.5); display:flex; align-items:flex-start; justify-content:center; padding:60px 16px';
    overlay.innerHTML = `
      <div style="background:#fff; border-radius:12px; max-width:520px; width:100%; box-shadow:0 10px 40px rgba(0,0,0,0.3); display:flex; flex-direction:column; overflow:hidden">
        <div style="padding:14px 18px; border-bottom:1px solid #eee; display:flex; align-items:center">
          <h3 style="margin:0; flex:1; font-size:15px">💬 らぼったーに投稿</h3>
          <button id="ssm-close" style="background:none; border:none; font-size:22px; cursor:pointer; padding:0 6px; line-height:1">×</button>
        </div>
        <div style="padding:14px 16px; display:flex; flex-direction:column; gap:10px">
          <textarea id="ssm-body" maxlength="2000" rows="6"
            style="width:100%; box-sizing:border-box; resize:vertical; min-height:120px; font-size:14px; line-height:1.6">${escapeHtml(defaultBody)}</textarea>
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:13px">
            <input type="checkbox" id="ssm-loc"> 📍 現在地を添付
          </label>
          <div class="hint-sm" style="font-size:11px">
            #/ で始まる URL はタップで該当ページにジャンプできます (例: ${escapeHtml(url)})
          </div>
        </div>
        <div style="padding:12px 16px; border-top:1px solid #eee; display:flex; gap:8px; justify-content:flex-end">
          <button id="ssm-cancel" class="btn">キャンセル</button>
          <button id="ssm-post" class="btn primary">投稿する</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const closeModal = (ok) => { overlay.remove(); resolve(!!ok); };
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(false); });
    document.getElementById('ssm-close').addEventListener('click', () => closeModal(false));
    document.getElementById('ssm-cancel').addEventListener('click', () => closeModal(false));
    document.getElementById('ssm-post').addEventListener('click', async () => {
      const body = document.getElementById('ssm-body').value.trim();
      if (!body) { toast('本文を入力してください'); return; }
      const useLoc = document.getElementById('ssm-loc').checked;
      const btn = document.getElementById('ssm-post');
      btn.disabled = true; btn.textContent = '送信中…';
      const payload = { body };
      if (useLoc && 'geolocation' in navigator) {
        try {
          const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
          payload.lat = p.coords.latitude;
          payload.lng = p.coords.longitude;
        } catch (_) {}
      }
      try {
        await post('/api/posts', payload);
        toast('らぼったーに投稿しました');
        closeModal(true);
      } catch (e) {
        toast('投稿失敗: ' + (e?.message || e));
        btn.disabled = false; btn.textContent = '投稿する';
      }
    });
    setTimeout(() => document.getElementById('ssm-body')?.focus(), 50);
  });
}

// v709 #301 ラボ全体で共有する用 (Slack / DM 等 LabPay 外へ貼れる) の
//   絶対 URL をクリップボードにコピーする。 base = location.origin (例:
//   https://pay.nkmr.io)、 hashUrl は '#/invitations/123' / '#/tasks/45' 形式。
//   失敗 (HTTPS 外 / 権限拒否等) は textarea fallback で救う。
export async function copyShareUrl(hashUrl) {
  const url = hashUrl.startsWith('#') ? hashUrl : '#' + hashUrl;
  const fullUrl = location.origin + '/' + url;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(fullUrl);
    } else {
      const ta = document.createElement('textarea');
      ta.value = fullUrl;
      ta.style.cssText = 'position:fixed; top:-1000px; left:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('URL をコピーしました: ' + fullUrl);
  } catch (e) {
    toast('コピー失敗: ' + (e?.message || e));
  }
}

// 既存 view からシェアボタンを簡単に生成するヘルパ。
//   ボタン要素を親に append し、クリックで shareToSns を呼ぶ。
export function makeShareButton(title, hashUrl, label = '💬 らぼったーで共有') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.style.cssText = 'font-size:12px; padding:4px 8px';
  btn.textContent = label;
  btn.addEventListener('click', () => shareToSns(title, hashUrl));
  return btn;
}

// v853 統合シェアダイアログ。 3 系統を 1 つのモーダルにまとめる。
//   (1) 📋 タイトル + URL をコピー (Slack 等に貼り付け用)
//   (2) 💬 らぼったーに投稿
//   (3) 👤 メンバーに送る (admin_notice で URL を相手に送信)
export async function shareDialog(title, hashUrl) {
  const { get, post } = await import('./api.js');
  const url = hashUrl.startsWith('#') ? hashUrl : '#' + hashUrl;
  const fullUrl = location.origin + '/' + url;
  document.getElementById('share-dialog-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'share-dialog-modal';
  overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.5); display:flex; align-items:flex-start; justify-content:center; padding:60px 16px';
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:520px; width:100%; box-shadow:0 10px 40px rgba(0,0,0,0.3); display:flex; flex-direction:column; overflow:hidden">
      <div style="padding:12px 16px; border-bottom:1px solid #eee; display:flex; align-items:center">
        <h3 style="margin:0; flex:1; font-size:15px">📤 共有</h3>
        <button id="sd-close" style="background:none; border:none; font-size:22px; cursor:pointer; padding:0 6px; line-height:1">×</button>
      </div>
      <div style="padding:14px 16px; display:flex; flex-direction:column; gap:10px; font-size:14px">
        <div style="background:#f3f4f6; padding:8px 10px; border-radius:6px; font-size:12px; word-break:break-all">
          <div style="font-weight:600; color:#374151">${escapeHtml(title)}</div>
          <div style="color:#6b7280; margin-top:2px">${escapeHtml(fullUrl)}</div>
        </div>
        <button id="sd-copy" class="btn primary" style="text-align:left">📋 タイトル + URL をコピー <span class="hint-sm" style="font-size:11px">(Slack 等に貼り付け)</span></button>
        <button id="sd-sns" class="btn" style="text-align:left">💬 らぼったーに投稿</button>
        <div style="border-top:1px solid #eee; padding-top:10px">
          <div style="font-weight:600; margin-bottom:6px">👤 メンバーに送る</div>
          <input type="search" id="sd-uq" placeholder="メンバー名で検索" style="width:100%; box-sizing:border-box; font-size:13px; padding:4px 8px; border:1px solid #d1d5db; border-radius:4px; margin-bottom:6px">
          <div id="sd-user-list" style="max-height:160px; overflow:auto; border:1px solid #e5e7eb; border-radius:6px; padding:4px"><div class="muted" style="font-size:12px">読み込み中…</div></div>
          <textarea id="sd-msg" placeholder="一言メッセージ (任意)" rows="2" maxlength="500" style="width:100%; box-sizing:border-box; margin-top:6px; font-size:13px"></textarea>
          <div class="row" style="gap:6px; justify-content:flex-end; margin-top:6px">
            <button id="sd-send" class="btn primary" style="font-size:13px" disabled>選択 0 人に送る</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const closeModal = () => overlay.remove();
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });
  document.getElementById('sd-close').addEventListener('click', closeModal);

  // (1) タイトル + URL コピー
  document.getElementById('sd-copy').addEventListener('click', async () => {
    const text = `${title}\n${fullUrl}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed; top:-1000px; left:0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('📋 コピーしました');
    } catch (e) { toast('コピー失敗: ' + (e?.message || e)); }
  });

  // (2) らぼったー
  document.getElementById('sd-sns').addEventListener('click', () => {
    closeModal();
    shareToSns(title, hashUrl);
  });

  // (3) メンバーに送る — ユーザ一覧を /api/users から取得
  const userList = document.getElementById('sd-user-list');
  const sendBtn = document.getElementById('sd-send');
  const uq = document.getElementById('sd-uq');
  const selected = new Set();
  let allUsers = [];
  const refreshSendLabel = () => {
    sendBtn.textContent = `選択 ${selected.size} 人に送る`;
    sendBtn.disabled = selected.size === 0;
  };
  const renderUsers = () => {
    const q = (uq.value || '').trim().toLowerCase();
    const filtered = q ? allUsers.filter(u => (u.display_name || '').toLowerCase().includes(q)) : allUsers;
    if (!filtered.length) { userList.innerHTML = '<div class="muted" style="font-size:12px">該当ユーザなし</div>'; return; }
    userList.innerHTML = filtered.slice(0, 50).map(u => `
      <label style="display:flex; gap:6px; align-items:center; padding:3px 4px; cursor:pointer; font-size:13px">
        <input type="checkbox" data-uid="${u.id}" ${selected.has(u.id) ? 'checked' : ''}>
        <span>${escapeHtml(u.display_name || ('user#' + u.id))}</span>
      </label>`).join('');
    userList.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const uid = Number(cb.dataset.uid);
        if (cb.checked) selected.add(uid); else selected.delete(uid);
        refreshSendLabel();
      });
    });
  };
  uq.addEventListener('input', renderUsers);
  try {
    const d = await get('/api/users');
    allUsers = (d.items || d || []).filter(u => u.id && u.kind !== 'service');
    renderUsers();
  } catch (e) { userList.innerHTML = `<div class="muted" style="font-size:12px">取得失敗: ${escapeHtml(e.message)}</div>`; }
  sendBtn.addEventListener('click', async () => {
    if (!selected.size) return;
    const message = (document.getElementById('sd-msg').value || '').trim();
    sendBtn.disabled = true; sendBtn.textContent = '送信中…';
    try {
      const r = await post('/api/share/notify-users', {
        user_ids: Array.from(selected),
        title, hash_url: url, message,
      });
      toast(`✅ ${r.sent || selected.size} 人に送信しました`);
      closeModal();
    } catch (e) {
      toast('送信失敗: ' + (e?.message || e));
      sendBtn.disabled = false; refreshSendLabel();
    }
  });
}

// view からボタン 1 つで shareDialog を開けるヘルパ
export function makeShareDialogButton(title, hashUrl, label = '📤 共有') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.style.cssText = 'font-size:12px; padding:4px 8px';
  btn.textContent = label;
  btn.addEventListener('click', () => shareDialog(title, hashUrl));
  return btn;
}
