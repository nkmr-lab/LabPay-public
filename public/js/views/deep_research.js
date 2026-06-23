// /#/deep-research — Deep Research (v781 #376)。
//   ChatGPT の Deep Research を 真似た 多段 Web 調査。 OpenAI Responses API +
//   web_search ツール で 横断 検索 し、 構造化 レポート + 出典 URL 一覧 を 返す。
//   深さ 3 段階 (light 100pt / standard 250pt / deep 500pt)、 結果 は token URL で 共有可。
//
// 使い方:
//   1. クエリ + 深さ を 選ぶ → 「🔎 調査 開始」
//   2. 結果 ページ に 遷移、 status=pending/processing なら 10 秒 ごと に polling
//   3. done に なれ ば レポート + 出典 が 表示 される

import { get, post, del, patch } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

let cachedSettings = null;

export async function renderDeepResearch() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🔎 Deep Research</h2>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        クエリ を 入力 する と、 OpenAI が Web を 横断 検索 して 構造化 レポート + 出典 を 日本語 で 返します。
        ChatGPT の Deep Research を 真似た 機能 で、 深さ に 応じて ポイント が 変動 します。
      </p>
    </div>
    <div class="card">
      <label class="field">
        <span class="lbl">🧐 調査 したい こと</span>
        <textarea id="dr-query" rows="4" maxlength="4000" placeholder="例: 「2026 年 時点 の 視線 追跡 (eye tracking) センサ の 民生 機器 で の 採用 状況 と、 主要 メーカ の 技術 トレンド を 整理 して」"></textarea>
        <div class="hint-sm" style="font-size:11px; margin-top:4px">範囲 が 広 すぎ ない、 一文 〜 数文 で 具体的 に 書く と 質 が 上がります。</div>
      </label>
      <label class="field">
        <span class="lbl">⚙️ 深さ</span>
        <select id="dr-depth"><option value="">読み込み中…</option></select>
        <div class="hint-sm" id="dr-cost-info" style="font-size:12px; margin-top:4px; color:#6b21a8"></div>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="dr-go" class="primary" disabled>🔎 調査 開始</button>
      </div>
    </div>
    <div id="dr-result"></div>
    <div id="dr-history" class="card" style="margin-top:8px"><div class="muted">過去 の Deep Research 履歴…</div></div>
    <div class="card" style="margin-top:8px">
      <div class="bold" style="font-size:14px; margin-bottom:6px">🌐 みんなの 公開 Deep Research</div>
      <div class="row" style="gap:6px; margin-bottom:6px">
        <input type="text" id="dr-shared-q" placeholder="キーワード で 検索 (空欄 で 最新 100 件)" style="flex:1">
        <button id="dr-shared-go">検索</button>
      </div>
      <div id="dr-shared-list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  await loadSettings();
  await loadHistory();
  await loadSharedList('');
  document.getElementById('dr-go').addEventListener('click', go);
  document.getElementById('dr-shared-go').addEventListener('click', () => {
    const q = (document.getElementById('dr-shared-q').value || '').trim();
    loadSharedList(q);
  });
  document.getElementById('dr-shared-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = (document.getElementById('dr-shared-q').value || '').trim();
      loadSharedList(q);
    }
  });
}

