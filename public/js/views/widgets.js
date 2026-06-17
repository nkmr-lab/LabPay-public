// /#/widgets — ウィジェット センター (#246)。
// 自作 widget を 登録 / 編集 / 有効化 / 削除。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';

const SAMPLE_CLOCK = `import { me, html } from '/js/widgets_api.js';

export const meta = {
  name: '🕐 時計',
  description: '現在 時刻 を 表示',
  refreshSec: 1,
};

export function render(root) {
  const now = new Date();
  root.innerHTML = \`
    <div style="text-align:center; padding:8px">
      <div style="font-size:36px; font-family:monospace; font-weight:700">
        \${now.toLocaleTimeString('ja-JP')}
      </div>
      <div class="hint-sm" style="font-size:13px">
        \${now.toLocaleDateString('ja-JP', { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
      <div class="hint-sm" style="font-size:11px; margin-top:4px">こんにちは、 \${html(me.name)} さん</div>
    </div>
  \`;
}
`;

const SAMPLE_BALANCE = `import { get, html } from '/js/widgets_api.js';

export const meta = {
  name: '💰 残高',
  description: 'あなた の 残高 を 表示',
  refreshSec: 60,
};

export async function render(root) {
  try {
    const me = await get('/api/auth/me');
    const bal = me.balance ?? 0;
    root.innerHTML = \`
      <div style="text-align:center; padding:12px">
        <div class="hint-sm">あなた の 残高</div>
        <div style="font-size:32px; font-weight:700; color:#7c3aed">\${bal.toLocaleString()} pt</div>
      </div>
    \`;
  } catch (e) {
    root.innerHTML = \`<div class="hint">取得 失敗: \${html(e.message)}</div>\`;
  }
}
`;

const SAMPLES = [
  { label: '🕐 時計 (1 秒 更新)',     code: SAMPLE_CLOCK },
  { label: '💰 残高 (60 秒 更新)',    code: SAMPLE_BALANCE },
];

export async function renderWidgets() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">🧩 ウィジェット センター</h2>
        <a class="btn primary" href="#/widgets/new">＋ 新規 ウィジェット</a>
      </div>
      <p class="hint" style="font-size:13px; margin-top:6px">
        自作 ウィジェット を 登録 して ホーム に 出せます。
        JS を 書いて render(root) で 描画 する だけ。 詳細 は 「＋ 新規」 から サンプル を 見て ください。
      </p>
    </div>
    <div class="card">
      <h3>あなた の ウィジェット</h3>
      <div id="cw-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await loadList();
}

async function loadList() {
  const root = document.getElementById('cw-list');
  try {
    const d = await get('/api/custom-widgets');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">まだ ウィジェット は ありません。 「＋ 新規」 から 作成 してください</div>';
      return;
    }
    root.innerHTML = items.map(w => `
      <div class="list-item" style="gap:8px; align-items:center">
        <span style="font-size:24px; flex:none">${escapeHtml(w.icon || '🧩')}</span>
        <div class="grow" style="min-width:0">
          <div class="bold">${escapeHtml(w.name)} ${w.enabled ? '<span class="tag ok">有効</span>' : '<span class="tag muted">無効</span>'}</div>
          ${w.description ? `<div class="meta">${escapeHtml(w.description)}</div>` : ''}
          <div class="meta">JS ${w.js_size} bytes ・ 更新 ${escapeHtml(w.updated_at)}</div>
        </div>
        <div class="row" style="gap:6px; flex:none">
          <button class="btn cw-toggle" data-id="${w.id}" data-enabled="${w.enabled ? 1 : 0}">${w.enabled ? '無効化' : '有効化'}</button>
          <a class="btn" href="#/widgets/${w.id}/edit">編集</a>
          <button class="danger cw-del" data-id="${w.id}">削除</button>
        </div>
      </div>
    `).join('');
    root.querySelectorAll('.cw-toggle').forEach(b => b.addEventListener('click', async () => {
      try {
        await patch('/api/custom-widgets/' + b.dataset.id, { enabled: b.dataset.enabled === '1' ? 0 : 1 });
        toast(b.dataset.enabled === '1' ? '無効化 しました' : '有効化 しました');
        await loadList();
      } catch (e) { toast('失敗: ' + e.message); }
    }));
    root.querySelectorAll('.cw-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('この ウィジェット を 削除 しますか?')) return;
      try {
        await del('/api/custom-widgets/' + b.dataset.id);
        toast('削除 しました');
        await loadList();
      } catch (e) { toast('失敗: ' + e.message); }
    }));
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderWidgetNew({ params } = {}) {
  return renderWidgetForm(null);
}

