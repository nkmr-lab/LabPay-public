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
      <div class="field">
        <span class="lbl">宛先 (複数選択 可)</span>
        <div id="ft-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="ft-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <label class="field"><span class="lbl">ファイル</span>
        <input type="file" id="ft-file">
        <span class="hint-sm" style="font-size:11px">単一ファイル送信 (PDF / Word / Excel / 画像 / zip / txt 等 最大 50MB)</span>
      </label>
      <label class="field"><span class="lbl">📁 または フォルダ (v735 #345)</span>
        <input type="file" id="ft-folder" webkitdirectory directory multiple>
        <span class="hint-sm" style="font-size:11px">フォルダを丸ごと送信。サーバ側で zip にまとめて送信されます (合計 50MB 上限)</span>
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
  // v742 #353 複数選択 可 の 共通 member picker に 差し替え。
  const { createMemberPicker } = await import('../member_picker.js');
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer: document.getElementById('ft-bulk'),
      chipsContainer: document.getElementById('ft-chips'),
      initial: [],
      excludeIds: [Number(state.me?.id)],
      showGenderBulk: false,
    });
  } catch (e) { console.error('[ft] picker init failed:', e); }

  document.getElementById('ft-send').addEventListener('click', async () => {
    const selected = picker ? [...picker.getSelected()] : [];
    const fileInput   = document.getElementById('ft-file');
    const folderInput = document.getElementById('ft-folder');
    const body = document.getElementById('ft-body').value.trim();
    if (!selected.length) { toast('宛先を 1 人以上 選んで ください'); return; }
    const folderFiles = Array.from(folderInput.files || []);
    const singleFile  = fileInput.files[0];
    if (!folderFiles.length && !singleFile) { toast('ファイル または フォルダ を 選んで ください'); return; }
    const fd = new FormData();
    if (folderFiles.length > 0) {
      const paths = [];
      for (const f of folderFiles) {
        fd.append('files[]', f, f.name);
        paths.push(f.webkitRelativePath || f.name);
      }
      fd.append('paths', JSON.stringify(paths));
    } else {
      fd.append('file', singleFile);
    }
    for (const id of selected) fd.append('recipient_user_ids[]', String(id));
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
      toast(`送信しました (${selected.length} 人)`);
      document.getElementById('ft-file').value = '';
      document.getElementById('ft-folder').value = '';
      document.getElementById('ft-body').value = '';
      if (picker) picker.setSelected([]);
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
    // v742 #353 送信側は batch_id ごとに 1 枚にまとめる (= 複数受信者送信の 1 アクションを 1 行で 表示)。
    const sentGrouped = groupByBatch(sent);
    document.getElementById('ft-recv').innerHTML = recv.length
      ? recv.map(renderRecvRow).join('')
      : '<div class="empty">受信ファイルはありません</div>';
    document.getElementById('ft-sent').innerHTML = sentGrouped.length
      ? sentGrouped.map(renderSentGroup).join('')
      : '<div class="empty">送信ファイルはありません</div>';
    document.querySelectorAll('[data-ft-del]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('このファイルを削除しますか?')) return;
        try { await del('/api/file-transfers/' + b.dataset.ftDel); toast('削除しました'); await loadList(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
    document.querySelectorAll('[data-ft-del-batch]').forEach(b => {
      b.addEventListener('click', async () => {
        const ids = b.dataset.ftDelBatch.split(',');
        if (!confirm(`この送信 (${ids.length} 人宛) を全部 削除しますか?`)) return;
        try {
          await Promise.all(ids.map(id => del('/api/file-transfers/' + id)));
          toast('削除しました'); await loadList();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    document.getElementById('ft-recv').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function groupByBatch(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = r.batch_id || ('single-' + r.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].sort((a, b) => (b[0].sent_at || '').localeCompare(a[0].sent_at || ''));
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

// 1 つの送信アクション (= 同じ batch) を 1 ブロックで 表示。 受信者 1 人なら 旧 UI に近い。
function renderSentGroup(rows) {
  const head = rows[0];
  const ids = rows.map(r => r.id);
  return `
    <div class="list-item" style="align-items:flex-start; gap:10px; flex-direction:column">
      <div style="display:flex; gap:10px; width:100%; align-items:flex-start">
        <div style="flex:none">📦</div>
        <div class="grow" style="min-width:0">
          <div class="bold">${escapeHtml(head.original_name)} <span class="hint-sm" style="font-size:11px; opacity:0.7">${fmtBytes(head.file_size)}</span></div>
          <div class="meta">${rows.length} 人 宛 · ${escapeHtml(head.sent_at)}</div>
          ${head.body ? `<div style="white-space:pre-wrap; font-size:13px; margin-top:4px">${escapeHtml(head.body)}</div>` : ''}
        </div>
      </div>
      <div style="width:100%; padding-left:24px; display:flex; flex-direction:column; gap:4px">
        ${rows.map(r => {
          const dl = r.download_count > 0
            ? `<span class="tag ok">✓ ${r.download_count} 回 DL ・ 初回 ${escapeHtml(String(r.first_downloaded_at || ''))}</span>`
            : `<span class="tag warn">未ダウンロード</span>`;
          return `
            <div style="display:flex; gap:6px; align-items:center; font-size:12px">
              ${avatarHtml(r.recipient_name, r.recipient_avatar, 'sm')}
              <span style="font-weight:600">${escapeHtml(r.recipient_name)}</span>
              ${dl}
              <button class="btn danger" style="font-size:11px; padding:1px 6px; margin-left:auto" data-ft-del="${r.id}">この人だけ削除</button>
            </div>`;
        }).join('')}
        <div style="display:flex; gap:6px; margin-top:4px">
          <a href="/api/file-transfers/${head.id}/download" class="btn" style="font-size:12px; padding:2px 8px">⬇️ 内容 確認</a>
          ${rows.length > 1 ? `<button class="btn danger" style="font-size:12px; padding:2px 8px" data-ft-del-batch="${ids.join(',')}">全員 分 削除</button>` : ''}
        </div>
      </div>
    </div>`;
}