async function loadSharedList(q) {
  const root = document.getElementById('dr-shared-list');
  if (!root) return;
  try {
    const url = '/api/ai/deep_research/shared' + (q ? '?q=' + encodeURIComponent(q) : '');
    const d = await get(url);
    if (!d.items || !d.items.length) {
      root.innerHTML = `<div class="muted">${q ? '「' + escapeHtml(q) + '」 に 該当 する 公開 Deep Research は ありません' : '公開 されて いる Deep Research は まだ ありません'}</div>`;
      return;
    }
    root.innerHTML = `<div style="display:flex; flex-direction:column; gap:6px">
      ${d.items.map(r => `
        <a class="list-item" href="#/deep-research/r/${escapeHtml(r.share_token)}" style="flex-direction:column; align-items:stretch; text-decoration:none; color:inherit">
          <div style="display:flex; align-items:center; gap:6px">
            ${avatarHtml(r.author_name, r.author_avatar, 'xs')}
            <span class="bold" style="font-size:13px">${escapeHtml(r.author_name || '')}</span>
            <span class="meta" style="font-size:11px; margin-left:auto">${escapeHtml(r.depth || '')} ・ ${r.cost_points}pt ・ ${escapeHtml(r.shared_at || '')}</span>
          </div>
          <div style="font-size:13.5px; margin-top:4px; font-weight:600">🔎 ${escapeHtml(r.query_short)}</div>
          ${r.summary_short ? `<div style="font-size:12.5px; margin-top:3px; color:#374151; line-height:1.6">${escapeHtml(r.summary_short)}…</div>` : ''}
        </a>`).join('')}
    </div>`;
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function loadSettings() {
  try { cachedSettings = await get('/api/ai/deep_research'); }
  catch (e) { toast('設定 読込 失敗: ' + e.message); return; }
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
      if (info) info.textContent = `選択中: ${t.label} ・ 1 回 ${t.cost}pt (深さ により 1-15 分)`;
      if (btn) btn.textContent = `🔎 調査 開始 (${t.cost}pt)`;
    };
    sel.addEventListener('change', refresh);
    refresh();
    btn.disabled = false;
  }
}

