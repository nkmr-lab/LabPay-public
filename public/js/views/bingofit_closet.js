// v740 BingoFit (feedback #288) クローゼット: 衣類の追加 / 編集 / アーカイブ。
// 写真は /api/uploads/image にアップ → 返ってきた URL を POST /api/bingofit/items に渡す。
// 背景透過は worker (cron 1 分) が非同期で生成。 pending の間は「🪄 切り抜き中」 バッジを出して
// 5 秒 polling、 done になったら image_url_transparent に差し替える。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

const CAT_LABELS = { top: 'トップス', bottom: 'ボトムス', outer: 'アウター', shoes: '靴', other: 'その他' };
let _pollTimer = null;

export async function renderBingofitCloset() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div style="max-width:720px; margin:0 auto; padding:12px">
      <h2 style="margin:0 0 12px; font-size:20px">👕 着回しビンゴ - クローゼット</h2>
      <div style="font-size:12px; color:#666; margin-bottom:14px; line-height:1.6">
        手持ちの服を 25 着以上登録すると、 日曜始まりの週次ビンゴ盤が自動生成されます。
        着た服を盤面から開けて、 ラインが揃えばビンゴ! 背景は自動で透過処理されます (1 分以内に完了)。
      </div>
      <div style="display:flex; gap:12px; margin-bottom:14px">
        <a href="#/bingofit/board"   class="btn" style="flex:1; text-align:center; padding:10px; background:#7b3fa0; color:#fff; border-radius:8px; text-decoration:none; font-weight:600">🎯 今週の盤を見る</a>
        <a href="#/bingofit/history" class="btn" style="flex:1; text-align:center; padding:10px; background:#ede4f3; color:#4a106d; border-radius:8px; text-decoration:none">📊 過去履歴</a>
      </div>

      <div id="bf-add" style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:12px; margin-bottom:14px">
        <div style="font-weight:600; margin-bottom:8px">➕ 衣類を追加</div>
        <input type="file" id="bf-file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" style="display:block; width:100%; margin-bottom:8px">
        <input type="text" id="bf-label" placeholder="ラベル (例: 黒T、デニム) - 任意、 80 文字以下" maxlength="80" style="display:block; width:100%; padding:8px; border:1px solid #d1d5db; border-radius:6px; margin-bottom:8px; box-sizing:border-box">
        <select id="bf-cat" style="display:block; width:100%; padding:8px; border:1px solid #d1d5db; border-radius:6px; margin-bottom:8px; box-sizing:border-box">
          <option value="top">トップス</option>
          <option value="bottom">ボトムス</option>
          <option value="outer">アウター</option>
          <option value="shoes">靴</option>
          <option value="other" selected>その他</option>
        </select>
        <button id="bf-add-btn" type="button" style="width:100%; padding:10px; background:#4a106d; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer">登録する</button>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
        <div id="bf-counter" style="font-size:13px; color:#374151"></div>
        <div style="font-size:11px; color:#9ca3af">タップで編集</div>
      </div>
      <div id="bf-list">読み込み中...</div>
    </div>
  `;
  document.getElementById('bf-add-btn').addEventListener('click', onAddClick);
  await refreshList();
  startPollIfPending();
}

async function refreshList() {
  try {
    const d = await get('/api/bingofit/items');
    renderItems(d);
  } catch (e) {
    document.getElementById('bf-list').innerHTML = `<div style="color:#c00; padding:12px">取得 失敗: ${escapeHtml(String(e))}</div>`;
  }
}

function renderItems(d) {
  const items = d.items || [];
  const max = d.max_items || 50;
  const active = items.filter(i => !i.archived);
  document.getElementById('bf-counter').textContent =
    `登録: ${active.length} / ${max} 着 (うちアーカイブ ${items.length - active.length} 件)`;
  if (items.length === 0) {
    document.getElementById('bf-list').innerHTML = `
      <div style="text-align:center; padding:30px; color:#9ca3af; background:#f9fafb; border-radius:10px">
        まだ衣類が登録されていません。<br>上のフォームから写真を 1 枚ずつ追加してください。
      </div>`;
    return;
  }
  // v741 「最近 着てない 服」 サジェスト。 14 日以上 着てない (or 一度も) アクティブ衣類 を 5 件 まで。
  //   研究 (BingoFit) の 効果 検証 部分: 眠ってる 服 を 見せて 「次 これ 着てみない?」 を 促す。
  const suggestions = active
    .filter(i => i.days_since_worn === null || i.days_since_worn >= 14)
    .sort((a, b) => {
      const ad = a.days_since_worn === null ? 9999 : a.days_since_worn;
      const bd = b.days_since_worn === null ? 9999 : b.days_since_worn;
      return bd - ad;
    })
    .slice(0, 5);
  const sugHtml = suggestions.length === 0 ? '' : `
    <div style="background:linear-gradient(135deg,#fef3c7,#fde68a); border:1px solid #fde68a; border-radius:10px; padding:10px 12px; margin-bottom:12px">
      <div style="font-weight:600; font-size:13px; color:#92400e; margin-bottom:6px">💤 最近 着てない 服 (今週 着てみよう)</div>
      <div style="display:flex; gap:6px; overflow-x:auto">
        ${suggestions.map(i => `
          <div style="flex:none; text-align:center">
            <img src="${escapeHtml(i.image_url_transparent || i.image_url || '')}" alt="${escapeHtml(i.label||'')}" loading="lazy"
                 style="width:54px; height:54px; object-fit:contain; background:#fff; border-radius:6px; padding:2px">
            <div style="font-size:9px; color:#92400e; margin-top:2px">${i.days_since_worn === null ? '未着用' : i.days_since_worn + ' 日 前'}</div>
          </div>
        `).join('')}
      </div>
    </div>`;

  document.getElementById('bf-list').innerHTML = sugHtml + `
    <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:10px">
      ${items.map(itemCard).join('')}
    </div>`;
  document.querySelectorAll('[data-bf-item]').forEach(el => {
    el.addEventListener('click', () => editItem(parseInt(el.dataset.bfItem, 10), items));
  });
}

function itemCard(it) {
  const url = it.image_url_transparent || it.image_url;
  const isDone = it.bg_status === 'done';
  const isPending = it.bg_status === 'pending';
  const isFailed = it.bg_status === 'failed';
  const archived = it.archived;
  const bg = isDone ? 'linear-gradient(135deg,#fafaf5,#ede4f3)' : '#f3f4f6';
  // v741 「N 日前に着た」 / 「14 日以上 着てない」 バッジ
  let wornBadge = '';
  if (!archived && it.days_since_worn !== null) {
    const d = it.days_since_worn;
    if (d <= 1) wornBadge = `<div style="position:absolute; top:4px; left:4px; background:#10b981; color:#fff; font-size:9px; padding:2px 5px; border-radius:3px">✓ 今週</div>`;
    else if (d >= 14) wornBadge = `<div style="position:absolute; top:4px; left:4px; background:#f59e0b; color:#fff; font-size:9px; padding:2px 5px; border-radius:3px">💤 ${d}日</div>`;
  }
  return `
    <div data-bf-item="${it.id}" style="position:relative; cursor:pointer; border-radius:10px; overflow:hidden; border:1px solid #e5e7eb; background:${bg}; ${archived ? 'opacity:0.4' : ''}">
      <div style="padding-top:100%; position:relative; background:${bg}">
        <img src="${escapeHtml(url || '')}" alt="${escapeHtml(it.label || '')}" loading="lazy"
             style="position:absolute; inset:0; width:100%; height:100%; object-fit:contain; padding:4px; ${isPending ? 'opacity:0.45; filter:saturate(0.4)' : ''}">
        ${wornBadge}
        ${isPending ? `<div style="position:absolute; left:0; right:0; bottom:0; background:rgba(0,0,0,0.55); color:#fff; font-size:10px; text-align:center; padding:3px">🪄 切り抜き中</div>` : ''}
        ${isFailed ? `<div style="position:absolute; left:0; right:0; bottom:0; background:rgba(220,38,38,0.85); color:#fff; font-size:10px; text-align:center; padding:3px">⚠ 切り抜き失敗</div>` : ''}
        ${archived ? `<div style="position:absolute; top:4px; right:4px; background:#6b7280; color:#fff; font-size:9px; padding:2px 5px; border-radius:3px">📦 アーカイブ</div>` : ''}
      </div>
      <div style="padding:5px 6px; font-size:11px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(it.label || '(無名)')}</div>
    </div>`;
}

async function onAddClick() {
  const file = document.getElementById('bf-file').files[0];
  if (!file) { toast('写真を選んでください'); return; }
  const label = document.getElementById('bf-label').value.trim();
  const category = document.getElementById('bf-cat').value;
  const btn = document.getElementById('bf-add-btn');
  btn.disabled = true;
  btn.textContent = 'アップロード 中...';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const upRes = await fetch('/api/uploads/image', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': state.csrfToken || '' }, credentials: 'same-origin' });
    if (!upRes.ok) throw new Error('upload failed: ' + upRes.status);
    const up = await upRes.json();
    await post('/api/bingofit/items', { image_url: up.path || up.url.replace(/^https?:\/\/[^/]+/, ''), label, category });
    toast('追加しました (背景透過処理を開始)');
    document.getElementById('bf-file').value = '';
    document.getElementById('bf-label').value = '';
    await refreshList();
    startPollIfPending();
  } catch (e) {
    toast('追加 失敗: ' + (e?.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = '登録する';
  }
}

async function editItem(id, items) {
  const it = items.find(x => x.id === id);
  if (!it) return;
  // ミニ モーダル (label / category 編集 + アーカイブ / 復活 / 再切り抜き)
  const newLabel = prompt('ラベル (空でも OK)', it.label || '');
  if (newLabel === null) return;
  const action = prompt(`カテゴリ: top/bottom/outer/shoes/other
