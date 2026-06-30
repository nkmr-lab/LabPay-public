// /#/workouts — 筋トレ記録 + 仲間 (mutual follow)。
// v533 #162。 プリセットの種目ピル + 回数 / ウェイト / セット + 仲間との共有。

import { get, post, del } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';

const PRESET_EXERCISES = [
  { name: '腕立て',    icon: '💪', defaultReps: 10, hasWeight: false },
  { name: '腹筋',      icon: '🔥', defaultReps: 20, hasWeight: false },
  { name: '背筋',      icon: '🦴', defaultReps: 15, hasWeight: false },
  { name: 'スクワット', icon: '🦵', defaultReps: 15, hasWeight: false },
  { name: 'プランク',  icon: '⏱',  defaultReps: 60, hasWeight: false }, // reps = 秒
  { name: '懸垂',      icon: '🧗', defaultReps: 5,  hasWeight: false },
  { name: 'ベンチプレス', icon: '🏋️', defaultReps: 8, hasWeight: true },
  { name: 'デッドリフト', icon: '🏋️', defaultReps: 5, hasWeight: true },
  { name: 'ダンベルカール', icon: '💪', defaultReps: 10, hasWeight: true },
];

let activeExercise = null;
let activeScope    = 'mine';

export async function renderWorkouts() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">💪 筋トレ</h2>
        <span style="flex:1"></span>
        <a href="#/workouts/friends" class="btn" style="font-size:12px; padding:4px 10px">🤝 仲間</a>
      </div>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📝 記録</div>
      <div id="wk-presets" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px"></div>
      <div class="row" style="gap:6px; align-items:flex-end; flex-wrap:wrap">
        <input type="text" id="wk-exercise" maxlength="60" placeholder="種目 (プリセット選択 or 自由入力)" style="flex:2; min-width:140px; font-size:13px">
        <input type="number" id="wk-reps" min="1" max="10000" placeholder="回数" style="flex:1; min-width:70px; font-size:13px">
        <input type="number" id="wk-weight" step="0.5" min="0" max="1000" placeholder="kg" style="flex:1; min-width:70px; font-size:13px">
        <input type="number" id="wk-sets" min="1" max="1000" value="1" placeholder="セット" style="flex:1; min-width:70px; font-size:13px">
        <button id="wk-save" class="primary" style="padding:4px 12px; font-size:13px">＋ 記録</button>
      </div>
      <div class="row" style="gap:6px; margin-top:6px">
        <input type="text" id="wk-memo" maxlength="200" placeholder="メモ (任意)" style="flex:1; font-size:13px">
      </div>
    </div>
    <div class="card" id="wk-summary"><div class="muted">読み込み中…</div></div>
    <div class="card">
      <div class="row center" style="gap:6px; margin-bottom:6px">
        <div class="bold">📜 ログ</div>
        <span style="flex:1"></span>
        <select id="wk-scope" style="font-size:12px">
          <option value="mine">自分のみ</option>
          <option value="friends">仲間のみ</option>
          <option value="all">自分 + 仲間</option>
        </select>
      </div>
      <div id="wk-list" class="list"></div>
    </div>
  `;
  document.getElementById('wk-presets').innerHTML = PRESET_EXERCISES.map((p, i) => `
    <button class="btn" data-preset="${i}" style="font-size:12px; padding:4px 10px">${p.icon} ${escapeHtml(p.name)}</button>
  `).join('');
  document.querySelectorAll('[data-preset]').forEach(b => {
    b.addEventListener('click', () => {
      const p = PRESET_EXERCISES[Number(b.dataset.preset)];
      document.getElementById('wk-exercise').value = p.name;
      if (!document.getElementById('wk-reps').value) document.getElementById('wk-reps').value = p.defaultReps;
      // 自重系はウェイトクリア
      if (!p.hasWeight) document.getElementById('wk-weight').value = '';
      activeExercise = p.name;
      document.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('primary', x === b));
    });
  });
  document.getElementById('wk-save').addEventListener('click', save);
  document.getElementById('wk-scope').addEventListener('change', (e) => {
    activeScope = e.target.value;
    refreshList();
  });
  await refreshSummary();
  await refreshList();
}

async function save() {
  const exercise = document.getElementById('wk-exercise').value.trim();
  const reps     = document.getElementById('wk-reps').value.trim();
  const weight   = document.getElementById('wk-weight').value.trim();
  const sets     = document.getElementById('wk-sets').value.trim() || '1';
  const memo     = document.getElementById('wk-memo').value.trim();
  if (!exercise) { toast('種目を入れてください'); return; }
  try {
    await post('/api/workouts/record', {
      exercise,
      reps: reps || null,
      weight_kg: weight || null,
      sets: sets || 1,
      memo: memo || null,
    });
    document.getElementById('wk-reps').value = '';
    document.getElementById('wk-weight').value = '';
    document.getElementById('wk-memo').value = '';
    toast('記録しました');
    await refreshSummary();
    await refreshList();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function refreshSummary() {
  const root = document.getElementById('wk-summary');
  if (!root) return;
  try {
    const s = await get('/api/workouts/summary');
    const week = s.week_by_exercise || [];
    if (!week.length) {
      root.innerHTML = '<div class="muted">直近 7 日間の記録はまだありません</div>';
      return;
    }
    root.innerHTML = `
      <div class="bold" style="margin-bottom:6px">📊 直近 7 日</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap">
        ${week.map(r => `
          <div style="padding:6px 10px; background:var(--primary-soft, #ede4f3); border-radius:8px; font-size:12px">
            <span class="bold">${escapeHtml(r.exercise)}</span>:
            ${r.total_reps} 回 / ${r.total_sets} セット
          </div>
        `).join('')}
      </div>`;
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function refreshList() {
  const root = document.getElementById('wk-list');
  if (!root) return;
  try {
    const d = await get('/api/workouts/records', { days: 30, scope: activeScope });
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">該当ログはありません</div>';
      return;
    }
    root.innerHTML = items.slice(0, 50).map(r => {
      const detail = [
        r.reps ? `${r.reps} 回` : '',
        r.weight_kg ? `${r.weight_kg}kg` : '',
        r.sets > 1 ? `× ${r.sets} セット` : '',
      ].filter(Boolean).join(' · ');
      return `
        <div class="list-item" style="align-items:flex-start; gap:8px">
          <span style="display:inline-flex; flex:none">${avatarHtml(r.display_name, r.avatar_url, 'sm')}</span>
          <div class="grow">
            <div style="font-size:13px"><span class="bold">${escapeHtml(r.exercise)}</span> · ${detail}</div>
            ${r.memo ? `<div class="meta" style="font-size:12px">📝 ${escapeHtml(r.memo)}</div>` : ''}
            <div class="meta" style="font-size:11px">${escapeHtml(r.display_name)} · ${escapeHtml(r.recorded_at)}</div>
          </div>
          ${r.is_mine ? `<button class="btn danger" data-rm="${r.id}" style="font-size:11px; padding:2px 8px">×</button>` : ''}
        </div>`;
    }).join('');
    root.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この記録を削除しますか?')) return;
        try { await del('/api/workouts/record/' + b.dataset.rm); await refreshList(); await refreshSummary(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// 仲間管理ページ
export async function renderWorkoutsFriends() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/workouts" class="hint">← 筋トレ</a>
      <h2 style="margin:6px 0">🤝 筋トレ仲間</h2>
      <p class="hint-sm" style="font-size:12px">お互いに追加し合うと、 互いの記録が見えます。 片方だけの場合は 「申請中」 表示になります。</p>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">＋ 追加</div>
      <div id="wkf-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
      <div id="wkf-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:6px">
        <button id="wkf-add" class="primary" style="font-size:13px; padding:4px 12px">追加</button>
      </div>
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📋 追加済み</div>
      <div id="wkf-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer:  document.getElementById('wkf-bulk'),
      chipsContainer: document.getElementById('wkf-chips'),
      initial: [],
      excludeIds: [Number(state.me?.id)],
      showGenderBulk: false,
    });
  } catch (e) {
    document.getElementById('wkf-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
  document.getElementById('wkf-add').addEventListener('click', async () => {
    const ids = picker ? [...picker.getSelected()] : [];
    if (!ids.length) { toast('1 人以上選んでください'); return; }
    for (const uid of ids) {
      try { await post('/api/workouts/friend', { user_id: uid }); } catch (e) {}
    }
    toast('追加しました');
    if (picker) picker.clear?.();
    await loadFriends();
  });
  await loadFriends();
}

async function loadFriends() {
  const root = document.getElementById('wkf-list');
  if (!root) return;
  try {
    const d = await get('/api/workouts/friends');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">まだ仲間がいません</div>';
      return;
    }
    root.innerHTML = items.map(f => `
      <div class="list-item" style="align-items:center; gap:8px">
        <span style="display:inline-flex; flex:none">${avatarHtml(f.display_name, f.avatar_url, 'sm')}</span>
        <div class="grow">
          <div class="bold">${escapeHtml(f.display_name)}</div>
          <div class="meta">${f.they_added_me ? '<span class="tag ok">相互フォロー</span>' : '<span class="tag warn">申請中 (相手が追加すれば相互に)</span>'}</div>
        </div>
        <button class="btn danger" data-rm="${f.id}" style="font-size:11px; padding:2px 8px">解除</button>
      </div>
    `).join('');
    root.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('仲間を解除しますか?')) return;
        try { await del('/api/workouts/friend/' + b.dataset.rm); await loadFriends(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
