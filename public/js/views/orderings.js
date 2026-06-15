// /#/orderings — 順番決め (発表順 / 当番割 など)。
// v523 #160 ルーレット (1 人選ぶ) の全員順列版。 タイトル + メンバー指定 → 並び替え
//   結果を保存 + 各メンバーに通知。 詳細ページで順番を 1 人ずつめくる演出。
//
// ルート:
//   /#/orderings              一覧 (自分が起案 or 含まれてる)
//   /#/orderings/new          作成フォーム (メンバーピッカー + タイトル)
//   /#/orderings/:id          詳細 (順番表示 + 演出)

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';

export async function renderOrderings() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">📋 順番決め</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/orderings/new">＋ 新規</a>
      </div>
    </div>
    <div id="ord-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/orderings');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('ord-list').innerHTML =
        '<div class="empty">まだ 順番決め はありません。 「＋ 新規」 から作成してください。</div>';
      return;
    }
    document.getElementById('ord-list').innerHTML = items.map(o => {
      const myPosTag = o.my_position
        ? `<span class="tag ok">あなた: ${o.my_position} 番</span>`
        : '';
      return `
        <a class="list-item" href="#/orderings/${o.id}">
          <div class="grow">
            <div class="bold">${escapeHtml(o.title)}</div>
            <div class="meta">${escapeHtml(o.creator_name)} · ${escapeHtml(o.created_at)} · ${o.member_count} 名</div>
          </div>
          ${myPosTag}
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('ord-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderOrderingNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/orderings" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">📋 順番決め — 新規</h2>
      <div style="margin-top:8px">
        <label style="display:block; font-size:13px; margin-bottom:4px">タイトル (例: 「卒研 発表順」)</label>
        <input type="text" id="ord-title" maxlength="200" placeholder="例: 卒業研究 発表順" style="width:100%; box-sizing:border-box">
      </div>
      <div style="margin-top:10px">
        <label style="display:block; font-size:13px; margin-bottom:4px">メンバーを選択</label>
        <div id="ord-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="ord-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div class="row" style="margin-top:10px; gap:6px; justify-content:flex-end">
        <a href="#/orderings" class="btn">キャンセル</a>
        <button id="ord-go" class="primary">🎲 並べ替えを実行</button>
      </div>
    </div>
  `;
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer:  document.getElementById('ord-bulk'),
      chipsContainer: document.getElementById('ord-chips'),
      initial: [],
      excludeIds: [],
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('ord-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  document.getElementById('ord-go').addEventListener('click', async () => {
    const title = document.getElementById('ord-title').value.trim();
    if (!title) { toast('タイトルを入れてください'); return; }
    const ids = picker ? [...picker.getSelected()] : [];
    if (ids.length < 2) { toast('2 名以上選んでください'); return; }
    const btn = document.getElementById('ord-go');
    btn.disabled = true; btn.textContent = '🎲 並べ替え中…';
    try {
      const r = await post('/api/orderings', { title, member_ids: ids });
      navigate('#/orderings/' + r.id);
    } catch (e) {
      toast('失敗: ' + e.message);
      btn.disabled = false; btn.textContent = '🎲 並べ替えを実行';
    }
  });
}

export async function renderOrderingDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="muted">読み込み中…</div></div>`;
  let d;
  try { d = await get('/api/orderings/' + id); }
  catch (e) {
    app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`;
    return;
  }
  const isOwner = state.me?.id === Number(d.creator_user_id);
  const isAdmin = state.me?.role === 'admin';
  const canDelete = isOwner || isAdmin;
  app.innerHTML = `
    <div class="card">
      <a href="#/orderings" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">📋 ${escapeHtml(d.title)}</h2>
      <div class="meta">${escapeHtml(d.creator_name)} · ${escapeHtml(d.created_at)} · ${d.results.length} 名</div>
      ${canDelete ? `<div style="text-align:right; margin-top:6px">
        <button id="ord-del" class="btn danger" style="font-size:11px; padding:2px 8px">🗑 削除</button>
      </div>` : ''}
    </div>
    <div class="card">
      <div id="ord-stage" class="list" style="position:relative; min-height:80px">
        <div class="muted" style="text-align:center; padding:14px">🎲 並べ替え中…</div>
      </div>
      <div style="text-align:center; margin-top:8px; display:flex; gap:6px; justify-content:center; flex-wrap:wrap">
        <button id="ord-skip" class="btn" style="font-size:11px; padding:2px 10px">⏭ 演出スキップ</button>
        <button id="ord-copy" class="btn" style="font-size:11px; padding:2px 10px">📋 結果をテキストでコピー</button>
      </div>
    </div>
  `;
  document.getElementById('ord-copy').addEventListener('click', async () => {
    const lines = [`【${d.title}】`];
    d.results.forEach((r, i) => lines.push(`${i + 1}. ${r.display_name}${r.grade ? ` [${r.grade}]` : ''}`));
    const txt = lines.join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      toast('結果をクリップボードにコピーしました');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('結果をコピーしました'); }
      catch (e) { toast('コピー失敗'); }
      finally { document.body.removeChild(ta); }
    }
  });
  if (canDelete) {
    document.getElementById('ord-del').addEventListener('click', async () => {
      if (!confirm('この 順番決め を削除しますか? (元には戻せません)')) return;
      try { await del('/api/orderings/' + id); navigate('#/orderings'); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  }
  // 演出: 上から順に 1 人ずつ位置確定 (フェードイン)。
  await dramatize(d.results);
  document.getElementById('ord-skip')?.remove();
}

async function dramatize(results) {
  const stage = document.getElementById('ord-stage');
  if (!stage) return;
  stage.innerHTML = '';
  let skipped = false;
  document.getElementById('ord-skip')?.addEventListener('click', () => { skipped = true; });
  for (let i = 0; i < results.length; i++) {
    if (!document.getElementById('ord-stage')) return; // navigated away
    const r = results[i];
    const row = document.createElement('div');
    row.className = 'list-item';
    row.style.cssText = 'opacity:0; transform:translateY(8px); transition:opacity 0.4s, transform 0.4s';
    row.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center; flex:1">
        <div style="flex:none; width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg, #ede4f3, #d6b3e0); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px; color:#4a106d">${r.position}</div>
        <span style="display:inline-flex; flex:none">${avatarHtml(r.display_name, r.avatar_url, 'sm')}</span>
        <div class="bold">${escapeHtml(r.display_name)}</div>
      </div>`;
    stage.appendChild(row);
    requestAnimationFrame(() => {
      row.style.opacity = '1';
      row.style.transform = 'translateY(0)';
    });
    if (!skipped) {
      // 1 名あたり 250-450ms (短くシャープに) — 名前が増えると後半は短くなる
      const wait = Math.max(120, 450 - i * 12);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}