async function loadHistory() {
  const root = document.getElementById('dr-history');
  try {
    const d = await get('/api/ai/deep_research');
    if (!d.items || !d.items.length) {
      root.innerHTML = `<div class="muted">過去 の 履歴 は ありません</div>`;
      return;
    }
    root.innerHTML = `
      <div class="bold" style="margin-bottom:6px">📚 自分 の 履歴</div>
      <div style="display:flex; flex-direction:column; gap:4px">
        ${d.items.map(r => `
          <div style="display:flex; align-items:center; gap:6px; padding:4px 8px; border-radius:6px; background:#fafafa">
            <a class="grow" href="#/deep-research/r/${escapeHtml(r.share_token)}" style="text-decoration:none; color:inherit; min-width:0; flex:1">
              <div style="font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${r.is_shared ? '🌐 ' : ''}${escapeHtml(r.query_short)}</div>
              <div class="meta" style="font-size:11px">${escapeHtml(r.depth)} ・ ${escapeHtml(r.model)} ・ ${r.cost_points}pt ・ ${escapeHtml(r.status)} ・ ${escapeHtml(r.created_at || '')}</div>
            </a>
            <button class="ghost" data-del="${r.id}" title="削除" style="font-size:14px; padding:2px 8px">🗑</button>
          </div>`).join('')}
      </div>`;
    root.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', async ev => {
        ev.preventDefault();
        if (!confirm('この 履歴 を 削除 しますか?')) return;
        try {
          await del('/api/ai/deep_research/' + b.dataset.del);
          await loadHistory();
        } catch (e) { toast('削除 失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function go() {
  const query = (document.getElementById('dr-query').value || '').trim();
  if (!query) { toast('クエリ を 入力 して ください'); return; }
  const depth = document.getElementById('dr-depth').value || 'standard';
  const btn = document.getElementById('dr-go');
  btn.disabled = true; btn.textContent = '⏳ 依頼 中…';
  const root = document.getElementById('dr-result');
  root.innerHTML = '<div class="card"><div class="muted">⏳ OpenAI に 依頼 中…</div></div>';
  try {
    const r = await post('/api/ai/deep_research', { query, depth });
    location.hash = '#/deep-research/r/' + r.share_token;
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="muted">失敗: ${escapeHtml(e.message)}</div></div>`;
    btn.disabled = false;
    btn.textContent = '🔎 調査 開始';
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
  // v798 別 ページ に 移って いる なら 触らず timer 自殺 (= 強制 引き 戻し 防止)
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
          <span>🌐 みんな に 公開 (他 メンバ が キーワード 検索 で 見つけ られる ように する)</span>
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
          <div class="bold" style="font-size:16px; color:var(--primary)">⏳ Web を 横断 調査 中…</div>
          <p class="hint" style="font-size:13px; margin-top:6px">
            深さ に より 1-30 分 程度 かかります。 この ページ を 閉じて も 大丈夫 (完了 したら 通知 が 届きます)。<br>
            10 秒 ごと に 自動 更新。
          </p>
          ${d.progress_text ? `
            <div style="margin-top:10px; padding:10px 14px; background:#f0f9ff; border-left:4px solid #0284c7; border-radius:0 6px 6px 0">
              <div class="bold" style="font-size:13px; color:#0284c7">📡 現在 の 状況</div>
              <div style="font-size:13.5px; margin-top:4px">${escapeHtml(d.progress_text)}</div>
            </div>` : ''}
        </div>`;
      if (!pollTimer) pollTimer = setInterval(() => refreshShared(token), 10000);
      return;
    }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (d.status === 'error') {
      document.getElementById('dr-result').innerHTML = `
        <div class="card"><div class="muted">❌ 調査 失敗: ${escapeHtml(d.error_msg || '不明 な エラー')}</div></div>`;
      return;
    }
    // v784 #382 公開 切替
    document.getElementById('dr-share-toggle')?.addEventListener('change', async (e) => {
      try {
        await patch('/api/ai/deep_research/' + d.id, { is_shared: e.target.checked });
        toast(e.target.checked ? '公開 しました' : '公開 を 停止 しました');
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
        <div class="bold" style="color:var(--primary)">🧐 クエリ の 理解</div>
        <div style="font-size:13.5px; line-height:1.75; margin-top:4px; white-space:pre-wrap">${escapeHtml(r.query_understanding)}</div>
      </div>` : ''}

    ${r.sub_questions && r.sub_questions.length ? `
      <div class="card">
        <div class="bold" style="color:var(--primary)">🧩 立てた サブ 問い</div>
        <ul style="margin:6px 0 0 0; padding-left:20px; font-size:13.5px; line-height:1.7">
          ${r.sub_questions.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')}
        </ul>
      </div>` : ''}

    ${r.summary ? `
      <div class="card" style="border:2px solid var(--primary)">
        <div class="bold" style="color:var(--primary); font-size:15px">📝 全体 まとめ</div>
        <div style="font-size:14px; line-height:1.8; margin-top:6px; white-space:pre-wrap">${escapeHtml(r.summary)}</div>
      </div>` : ''}

    ${r.key_findings && r.key_findings.length ? `
      <div class="card">
        <div class="bold" style="color:#15803d">💡 重要 発見・主張</div>
        <ul style="margin:6px 0 0 0; padding-left:20px; font-size:13.5px; line-height:1.75">
          ${r.key_findings.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')}
        </ul>
      </div>` : ''}

    ${r.sections && r.sections.length ? `
      <div class="card">
        <div class="bold" style="color:var(--primary); font-size:15px; margin-bottom:6px">📚 セクション 別 調査 結果</div>
        <div style="display:flex; flex-direction:column; gap:14px">
          ${r.sections.map(sec => `
            <div style="padding:10px 12px; border-left:3px solid var(--primary); background:#fafafa; border-radius:0 6px 6px 0">
              <div class="bold" style="font-size:14px; color:var(--primary)">${escapeHtml(sec.heading || '')}</div>
              <div style="font-size:13.5px; line-height:1.75; margin-top:6px; white-space:pre-wrap">${escapeHtml(sec.body || '')}</div>
              ${sec.sources && sec.sources.length ? `
                <div style="margin-top:8px">
                  <div class="bold" style="font-size:12px; color:#4f46e5">📎 このセクションの 出典</div>
                  <ul style="margin:3px 0 0 0; padding-left:20px; font-size:12.5px; line-height:1.7">
                    ${sec.sources.map(src => `<li>${renderSourceMeta(src)}<br><a href="${escapeHtml(src.url || '')}" target="_blank" rel="noopener" style="word-break:break-all">${escapeHtml(src.url || '')}</a></li>`).join('')}
                  </ul>
                </div>` : ''}
            </div>`).join('')}
        </div>
      </div>` : ''}

    ${r.open_questions && r.open_questions.length ? `
      <div class="card">
        <div class="bold" style="color:#a16207">❓ まだ 残って いる 問い</div>
        <ul style="margin:6px 0 0 0; padding-left:20px; font-size:13.5px; line-height:1.75">
          ${r.open_questions.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')}
        </ul>
      </div>` : ''}

    ${r.all_sources && r.all_sources.length ? `
      <div class="card">
        <div class="bold" style="color:#4f46e5">📚 全 出典 一覧</div>
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

// v787 #385 出典 の メタ情報 (第一 著者 / タイトル / 投稿先) を 整形 して 表示。
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
