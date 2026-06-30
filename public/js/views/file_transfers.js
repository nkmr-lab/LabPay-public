// /#/file-transfers — v733 #342 相手指定のファイル送受信。
//   送信: 宛先 + ファイル (PDF / Word / Excel / 画像 / zip / txt 等最大 50MB) + 任意メッセージ
//   受信: 一覧でファイル名 / 送信者 / 大きさ / ダウンロード回数を表示、即ダウンロード可。

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
        相手を指定してファイルを送れます。 PDF / Word / Excel / 画像 / zip / txt 等 (最大 100MB)。
        受信者がダウンロードした回数と最初のダウンロード時刻が記録されます。
      </p>
    </div>
    <div class="card">
      <h3 style="margin:0 0 6px">＋ 新規送信</h3>
      <div class="field">
        <span class="lbl">宛先 (複数選択可)</span>
        <div id="ft-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="ft-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div class="field">
        <span class="lbl">ファイル (複数選択 / フォルダ / ドラッグ&ドロップ可)</span>
        <div id="ft-drop" style="border:2px dashed #9ca3af; border-radius:10px; padding:18px; text-align:center; background:#fafafa; cursor:pointer; transition:background 0.15s, border-color 0.15s">
          <div style="font-size:32px; margin-bottom:4px">📂</div>
          <div style="font-size:13px; color:#374151">ここにファイル / フォルダをドロップ</div>
          <div style="font-size:11px; color:#6b7280; margin-top:4px">またはタップで選ぶ (複数 OK)</div>
          <input type="file" id="ft-files" multiple hidden>
          <input type="file" id="ft-folder" webkitdirectory directory multiple hidden>
          <div class="row" style="gap:6px; margin-top:8px; justify-content:center">
            <button type="button" id="ft-pick-files" class="btn" style="font-size:12px; padding:4px 10px">📄 ファイルを選ぶ</button>
            <button type="button" id="ft-pick-folder" class="btn" style="font-size:12px; padding:4px 10px">📁 フォルダを選ぶ</button>
          </div>
        </div>
        <div id="ft-selected" style="margin-top:8px"></div>
        <span class="hint-sm" style="font-size:11px">複数ファイルは zip にまとめられて送信。 PDF / Word / Excel / 画像 / zip / txt 等、合計 100MB 上限</span>
      </div>
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
  // v742 #353 複数選択可の共通 member picker に差し替え。
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

  // v743 #354 ファイル選択をドラッグ&ドロップ + 複数選択に対応。
  //   保持構造: { file: File, relPath: string }[]
  //   relPath はフォルダドロップ時のみ "folder/sub/file.txt" 形式、単独 file は file.name。
  const selectedFiles = [];
  function renderSelected() {
    const root = document.getElementById('ft-selected');
    if (selectedFiles.length === 0) { root.innerHTML = ''; return; }
    let total = 0;
    for (const it of selectedFiles) total += it.file.size;
    root.innerHTML = `
      <div style="background:#f3f4f6; border-radius:8px; padding:8px; font-size:12px">
        <div style="font-weight:600; margin-bottom:4px">選択中: ${selectedFiles.length} 件 (合計 ${fmtBytes(total)})</div>
        <div style="display:flex; flex-direction:column; gap:2px; max-height:200px; overflow:auto">
          ${selectedFiles.map((it, i) => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding:2px 0; border-bottom:1px solid #e5e7eb">
              <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(it.relPath || it.file.name)}</span>
              <span style="color:#6b7280; flex:none">${fmtBytes(it.file.size)}</span>
              <button type="button" class="btn" data-ft-rm="${i}" style="font-size:10px; padding:0 6px; flex:none">×</button>
            </div>
          `).join('')}
        </div>
        <button type="button" id="ft-clear" class="btn" style="font-size:11px; padding:2px 8px; margin-top:6px">全部クリア</button>
      </div>`;
    root.querySelectorAll('[data-ft-rm]').forEach(b => b.addEventListener('click', () => {
      selectedFiles.splice(Number(b.dataset.ftRm), 1); renderSelected();
    }));
    document.getElementById('ft-clear').addEventListener('click', () => {
      selectedFiles.length = 0; renderSelected();
    });
  }
  function addFiles(files, basePath = '') {
    for (const f of files) {
      const rel = basePath ? (basePath + '/' + f.name) : (f.webkitRelativePath || f.name);
      selectedFiles.push({ file: f, relPath: rel });
    }
    renderSelected();
  }

  // ファイル選択ボタン
  const fInput = document.getElementById('ft-files');
  const dInput = document.getElementById('ft-folder');
  document.getElementById('ft-pick-files').addEventListener('click', () => fInput.click());
  document.getElementById('ft-pick-folder').addEventListener('click', () => dInput.click());
  fInput.addEventListener('change', () => { addFiles(fInput.files); fInput.value = ''; });
  dInput.addEventListener('change', () => { addFiles(dInput.files); dInput.value = ''; });

  // ドロップゾーン本体タップでもファイル選択 (ボタン以外をタップした時)
  const drop = document.getElementById('ft-drop');
  drop.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;     // ボタンクリックは別ハンドラ
    fInput.click();
  });

  // ドラッグ&ドロップ
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, (ev) => {
    ev.preventDefault();
    drop.style.background = '#ede4f3';
    drop.style.borderColor = '#7b3fa0';
  }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, (ev) => {
    ev.preventDefault();
    drop.style.background = '#fafafa';
    drop.style.borderColor = '#9ca3af';
  }));
  drop.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    const items = ev.dataTransfer?.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      // ディレクトリも含めて再帰で拾う
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const e = items[i].webkitGetAsEntry?.();
        if (e) entries.push(e);
      }
      const all = [];
      await Promise.all(entries.map(e => walkEntry(e, '', all)));
      for (const { file, path } of all) {
        selectedFiles.push({ file, relPath: path || file.name });
      }
      renderSelected();
    } else if (ev.dataTransfer?.files) {
      addFiles(ev.dataTransfer.files);
    }
  });

  document.getElementById('ft-send').addEventListener('click', async () => {
    const selected = picker ? [...picker.getSelected()] : [];
    const body = document.getElementById('ft-body').value.trim();
    if (!selected.length) { toast('宛先を 1 人以上選んでください'); return; }
    if (selectedFiles.length === 0) { toast('ファイルを選んでください'); return; }
    const fd = new FormData();
    if (selectedFiles.length === 1 && !selectedFiles[0].relPath.includes('/')) {
      // 単一ファイル (フォルダ階層なし) → 旧 file 互換で送る (= zip しない、原形で保存)
      fd.append('file', selectedFiles[0].file);
    } else {
      const paths = [];
      for (const it of selectedFiles) {
        fd.append('files[]', it.file, it.file.name);
        paths.push(it.relPath || it.file.name);
      }
      fd.append('paths', JSON.stringify(paths));
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
      selectedFiles.length = 0;
      renderSelected();
      document.getElementById('ft-body').value = '';
      if (picker) picker.setSelected([]);
      await loadList();
    } catch (e) { toast('失敗: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '送信'; }
  });

  await loadList();
}

// FileSystemEntry を再帰で走査して全 File を all[] に push (path 付き)
async function walkEntry(entry, prefix, all) {
  if (entry.isFile) {
    await new Promise((resolve) => entry.file((f) => {
      all.push({ file: f, path: prefix ? (prefix + '/' + f.name) : f.name });
      resolve();
    }, () => resolve()));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries は 1 回で全部返さない仕様なのでループ
    while (true) {
      const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
      if (!batch || batch.length === 0) break;
      const nextPrefix = prefix ? (prefix + '/' + entry.name) : entry.name;
      for (const child of batch) await walkEntry(child, nextPrefix, all);
    }
  }
}

async function loadList() {
  try {
    const d = await get('/api/file-transfers');
    const items = d.items || [];
    const meId = Number(state.me?.id);
    const recv = items.filter(it => it.recipient_user_id === meId);
    const sent = items.filter(it => it.sender_user_id    === meId);
    // v742 #353 送信側は batch_id ごとに 1 枚にまとめる (= 複数受信者送信の 1 アクションを 1 行で表示)。
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
        if (!confirm(`この送信 (${ids.length} 人宛) を全部削除しますか?`)) return;
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

// 1 つの送信アクション (= 同じ batch) を 1 ブロックで表示。受信者 1 人なら旧 UI に近い。
function renderSentGroup(rows) {
  const head = rows[0];
  const ids = rows.map(r => r.id);
  return `
    <div class="list-item" style="align-items:flex-start; gap:10px; flex-direction:column">
      <div style="display:flex; gap:10px; width:100%; align-items:flex-start">
        <div style="flex:none">📦</div>
        <div class="grow" style="min-width:0">
          <div class="bold">${escapeHtml(head.original_name)} <span class="hint-sm" style="font-size:11px; opacity:0.7">${fmtBytes(head.file_size)}</span></div>
          <div class="meta">${rows.length} 人宛 · ${escapeHtml(head.sent_at)}</div>
          ${head.body ? `<div style="white-space:pre-wrap; font-size:13px; margin-top:4px">${escapeHtml(head.body)}</div>` : ''}
        </div>
      </div>
      <div style="width:100%; padding-left:24px; display:flex; flex-direction:column; gap:4px">
        ${rows.map(r => {
          const dl = r.download_count > 0
            ? `<span class="tag ok">✓ ${r.download_count} 回 DL ・初回 ${escapeHtml(String(r.first_downloaded_at || ''))}</span>`
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
          <a href="/api/file-transfers/${head.id}/download" class="btn" style="font-size:12px; padding:2px 8px">⬇️ 内容確認</a>
          ${rows.length > 1 ? `<button class="btn danger" style="font-size:12px; padding:2px 8px" data-ft-del-batch="${ids.join(',')}">全員分削除</button>` : ''}
        </div>
      </div>
    </div>`;
}