あるいは "archive" / "unarchive" / "retry-bg" を入力 (空 Enter でラベルのみ更新)`, it.category);
  if (action === null) return;
  try {
    if (action === 'archive') {
      await patch('/api/bingofit/items/' + id, { archived: true });
    } else if (action === 'unarchive') {
      await patch('/api/bingofit/items/' + id, { archived: false });
    } else if (action === 'retry-bg') {
      await post('/api/bingofit/items/' + id + '/retry-bg', {});
      toast('再処理を依頼しました');
      startPollIfPending();
    } else if (['top','bottom','outer','shoes','other'].includes(action)) {
      await patch('/api/bingofit/items/' + id, { label: newLabel, category: action });
    } else {
      await patch('/api/bingofit/items/' + id, { label: newLabel });
    }
    await refreshList();
  } catch (e) {
    toast('更新 失敗: ' + (e?.message || e));
  }
}

function startPollIfPending() {
  if (_pollTimer) return;
  _pollTimer = setInterval(async () => {
    try {
      const d = await get('/api/bingofit/items');
      const pending = (d.items || []).some(i => i.bg_status === 'pending');
      renderItems(d);
      if (!pending) { clearInterval(_pollTimer); _pollTimer = null; }
    } catch (_) { /* swallow */ }
  }, 5000);
}
