// /#/conquest — ユーザが自由に 「制覇リスト」 を作って、 アイテムを追加 + 自分が
//   達成したものをチェックしていくアプリ。 v860 #445。
//   例: 「中野区のパン屋」 「都内のラーメン屋一蘭」 「47 都道府県県庁所在地」 …

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { toast } from '../app.js';
import { fmtRelative } from '../format.js';

export async function renderConquest() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">🏁 制覇リスト</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/conquest/new">＋ 新しいリスト</a>
      </div>
      <div class="hint-sm" style="margin-top:4px">
        街のパン屋、 通った学会、 行きたい温泉など、 自分だけの制覇リストを作ってチェックしていけます。
      </div>
    </div>
    <div id="cq-list"><div class="muted">読込中…</div></div>`;

  try {
    const d = await get('/api/conquest/lists');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('cq-list').innerHTML = `
        <div class="card center muted">
          まだリストがありません。 「＋ 新しいリスト」 から作ってみよう。
        </div>`;
      return;
    }
    document.getElementById('cq-list').innerHTML = items.map(it => {
      const pct = it.item_count > 0 ? Math.round((it.my_visit_count || 0) * 100 / it.item_count) : 0;
      const visTag = it.visibility === 'private'
        ? '<span class="tag muted">🔒 非公開</span>'
        : '<span class="tag ok">🌐 公開</span>';
      return `
        <a class="card cq-tile" href="#/conquest/${it.id}" style="display:block; text-decoration:none; color:inherit">
          <div class="row" style="gap:8px; align-items:center">
            ${avatarHtml(it.owner_name, it.owner_avatar, 'sm')}
            <div style="flex:1; min-width:0">
              <div class="bold" style="font-size:15px">${escapeHtml(it.title)} ${visTag}</div>
              <div class="muted" style="font-size:12px">
                ${escapeHtml(it.owner_name || '')} ・ ${it.item_count} 件・ ${fmtRelative(it.updated_at)}
              </div>
              ${it.description ? `<div style="font-size:13px; margin-top:4px; white-space:pre-wrap; max-height:3.2em; overflow:hidden">${escapeHtml(it.description)}</div>` : ''}
              <div style="margin-top:6px">
                <div class="bold" style="font-size:13px; color:var(--primary)">${it.my_visit_count} / ${it.item_count} 制覇 (${pct}%)</div>
                <div style="height:6px; background:#ede4f3; border-radius:99px; overflow:hidden; margin-top:3px">
                  <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--primary), #b3a0e0)"></div>
                </div>
              </div>
            </div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('cq-list').innerHTML = `<div class="card muted">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

export async function renderConquestNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <a href="#/conquest" class="btn">← 一覧</a>
      <h2 style="margin:6px 0 0">＋ 新しい制覇リスト</h2>
    </div>
    <div class="card">
      <label style="font-size:13px">タイトル <span class="muted">(例: 中野区のパン屋)</span></label>
      <input id="cq-title" type="text" maxlength="120" style="width:100%; padding:8px; margin-top:4px">
      <label style="font-size:13px; margin-top:10px; display:block">説明 (任意)</label>
      <textarea id="cq-desc" rows="3" style="width:100%; padding:8px; margin-top:4px"></textarea>
      <label style="font-size:13px; margin-top:10px; display:block">公開設定</label>
      <select id="cq-vis" style="padding:8px; margin-top:4px">
        <option value="public">🌐 公開 (誰でも見られる、 みんなで追加 OK)</option>
        <option value="private">🔒 非公開 (自分だけ)</option>
      </select>
      <div style="margin-top:14px">
        <button id="cq-create" class="primary">作成</button>
      </div>
    </div>`;
  document.getElementById('cq-create').addEventListener('click', async () => {
    const title = document.getElementById('cq-title').value.trim();
    const desc  = document.getElementById('cq-desc').value.trim();
    const vis   = document.getElementById('cq-vis').value;
    if (!title) { toast('タイトルを入れてください'); return; }
    try {
      const r = await post('/api/conquest/lists', { title, description: desc, visibility: vis });
      toast('作成しました');
      navigate('#/conquest/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderConquestDetail({ id }) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="muted">読込中…</div>`;
  let d;
  try { d = await get('/api/conquest/lists/' + id); }
  catch (e) { app.innerHTML = `<div class="card muted">読み込み失敗: ${escapeHtml(e.message)}</div>`; return; }
  // v865 #447 念のため API レスポンスが期待形でない場合の防御
  if (!d || !Array.isArray(d.items)) {
    app.innerHTML = `<div class="card muted">読み込み失敗: 無効なレスポンス</div>`;
    return;
  }
  const pct = d.items.length > 0 ? Math.round(d.my_visit_count * 100 / d.items.length) : 0;
  const visTag = d.visibility === 'private'
    ? '<span class="tag muted">🔒 非公開</span>'
    : '<span class="tag ok">🌐 公開</span>';
  const canAddItem = d.visibility === 'public' || d.is_mine;
  app.innerHTML = `
    <div class="card page-header">
      <a href="#/conquest" class="btn">← 一覧</a>
      <h2 style="margin:6px 0 0">${escapeHtml(d.title)} ${visTag}</h2>
      <div class="muted" style="font-size:12px; margin-top:4px">
        ${avatarHtml(d.owner_name, d.owner_avatar, 'sm')} ${escapeHtml(d.owner_name || '')}
      </div>
      ${d.description ? `<div style="white-space:pre-wrap; margin-top:8px">${escapeHtml(d.description)}</div>` : ''}
      <div style="margin-top:10px">
        <div class="bold" style="font-size:16px; color:var(--primary)">${d.my_visit_count} / ${d.items.length} 制覇 (${pct}%)</div>
        <div style="height:8px; background:#ede4f3; border-radius:99px; overflow:hidden; margin-top:6px">
          <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--primary), #b3a0e0)"></div>
        </div>
      </div>
      ${d.is_mine ? `<div class="row" style="gap:6px; margin-top:10px"><a class="btn" href="#/conquest/${id}/edit">✏️ 編集</a><button id="cq-del" class="btn danger">🗑 削除</button></div>` : ''}
    </div>
    ${canAddItem ? `
      <div class="card">
        <div class="bold" style="font-size:13px; margin-bottom:6px">＋ アイテムを追加</div>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <input id="cq-item-name" type="text" maxlength="160" placeholder="お店名 / 対象名" style="flex:1; min-width:160px; padding:8px">
          <input id="cq-item-note" type="text" maxlength="400" placeholder="メモ (住所等、 任意)" style="flex:1; min-width:160px; padding:8px">
          <button id="cq-item-add" class="primary">追加</button>
        </div>
      </div>` : ''}
    <div class="card">
      <div class="bold" style="margin-bottom:6px">アイテム (${d.items.length})</div>
      <div id="cq-items">
        ${d.items.length === 0
          ? '<div class="muted">まだアイテムがありません。 上から追加してください。</div>'
          : d.items.map(it => renderItemRow(it, d)).join('')}
      </div>
    </div>`;
  if (d.is_mine) {
    document.getElementById('cq-del')?.addEventListener('click', async () => {
      if (!confirm('このリストを削除します。 いいですか?')) return;
      try { await del('/api/conquest/lists/' + id); toast('削除しました'); navigate('#/conquest'); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  }
  if (canAddItem) {
    document.getElementById('cq-item-add')?.addEventListener('click', async () => {
      const name = document.getElementById('cq-item-name').value.trim();
      const note = document.getElementById('cq-item-note').value.trim();
      if (!name) { toast('名前を入れてください'); return; }
      try {
        await post(`/api/conquest/lists/${id}/items`, { name, note });
        toast('追加しました');
        renderConquestDetail({ id });
      } catch (e) { toast('失敗: ' + e.message); }
    });
  }
  document.querySelectorAll('[data-toggle-item]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.toggleItem;
      try {
        const r = await post(`/api/conquest/lists/${id}/items/${itemId}/visit`, {});
        toast(r.visited ? '✅ 制覇した' : '↩ 取消');
        renderConquestDetail({ id });
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
  document.querySelectorAll('[data-del-item]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.delItem;
      if (!confirm('このアイテムを削除します。 いいですか?')) return;
      try { await del(`/api/conquest/lists/${id}/items/${itemId}`); toast('削除'); renderConquestDetail({ id }); }
      catch (e) { toast('失敗: ' + e.message); }
    });
  });
}

function renderItemRow(it, d) {
  const visited = it.i_visited;
  const bg = visited ? 'var(--primary-soft, #ede4f3)' : '#fff';
  const border = visited ? 'var(--primary)' : 'var(--line)';
  return `
    <div class="row" style="padding:8px 10px; gap:8px; align-items:center; border:1.5px solid ${border}; border-radius:8px; background:${bg}; margin-bottom:6px">
      <button data-toggle-item="${it.id}" style="border:none; background:transparent; font-size:22px; cursor:pointer; padding:0">${visited ? '✅' : '⬜'}</button>
      <div style="flex:1; min-width:0">
        <div class="bold" style="font-size:14px">${escapeHtml(it.name)}</div>
        ${it.note ? `<div class="muted" style="font-size:12px">${escapeHtml(it.note)}</div>` : ''}
        <div class="hint-sm" style="font-size:10px; margin-top:2px">${it.total_visits} 人が制覇 ${it.added_by_name ? '・追加: ' + escapeHtml(it.added_by_name) : ''}</div>
      </div>
      ${d.is_mine ? `<button data-del-item="${it.id}" class="btn" style="font-size:11px; padding:3px 8px">🗑</button>` : ''}
    </div>`;
}
