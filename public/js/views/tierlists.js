// /#/tierlists — ティア表 (Tier List)。 v549 #210。
//   起案者がお題 + 候補リスト → 参加者が S/A/B/C/D/F に振り分け → 提出後 他人の表が見える。

import { get, post, put, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

export async function renderTierlists() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">🎯 ティア表</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/tierlists/new">＋ 新規</a>
      </div>
    </div>
    <div id="tl-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/tierlists');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('tl-list').innerHTML = '<div class="empty">まだティア表がありません。 「＋ 新規」 から作ってみてください。</div>';
      return;
    }
    document.getElementById('tl-list').innerHTML = items.map(t => `
      <a class="list-item" href="#/tierlists/${t.id}" style="gap:8px; align-items:center">
        <span style="display:inline-flex; flex:none">${avatarHtml(t.creator_name, t.creator_avatar, 'sm')}</span>
        <div class="grow">
          <div class="bold">${escapeHtml(t.title)}
            ${t.is_closed ? '<span class="tag muted">締切</span>' : ''}
            ${t.my_answered ? '<span class="tag ok">回答済</span>' : ''}
          </div>
          <div class="meta">${escapeHtml(t.creator_name)} · ${t.answer_count} 人が回答</div>
        </div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('tl-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderTierlistNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/tierlists" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🎯 ティア表 — 新規作成</h2>
      <label class="field">
        <span class="lbl">お題 (タイトル)</span>
        <input type="text" id="tl-title" maxlength="200" placeholder="例: 中村研究室で食べたいランチ">
      </label>
      <label class="field">
        <span class="lbl">説明 (任意)</span>
        <textarea id="tl-desc" maxlength="500" rows="2"></textarea>
      </label>
      <label class="field">
        <span class="lbl">候補 (1 行 1 候補、 改行区切り、 最大 200 件)</span>
        <textarea id="tl-items" rows="10" maxlength="20000" placeholder="例:&#10;ラーメン花月&#10;マック&#10;サブウェイ&#10;松屋"></textarea>
        <div class="hint-sm">後で 「他の人の表を見る」 から 一覧で 集計 (各候補が どの段階に いくつ振り分けられたか) を確認できます。</div>
      </label>
      <div class="row" style="margin-top:10px; gap:6px; justify-content:flex-end">
        <a href="#/tierlists" class="btn">キャンセル</a>
        <button id="tl-go" class="primary">作成</button>
      </div>
    </div>
  `;
  document.getElementById('tl-go').addEventListener('click', async () => {
    const title = document.getElementById('tl-title').value.trim();
    if (!title) { toast('タイトルを入れてください'); return; }
    const desc  = document.getElementById('tl-desc').value.trim();
    const raw   = document.getElementById('tl-items').value;
    const items = raw.split(/\r?\n/).map(s => s.trim()).filter(s => s).map(label => ({ label }));
    if (!items.length) { toast('候補を 1 つ以上入れてください'); return; }
    const btn = document.getElementById('tl-go');
    btn.disabled = true; btn.textContent = '作成中…';
    try {
      const r = await post('/api/tierlists', { title, description: desc || null, items });
      navigate('#/tierlists/' + r.id);
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = '作成';
    }
  });
}

