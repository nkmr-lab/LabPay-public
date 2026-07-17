// v1141 修正 TODO チェックリスト (paper_review / resume_check / exp_plan で共通利用)。
// 中村さん要望「査読結果や原稿チェックの結果で、修正するべき点をチェックボックスにして
// おいて、画面上部に配置しよう。 で、そのチェックボックスで進捗を管理できるように
// しよう (これは他者ともシェア)。 また、そのTODOリストを、自身のTODOに放り込む機能を追加」

import { get, post, patch } from './api.js';
import { escapeHtml, navigate } from './router.js';
import { toast, state } from './app.js';

// v1144 「🔬 この結果について AI と話す」ボタンを結果ページ上部に配置するヘルパ。
//   押すと 研究 AI サブスクの新規スレッドを作成 (seed_source_type + seed_source_id を渡す)、
//   スレッド画面に遷移する。 未加入なら加入導線へ。
export function renderAskAiButton(rootEl, { sourceType, sourceId, title }) {
  if (!rootEl) return;
  rootEl.innerHTML = `
    <button class="btn primary" id="ask-ai-btn" style="font-size:13px; padding:6px 14px">
      🔬 この結果について AI と話す
    </button>
    <span class="hint-sm" style="font-size:11px; margin-left:6px; color:#6b7280">
      (研究 AI サブスクの新規スレッドが立ちます。 元結果の要約が context として自動で入ります)
    </span>
  `;
  document.getElementById('ask-ai-btn').addEventListener('click', async () => {
    const btn = document.getElementById('ask-ai-btn');
    btn.disabled = true; btn.textContent = '⌛ スレッド作成中…';
    try {
      const r = await post('/api/research-ai/threads', {
        title: (title ? String(title).slice(0, 60) : 'AI 結果について') + ' について AI と話す',
        template_key: 'freetalk',
        seed_source_type: sourceType,
        seed_source_id: sourceId,
      });
      navigate('#/research-ai');
      // research_ai.js は URL params でスレッド指定はしていないので、少し待って選択させる代替:
      //   グローバル state に格納して開くのが望ましいが、簡便に localStorage を使って
      //   research_ai 側で「開いてほしいスレッド」を拾わせる。
      try { localStorage.setItem('labpay-rai-open-tid', String(r.id)); } catch(_) {}
    } catch (e) {
      btn.disabled = false; btn.textContent = '🔬 この結果について AI と話す';
      if (e.message?.includes('403')) {
        if (confirm('研究 AI サブスク未加入です。 サブスクページへ移動しますか?')) location.hash = '#/research-ai';
      } else {
        toast('失敗: ' + e.message);
      }
    }
  });
}

