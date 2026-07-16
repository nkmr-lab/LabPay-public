// /#/setlog — 1日を短いクリップで断片記録する Vlog 型 (v1126)
//   写真を随時追加 → 日別・ユーザ別に時系列表示。今日のみんなのフィードも。

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { toast, state } from '../app.js';
import { uploadImage } from '../upload.js';

export async function renderSetlog() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📸 setlog</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px; line-height:1.6">
        1 日をチラ見せの断片で記録するラボ内 Vlog (BeReal 的)。写真 + 短いキャプションを随時ポスト → 日別にまとまる。
      </p>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button class="btn primary" data-sl-tab="today">🎬 今日のみんな</button>
        <button class="btn"         data-sl-tab="post">📸 撮る / 投稿</button>
        <button class="btn"         data-sl-tab="mine">🎞 私のログ</button>
      </div>
    </div>
    <div id="sl-root"><div class="muted">読み込み中…</div></div>
  `;
  document.querySelectorAll('[data-sl-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.slTab));
  });
  await switchTab('today');
}

async function switchTab(tab) {
  document.querySelectorAll('[data-sl-tab]').forEach(el => el.classList.toggle('primary', el.dataset.slTab === tab));
  const root = document.getElementById('sl-root');
  root.innerHTML = '<div class="muted">読み込み中…</div>';
  if (tab === 'today') return renderToday(root);
  if (tab === 'post')  return renderPost(root);
  if (tab === 'mine')  return renderMine(root);
}

function clipCard(c) {
  const t = c.taken_at.split(' ')[1]?.slice(0, 5) || '';
  return `
    <div style="position:relative; border-radius:8px; overflow:hidden; background:#000">
      <img src="${escapeHtml(c.image_url)}" style="width:100%; aspect-ratio:1/1; object-fit:cover; display:block" loading="lazy">
      <div style="position:absolute; bottom:0; left:0; right:0; padding:6px 8px; background:linear-gradient(0deg, rgba(0,0,0,0.6), transparent); color:#fff; font-size:11px; display:flex; align-items:center; gap:6px">
        <span style="font-weight:700">${t}</span>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(c.caption || '')}</span>
        ${c.is_mine ? `<button data-sl-del="${c.id}" style="border:none; background:rgba(255,255,255,0.2); color:#fff; padding:0 4px; border-radius:3px; cursor:pointer; font-size:11px">🗑</button>` : ''}
      </div>
    </div>
  `;
}

async function renderToday(root) {
  try {
    const d = await get('/api/setlog/today');
    if (!d.users.length) { root.innerHTML = '<div class="card muted">まだ今日のクリップがありません。「📸 撮る」から始めよう!</div>'; return; }
    root.innerHTML = d.users.map(u => `
      <div class="card">
        <div class="row" style="gap:6px; align-items:center; margin-bottom:6px">
          ${avatarHtml(u.user_name, u.user_avatar, 'sm')}
          <div style="font-weight:700">${escapeHtml(u.user_name)}</div>
          <span style="margin-left:auto; font-size:11px; color:#6b7280">${u.clips.length} クリップ</span>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:4px">
          ${u.clips.map(clipCard).join('')}
        </div>
      </div>
    `).join('');
    wireDel(root);
  } catch (e) { root.innerHTML = `<div class="card muted" style="color:#b91c1c">${escapeHtml(e.message)}</div>`; }
}

async function renderPost(root) {
  root.innerHTML = `
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📸 撮って / 選んで投稿</div>
      <p class="hint-sm" style="font-size:12px; color:#6b7280">スマホなら「カメラを起動」で撮影、PC なら画像選択。1 日にいくつでも投稿 OK。</p>
      <input type="file" id="sl-file" accept="image/*" capture="environment" style="width:100%; padding:8px; border:2px dashed #a78bfa; border-radius:8px; background:#faf5ff; margin-bottom:8px">
      <div id="sl-preview" style="margin-bottom:8px"></div>
      <label style="display:block; margin-bottom:8px">
        <div style="font-size:12px; color:#6b7280">💬 キャプション (80 字まで、任意)</div>
        <input type="text" id="sl-caption" maxlength="80" placeholder="例: 実験なう / お昼ラーメン / ゼミ中" style="width:100%; padding:6px; box-sizing:border-box">
      </label>
      <div class="row" style="justify-content:flex-end">
        <button class="btn primary" id="sl-post" disabled>📮 投稿</button>
      </div>
    </div>
  `;
  const fileInput = document.getElementById('sl-file');
  const preview = document.getElementById('sl-preview');
  const postBtn = document.getElementById('sl-post');
  let selected = null;
  fileInput.addEventListener('change', () => {
    selected = fileInput.files[0] || null;
    if (!selected) { preview.innerHTML = ''; postBtn.disabled = true; return; }
    const url = URL.createObjectURL(selected);
    preview.innerHTML = `<img src="${url}" style="max-width:100%; max-height:300px; border-radius:8px">`;
    postBtn.disabled = false;
  });
  postBtn.addEventListener('click', async () => {
    if (!selected) return;
    postBtn.disabled = true; postBtn.textContent = '⌛ アップロード中…';
    try {
      const up = await uploadImage(selected);
      const cap = document.getElementById('sl-caption').value.trim();
      await post('/api/setlog', { image_url: up.url, caption: cap });
      toast('📸 投稿完了');
      await switchTab('today');
    } catch (e) { toast('失敗: ' + e.message); postBtn.disabled = false; postBtn.textContent = '📮 投稿'; }
  });
}

async function renderMine(root) {
  try {
    const days = (await get('/api/setlog/mine-days')).days || [];
    if (!days.length) { root.innerHTML = '<div class="card muted">まだ投稿がありません</div>'; return; }
    root.innerHTML = `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">🎞 私のログ (直近 ${days.length} 日)</div>
        <div class="row" style="gap:4px; flex-wrap:wrap">
          ${days.map(d => `<button class="btn" data-sl-day="${d.d}" style="font-size:12px">${d.d} (${d.n})</button>`).join('')}
        </div>
      </div>
      <div id="sl-day-detail"></div>
    `;
    root.querySelectorAll('[data-sl-day]').forEach(el => {
      el.addEventListener('click', async () => {
        const date = el.dataset.slDay;
        const detail = document.getElementById('sl-day-detail');
        detail.innerHTML = '<div class="muted">読み込み中…</div>';
        const uid = state.me?.id;
        const d = await get(`/api/setlog?user_id=${uid}&date=${date}`);
        detail.innerHTML = `
          <div class="card">
            <div class="bold" style="margin-bottom:6px">📅 ${date} — ${d.items.length} クリップ</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:4px">
              ${d.items.map(clipCard).join('')}
            </div>
          </div>
        `;
        wireDel(detail);
      });
    });
    // 最新日を自動オープン
    if (days.length) root.querySelector('[data-sl-day]').click();
  } catch (e) { root.innerHTML = `<div class="card muted" style="color:#b91c1c">${escapeHtml(e.message)}</div>`; }
}

function wireDel(root) {
  root.querySelectorAll('[data-sl-del]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('このクリップを削除?')) return;
      try { await del('/api/setlog/' + el.dataset.slDel); toast('削除'); await switchTab(document.querySelector('[data-sl-tab].primary')?.dataset.slTab || 'today'); }
      catch (err) { toast('失敗: ' + err.message); }
    });
  });
}
