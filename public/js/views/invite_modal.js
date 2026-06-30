// v632 「対象者指定 → 即起動」 用の共通モーダル。
//   各ゲームの 「＋ 新規卓」 ボタンから呼ぶ。
//
//   showInviteModal({
//     title:       '🃏 大富豪新規卓',
//     description: 'プレイフィー 2pt。 全員同意済で即開始。',
//     minPick:     1,            // 最少招待人数 (= max_players - 1)
//     maxPick:     3,            // 最大招待人数
//     allowPublic: true,         // 「公開卓で立てる」 ボタンを出すか
//   })
//   ⇒ 戻り値: { kind: 'public' } | { kind: 'invite', memberIds: [uid,...] } | null (cancel)

import { state } from '../app.js';
import { escapeHtml } from '../router.js';
import { createMemberPicker } from '../member_picker.js';

export async function showInviteModal(opts) {
  const {
    title = '新規卓',
    description = '',
    minPick = 1,
    maxPick = 99,
    allowPublic = true,
  } = opts || {};

  return new Promise(async (resolve) => {
    document.getElementById('invite-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'invite-modal-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:20px';
    overlay.innerHTML = `
      <div style="background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,0.3)">
        <div style="padding:14px 18px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:8px">
          <h3 style="margin:0; flex:1; font-size:16px">${escapeHtml(title)}</h3>
          <button id="im-close" style="background:none; border:none; font-size:22px; cursor:pointer; padding:0 6px; line-height:1">×</button>
        </div>
        <div style="flex:1; overflow:auto; padding:14px 18px">
          ${description ? `<p class="hint" style="margin:0 0 10px; font-size:13px">${escapeHtml(description)}</p>` : ''}
          <div class="bold" style="font-size:13px; margin-bottom:6px">対象者を選ぶ (${minPick}〜${maxPick} 人)</div>
          <div id="im-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
          <div id="im-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
        </div>
        <div style="padding:12px 18px; border-top:1px solid #eee; display:flex; gap:8px; justify-content:flex-end">
          ${allowPublic ? '<button id="im-public" class="btn">公開卓で立てる</button>' : ''}
          <button id="im-invite" class="btn primary">対象者で即開始</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let picker = null;
    try {
      picker = await createMemberPicker({
        bulkContainer:  document.getElementById('im-bulk'),
        chipsContainer: document.getElementById('im-chips'),
        initial: [],
        excludeIds: [Number(state.me?.id)],
        showGenderBulk: false,
      });
    } catch (e) {
      document.getElementById('im-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    }

    const cleanup = () => overlay.remove();
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) { cleanup(); resolve(null); } });
    document.getElementById('im-close').addEventListener('click', () => { cleanup(); resolve(null); });
    document.getElementById('im-public')?.addEventListener('click', () => { cleanup(); resolve({ kind: 'public' }); });
    document.getElementById('im-invite').addEventListener('click', () => {
      const ids = picker ? [...picker.getSelected()] : [];
      if (ids.length < minPick) { alert(`${minPick} 人以上選んでください`); return; }
      if (ids.length > maxPick) { alert(`${maxPick} 人まで`); return; }
      cleanup(); resolve({ kind: 'invite', memberIds: ids });
    });
  });
}
