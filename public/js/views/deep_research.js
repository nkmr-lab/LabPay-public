// /#/deep-research — Deep Research。
//   v840 #422 依頼フォームを <details> で 折りたたみ、 過去結果をタイル表示、 ⭐ スター + 並び替え。

import { get, post, del, patch } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { starButtonHtml, bindStarButtons, viewControlsHtml, bindViewControls, setFormOpen } from '../ui_ai_stars.js';

let cachedSettings = null;
let viewState = {
  mineSort: 'new', mineOnly_mine: false,  // 自分の履歴側の並び/フィルタ
  pubSort:  'new', mineOnly_pub:  false,  // 公開 Deep Research 側
  lastQuery: '',
};

export async function renderDeepResearch() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🔎 Deep Research</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        クエリを入力すると、 OpenAI が Web を横断検索して 構造化レポート + 出典 を日本語で返します。
      </p>
    </div>
    <details class="card" id="dr-form" style="margin-top:8px">
      <summary style="cursor:pointer; font-weight:600; padding:4px 0; user-select:none">➕ 新しい Deep Research を依頼</summary>
      <div style="margin-top:8px">
        <label class="field">
          <span class="lbl">🧐 調査したいこと</span>
          <textarea id="dr-query" rows="4" maxlength="4000" placeholder="例: 「2026年時点の視線追跡 (eye tracking) センサの民生機器での採用状況と、 主要メーカの技術トレンドを整理して」"></textarea>
          <div class="hint-sm" style="font-size:11px; margin-top:4px">範囲が広すぎない、 一文〜数文で具体的に書くと質が上がります。</div>
        </label>
        <label class="field">
          <span class="lbl">⚙️ 深さ</span>
          <select id="dr-depth"><option value="">読み込み中…</option></select>
          <div class="hint-sm" id="dr-cost-info" style="font-size:12px; margin-top:4px; color:#6b21a8"></div>
        </label>
        <div class="row" style="gap:6px; justify-content:flex-end">
          <button id="dr-go" class="primary" disabled>🔎 調査開始</button>
        </div>
      </div>
    </details>
    <div id="dr-result"></div>

    <div class="card" style="margin-top:8px">
      <div class="bold" style="margin-bottom:6px; font-size:14px">📚 自分の Deep Research 履歴</div>
      <div id="dr-history-controls"></div>
      <div id="dr-history-grid"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card" style="margin-top:8px">
      <div class="bold" style="font-size:14px; margin-bottom:6px">🌐 みんなの公開 Deep Research</div>
      <div class="row" style="gap:6px; margin-bottom:6px">
        <input type="text" id="dr-shared-q" placeholder="キーワードで検索 (空欄で最新 100 件)" style="flex:1">
        <button id="dr-shared-go">検索</button>
      </div>
      <div id="dr-shared-controls"></div>
      <div id="dr-shared-grid"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await loadSettings();
  await loadHistory();
  await loadSharedList('');
  document.getElementById('dr-go').addEventListener('click', go);
  document.getElementById('dr-shared-go').addEventListener('click', () => {
    viewState.lastQuery = (document.getElementById('dr-shared-q').value || '').trim();
    loadSharedList(viewState.lastQuery);
  });
  document.getElementById('dr-shared-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      viewState.lastQuery = (document.getElementById('dr-shared-q').value || '').trim();
      loadSharedList(viewState.lastQuery);
    }
  });
}

