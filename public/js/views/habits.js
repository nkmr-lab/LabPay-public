// /#/habits — Habit Tracker。 個人 ごと に 「毎日 論文 を 読む」 など の 習慣 を 登録、
//   日 毎 達成 を ✓ で 入力、 連続記録 (streak) と 60 日 カレンダー で 可視化。 公開
//   リスト は ラボメン 全員 が 見えて 達成 数 で 比較 できる。 v870 #452。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { toast } from '../app.js';
import { fmtRelative } from '../format.js';

function today() { return new Date().toISOString().slice(0, 10); }

export async function renderHabits() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">📓 Habit Tracker</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/habits/new">＋ 新しい習慣</a>
      </div>
      <div class="hint-sm" style="margin-top:4px">
        毎日 論文 を 読む / 早起き / 運動 など、 自分 の 習慣 を 登録 して 日 毎 ✓ で 積み上げ。 公開 すれば ラボ メン 全員 が 達成 状況 を 確認 できて 励まし 合えます。
      </div>
    </div>
    <div id="hb-list"><div class="muted">読込中…</div></div>`;
  try {
    const d = await get('/api/habits');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('hb-list').innerHTML = `
        <div class="card center muted">
          まだ 習慣 が ありません。 「＋ 新しい習慣」 から 始め よう。
        </div>`;
      return;
    }
    document.getElementById('hb-list').innerHTML = items.map(it => {
      const pct = Math.min(100, Math.round((it.done_this_week / Math.max(1, it.target_per_week)) * 100));
      const visTag = it.visibility === 'private'
        ? '<span class="tag muted">🔒 非公開</span>'
        : '<span class="tag ok">🌐 公開</span>';
      const todayBtn = it.done_today
        ? `<button class="btn primary" data-toggle="${it.id}" style="background:#15803d; border-color:#15803d">✅ 今日 達成 済</button>`
        : `<button class="btn" data-toggle="${it.id}">⬜ 今日 ✓ する</button>`;
      const youTag = it.is_mine ? '<span class="tag" style="background:#ede4f3; color:#4a106d">自分</span>' : '';
      return `
        <div class="card">
          <div class="row" style="gap:8px; align-items:flex-start">
            ${avatarHtml(it.owner_name, it.owner_avatar, 'sm')}
            <div style="flex:1; min-width:0">
              <div class="bold" style="font-size:15px">${escapeHtml(it.emoji || '✅')} <a href="#/habits/${it.id}" style="color:inherit">${escapeHtml(it.title)}</a> ${visTag} ${youTag}</div>
              <div class="muted" style="font-size:12px">
                ${escapeHtml(it.owner_name || '')} ・ 目標 週 ${it.target_per_week} 日 ・ 通算 ${it.done_total} 回
              </div>
              ${it.description ? `<div style="font-size:13px; margin-top:4px; white-space:pre-wrap; max-height:3.2em; overflow:hidden">${escapeHtml(it.description)}</div>` : ''}
              <div style="margin-top:6px">
                <div class="hint-sm" style="font-size:12px">今週: ${it.done_this_week} / ${it.target_per_week} 日</div>
                <div style="height:6px; background:#ede4f3; border-radius:99px; overflow:hidden; margin-top:3px">
                  <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--primary), #b3a0e0)"></div>
                </div>
              </div>
            </div>
            <div>${todayBtn}</div>
          </div>
        </div>`;
    }).join('');
    document.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggle;
        const isDone = btn.textContent.includes('✅');
        try {
          if (isDone) await del(`/api/habits/${id}/checkin?date=${today()}`);
          else        await post(`/api/habits/${id}/checkin`, {});
          toast(isDone ? '↩ 取消' : '✅ 達成');
          renderHabits();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    document.getElementById('hb-list').innerHTML = `<div class="card muted">読み込み 失敗: ${escapeHtml(e.message)}</div>`;
  }
}

export async function renderHabitsNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <a href="#/habits" class="btn">← 一覧</a>
      <h2 style="margin:6px 0 0">＋ 新しい 習慣</h2>
    </div>
    <div class="card">
      <label style="font-size:13px">絵文字 (任意)</label>
      <input id="hb-emoji" type="text" maxlength="4" value="✅" style="width:80px; padding:8px; margin-top:4px; font-size:18px; text-align:center">
      <label style="font-size:13px; margin-top:10px; display:block">タイトル <span class="muted">(例: 毎日 論文 を 1 本 読む)</span></label>
      <input id="hb-title" type="text" maxlength="160" style="width:100%; padding:8px; margin-top:4px">
      <label style="font-size:13px; margin-top:10px; display:block">説明 (任意)</label>
      <textarea id="hb-desc" rows="3" style="width:100%; padding:8px; margin-top:4px"></textarea>
      <label style="font-size:13px; margin-top:10px; display:block">週 の 目標 日数 (1 〜 7)</label>
      <input id="hb-tpw" type="number" min="1" max="7" value="7" style="width:80px; padding:8px; margin-top:4px">
      <label style="font-size:13px; margin-top:10px; display:block">公開 設定</label>
      <select id="hb-vis" style="padding:8px; margin-top:4px">
        <option value="public">🌐 公開 (ラボ 全員 に 達成 状況 が 見える)</option>
        <option value="private">🔒 非公開 (自分 だけ)</option>
      </select>
      <div style="margin-top:14px">
        <button id="hb-create" class="primary">作成</button>
      </div>
    </div>`;
  document.getElementById('hb-create').addEventListener('click', async () => {
    const title = document.getElementById('hb-title').value.trim();
    const desc  = document.getElementById('hb-desc').value.trim();
    const emoji = document.getElementById('hb-emoji').value.trim();
    const tpw   = parseInt(document.getElementById('hb-tpw').value, 10) || 7;
    const vis   = document.getElementById('hb-vis').value;
    if (!title) { toast('タイトル を 入れてください'); return; }
    try {
      const r = await post('/api/habits', { title, description: desc, emoji, target_per_week: tpw, visibility: vis });
      toast('作成 しました');
      navigate('#/habits/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

export async function renderHabitDetail({ id }) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="muted">読込中…</div>`;
  let h;
  try { h = await get('/api/habits/' + id); }
  catch (e) { app.innerHTML = `<div class="card muted">読み込み 失敗: ${escapeHtml(e.message)}</div>`; return; }
  if (!h || !Array.isArray(h.my_checkins)) {
    app.innerHTML = `<div class="card muted">読み込み 失敗: 無効 な レスポンス</div>`;
    return;
  }
  const visTag = h.visibility === 'private'
    ? '<span class="tag muted">🔒 非公開</span>'
    : '<span class="tag ok">🌐 公開</span>';
  const checked = new Set(h.my_checkins);
  const doneToday = checked.has(today());
  // 60 日 カレンダー (古い → 新しい)
  const cells = [];
  for (let i = 59; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const done = checked.has(iso);
    const isToday = (iso === today());
    cells.push(`
      <div title="${iso}${done ? ' ✓' : ''}"
           style="aspect-ratio:1; border-radius:3px; background:${done ? '#15803d' : '#ede4f3'}; border:${isToday ? '2px solid #4a106d' : '1px solid #d9d2e6'}; min-width:14px"></div>`);
  }
  app.innerHTML = `
    <div class="card page-header">
      <a href="#/habits" class="btn">← 一覧</a>
      <h2 style="margin:6px 0 0">${escapeHtml(h.emoji || '✅')} ${escapeHtml(h.title)} ${visTag}</h2>
      <div class="muted" style="font-size:12px; margin-top:4px">
        ${avatarHtml(h.owner_name, h.owner_avatar, 'sm')} ${escapeHtml(h.owner_name || '')} ・ 目標 週 ${h.target_per_week} 日
      </div>
      ${h.description ? `<div style="white-space:pre-wrap; margin-top:8px">${escapeHtml(h.description)}</div>` : ''}
      <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap">
        <button id="hb-toggle" class="primary" style="${doneToday ? 'background:#15803d; border-color:#15803d' : ''}">${doneToday ? '✅ 今日 達成 済 (もう一度 押して 取消)' : '⬜ 今日 を ✓ する'}</button>
        ${h.is_mine ? `<button id="hb-del" class="btn danger">🗑 削除</button>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📊 自分 の 記録</div>
      <div style="display:flex; gap:14px; align-items:flex-end; flex-wrap:wrap">
        <div><div style="font-size:24px; font-weight:700; color:var(--primary)">${h.my_streak}</div><div class="hint-sm">🔥 連続 日数</div></div>
        <div><div style="font-size:24px; font-weight:700; color:var(--primary)">${h.my_done_60d}</div><div class="hint-sm">60 日 で 達成</div></div>
      </div>
      <div class="hint-sm" style="margin-top:10px; font-size:11px">直近 60 日 (右端 が 今日、 緑 は 達成)</div>
      <div style="display:grid; grid-template-columns:repeat(20, 1fr); gap:3px; margin-top:6px">${cells.join('')}</div>
    </div>
    ${h.visibility === 'public' && (h.others || []).length ? `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">🏆 ラボ メン の 達成 (60 日)</div>
        ${h.others.map(o => `
          <div class="row" style="padding:6px 0; gap:8px; align-items:center; border-top:1px solid var(--line)">
            ${avatarHtml(o.display_name, o.avatar_url, 'sm')}
            <span class="bold" style="flex:1">${escapeHtml(o.display_name)} ${o.done_today ? '<span class="tag ok" style="font-size:10px">今日 ✓</span>' : ''}</span>
            <span style="font-variant-numeric:tabular-nums">${o.done_count} 日</span>
          </div>`).join('')}
      </div>` : ''}`;
  document.getElementById('hb-toggle').addEventListener('click', async () => {
    try {
      if (doneToday) await del(`/api/habits/${id}/checkin?date=${today()}`);
      else            await post(`/api/habits/${id}/checkin`, {});
      toast(doneToday ? '↩ 取消' : '✅ 達成');
      renderHabitDetail({ id });
    } catch (e) { toast('失敗: ' + e.message); }
  });
  document.getElementById('hb-del')?.addEventListener('click', async () => {
    if (!confirm('この 習慣 を 削除 します (記録 も 全部 消えます)。 いいですか?')) return;
    try { await del('/api/habits/' + id); toast('削除 しました'); navigate('#/habits'); }
    catch (e) { toast('失敗: ' + e.message); }
  });
}