// Detail: 自分の回答 (編集可) と 集計結果 (他の人の回答が 集約されたもの) を表示
export async function renderTierlistDetail({ params }) {
  const tid = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="muted">読み込み中…</div></div>`;
  let d;
  try { d = await get('/api/tierlists/' + tid); }
  catch (e) { app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`; return; }
  const tiers = d.tiers || [];
  const items = d.items || [];
  // 自分の現在の割り当て (item id → tier key)
  let my = (d.my_answer && d.my_answer.assignments) || {};
  if (Array.isArray(my)) my = {};
  app.innerHTML = `
    <div class="card">
      <a href="#/tierlists" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🎯 ${escapeHtml(d.title)}
        ${d.is_closed ? '<span class="tag muted">締切</span>' : ''}
      </h2>
      ${d.description ? `<div class="meta">${escapeHtml(d.description)}</div>` : ''}
      <div class="meta">${escapeHtml(d.creator_name)} 起案 · ${d.answer_count} 人が回答</div>
      ${d.is_creator && !d.is_closed ? `<div style="text-align:right; margin-top:6px"><button id="tl-close" class="btn" style="font-size:11px; padding:2px 8px">締切る</button></div>` : ''}
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">✏️ あなたの回答</div>
      <div class="hint-sm" style="margin-bottom:6px">候補ボタンをタップすると 段階が回ります (S → A → B → C → D → F → 未配置)。</div>
      <div id="tl-board"></div>
      <div class="row" style="gap:6px; margin-top:10px; justify-content:flex-end">
        <button id="tl-save" class="primary"${d.is_closed ? ' disabled' : ''}>${d.my_answer ? '更新を保存' : '回答する'}</button>
      </div>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📊 集計 (全員 = ${d.answer_count} 人)</div>
      <div id="tl-agg"></div>
    </div>
    ${d.other_answers.length ? `<div class="card">
      <div class="bold" style="margin-bottom:6px">👥 他の人の回答</div>
      <div id="tl-others" class="list"></div>
    </div>` : ''}
  `;
  if (d.is_creator && !d.is_closed) {
    document.getElementById('tl-close').addEventListener('click', async () => {
      if (!confirm('回答受付を締切りますか?')) return;
      try { await post('/api/tierlists/' + tid + '/close', {}); await renderTierlistDetail({ params: { id: tid } }); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  }
  paintBoard(d, items, tiers, my);
  paintAggregation(d, items, tiers);
  if (d.other_answers.length) paintOthers(d, items, tiers);
  document.getElementById('tl-save').addEventListener('click', async () => {
    const btn = document.getElementById('tl-save');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      await put('/api/tierlists/' + tid + '/answer', { assignments: my });
      toast('保存しました');
      await renderTierlistDetail({ params: { id: tid } });
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = '更新を保存';
    }
  });
}

function paintBoard(d, items, tiers, my) {
  const board = document.getElementById('tl-board');
  if (!board) return;
  const slots = [...tiers.map(t => ({ key: t.key, label: t.label, color: t.color })), { key: '', label: '未', color: '#888' }];
  board.innerHTML = slots.map(s => `
    <div class="tl-row" data-tier="${escapeHtml(s.key)}" style="display:flex; gap:6px; align-items:center; margin-bottom:4px; min-height:38px; padding:4px 6px; background:${s.color}22; border-left:4px solid ${s.color}; border-radius:6px">
      <div style="width:32px; text-align:center; font-weight:700; color:${s.color}; font-size:16px; flex:none">${escapeHtml(s.label)}</div>
      <div class="tl-row-items" style="display:flex; flex-wrap:wrap; gap:4px; flex:1; min-height:30px"></div>
    </div>
  `).join('');
  const rows = Object.fromEntries([...board.querySelectorAll('.tl-row')].map(r => [r.dataset.tier, r.querySelector('.tl-row-items')]));
  for (const it of items) {
    const tk = my[it.id] || '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tl-chip';
    btn.dataset.iid = it.id;
    btn.style.cssText = 'padding:4px 10px; background:#fff; border:1px solid #ccc; border-radius:6px; font-size:13px; cursor:pointer';
    btn.textContent = it.label;
    if (!d.is_closed) {
      btn.addEventListener('click', () => {
        const order = [...tiers.map(t => t.key), ''];
        const cur = my[it.id] || '';
        const idx = order.indexOf(cur);
        const next = order[(idx + 1) % order.length];
        if (next) my[it.id] = next; else delete my[it.id];
        paintBoard(d, items, tiers, my);
      });
    }
    rows[tk]?.appendChild(btn);
  }
}

function paintAggregation(d, items, tiers) {
  const root = document.getElementById('tl-agg');
  if (!root) return;
  const total = Math.max(1, d.answer_count);
  root.innerHTML = items.map(it => {
    const counts = (d.aggregation && d.aggregation[it.id]) || {};
    const bars = tiers.map(t => {
      const n = counts[t.key] || 0;
      const pct = Math.round(n * 100 / total);
      return n > 0 ? `<span title="${escapeHtml(t.label)} ${n}人" style="background:${t.color}; height:14px; width:${pct}%; display:inline-block; min-width:${n > 0 ? 8 : 0}px"></span>` : '';
    }).join('');
    return `
      <div style="margin-bottom:8px">
        <div style="font-size:13px; margin-bottom:2px">${escapeHtml(it.label)}</div>
        <div style="display:flex; height:14px; border-radius:4px; overflow:hidden; background:#eee">${bars}</div>
        <div class="meta" style="font-size:10px; margin-top:2px">
          ${tiers.map(t => `<span style="color:${t.color}">${escapeHtml(t.label)}:${counts[t.key] || 0}</span>`).join(' / ')}
        </div>
      </div>`;
  }).join('');
}

function paintOthers(d, items, tiers) {
  const root = document.getElementById('tl-others');
  if (!root) return;
  root.innerHTML = d.other_answers.map(a => {
    const lines = tiers.map(t => {
      const labels = items.filter(it => (a.assignments[it.id]) === t.key).map(it => escapeHtml(it.label));
      if (!labels.length) return '';
      return `<div style="font-size:12px; padding:2px 0"><span style="display:inline-block; min-width:24px; color:${t.color}; font-weight:700; text-align:center">${escapeHtml(t.label)}</span> ${labels.join(' · ')}</div>`;
    }).filter(s => s).join('');
    return `
      <div class="list-item" style="align-items:flex-start; gap:8px">
        <span style="display:inline-flex; flex:none">${avatarHtml(a.display_name, a.avatar_url, 'sm')}</span>
        <div class="grow">
          <div class="bold" style="font-size:13px">${escapeHtml(a.display_name)}</div>
          ${lines}
        </div>
      </div>`;
  }).join('');
}
