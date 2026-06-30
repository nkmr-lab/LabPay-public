// /#/quotes — 名言登録 / 管理 (v804)。 ホームウィジェットの 「💬 今日の名言」 のプールに載る。

import { get, post, del } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';

export async function renderQuotes() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">💬 名言登録</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        登録した名言は、 静的リスト (偉人 / 漫画 / アニメ約 90 件) と合算されて、
        ホームの 「💬 今日の名言」 で 1 日 1 件が自動表示されます。 日ごとに
        deterministic に選ばれるので、 全員同じ名言を見ることになります。
      </p>
    </div>

    <div class="card">
      <h3 style="margin-top:0; font-size:14px">📝 新規登録</h3>
      <label class="field">
        <span class="lbl">名言本文 (必須、 500 字まで)</span>
        <textarea id="q-text" rows="3" maxlength="500" placeholder="例: 我思う、 故に我あり。"></textarea>
      </label>
      <label class="field">
        <span class="lbl">著者 / キャラクター (任意、 100 字まで)</span>
        <input type="text" id="q-author" maxlength="100" placeholder="例: ルフィ、 アインシュタイン、 西村先生">
      </label>
      <label class="field">
        <span class="lbl">出典 (任意、 200 字まで)</span>
        <input type="text" id="q-source" maxlength="200" placeholder="例: ONE PIECE、 講義中">
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="q-go" class="primary">📝 登録</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0; font-size:14px">📚 登録済名言一覧</h3>
      <div id="q-list" class="muted">読み込み中…</div>
    </div>
  `;
  document.getElementById('q-go').addEventListener('click', onSubmit);
  await load();
}

async function load() {
  const root = document.getElementById('q-list');
  try {
    const d = await get('/api/quotes');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">まだ登録された名言がありません</div>';
      return;
    }
    const meId = Number(state.me?.id || 0);
    const isAdmin = state.me?.role === 'admin';
    root.innerHTML = items.map(it => {
      const canDel = (it.user_id === meId) || isAdmin;
      const srcLine = it.source ? ` <span style="color:#9ca3af; font-size:11px">(${escapeHtml(it.source)})</span>` : '';
      return `
        <div class="list-item" style="align-items:flex-start; gap:6px; padding:8px 0; border-bottom:1px solid #f0f0f0">
          <div class="grow" style="min-width:0">
            <div style="font-size:14px; line-height:1.7; white-space:pre-wrap">「${escapeHtml(it.quote)}」</div>
            <div class="hint-sm" style="font-size:12px; color:#6b21a8; margin-top:3px">— ${escapeHtml(it.author || '不明')}${srcLine}</div>
            <div class="hint-sm" style="font-size:10.5px; color:#9ca3af; margin-top:2px">📝 ${escapeHtml(it.submitter_name || '?')} さん・ ${escapeHtml(it.created_at)}</div>
          </div>
          ${canDel ? `<button class="btn" data-del="${it.id}" style="font-size:11px; padding:2px 8px; flex:none">🗑</button>` : ''}
        </div>`;
    }).join('');
    root.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この名言を削除しますか?')) return;
        try { await del('/api/quotes/' + b.dataset.del); toast('削除しました'); await load(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function onSubmit() {
  const text   = document.getElementById('q-text').value.trim();
  const author = document.getElementById('q-author').value.trim();
  const source = document.getElementById('q-source').value.trim();
  if (!text) { toast('名言本文を入れて'); return; }
  try {
    await post('/api/quotes', { quote: text, author, source });
    toast('登録しました');
    document.getElementById('q-text').value = '';
    document.getElementById('q-author').value = '';
    document.getElementById('q-source').value = '';
    await load();
  } catch (e) { toast('失敗: ' + e.message); }
}