// AI 結果 JSON から「修正すべき点」候補を安定 key 付きで抽出。
//   source_type ごとにフィールドの意味が違うので分岐。
//   item_key はサーバ側で UNIQUE (source_type, source_id, item_key)、
//   結果が同じなら再 upsert しても同一行が使い回される。
//   text_snippet は表示用 (500 字上限)。
export function extractChecklistItems(sourceType, resultJson) {
  const out = [];
  const r = resultJson || {};
  const push = (key, text) => {
    if (!text) return;
    const t = String(text).trim();
    if (!t) return;
    out.push({ item_key: key.slice(0, 80), text_snippet: t.slice(0, 500) });
  };

  if (sourceType === 'paper_review') {
    // 論文査読: weaknesses / rewrite_suggestions / revision_to_accept /
    //   response_evaluation.recommended_revisions_to_response / strengthening_analyses /
    //   statistical_validity.issues / citations_check.suspicious_citations
    const rv = r.review || r;
    (rv.weaknesses || []).forEach((w, i) => push(`weakness:${i}`, w));
    (rv.rewrite_suggestions || []).forEach((s, i) => {
      const t = s?.original ? `[書き換え] ${s.original} → ${s.suggested_rewrite_en || s.suggested_rewrite || ''}` : (s?.reason || '');
      push(`rewrite:${i}`, t);
    });
    (rv.revision_to_accept || []).forEach((s, i) => push(`revision:${i}`, s));
    (rv.strengthening_analyses || []).forEach((s, i) => push(`strengthening:${i}`, s));
    (rv.alternatives_when_no_reexp || []).forEach((s, i) => push(`alternative:${i}`, s));
    const sv = rv.statistical_validity;
    if (sv && Array.isArray(sv.issues)) {
      sv.issues.forEach((it, i) => {
        const t = `[統計 ${it?.location || '?'}] ${it?.explanation || ''} → ${it?.suggestion || ''}`;
        push(`stat_issue:${i}`, t);
      });
    }
    const cc = rv.citations_check;
    if (cc && Array.isArray(cc.suspicious_citations)) {
      cc.suspicious_citations.forEach((it, i) => {
        push(`citation:${i}`, `[引用] ${it?.original_citation || ''} — ${it?.explanation || ''}`);
      });
    }
    const re = rv.response_evaluation;
    if (re) {
      (re.missing_points || []).forEach((s, i) => push(`resp_missing:${i}`, `[回答漏れ] ${s}`));
      (re.recommended_revisions_to_response || []).forEach((s, i) => push(`resp_rewrite:${i}`, `[回答書き換え] ${s}`));
      (re.inconsistencies || []).forEach((s, i) => push(`resp_inconsistency:${i}`, `[回答矛盾] ${s}`));
    }
  } else if (sourceType === 'resume_check') {
    // 原稿チェック: next_three_steps / rewrite_suggestions / logical_flow.issues /
    //   japanese_connectives.issues / statistical_validity.issues / jargon_explanation.missing /
    //   citations_check.issues
    (r.next_three_steps || []).forEach((s, i) => push(`step:${i}`, s));
    (r.rewrite_suggestions || []).forEach((s, i) => {
      const t = s?.original ? `[書き換え] ${s.original} → ${s.suggested_rewrite || ''}` : (s?.reason || '');
      push(`rewrite:${i}`, t);
    });
    ['background_validity','logical_flow','jargon_explanation','japanese_connectives','terminology_consistency','citations_check'].forEach(sec => {
      const v = r[sec];
      if (!v) return;
      (v.issues || []).forEach((it, i) => {
        const t = typeof it === 'string' ? it : (it?.original ? `${it.original} → ${it.suggested || ''}` : (it?.explanation || ''));
        push(`${sec}:${i}`, `[${sec}] ${t}`);
      });
      (v.missing || []).forEach((s, i) => push(`${sec}_missing:${i}`, `[${sec} 説明不足] ${s}`));
      (v.variations || []).forEach((s, i) => push(`${sec}_variation:${i}`, `[${sec} 揺れ] ${s}`));
    });
    const sv = r.statistical_validity;
    if (sv && Array.isArray(sv.issues)) {
      sv.issues.forEach((it, i) => {
        const t = `[統計 ${it?.location || '?'}] ${it?.explanation || ''} → ${it?.suggestion || ''}`;
        push(`stat_issue:${i}`, t);
      });
    }
  } else if (sourceType === 'exp_plan') {
    // 実験計画書: next_three_steps + top_priority_fixes + 各セクションの issues
    (r.next_three_steps || []).forEach((s, i) => push(`step:${i}`, s));
    (r.top_priority_fixes || []).forEach((s, i) => push(`priority:${i}`, s));
    ['rq_review','hypothesis_review','hypothesis_experiment_link','data_appropriateness','statistics','sample_size'].forEach(sec => {
      const v = r[sec];
      if (!v || !Array.isArray(v.issues)) return;
      v.issues.forEach((it, i) => {
        const t = `[${sec}] ${it?.issue || ''} → ${it?.suggestion || ''}`;
        push(`${sec}:${i}`, t);
      });
    });
  }
  return out;
}

// 修正 TODO ボックスを結果ページの root に対して差し込む。
//   render(rootEl, { sourceType, sourceId, resultJson })
//   - 結果 JSON から候補を抽出 → サーバに upsert → 一覧を GET → チェックボックス描画
//   - 進捗はサーバ側で永続化 (誰でも見える・触れる)
//   - 各項目に「＋TODO」ボタンで自身の TODO に転送
export async function renderChecklistBox(rootEl, { sourceType, sourceId, resultJson }) {
  if (!rootEl) return;
  const candidates = extractChecklistItems(sourceType, resultJson);
  rootEl.innerHTML = `
    <div class="card" style="background:linear-gradient(180deg,#f5f3ff,#faf7fc); border:2px solid #7b3fa0; border-radius:10px">
      <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:8px; gap:6px; flex-wrap:wrap">
        <div class="bold" style="color:#4a106d; font-size:14px">📝 修正 TODO (他の人ともシェア、 チェックで進捗管理)</div>
        <div class="hint-sm" id="acl-progress" style="font-size:12px; color:#6b7280">読み込み中…</div>
      </div>
      <div id="acl-list" style="display:flex; flex-direction:column; gap:4px"></div>
      <div class="hint-sm" style="font-size:11px; margin-top:6px; color:#6b7280">
        全員が閲覧・チェック可 (共有)。 各項目の「+TODO」で自分の TODO に放り込めます。
      </div>
    </div>
  `;
  try {
    if (candidates.length) {
      await post('/api/ai/checklist', { source_type: sourceType, source_id: sourceId, items: candidates });
    }
    const d = await get('/api/ai/checklist?' + new URLSearchParams({ source_type: sourceType, source_id: String(sourceId) }).toString());
    paintChecklist(d.items || []);
  } catch (e) {
    document.getElementById('acl-list').innerHTML = `<div class="hint-sm" style="color:#dc2626">読み込み失敗: ${escapeHtml(e.message)}</div>`;
    document.getElementById('acl-progress').textContent = '';
  }
}

