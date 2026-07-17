// /#/bokete — 画像大喜利 (v1147 中村さん要望「boketeの機能をつくって」)。
//   お題 (画像 + 任意タイトル) を投稿 → 他のメンバーが「ボケ」を書く →
//   みんなが ⭐ で評価 → ⭐ 数でランキング。 無料、 娯楽タブから。

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { uploadImage } from '../upload.js';

export async function renderBokete() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">😆 ぼけて (bokete)</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/bokete/new">＋ お題を出す</a>
      </div>
      <div class="hint-sm" style="margin-top:6px; font-size:12px">
        画像を出して、面白い一言 (ボケ) を集めて ⭐ で評価する 大喜利。 無料で誰でも 参加可。
      </div>
    </div>
    <div id="bk-list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/bokete');
    const items = d.items || [];
    const root = document.getElementById('bk-list');
    if (!items.length) {
      root.innerHTML = '<div class="card"><div class="hint-sm">まだお題がありません。 「＋ お題を出す」から画像を投稿してみよう。</div></div>';
      return;
    }
    root.innerHTML = items.map(t => renderTopicCard(t)).join('');
  } catch (e) {
    document.getElementById('bk-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderTopicCard(t) {
  const closed = t.is_closed ? '<span class="tag" style="background:#fecaca; color:#b91c1c">締切済</span>' : '';
  return `
    <a class="card" href="#/bokete/${t.id}" style="display:block; text-decoration:none; color:inherit; padding:0; overflow:hidden">
      <div style="display:flex; gap:10px; padding:10px; align-items:flex-start">
        <img src="${escapeHtml(t.image_url)}" style="width:120px; height:120px; object-fit:cover; border-radius:8px; flex:none; background:#f3f4f6">
        <div style="flex:1; min-width:0">
          <div class="row" style="gap:6px; align-items:center; margin-bottom:4px">
            ${avatarHtml(t.creator_name, t.creator_avatar, 'xs')}
            <span class="hint-sm" style="font-size:11px">${escapeHtml(t.creator_name)}</span>
            ${closed}
          </div>
          ${t.title ? `<div class="bold" style="font-size:14px; margin-bottom:4px; line-height:1.4">${escapeHtml(t.title)}</div>` : ''}
          <div class="row" style="gap:10px; font-size:12px; color:#6b7280">
            <span>💬 ${t.answer_count} ボケ</span>
            <span>⭐ 最高 ${t.top_stars}</span>
            <span>${escapeHtml(String(t.created_at).slice(5, 16).replace('-','/'))}</span>
          </div>
        </div>
      </div>
    </a>`;
}

export async function renderBoketeNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/bokete" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">😆 新しいお題</h2>
      <label class="field">
        <span class="lbl">お題の画像 (必須)</span>
        <input type="file" id="bk-file" accept="image/*">
        <div id="bk-file-status" class="hint-sm"></div>
        <img id="bk-preview" hidden style="max-width:240px; max-height:240px; border-radius:8px; margin-top:6px; display:block">
      </label>
      <label class="field">
        <span class="lbl">お題の一言 (任意、 200 字まで)</span>
        <input type="text" id="bk-title" maxlength="200" placeholder="例: 猫がスマホを見ている理由は?">
      </label>
      <label class="field">
        <span class="lbl">締切 (任意)</span>
        <input type="datetime-local" id="bk-deadline">
        <div class="hint-sm" style="font-size:11px">締切を過ぎるとボケの投稿ができなくなります (⭐は続けられる)。</div>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:10px">
        <a href="#/bokete" class="btn">キャンセル</a>
        <button id="bk-go" class="btn primary" disabled>お題を投稿</button>
      </div>
    </div>
  `;
  let imageUrl = null;
  const goBtn = document.getElementById('bk-go');
  const status = document.getElementById('bk-file-status');
  const preview = document.getElementById('bk-preview');
  document.getElementById('bk-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast('20 MB まで'); return; }
    status.textContent = '⏳ アップロード中…';
    try {
      const r = await uploadImage(f);
      imageUrl = r.url || r.path;
      preview.src = imageUrl; preview.hidden = false;
      status.innerHTML = '<span style="color:#0e7c63">✓ アップロード完了</span>';
      goBtn.disabled = false;
    } catch (e) { status.textContent = '失敗: ' + e.message; }
  });
  goBtn.addEventListener('click', async () => {
    if (!imageUrl) { toast('画像を選んでください'); return; }
    const title = document.getElementById('bk-title').value.trim();
    const deadline = document.getElementById('bk-deadline').value;
    const body = { image_url: imageUrl, title };
    if (deadline) body.deadline_at = deadline.replace('T', ' ') + ':00';
    goBtn.disabled = true; goBtn.textContent = '⌛ 投稿中…';
    try {
      const r = await post('/api/bokete', body);
      toast('お題を投稿しました');
      navigate('#/bokete/' + r.id);
    } catch (e) {
      toast('失敗: ' + e.message);
      goBtn.disabled = false; goBtn.textContent = 'お題を投稿';
    }
  });
}

export async function renderBoketeTopic({ params }) {
  const tid = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="muted">読み込み中…</div></div>`;
  await loadTopic(tid);
}

