// /#/contacts — 連絡先 (緊急連絡用)。
// 「電話番号を登録済みのメンバー」 を強調しつつ、 全員 (登録無しの人も) 一覧表示。
// tel: リンクでタップ通話。

import { get } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';

const GRADE_ORDER = ['B3','B4','M1','M2','D',''];
const gradeRank = g => {
  const i = GRADE_ORDER.indexOf(g || '');
  return i < 0 ? GRADE_ORDER.length : i;
};

function telHref(s) {
  // 全角 → 半角、 数字 / + 以外を落とす (tel: の RFC に従う)。
  if (!s) return '';
  const half = s.replace(/[０-９＋]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  return 'tel:' + half.replace(/[^\d+]/g, '');
}

export async function renderContacts() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">連絡先</h2>
      <p class="card-subtitle" style="margin:6px 0 0">
        ラボメンバーの緊急連絡用電話番号。 自分の番号は
        <a href="#/settings">設定</a> から登録できます。
      </p>
    </div>
    <div id="contacts-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    // v494 #99 #100 一般の /api/users からは phone_number を除外。 専用エンドポイント
    //   /api/users/contacts なら admin/自分/同グループメンバー のみ phone を含む。
    const d = await get('/api/users/contacts');
    const users = [...(d.items || [])].sort((a, b) => {
      const gd = gradeRank(a.grade) - gradeRank(b.grade);
      if (gd !== 0) return gd;
      return (a.display_name || '').localeCompare(b.display_name || '', 'ja');
    });
    if (!users.length) {
      document.getElementById('contacts-list').innerHTML = '<div class="empty">メンバーがいません</div>';
      return;
    }
    document.getElementById('contacts-list').innerHTML = users.map(u => {
      const phone = u.phone_number || '';
      const phoneRow = phone
        ? `<a href="${escapeHtml(telHref(phone))}" class="bold" style="color:var(--primary)" onclick="event.stopPropagation()">📞 ${escapeHtml(phone)}</a>`
        : `<span class="muted" style="font-size:12px">未登録</span>`;
      // 行全体を 公開プロフィールへの link に。 電話タップだけは stopPropagation で
      // tel: 直行 (プロフィールへは行かない)。
      return `
        <a class="list-item" href="#/users/${u.id}" style="gap:10px; align-items:center; text-decoration:none; color:inherit">
          ${avatarHtml(u.display_name, u.avatar_url, 'md')}
          <div class="grow" style="min-width:0">
            <div class="bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
              ${escapeHtml(u.display_name)}
              ${u.grade ? `<span class="muted" style="font-size:11px; font-weight:400">[${escapeHtml(u.grade)}]</span>` : ''}
            </div>
            <div class="meta">${phoneRow}</div>
          </div>
          <span class="hint" style="font-size:11px">→</span>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('contacts-list').innerHTML =
      `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
