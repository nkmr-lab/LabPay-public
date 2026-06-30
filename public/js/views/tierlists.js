// /#/tierlists — ティア表 (Tier List)。 v549 #210 / v582 5 段階 (S/A/B/C/D) + 画像対応。
//   起案者がお題 + 候補リスト → 参加者が S/A/B/C/D に振り分け → 提出後他人の表が見える。
//   v582 候補に正方形画像を任意で設定可能 (アップロード or URL)。

import { get, post, put, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { shareToSns } from '../share_to_sns.js';

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
      document.getElementById('tl-list').innerHTML = '<div class="empty">まだティア表がありません。「＋ 新規」から作ってみてください。</div>';
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
      <div class="field">
        <div class="lbl" style="margin-bottom:6px">候補 (任意で正方形画像を各候補に設定可能)</div>
        <div id="tl-items-list" style="display:flex; flex-direction:column; gap:6px"></div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button id="tl-add-item" class="btn" type="button">+ 候補を追加</button>
          <button id="tl-bulk-paste" class="btn" type="button" style="font-size:12px">複数行まとめて貼付け</button>
        </div>
        <div class="hint-sm" style="margin-top:4px">画像アイコンをタップで端末からアップロード (任意)。候補は最大 200 件。</div>
      </div>
      <div class="row" style="margin-top:10px; gap:6px; justify-content:flex-end">
        <a href="#/tierlists" class="btn">キャンセル</a>
        <button id="tl-go" class="primary">作成</button>
      </div>
    </div>
  `;
  // 候補リストの状態 (UI から直接読み出す方式)
  const listRoot = document.getElementById('tl-items-list');
  function addItemRow(label = '', imageUrl = null) {
    const i = listRoot.children.length;
    const row = document.createElement('div');
    row.className = 'tl-new-item';
    row.style.cssText = 'display:flex; gap:6px; align-items:center; padding:4px 0';
    row.innerHTML = `
      <label class="tl-img-pick" data-i="${i}"
             style="position:relative; width:48px; height:48px; flex:none; border:2px dashed #ccc; border-radius:8px;
                    display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden; background:#fafafa">
        <img class="tl-img-preview" alt=""
             style="${imageUrl ? '' : 'display:none'}; width:100%; height:100%; object-fit:cover"
             ${imageUrl ? `src="${escapeHtml(imageUrl)}"` : ''}>
        <span class="tl-img-placeholder" style="${imageUrl ? 'display:none;' : ''} font-size:18px; color:#aaa">🖼</span>
        <input type="file" class="tl-img-input" accept="image/*" hidden>
      </label>
      <input type="text" class="tl-item-label" maxlength="80" value="${escapeHtml(label)}"
             placeholder="例: ラーメン花月" style="flex:1; padding:6px 8px">
      <button type="button" class="tl-item-remove" style="background:none; border:none; color:#c00; font-size:18px; cursor:pointer; padding:0 6px">×</button>
    `;
    const pick    = row.querySelector('.tl-img-pick');
    const fileIn  = row.querySelector('.tl-img-input');
    const preview = row.querySelector('.tl-img-preview');
    const ph      = row.querySelector('.tl-img-placeholder');
    pick.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') fileIn.click();
    });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      if (!f) return;
      ph.textContent = '⏳';
      try {
        const fd = new FormData();
        fd.append('file', f);
        const r = await fetch('/api/uploads/image', {
          method: 'POST', body: fd, credentials: 'same-origin',
          headers: { 'X-Requested-With': 'labpay' },
        }).then(x => x.json());
        if (!r || !r.url) throw new Error(r?.error?.message || 'upload failed');
        preview.src = r.url;
        preview.style.display = '';
        ph.style.display = 'none';
        row.dataset.imageUrl = r.url;
      } catch (e) {
        toast('画像アップロード失敗: ' + (e?.message || e));
        ph.textContent = '🖼';
      }
    });
    row.querySelector('.tl-item-remove').addEventListener('click', () => row.remove());
    if (imageUrl) row.dataset.imageUrl = imageUrl;
    listRoot.appendChild(row);
  }
  // 初期 3 行
  for (let i = 0; i < 3; i++) addItemRow();

  document.getElementById('tl-add-item').addEventListener('click', () => addItemRow());
  document.getElementById('tl-bulk-paste').addEventListener('click', () => {
    const txt = prompt('1 行 = 1 候補。改行区切りで貼り付けてください');
    if (!txt) return;
    txt.split(/\r?\n/).map(s => s.trim()).filter(s => s).forEach(s => addItemRow(s));
  });

  document.getElementById('tl-go').addEventListener('click', async () => {
    const title = document.getElementById('tl-title').value.trim();
    if (!title) { toast('タイトルを入れてください'); return; }
    const desc  = document.getElementById('tl-desc').value.trim();
    const items = [...listRoot.querySelectorAll('.tl-new-item')]
      .map(row => ({
        label: row.querySelector('.tl-item-label').value.trim(),
        image_url: row.dataset.imageUrl || null,
      }))
      .filter(it => it.label);
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

// Detail: 自分の回答 (編集可) と集計結果 (他の人の回答が集約されたもの) を表示
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
      <div style="display:flex; align-items:center; gap:8px; margin:6px 0">
        <h2 style="margin:0; flex:1">🎯 ${escapeHtml(d.title)}
          ${d.is_closed ? '<span class="tag muted">締切</span>' : ''}
        </h2>
        <button id="tl-share" class="btn" style="font-size:12px; padding:4px 8px">💬 共有</button>
      </div>
      ${d.description ? `<div class="meta">${escapeHtml(d.description)}</div>` : ''}
      <div class="meta">${escapeHtml(d.creator_name)} 起案 · ${d.answer_count} 人が回答</div>
      ${d.is_creator && !d.is_closed ? `<div style="text-align:right; margin-top:6px"><button id="tl-close" class="btn" style="font-size:11px; padding:2px 8px">締切る</button></div>` : ''}
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">✏️ あなたの回答</div>
      <div class="hint-sm" style="margin-bottom:6px">候補を <b>ドラッグ</b> で行を移動 (タップで段階を回すこともできます)。「?」は「行ってない / 評価不能」の意味で使ってください。</div>
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
  document.getElementById('tl-share')?.addEventListener('click', () => {
    shareToSns(`🎯 ティア表「${d.title}」 ${d.is_closed ? '結果' : '回答募集中'} (${d.answer_count} 人回答)`, `#/tierlists/${tid}`);
  });
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
  // v815 #410 サーバが tiers 末尾に「?」 (評価不能) を追加して返す。「未」 (未配置) と
  //   「?」 (行ってない / 評価不能) は別物として残す。
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
    if (it.image_url) {
      btn.style.cssText = 'padding:0; background:#fff; border:1px solid #ccc; border-radius:6px; cursor:grab; touch-action:none; display:inline-flex; flex-direction:column; align-items:center; overflow:hidden; width:72px; user-select:none';
      btn.innerHTML = `
        <img src="${escapeHtml(it.image_url)}" alt="" loading="lazy" draggable="false"
             style="width:72px; height:72px; object-fit:cover; display:block; pointer-events:none">
        <span style="font-size:11px; padding:2px 4px; line-height:1.2; text-align:center; max-width:100%; overflow:hidden; text-overflow:ellipsis; pointer-events:none">${escapeHtml(it.label)}</span>
      `;
    } else {
      btn.style.cssText = 'padding:4px 10px; background:#fff; border:1px solid #ccc; border-radius:6px; font-size:13px; cursor:grab; touch-action:none; user-select:none';
      btn.textContent = it.label;
    }
    if (!d.is_closed) {
      // v815 #409 ドラッグアンドドロップ (pointer events で desktop + touch を統一)
      attachTierChipDnd(btn, it.id, d, items, tiers, my);
      // 既存の「タップで段階を回す」動作も残す (DnD で動かなかった時 = pointertap)
      btn.addEventListener('click', (ev) => {
        if (btn.dataset.dragged === '1') {
          btn.dataset.dragged = '';
          ev.preventDefault();
          return;
        }
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

// v815 #409 ティアチップの DnD。 pointer events で desktop / mobile 共通に。
//   - pointerdown でゴースト要素を作って体感ドラッグ
//   - pointermove で elementFromPoint → 最近接の .tl-row をハイライト
//   - pointerup で該当 row の data-tier を my[iid] に反映 → 再描画
//   - 5 px 未満の移動で終わったらクリック (= 段階を回す) として扱う
function attachTierChipDnd(btn, iid, d, items, tiers, my) {
  btn.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return; // 左クリック / 主ポインタのみ
    ev.preventDefault();
    const startX = ev.clientX, startY = ev.clientY;
    const rect = btn.getBoundingClientRect();
    const offX = startX - rect.left, offY = startY - rect.top;
    let moved = false;
    let lastTarget = null;
    // ゴースト (元を半透明に、 cursor 追従のクローンを body に append)
    const ghost = btn.cloneNode(true);
    ghost.style.position = 'fixed';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.zIndex = 9999;
    ghost.style.pointerEvents = 'none';
    ghost.style.opacity = '0.85';
    ghost.style.transform = 'scale(1.05)';
    ghost.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
    document.body.appendChild(ghost);
    btn.style.opacity = '0.3';
    const findRow = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest?.('.tl-row');
    };
    const onMove = (e) => {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && (Math.abs(dx) + Math.abs(dy)) > 5) moved = true;
      ghost.style.left = (e.clientX - offX) + 'px';
      ghost.style.top  = (e.clientY - offY) + 'px';
      const row = findRow(e.clientX, e.clientY);
      if (row !== lastTarget) {
        if (lastTarget) lastTarget.style.outline = '';
        if (row) row.style.outline = '2px dashed #a855f7';
        lastTarget = row;
      }
    };
    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      ghost.remove();
      btn.style.opacity = '';
      if (lastTarget) lastTarget.style.outline = '';
      if (!moved) return; // click → cycle に任せる
      btn.dataset.dragged = '1';
      const row = findRow(e.clientX, e.clientY);
      if (!row) return;
      const tier = row.dataset.tier || '';
      if (tier) my[iid] = tier; else delete my[iid];
      paintBoard(d, items, tiers, my);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
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
