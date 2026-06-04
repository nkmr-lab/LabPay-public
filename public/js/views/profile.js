// /#/users/:id — 公開プロフィール ビュー。
// 表示項目: avatar / display_name / grade / 趣味 / 推し / Scrapbox。
// 編集は出来ない (= 設定ページ で 自分のだけ 編集)。

import { get } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state } from '../app.js';

export async function renderUserProfile({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/contacts" class="hint">← 連絡先一覧</a>
      <div id="up-body" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  try {
    const d = await get('/api/users/' + id + '/profile');
    const p = d.profile;
    const isMe = Number(p.id) === Number(state.me?.id);
    const sbLink = p.scrapbox_username
      ? `<a href="https://scrapbox.io/nakamura716lab/${encodeURIComponent(p.scrapbox_username)}" target="_blank" rel="noopener" style="color:var(--primary)">@${escapeHtml(p.scrapbox_username)}</a>`
      : '';
    const section = (title, body) => body
      ? `<div style="margin-top:14px">
           <div class="bold" style="margin-bottom:4px">${title}</div>
           <div style="white-space:pre-wrap; background:#faf7fd; padding:10px; border-radius:8px; font-size:14px">${escapeHtml(body)}</div>
         </div>`
      : '';
    document.getElementById('up-body').innerHTML = `
      <div style="text-align:center">
        <div style="display:inline-block">${avatarHtml(p.display_name, p.avatar_url, 'lg')}</div>
        <div class="bold" style="font-size:20px; margin-top:6px">${escapeHtml(p.display_name)}${isMe ? ' <span class="hint">(自分)</span>' : ''}</div>
        <div class="meta">
          ${p.grade ? '[' + escapeHtml(p.grade) + ']' : ''}
          ${sbLink ? ' · Scrapbox ' + sbLink : ''}
        </div>
      </div>
      ${section('🎯 趣味', p.hobbies)}
      ${section('❤️ 推し', p.favorites)}
      ${(!p.hobbies && !p.favorites)
        ? '<div class="hint" style="margin-top:14px; text-align:center">まだ 趣味 / 推し は登録されていません</div>'
        : ''}
      ${isMe
        ? '<div class="row" style="margin-top:14px; justify-content:center"><a href="#/settings" class="btn primary">設定で編集</a></div>'
        : ''}
    `;
  } catch (e) {
    document.getElementById('up-body').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