async function loadTopic(tid) {
  const app = document.getElementById('app');
  try {
    const d = await get('/api/bokete/' + tid);
    paintTopic(d);
  } catch (e) {
    app.innerHTML = `<div class="card"><a href="#/bokete" class="hint">← 一覧</a><div class="muted">${escapeHtml(e.message)}</div></div>`;
  }
}

function paintTopic(d) {
  const app = document.getElementById('app');
  const t = d.topic;
  const meId = Number(state.me?.id);
  const isAdmin = state.me?.role === 'admin';
  const canPost = !t.is_closed;
  app.innerHTML = `
    <div class="card">
      <a href="#/bokete" class="hint">← 一覧</a>
      <div class="row" style="gap:6px; align-items:center; margin:6px 0; flex-wrap:wrap">
        ${avatarHtml(t.creator_name, t.creator_avatar, 'sm')}
        <span class="bold" style="font-size:13px">${escapeHtml(t.creator_name)}</span>
        <span class="hint-sm" style="font-size:11px">${escapeHtml(t.created_at)}</span>
        ${t.is_closed ? '<span class="tag" style="background:#fecaca; color:#b91c1c">締切済</span>' : ''}
        ${(t.is_mine || isAdmin) ? `<button id="bk-del-topic" class="btn danger" style="font-size:11px; padding:2px 8px; margin-left:auto">🗑 お題削除</button>` : ''}
      </div>
      ${t.title ? `<div class="bold" style="font-size:15px; margin-bottom:8px">${escapeHtml(t.title)}</div>` : ''}
      <img src="${escapeHtml(t.image_url)}" style="max-width:100%; max-height:480px; border-radius:8px; display:block; margin:0 auto; background:#f3f4f6">
      ${t.deadline_at ? `<div class="hint-sm" style="font-size:11px; margin-top:6px; color:#6b7280">締切: ${escapeHtml(t.deadline_at)}</div>` : ''}
    </div>

    ${canPost ? `
    <div class="card">
      <div class="bold" style="margin-bottom:6px; font-size:13px">✍️ ボケを書く</div>
      <textarea id="bk-ans" rows="2" maxlength="500" placeholder="面白い一言 (500字まで)" style="width:100%; padding:6px; box-sizing:border-box; resize:vertical"></textarea>
      <div class="row" style="justify-content:flex-end; margin-top:6px">
        <button id="bk-ans-go" class="btn primary" style="font-size:13px">💬 ボケる</button>
      </div>
    </div>` : `
    <div class="card">
      <div class="hint-sm">締切済なので、 新しいボケは投稿できません (⭐評価は続けられます)。</div>
    </div>
    `}

    <div class="card">
      <div class="bold" style="margin-bottom:8px; font-size:14px">😆 ボケ一覧 (⭐ 順、 ${d.answers.length} 件)</div>
      ${d.answers.length ? d.answers.map(a => renderAnswer(a, meId, isAdmin)).join('') :
         '<div class="hint-sm">まだボケがありません。 最初のボケを書いてみよう!</div>'}
    </div>
  `;

  document.getElementById('bk-del-topic')?.addEventListener('click', async () => {
    if (!confirm('このお題を削除しますか? (ボケも一緒に削除)')) return;
    try { await del('/api/bokete/' + t.id); toast('削除しました'); navigate('#/bokete'); }
    catch (e) { toast('失敗: ' + e.message); }
  });

  document.getElementById('bk-ans-go')?.addEventListener('click', async () => {
    const text = document.getElementById('bk-ans').value.trim();
    if (!text) { toast('本文を入力'); return; }
    const btn = document.getElementById('bk-ans-go');
    btn.disabled = true; btn.textContent = '⌛';
    try {
      await post('/api/bokete/' + t.id + '/answers', { text });
      document.getElementById('bk-ans').value = '';
      await loadTopic(t.id);
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '💬 ボケる'; }
  });

  // ⭐ トグル
  document.querySelectorAll('[data-bk-star]').forEach(b => b.addEventListener('click', async () => {
    const aid = Number(b.dataset.bkStar);
    b.disabled = true;
    try {
      const r = await post('/api/bokete/answers/' + aid + '/star', {});
      const cntEl = document.querySelector(`[data-bk-star-cnt="${aid}"]`);
      if (cntEl) cntEl.textContent = r.stars;
      b.textContent = r.on ? '⭐' : '☆';
      b.style.color = r.on ? '#f59e0b' : '#6b7280';
    } catch (e) { toast('失敗: ' + e.message); }
    finally { b.disabled = false; }
  }));

  // ボケ削除
  document.querySelectorAll('[data-bk-del-ans]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('このボケを削除しますか?')) return;
    const aid = Number(b.dataset.bkDelAns);
    try { await del('/api/bokete/answers/' + aid); await loadTopic(t.id); }
    catch (e) { toast('失敗: ' + e.message); }
  }));
}

