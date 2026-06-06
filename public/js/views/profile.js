// /#/users/:id — 公開プロフィール ビュー。
// 表示項目: avatar / display_name / grade / 趣味 / 推し / Scrapbox。
// 編集は出来ない (= 設定ページ で 自分のだけ 編集)。

import { get } from '../api.js';
import { escapeHtml, avatarHtml } from '../router.js';
import { state, toast } from '../app.js';

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
      ${(p.paypay_id || p.bank_info) ? `
        <div style="margin-top:14px">
          <div class="bold" style="margin-bottom:4px">💴 外部 送金 先</div>
          <div style="background:#faf7fd; padding:10px; border-radius:8px; font-size:14px">
            ${p.paypay_id ? `
              <div style="margin-bottom:6px; font-size:13px">
                <span class="muted">💴 PayPay:</span>
                <code id="up-paypay" style="word-break:break-all">${escapeHtml(p.paypay_id)}</code>
                <button class="btn" data-copy-target="up-paypay" style="font-size:11px; padding:1px 6px; margin-left:4px" title="コピー">📋</button>
              </div>` : ''}
            ${p.bank_info ? `
              <div style="margin-bottom:6px; font-size:13px">
                <span class="muted">🏦 口座:</span>
                <span style="white-space:pre-wrap; word-break:break-all">${escapeHtml(p.bank_info)}</span>
              </div>` : ''}
            ${!isMe ? `
              <div class="row" style="gap:6px; margin-top:6px; justify-content:flex-end">
                <a href="#/send?to=${p.id}" class="btn primary" style="font-size:13px">💸 LabPay で 送金</a>
              </div>` : ''}
          </div>
        </div>
      ` : ''}
      ${(!p.hobbies && !p.favorites && !p.paypay_id && !p.bank_info)
        ? '<div class="hint" style="margin-top:14px; text-align:center">まだ 何も 登録されていません</div>'
        : ''}
      ${isMe
        ? '<div class="row" style="margin-top:14px; justify-content:center"><a href="#/settings" class="btn primary">設定で編集</a></div>'
        : ''}
    `;
    // 📋 コピー
    document.querySelectorAll('[data-copy-target]').forEach(b => {
      b.addEventListener('click', () => {
        const t = document.getElementById(b.dataset.copyTarget);
        if (!t) return;
        const text = t.textContent;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => toast('コピーしました')).catch(() => toast('コピー失敗'));
        } else {
          const r = document.createRange(); r.selectNode(t);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          try { document.execCommand('copy'); toast('コピーしました'); }
          catch (_) { toast('コピー失敗'); }
        }
      });
    });
  } catch (e) {
    document.getElementById('up-body').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
