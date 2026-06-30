// 共有メンバー選択 picker。 各 view が ad-hoc で書いていた 「全員 / 学年 / 性別」 bulk +
// 個別 chip + 選択数ラベルを 1 箇所に集約。
//
// 使い方:
//   import { createMemberPicker } from '../member_picker.js';
//   const picker = await createMemberPicker({
//     bulkContainer: document.getElementById('xxx-bulk'),
//     chipsContainer: document.getElementById('xxx-members'),
//     countLabel:    document.getElementById('xxx-count'),  // 任意
//     initial:       [12, 34, ...],         // 初期選択 (任意)
//     poolIds:       [1, 2, 3, ...],        // 「これらの user_id のみ表示」 (任意。 グループ
//                                              内などで member を制限したい時に使う)
//     showGenderBulk: true,                  // 男 / 女ボタンを出すか (デフォ true)
//     excludeIds:    [meId],                 // 表示しない user_id (発起人を picker から外す等)
//     onChange:      (selectedSet) => {...}  // 任意 (変化のたびに呼ぶ)
//   });
//
//   picker.getSelected()  // → Set<number>
//   picker.setSelected(ids)
//   picker.size()         // → number

import { get } from './api.js';
import { escapeHtml, avatarHtml } from './router.js';

const GRADE_ORDER = ['B3','B4','M1','M2','D',''];
function gradeRank(g) {
  const i = GRADE_ORDER.indexOf(g || '');
  return i < 0 ? GRADE_ORDER.length : i;
}

function memberMatchesKey(user, key) {
  if (key === 'all') return true;
  if (key.startsWith('grade:'))  return (user.grade || '')  === key.slice(6);
  if (key.startsWith('gender:')) return (user.gender || '') === key.slice(7);
  return false;
}

export async function createMemberPicker(opts = {}) {
  const {
    bulkContainer = null,
    chipsContainer,
    countLabel = null,
    initial = [],
    poolIds = null,
    showGenderBulk = true,
    excludeIds = [],
    onChange = null,
  } = opts;
  if (!chipsContainer) throw new Error('member_picker: chipsContainer 必須');

  // メンバーリスト取得 → pool / exclude で絞り込み → 学年 → 50 音順でソート。
  const u = await get('/api/users');
  let users = u.items || [];
  if (Array.isArray(poolIds) && poolIds.length) {
    const allowed = new Set(poolIds.map(Number));
    users = users.filter(x => allowed.has(Number(x.id)));
  }
  if (Array.isArray(excludeIds) && excludeIds.length) {
    const drop = new Set(excludeIds.map(Number));
    users = users.filter(x => !drop.has(Number(x.id)));
  }
  users = [...users].sort((a, b) => {
    const gd = gradeRank(a.grade) - gradeRank(b.grade);
    if (gd !== 0) return gd;
    return (a.display_name || '').localeCompare(b.display_name || '', 'ja');
  });

  const picked = new Set(Array.from(initial || []).map(Number));

  // bulk ボタン: 全員 / 学年 (実在分) / 男 / 女 / クリア
  if (bulkContainer) {
    const presentGrades = [...new Set(users.map(x => x.grade || ''))];
    const sortedGrades = GRADE_ORDER.filter(g => g !== '' && presentGrades.includes(g));
    const genderBtns = showGenderBulk
      ? `<button class="btn" data-bulk="gender:M">男</button><button class="btn" data-bulk="gender:F">女</button>`
      : '';
    bulkContainer.innerHTML = `
      <button class="btn" data-bulk="all">全員</button>
      ${sortedGrades.map(g => `<button class="btn" data-bulk="grade:${g}">${g}</button>`).join('')}
      ${genderBtns}
      <button class="btn" data-bulk="clear">クリア</button>
    `;
    bulkContainer.querySelectorAll('[data-bulk]').forEach(b => {
      b.addEventListener('click', () => applyBulk(b.dataset.bulk));
    });
  }

  // chips (.rl-chip スタイルを共有)
  function chipHtml(x) {
    return `
      <span class="rl-chip" data-uid="${x.id}">
        ${avatarHtml(x.display_name, x.avatar_url, 'sm')}
        <span>${escapeHtml(x.display_name)}</span>
        ${x.grade ? `<span class="muted" style="font-size:11px">[${escapeHtml(x.grade)}]</span>` : ''}
      </span>`;
  }
  chipsContainer.innerHTML = users.map(chipHtml).join('');
  chipsContainer.querySelectorAll('.rl-chip').forEach(c => {
    c.addEventListener('click', () => togglePick(Number(c.dataset.uid)));
  });

  function refreshChips() {
    chipsContainer.querySelectorAll('.rl-chip').forEach(c => {
      const on = picked.has(Number(c.dataset.uid));
      c.style.background  = on ? 'var(--primary-soft, #efeafa)' : '';
      c.style.borderColor = on ? 'var(--primary)' : '';
    });
    if (countLabel) countLabel.textContent = `${picked.size} 人選択中`;
    if (onChange) onChange(new Set(picked));
  }

  function applyBulk(key) {
    if (key === 'clear') { picked.clear(); refreshChips(); return; }
    const targets = users.filter(x => memberMatchesKey(x, key));
    const allOn = targets.every(x => picked.has(x.id));
    if (allOn) targets.forEach(x => picked.delete(x.id));
    else       targets.forEach(x => picked.add(x.id));
    refreshChips();
  }

  function togglePick(uid) {
    if (picked.has(uid)) picked.delete(uid);
    else picked.add(uid);
    refreshChips();
  }

  refreshChips();

  return {
    users: () => users,
    getSelected: () => new Set(picked),
    setSelected: (ids) => {
      picked.clear();
      Array.from(ids || []).forEach(id => picked.add(Number(id)));
      refreshChips();
    },
    addSelected: (id) => { picked.add(Number(id)); refreshChips(); },
    removeSelected: (id) => { picked.delete(Number(id)); refreshChips(); },
    size: () => picked.size,
  };
}