async function loadSettings() {
  try { cachedSettings = await get('/api/ai/deep_research'); }
  catch (e) { toast('設定読込失敗: ' + e.message); return; }
  const sel = document.getElementById('dr-depth');
  const info = document.getElementById('dr-cost-info');
  const btn = document.getElementById('dr-go');
  if (sel && cachedSettings.tiers) {
    const def = cachedSettings.default_depth || 'standard';
    sel.innerHTML = Object.entries(cachedSettings.tiers).map(([k, t]) =>
      `<option value="${escapeHtml(k)}" ${k === def ? 'selected' : ''}>${escapeHtml(t.label)} — ${t.cost}pt</option>`).join('');
    const refresh = () => {
      const k = sel.value;
      const t = cachedSettings.tiers[k];
      if (info) info.textContent = `選択中: ${t.label} ・ 1 回 ${t.cost}pt (深さにより 1-15 分)`;
      if (btn) btn.textContent = `🔎 調査開始 (${t.cost}pt)`;
    };
    sel.addEventListener('change', refresh);
    refresh();
    btn.disabled = false;
  }
}

async function loadHistory() {
  const root = document.getElementById('dr-history-grid');
  const ctlRoot = document.getElementById('dr-history-controls');
  try {
    const d = await get('/api/ai/deep_research' + (viewState.mineSort === 'stars' ? '?sort=stars' : ''));
    let items = d.items || [];
    if (viewState.mineOnly_mine) items = items.filter(r => r.my_starred);

    // 履歴が空 (初回) なら form を開く、 ある なら閉じる
    setFormOpen('dr-form', items.length === 0);

    ctlRoot.innerHTML = viewControlsHtml({
      id: 'dr-history-vc',
      sort: viewState.mineSort,
      mineOnly: viewState.mineOnly_mine,
      total: items.length,
    });
    bindViewControls(ctlRoot, ({ mineOnly, sort }) => {
      viewState.mineOnly_mine = mineOnly;
      viewState.mineSort = sort;
      loadHistory();
    });

    if (!items.length) {
      root.innerHTML = `<div class="muted">${viewState.mineOnly_mine ? 'スター付きの履歴はまだありません' : '過去の履歴はありません'}</div>`;
      return;
    }
    root.innerHTML = `<div class="ai-tile-grid">
      ${items.map(r => `
        <a class="ai-tile" href="#/deep-research/r/${escapeHtml(r.share_token)}">
          <div class="ai-tile-head">
            ${r.is_shared ? '<span style="color:#15803d">🌐</span>' : ''}
            <span>${escapeHtml(r.depth)} ・ ${r.cost_points}pt</span>
            <span class="meta" style="margin-left:auto">${escapeHtml(r.status)}</span>
          </div>
          <div class="ai-tile-title">${escapeHtml(r.query_short || '(空)')}</div>
          <div class="ai-tile-foot">
            <span>${escapeHtml(r.created_at || '')}</span>
            <span style="margin-left:auto">
              ${starButtonHtml({ kind: 'deep_research', refId: r.id, count: r.star_count, mine: r.my_starred, users: r.star_users })}
            </span>
            <button class="ghost" data-del="${r.id}" title="削除" style="font-size:12px; padding:2px 6px; margin-left:2px"
              onclick="event.preventDefault(); event.stopPropagation();">🗑</button>
          </div>
        </a>`).join('')}
    </div>`;
    bindStarButtons(root);
    root.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', async ev => {
        ev.preventDefault(); ev.stopPropagation();
        if (!confirm('この履歴を削除しますか?')) return;
        try {
          await del('/api/ai/deep_research/' + b.dataset.del);
          await loadHistory();
        } catch (e) { toast('削除失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function loadSharedList(q) {
  const root = document.getElementById('dr-shared-grid');
  const ctlRoot = document.getElementById('dr-shared-controls');
  if (!root) return;
  try {
    const params = [];
    if (q) params.push('q=' + encodeURIComponent(q));
    if (viewState.pubSort === 'stars') params.push('sort=stars');
    const url = '/api/ai/deep_research/shared' + (params.length ? '?' + params.join('&') : '');
    const d = await get(url);
    let items = d.items || [];
    if (viewState.mineOnly_pub) items = items.filter(r => r.my_starred);

    ctlRoot.innerHTML = viewControlsHtml({
      id: 'dr-shared-vc',
      sort: viewState.pubSort,
      mineOnly: viewState.mineOnly_pub,
      total: items.length,
    });
    bindViewControls(ctlRoot, ({ mineOnly, sort }) => {
      viewState.mineOnly_pub = mineOnly;
      viewState.pubSort = sort;
      loadSharedList(viewState.lastQuery);
    });

    if (!items.length) {
      root.innerHTML = `<div class="muted">${
        viewState.mineOnly_pub ? 'スター付きの公開 Deep Research はありません'
        : (q ? '「' + escapeHtml(q) + '」 に該当する公開 Deep Research はありません' : '公開されている Deep Research はまだありません')
      }</div>`;
      return;
    }
    root.innerHTML = `<div class="ai-tile-grid">
      ${items.map(r => `
        <a class="ai-tile" href="#/deep-research/r/${escapeHtml(r.share_token)}">
          <div class="ai-tile-head">
            ${avatarHtml(r.author_name, r.author_avatar, 'xs')}
            <span style="font-size:11px">${escapeHtml(r.author_name || '')}</span>
            <span style="margin-left:auto; font-size:11px">${escapeHtml(r.depth || '')} ・ ${r.cost_points}pt</span>
          </div>
          <div class="ai-tile-title">${escapeHtml(r.query_short || '')}</div>
          ${r.summary_short ? `<div class="ai-tile-snippet">${escapeHtml(r.summary_short)}…</div>` : ''}
          <div class="ai-tile-foot">
            <span>${escapeHtml(r.shared_at || '')}</span>
            <span style="margin-left:auto">${starButtonHtml({ kind: 'deep_research', refId: r.id, count: r.star_count, mine: r.my_starred, users: r.star_users })}</span>
          </div>
        </a>`).join('')}
    </div>`;
    bindStarButtons(root);
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function go() {
  const query = (document.getElementById('dr-query').value || '').trim();
  if (!query) { toast('クエリを入力してください'); return; }
  const depth = document.getElementById('dr-depth').value || 'standard';
  const btn = document.getElementById('dr-go');
  btn.disabled = true; btn.textContent = '⏳ 依頼中…';
  const root = document.getElementById('dr-result');
  root.innerHTML = '<div class="card"><div class="muted">⏳ OpenAI に依頼中…</div></div>';
  try {
    const r = await post('/api/ai/deep_research', { query, depth });
    location.hash = '#/deep-research/r/' + r.share_token;
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="muted">失敗: ${escapeHtml(e.message)}</div></div>`;
    btn.disabled = false;
    btn.textContent = '🔎 調査開始';
  }
}

let pollTimer = null;
export async function renderDeepResearchShared({ params }) {
  const token = params.token;
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="muted">読み込み中…</div></div>`;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  await refreshShared(token);
  const stopOnLeave = () => {
    if (!location.hash.includes('/deep-research/r/' + token)) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      window.removeEventListener('hashchange', stopOnLeave);
    }
  };
  window.addEventListener('hashchange', stopOnLeave);
}

async function refreshShared(token) {
  const app = document.getElementById('app');
  if (!location.hash.includes('/deep-research/r/' + token)) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    return;
  }
  try {
    const d = await get('/api/ai/deep_research/r/' + encodeURIComponent(token));
    if (!location.hash.includes('/deep-research/r/' + token)) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      return;
    }
    const myUid = Number(state.me?.id || 0);
    const isOwner = myUid > 0 && Number(d.author_id) === myUid;
    const shareToggleHtml = (isOwner && d.status === 'done') ? `
      <div style="margin-top:8px; padding:8px 12px; background:#fef3c7; border-radius:6px; font-size:13px; display:flex; align-items:center; gap:8px">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer">
          <input type="checkbox" id="dr-share-toggle" ${d.is_shared ? 'checked' : ''}>
          <span>🌐 みんなに公開 (他メンバがキーワード検索で見つけられるようにする)</span>
        </label>
      </div>` : '';
    const header = `
      <div class="card">
        <a href="#/deep-research" class="hint">← Deep Research</a>
        <h2 style="margin:6px 0">🔎 Deep Research
          ${d.status === 'pending' || d.status === 'processing' ? '<span class="tag warn">処理中</span>' : ''}
          ${d.status === 'error' ? '<span class="tag" style="background:#fecaca; color:#b91c1c">エラー</span>' : ''}
          ${d.is_shared ? '<span class="tag" style="background:#dcfce7; color:#15803d">🌐 公開中</span>' : ''}
        </h2>
        <div class="meta">
          ${avatarHtml(d.author_name, d.author_avatar, 'xs')} ${escapeHtml(d.author_name)} ・ ${escapeHtml(d.model || '')} (${escapeHtml(d.depth || '')}) ・ ${d.cost_points}pt ・ ${escapeHtml(d.created_at || '')}
        </div>
        <div style="margin-top:8px; padding:8px 12px; background:#f5f3ff; border-left:3px solid #6b21a8; border-radius:0 6px 6px 0; font-size:13px; white-space:pre-wrap">${escapeHtml(d.query_text)}</div>
        ${shareToggleHtml}
      </div>
      <div id="dr-result"></div>
    `;
    app.innerHTML = header;
    if (d.status === 'pending' || d.status === 'processing') {
      document.getElementById('dr-result').innerHTML = `
        <div class="card">
          <div class="bold" style="font-size:16px; color:var(--primary)">⏳ Web を横断調査中…</div>
          <p class="hint" style="font-size:13px; margin-top:6px">
            深さにより 1-30 分程度かかります。 このページを閉じても大丈夫 (完了したら通知が届きます)。<br>
            10 秒ごとに自動更新。
          </p>
          ${d.progress_text ? `
            <div style="margin-top:10px; padding:10px 14px; background:#f0f9ff; border-left:4px solid #0284c7; border-radius:0 6px 6px 0">
              <div class="bold" style="font-size:13px; color:#0284c7">📡 現在の状況</div>
              <div style="font-size:13.5px; margin-top:4px">${escapeHtml(d.progress_text)}</div>
            </div>` : ''}
        </div>`;
      if (!pollTimer) pollTimer = setInterval(() => refreshShared(token), 10000);
      return;
    }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (d.status === 'error') {
      document.getElementById('dr-result').innerHTML = `
        <div class="card"><div class="muted">❌ 調査失敗: ${escapeHtml(d.error_msg || '不明なエラー')}</div></div>`;
      return;
    }
    document.getElementById('dr-share-toggle')?.addEventListener('change', async (e) => {
      try {
        await patch('/api/ai/deep_research/' + d.id, { is_shared: e.target.checked });
        toast(e.target.checked ? '公開しました' : '公開を停止しました');
        refreshShared(token);
      } catch (err) {
        toast('失敗: ' + err.message);
        e.target.checked = !e.target.checked;
      }
    });
    paintResult(d);
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`;
  }
}

function paintResult(d) {
  const r = d.result || {};
  const u = d.usage || {};
  const root = document.getElementById('dr-result');
  root.innerHTML = `
    ${u.total_tokens || u.search_count ? `
      <div class="card" style="background:#faf5ff">
        <div style="font-size:12px; color:#6b21a8">
          📊 使用量: 入力 ${u.input_tokens || 0} tok ・ 出力 ${u.output_tokens || 0} tok ・ 合計 ${u.total_tokens || 0} tok ・ Web 検索 ${u.search_count || 0} 回
        </div>
      </div>` : ''}

    ${r.query_understanding ? `
      <div class="card">
        <div class="bold" style="color:var(--primary)">🧐 クエリの理解</div>
        <div style="font-size:13.5px; line-height:1.75; margin-top:4px; white-space:pre-wrap">${escapeHtml(r.query_understanding)}</div>
      </div>` : ''}

    ${r.sub_questions && r.sub_questions.length ? `
      <div class="card">
        <div class="bold" style="color:var(--primary)">🧩 立てたサブ問い</div>
        <ul style="margin:6px 0 0 0; padding-left:20px; font-size:13.5px; line-height:1.7">
          ${r.sub_questions.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')}
        </ul>
      </div>` : ''}

    ${r.summary ? `
      <div class="card" style="border:2px solid var(--primary)">
        <div class="bold" style="color:var(--primary); font-size:15px">📝 全体まとめ</div>
        <div style="font-size:14px; line-height:1.8; margin-top:6px; white-space:pre-wrap">${escapeHtml(r.summary)}</div>
      </div>` : ''}

    ${r.key_findings && r.key_findings.length ? `
      <div class="card">
        <div class="bold" style="color:#15803d">💡 重要発見・主張</div>
        <ul style="margin:6px 0 0 0; padding-left:20px; font-size:13.5px; line-height:1.75">
          ${r.key_findings.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')}
        </ul>
      </div>` : ''}

    ${r.sections && r.sections.length ? `
      <div class="card">
        <div class="bold" style="color:var(--primary); font-size:15px; margin-bottom:6px">📚 セクション別調査結果</div>
        <div style="display:flex; flex-direction:column; gap:14px">
          ${r.sections.map(sec => `
            <div style="padding:10px 12px; border-left:3px solid var(--primary); background:#fafafa; border-radius:0 6px 6px 0">
              <div class="bold" style="font-size:14px; color:var(--primary)">${escapeHtml(sec.heading || '')}</div>
              <div style="font-size:13.5px; line-height:1.75; margin-top:6px; white-space:pre-wrap">${escapeHtml(sec.body || '')}</div>
              ${sec.sources && sec.sources.length ? `
                <div style="margin-top:8px">
                  <div class="bold" style="font-size:12px; color:#4f46e5">📎 このセクションの出典</div>
                  <ul style="margin:3px 0 0 0; padding-left:20px; font-size:12.5px; line-height:1.7">
                    ${sec.sources.map(src => `<li>${renderSourceMeta(src)}<br><a href="${escapeHtml(src.url || '')}" target="_blank" rel="noopener" style="word-break:break-all">${escapeHtml(src.url || '')}</a></li>`).join('')}
                  </ul>
                </div>` : ''}
            </div>`).join('')}
        </div>
      </div>` : ''}

    ${r.open_questions && r.open_questions.length ? `
      <div class="card">
        <div class="bold" style="color:#a16207">❓ まだ残っている問い</div>
        <ul style="margin:6px 0 0 0; padding-left:20px; font-size:13.5px; line-height:1.75">
          ${r.open_questions.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')}
        </ul>
      </div>` : ''}

    ${r.all_sources && r.all_sources.length ? `
      <div class="card">
        <div class="bold" style="color:#4f46e5">📚 全出典一覧</div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:6px">
          ${r.all_sources.map(src => `
            <div style="padding:6px 10px; background:#eef2ff; border-radius:6px; font-size:12.5px">
              <div class="bold" style="color:#4f46e5">${escapeHtml(src.label || '')}</div>
              ${renderSourceMeta(src, true)}
              <div style="margin-top:2px"><a href="${escapeHtml(src.url || '')}" target="_blank" rel="noopener" style="word-break:break-all">${escapeHtml(src.url || '')}</a></div>
              ${src.why ? `<div style="font-size:12px; color:#374151; margin-top:2px">${escapeHtml(src.why)}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>` : ''}
  `;
}

function renderSourceMeta(src, asBlock = false) {
  if (!src) return '';
  const parts = [];
  if (src.first_author) parts.push(`<b>${escapeHtml(src.first_author)}</b>`);
  if (src.title)        parts.push(escapeHtml(src.title));
  if (src.venue)        parts.push(`<span style="color:#6b7280">${escapeHtml(src.venue)}</span>`);
  if (!parts.length) return '';
  return asBlock
    ? `<div style="margin-top:2px; font-size:12.5px">${parts.join(' / ')}</div>`
    : `<span>${parts.join(' / ')}</span>`;
}
