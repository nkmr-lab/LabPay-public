// /#/file-transfers — v733 #342 相手指定のファイル送受信。
//   送信: 宛先 + ファイル (PDF / Word / Excel / 画像 / zip / txt 等 最大 50MB) + 任意メッセージ
//   受信: 一覧でファイル名 / 送信者 / 大きさ / ダウンロード回数を表示、 即ダウンロード可。

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

function fmtBytes(b) {
  if (b < 1024) return b + 'B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + 'MB';
  return (b / 1024 / 1024 / 1024).toFixed(1) + 'GB';
}

export async function renderFileTransfers() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📦 ファイル送受信</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        相手を指定してファイルを送れます。 PDF / Word / Excel / 画像 / zip / txt 等 (最大 50MB)。
        受信者がダウンロードした回数と最初のダウンロード時刻が記録されます。
      </p>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">＋ 新規送信</h3>
      <label class="field"><span class="lbl">宛先</span>
        <select id="ft-recipient">
          <option value="">読み込み中…</option>
        </select>
      </label>
      <label class="field"><span class="lbl">ファイル</span>
        <input type="file" id="ft-file">
      </label>
      <label class="field"><span class="lbl">メッセージ (任意)</span>
        <textarea id="ft-body" rows="2" maxlength="2000" placeholder="例: 査読お願いします"></textarea>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="ft-send" class="primary">送信</button>
      </div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">📥 受信</h3>
      <div id="ft-recv"><div class="hint">読み込み中…</div></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">📤 送信</h3>
      <div id="ft-sent"><div class="hint">読み込み中…</div></div>
    </div>
  `;
  // 宛先の選択肢を埋める
  try {
    const u = await get('/api/users');
    const sel = document.getElementById('ft-recipient');
    const meId = Number(state.me?.id);
    sel.innerHTML = '<option value="">＋ 宛先 を 選ぶ</option>' +
      (u.items || []).filter(x => x.id !== meId).map(x =>
        `<option value="${x.id}">${escapeHtml(x.display_name)}${x.grade ? ` [${escapeHtml(x.grade)}]` : ''}</option>`).join('');
  } catch (_) {}

  document.getElementById('ft-send').addEventListener('click', async () => {
    const recipientId = document.getElementById('ft-recipient').value;
    const file = document.getElementById('ft-file').files[0];
    const body = document.getElementById('ft-body').value.trim();
    if (!recipientId) { toast('宛先 を 選んで ください'); return; }
    if (!file) { toast('ファイル を 選んで ください'); return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('recipient_user_id', recipientId);
    if (body) fd.append('body', body);
    const btn = document.getElementById('ft-send');
    btn.disabled = true; btn.textContent = '送信中…';
    try {
      const resp = await fetch('/api/file-transfers', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' },
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = j?.error?.message || j?.error || ('HTTP ' + resp.status);
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      toast('送信しました');
      document.getElementById('ft-file').value = '';
      document.getElementById('ft-body').value = '';
      document.getElementById('ft-recipient').value = '';
      await loadList();
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '送信'; }
  });

  await loadList();
}

async function loadList() {
  try {
    const d = await get('/api/file-transfers');
    const items = d.items || [];
    const meId = Number(state.me?.id);
    const recv = items.filter(it => it.recipient_user_id === meId);
    const sent = items.filter(it => it.sender_user_id    === meId);
    document.getElementById('ft-recv').innerHTML = recv.length
      ? recv.map(renderRecvRow).join('')
      : '<div class="empty">受信ファイルはありません</div>';
    document.getElementById('ft-sent').innerHTML = sent.length
      ? sent.map(renderSentRow).join('')
      : '<div class="empty">送信ファイルはありません</div>';
    document.querySelectorAll('[data-ft-del]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('このファイルを削除しますか?')) return;
        try { await del('/api/file-transfers/' + b.dataset.ftDel); toast('削除しました'); await loadList(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    document.getElementById('ft-recv').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderRecvRow(it) {
  return `
    <div class="list-item" style="align-items:flex-start; gap:10px">
      <div style="flex:none">${avatarHtml(it.sender_name, it.sender_avatar, 'md')}</div>
      <div class="grow" style="min-width:0">
        <div class="bold">${escapeHtml(it.original_name)} <span class="hint-sm" style="font-size:11px; opacity:0.7">${fmtBytes(it.file_size)}</span></div>
        <div class="meta">${escapeHtml(it.sender_name)} から · ${escapeHtml(it.sent_at)}</div>
        ${it.body ? `<div style="white-space:pre-wrap; font-size:13px; margin-top:4px">${escapeHtml(it.body)}</div>` : ''}
        <a href="/api/file-transfers/${it.id}/download" class="btn primary" style="font-size:12px; padding:4px 10px; margin-top:6px; display:inline-block">⬇️ ダウンロード</a>
      </div>
    </div>`;
}

function renderSentRow(it) {
  const dlInfo = it.download_count > 0
    ? `<span class="tag ok">✓ ${it.download_count} 回 DL ・ 初回 ${escapeHtml(String(it.first_downloaded_at || ''))}</span>`
    : `<span class="tag warn">未ダウンロード</span>`;
  return `
    <div class="list-item" style="align-items:flex-start; gap:10px">
      <div style="flex:none">${avatarHtml(it.recipient_name, it.recipient_avatar, 'md')}</div>
      <div class="grow" style="min-width:0">
        <div class="bold">${escapeHtml(it.original_name)} <span class="hint-sm" style="font-size:11px; opacity:0.7">${fmtBytes(it.file_size)}</span></div>
        <div class="meta">${escapeHtml(it.recipient_name)} へ · ${escapeHtml(it.sent_at)}</div>
        ${it.body ? `<div style="white-space:pre-wrap; font-size:13px; margin-top:4px">${escapeHtml(it.body)}</div>` : ''}
        <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap; align-items:center">
          ${dlInfo}
          <a href="/api/file-transfers/${it.id}/download" class="btn" style="font-size:12px; padding:2px 8px">⬇️ 確認</a>
          <button class="btn danger" style="font-size:12px; padding:2px 8px" data-ft-del="${it.id}">削除</button>
        </div>
      </div>
    </div>`;
}