function paintChecklist(items) {
  const listEl = document.getElementById('acl-list');
  const progEl = document.getElementById('acl-progress');
  if (!listEl || !progEl) return;
  if (!items.length) {
    listEl.innerHTML = '<div class="hint-sm" style="color:#9ca3af">修正候補は検出されませんでした。</div>';
    progEl.textContent = '';
    return;
  }
  const done = items.filter(x => x.checked).length;
  progEl.textContent = `${done} / ${items.length} 完了`;
  const meUid = Number(state.me?.id);
  listEl.innerHTML = items.map(it => {
    const registered = !!it.todo_id && it.todo_by_user_id === meUid;
    return `
      <label class="acl-row" data-id="${it.id}" style="display:flex; gap:6px; align-items:flex-start; padding:6px 8px; background:#fff; border-radius:6px; ${it.checked ? 'opacity:0.6;' : ''}">
        <input type="checkbox" data-acl-check="${it.id}" ${it.checked ? 'checked' : ''} style="flex:none; margin-top:4px">
        <div style="flex:1; min-width:0">
          <div style="font-size:13px; line-height:1.55; white-space:pre-wrap; word-break:break-word; ${it.checked ? 'text-decoration:line-through;' : ''}">${escapeHtml(it.text_snippet)}</div>
          ${it.checked && it.checked_by_name ? `<div class="hint-sm" style="font-size:11px; margin-top:2px; color:#15803d">✓ ${escapeHtml(it.checked_by_name)} が完了</div>` : ''}
        </div>
        <button data-acl-todo="${it.id}" class="btn" style="flex:none; font-size:11px; padding:2px 8px; ${registered ? 'background:#dcfce7; color:#15803d; border-color:#86efac' : ''}" ${registered ? 'disabled' : ''} title="自分の TODO に追加">
          ${registered ? '✓ 追加済' : '+ TODO'}
        </button>
      </label>`;
  }).join('');
  listEl.querySelectorAll('[data-acl-check]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = Number(cb.dataset.aclCheck);
      try {
        const r = await patch('/api/ai/checklist/' + id, { checked: cb.checked });
        // 再読み込みして UI を最新化
        const src = document.getElementById('acl-list')?.closest('[data-checklist-source-type]');
        // シンプルに progress だけ更新
        const rows = document.querySelectorAll('.acl-row');
        const total = rows.length;
        let done = 0;
        rows.forEach(row => {
          const c = row.querySelector('input[type=checkbox]');
          if (c?.checked) done++;
          if (row.dataset.id === String(id)) {
            row.style.opacity = r.checked ? '0.6' : '1';
            const label = row.querySelector('div > div');
            if (label) label.style.textDecoration = r.checked ? 'line-through' : 'none';
          }
        });
        document.getElementById('acl-progress').textContent = `${done} / ${total} 完了`;
      } catch (e) {
        cb.checked = !cb.checked;
        toast('失敗: ' + e.message);
      }
    });
  });
  listEl.querySelectorAll('[data-acl-todo]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = Number(btn.dataset.aclTodo);
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '⌛';
      try {
        const r = await post('/api/ai/checklist/' + id + '/to_todo', {});
        btn.textContent = r.already ? '✓ 追加済' : '✓ 追加済';
        btn.style.background = '#dcfce7';
        btn.style.color = '#15803d';
        btn.style.borderColor = '#86efac';
        toast(r.already ? '既に TODO 追加済' : 'TODO に追加しました');
      } catch (e) {
        btn.disabled = false;
        btn.textContent = orig;
        toast('失敗: ' + e.message);
      }
    });
  });
}