export async function renderWidgetEdit({ params }) {
  return renderWidgetForm(Number(params.id));
}

async function renderWidgetForm(id) {
  const app = document.getElementById('app');
  const isEdit = id != null && !Number.isNaN(id);
  app.innerHTML = `
    <div class="card">
      <a href="#/widgets" class="hint">← ウィジェット センター</a>
      <h2 style="margin:6px 0">${isEdit ? '✏️ 編集' : '＋ 新規 ウィジェット'}</h2>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">名前</span>
        <input type="text" id="cw-name" maxlength="80" placeholder="例: 🕐 時計">
      </label>
      <label class="field"><span class="lbl">アイコン (絵文字 1 つ)</span>
        <input type="text" id="cw-icon" maxlength="4" placeholder="🧩">
      </label>
      <label class="field"><span class="lbl">説明 (任意)</span>
        <input type="text" id="cw-desc" maxlength="500" placeholder="ウィジェット の 説明">
      </label>
      ${isEdit ? '' : `
      <label class="field"><span class="lbl">サンプル から 取り込む</span>
        <select id="cw-sample">
          <option value="">-- 選択 --</option>
          ${SAMPLES.map((s, i) => `<option value="${i}">${escapeHtml(s.label)}</option>`).join('')}
        </select>
      </label>`}
      <label class="field"><span class="lbl">JS コード</span>
        <textarea id="cw-js" rows="20" style="width:100%; box-sizing:border-box; font-family:Consolas,Menlo,monospace; font-size:13px" placeholder="export const meta = { name: '...' };&#10;export function render(root) { ... }"></textarea>
      </label>
      <p class="hint" style="font-size:12px">
        💡 開発者 向け: <code>import { me, get, post, html } from '/js/widgets_api.js'</code> で API が 使えます。
        <code>export const meta = { name, description?, refreshSec? }</code> と
        <code>export function render(root)</code> を 書いて ください。
      </p>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/widgets" class="btn">キャンセル</a>
        <button id="cw-save" class="primary">${isEdit ? '保存' : '登録'}</button>
      </div>
    </div>
  `;

  if (isEdit) {
    try {
      const w = await get('/api/custom-widgets/' + id);
      document.getElementById('cw-name').value = w.name || '';
      document.getElementById('cw-icon').value = w.icon || '';
      document.getElementById('cw-desc').value = w.description || '';
      document.getElementById('cw-js').value = w.js_body || '';
    } catch (e) { toast('取得 失敗: ' + e.message); return; }
  } else {
    const sel = document.getElementById('cw-sample');
    sel?.addEventListener('change', () => {
      const idx = Number(sel.value);
      if (!Number.isFinite(idx) || sel.value === '') return;
      const s = SAMPLES[idx];
      document.getElementById('cw-js').value = s.code;
      // 名前 / アイコン も 推測 して 入れる
      const m = /name:\s*['"`]([^'"`]+)['"`]/.exec(s.code);
      if (m && !document.getElementById('cw-name').value) {
        document.getElementById('cw-name').value = m[1];
        // 先頭 の 絵文字 を icon に
        const em = m[1].match(/^(\p{Emoji}+)/u);
        if (em && !document.getElementById('cw-icon').value) document.getElementById('cw-icon').value = em[1];
      }
    });
  }

  document.getElementById('cw-save').addEventListener('click', async () => {
    const name = document.getElementById('cw-name').value.trim();
    const icon = document.getElementById('cw-icon').value.trim() || '🧩';
    const desc = document.getElementById('cw-desc').value.trim() || null;
    const js   = document.getElementById('cw-js').value;
    if (!name)   { toast('名前 必須'); return; }
    if (!js)     { toast('JS 必須'); return; }
    try {
      if (isEdit) {
        await patch('/api/custom-widgets/' + id, { name, icon, description: desc, js_body: js });
        toast('保存 しました');
      } else {
        await post('/api/custom-widgets', { name, icon, description: desc, js_body: js });
        toast('登録 しました');
      }
      navigate('#/widgets');
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