function renderAnswer(a, meId, isAdmin) {
  const canDelete = a.is_mine || isAdmin;
  const canStar = !a.is_mine;   // 自分のボケには ⭐ できない (サーバ側でも拒否)
  const starIcon = a.my_star ? '⭐' : '☆';
  const starColor = a.my_star ? '#f59e0b' : '#6b7280';
  return `
    <div style="padding:10px 12px; margin:6px 0; background:#fff; border:1px solid var(--line); border-radius:8px">
      <div class="row" style="gap:8px; align-items:flex-start">
        ${avatarHtml(a.user_name, a.user_avatar, 'sm')}
        <div style="flex:1; min-width:0">
          <div class="row" style="gap:6px; align-items:center; font-size:12px; color:#6b7280; margin-bottom:4px">
            <span class="bold" style="color:#1d1c1d; font-size:13px">${escapeHtml(a.user_name)}</span>
            <span>${escapeHtml(String(a.created_at).slice(5, 16).replace('-','/'))}</span>
            ${canDelete ? `<button data-bk-del-ans="${a.id}" class="btn" style="font-size:10px; padding:0 6px; margin-left:auto">🗑</button>` : ''}
          </div>
          <div style="font-size:15px; line-height:1.5; white-space:pre-wrap; word-break:break-word">${escapeHtml(a.text)}</div>
        </div>
        <div style="flex:none; text-align:center">
          ${canStar
            ? `<button data-bk-star="${a.id}" title="⭐ を付ける / 外す" style="border:none; background:none; font-size:22px; cursor:pointer; color:${starColor}; padding:0; line-height:1">${starIcon}</button>`
            : `<div style="font-size:22px; color:#9ca3af">⭐</div>`}
          <div class="bold" data-bk-star-cnt="${a.id}" style="font-size:14px; color:#f59e0b">${a.stars}</div>
        </div>
      </div>
    </div>`;
}
