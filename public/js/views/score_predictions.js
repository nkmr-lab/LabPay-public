// v609 #235 勝敗予測アプリ。試合のスコア (X 対 Y) を完璧に当てる予測。
//   /#/score-predictions          一覧
//   /#/score-predictions/new      起案
//   /#/score-predictions/:id      詳細 (予想 / 結果開示)

import { escapeHtml, navigate } from '../router.js';
import { get, post, patch } from '../api.js';
import { toast, state } from '../app.js';
import { shareToSns } from '../share_to_sns.js';

function statusBadge(st) {
  switch (st) {
    case 'open':      return '<span style="background:#e3f8e6; color:#1e8b3c; padding:1px 8px; border-radius:6px; font-size:11px">受付中</span>';
    case 'closed':    return '<span style="background:#fff5d4; color:#946d00; padding:1px 8px; border-radius:6px; font-size:11px">締切済</span>';
    case 'finished':  return '<span style="background:#e7e7f3; color:#4a106d; padding:1px 8px; border-radius:6px; font-size:11px">結果公開済</span>';
    case 'cancelled': return '<span style="background:#f8e3e3; color:#8b2c1e; padding:1px 8px; border-radius:6px; font-size:11px">キャンセル</span>';
    default: return escapeHtml(st);
  }
}

export async function renderScorePredictions() {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  try {
    const d = await get('/api/score_predictions/games');
    const items = d.items || [];
    app.innerHTML = `
      <div class="card page-header">
        <h2 style="margin:0">🎯 勝敗予測</h2>
        <p class="hint" style="margin:6px 0 0; font-size:13px">
          試合のスコア (例: 3-2) を完璧に当てた人が pot 総取り (山分け)。場代 5%。
          誰も完璧に当てなければ全員にフィー返金。
        </p>
        <p style="margin:8px 0 0">
          <a class="btn primary" href="#/score-predictions/new">＋ 試合を起案する</a>
        </p>
      </div>
      ${items.length ? items.map(g => `
        <a class="card" href="#/score-predictions/${g.id}" style="display:block; text-decoration:none; color:inherit">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px">
            <div class="bold" style="flex:1">${escapeHtml(g.team_home)} <span class="hint">対</span> ${escapeHtml(g.team_away)}</div>
            ${statusBadge(g.status)}
            ${g.me_entered ? '<span style="color:#1e8b3c; font-size:11px">✓ 参加済</span>' : ''}
          </div>
          <div class="meta" style="font-size:12px">${escapeHtml(g.title)}</div>
          <div class="meta" style="font-size:12px">
            起案: ${escapeHtml(g.creator_name)} ・
            参加 ${g.entry_count} 人・
            フィー ${g.fee}pt ・
            プール ${g.pot_total}pt
            ${g.actual_home !== null ? ` ・結果 ${g.actual_home}-${g.actual_away}` : ''}
            ${g.deadline_at ? ` ・締切 ${escapeHtml(g.deadline_at)}` : ''}
          </div>
        </a>
      `).join('') : `
        <div class="card"><div class="hint" style="text-align:center; padding:20px">まだ試合が起案されていません。「＋ 試合を起案する」 からどうぞ。</div></div>
      `}
    `;
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="hint">読み込み失敗: ${escapeHtml(String(e?.message || e))}</div></div>`;
  }
}

export async function renderScorePredictionNew() {
  const { createMemberPicker } = await import('../member_picker.js');
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 10px">🎯 勝敗予測を起案する</h2>
      <label style="display:block; margin-bottom:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">試合の概要 (タイトル)</div>
        <input id="spn-title" class="input" placeholder="例: W杯決勝日本 vs ブラジル" maxlength="200">
      </label>
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px">
        <label style="flex:1">
          <div class="bold" style="font-size:13px; margin-bottom:4px">対戦カード</div>
          <input id="spn-home" class="input" placeholder="例: 日本" maxlength="80">
        </label>
        <div style="font-size:20px; padding-top:18px">対</div>
        <label style="flex:1">
          <div class="bold" style="font-size:13px; margin-bottom:4px">　</div>
          <input id="spn-away" class="input" placeholder="例: ブラジル" maxlength="80">
        </label>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:10px">
        <label style="flex:1">
          <div class="bold" style="font-size:13px; margin-bottom:4px">参加フィー (10-100pt)</div>
          <input id="spn-fee" class="input" type="number" min="10" max="100" value="20">
        </label>
        <label style="flex:1">
          <div class="bold" style="font-size:13px; margin-bottom:4px">試合開始 (任意)</div>
          <input id="spn-match" class="input" type="datetime-local">
        </label>
      </div>
      <label style="display:block; margin-bottom:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">予想締切 (任意、試合開始と同じが普通)</div>
        <input id="spn-deadline" class="input" type="datetime-local">
      </label>
      <div style="margin-bottom:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">📣 通知を飛ばすメンバー (任意。 起案直後に admin_notice で受付開始を通知)</div>
        <div id="spn-notify-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="spn-notify-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div style="display:flex; gap:8px">
        <button class="btn primary" id="spn-submit">起案する</button>
        <a class="btn" href="#/score-predictions">キャンセル</a>
      </div>
    </div>
  `;
  document.getElementById('spn-match').addEventListener('change', (ev) => {
    const dl = document.getElementById('spn-deadline');
    if (!dl.value) dl.value = ev.target.value;
  });
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer:  document.getElementById('spn-notify-bulk'),
      chipsContainer: document.getElementById('spn-notify-chips'),
      initial: [],
      excludeIds: [Number(state.me?.id)],
      showGenderBulk: false,
    });
  } catch (_) {}
  document.getElementById('spn-submit').addEventListener('click', async () => {
    const title = document.getElementById('spn-title').value.trim();
    const home  = document.getElementById('spn-home').value.trim();
    const away  = document.getElementById('spn-away').value.trim();
    const fee   = parseInt(document.getElementById('spn-fee').value, 10);
    const match = document.getElementById('spn-match').value;
    const dl    = document.getElementById('spn-deadline').value;
    if (!title) { toast('タイトルを入れてください'); return; }
    if (!home || !away) { toast('対戦相手を両方入れてください'); return; }
    if (!(fee >= 10 && fee <= 100)) { toast('フィーは10-100pt'); return; }
    const body = { title, team_home: home, team_away: away, fee };
    if (match) body.match_at = match.replace('T', ' ') + ':00';
    if (dl)    body.deadline_at = dl.replace('T', ' ') + ':00';
    if (picker) body.notify_user_ids = [...picker.getSelected()];
    try {
      const r = await post('/api/score_predictions/games', body);
      navigate(`#/score-predictions/${r.id}`);
    } catch (e) {
      toast('起案失敗: ' + (e?.message || e));
    }
  });
}

let spCountdownTimer = null;
function startSpCountdown() {
  if (spCountdownTimer) { clearInterval(spCountdownTimer); spCountdownTimer = null; }
  const root = document.getElementById('sp-countdown');
  if (!root) return;
  const target = new Date((root.dataset.deadline || '').replace(' ', 'T')).getTime();
  if (!target || isNaN(target)) return;
  const txt = document.getElementById('sp-cd-text');
  const tick = () => {
    if (!document.getElementById('sp-countdown')) { clearInterval(spCountdownTimer); spCountdownTimer = null; return; }
    const diff = target - Date.now();
    if (diff <= 0) {
      // v689 #273 「⏳ 締切まで締切超過 ⛔」 だと重ね表示で変だった → 「⏰ 締切終了」 だけに。
      root.innerHTML = '⏰ 締切終了';
      root.style.background = 'linear-gradient(90deg, #fee2e2, #fecaca)';
      root.style.borderLeftColor = '#dc2626';
      root.style.color = '#7f1d1d';
      clearInterval(spCountdownTimer); spCountdownTimer = null;
      return;
    }
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    txt.textContent = days > 0 ? `${days} 日 ${hours} 時間 ${mins} 分 ${secs} 秒` : `${hours} 時間 ${mins} 分 ${secs} 秒`;
  };
  tick();
  spCountdownTimer = setInterval(tick, 1000);
}

export async function renderScorePredictionDetail(ctx) {
  const app = document.getElementById('app');
  const gid = parseInt(ctx.params.id, 10);
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  let g;
  try {
    g = await get(`/api/score_predictions/games/${gid}`);
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="hint">読み込み失敗: ${escapeHtml(String(e?.message || e))}</div></div>`;
    return;
  }
  paintSpDetail(g);
}

function paintSpDetail(g) {
  const app = document.getElementById('app');
  // v689 #273 締切が過ぎていればシンプルに 「締切終了」 を表示。
  const deadlinePassed = g.deadline_at
    && new Date(String(g.deadline_at).replace(' ', 'T')).getTime() <= Date.now();
  const countdownBlock = !g.deadline_at || g.status !== 'open' ? '' : (deadlinePassed
    ? `<div style="margin-top:8px; padding:8px 12px; background:linear-gradient(90deg, #fee2e2, #fecaca);
                   border-left:4px solid #dc2626; border-radius:6px; font-size:14px; color:#7f1d1d">⏰ 締切終了</div>`
    : `<div id="sp-countdown" data-deadline="${escapeHtml(g.deadline_at)}"
            style="margin-top:8px; padding:8px 12px; background:linear-gradient(90deg, #fef3c7, #fff5d4);
                   border-left:4px solid #f59e0b; border-radius:6px; font-size:14px; color:#946d00">
         ⏳ 締切まで <b id="sp-cd-text">計算中…</b>
       </div>`);

  let predictArea = '';
  if (g.status === 'open') {
    const cur = g.my_guess || { home: 0, away: 0 };
    predictArea = `
      <div class="card">
        <h3 style="margin:0 0 6px">${g.me_entered ? '予想を変更' : '予想を入力'}</h3>
        <p class="hint" style="margin:0 0 8px; font-size:12px">
          ${g.me_entered ? '締切前なら何度でも変更可能。' : `参加フィー ${g.fee}pt を支払って予想を登録します。締切前なら何度でも変更可能。`}
        </p>
        <div style="display:flex; gap:8px; align-items:center; justify-content:center; margin:14px 0">
          <div style="text-align:center; flex:1">
            <div class="bold" style="font-size:14px">${escapeHtml(g.team_home)}</div>
            <input id="sp-home" type="number" min="0" max="99" value="${cur.home}"
                   style="width:80px; font-size:48px; text-align:center; padding:4px; margin-top:6px; border:2px solid #ddd; border-radius:8px">
          </div>
          <div style="font-size:36px; padding-top:30px; color:#888">-</div>
          <div style="text-align:center; flex:1">
            <div class="bold" style="font-size:14px">${escapeHtml(g.team_away)}</div>
            <input id="sp-away" type="number" min="0" max="99" value="${cur.away}"
                   style="width:80px; font-size:48px; text-align:center; padding:4px; margin-top:6px; border:2px solid #ddd; border-radius:8px">
          </div>
        </div>
        <button class="btn primary" id="sp-submit" style="width:100%">${g.me_entered ? '予想を更新する' : `フィー ${g.fee}pt を支払って予想する`}</button>
      </div>`;
  } else if (g.status === 'closed') {
    predictArea = `<div class="card"><h3 style="margin:0 0 4px">締切済み</h3><p class="hint" style="margin:0">起案者が結果を登録するのを待ちましょう。</p></div>`;
  } else if (g.status === 'cancelled') {
    predictArea = `<div class="card"><h3 style="margin:0 0 4px">キャンセル済</h3><p class="hint" style="margin:0">参加フィーは全員に返金されました。</p></div>`;
  }

  const myResult = (g.status === 'finished' && g.my_guess) ? `
    <div class="card">
      <h3 style="margin:0 0 6px">あなたの予想と結果</h3>
      <div style="display:flex; gap:14px; align-items:center; justify-content:center; padding:10px 0">
        <div style="text-align:center">
          <div class="hint-sm">あなたの予想</div>
          <div style="font-size:32px; font-weight:700">${g.my_guess.home} - ${g.my_guess.away}</div>
        </div>
        <div style="text-align:center">
          <div class="hint-sm">正解</div>
          <div style="font-size:32px; font-weight:700; color:#dc2626">${g.actual_home} - ${g.actual_away}</div>
        </div>
      </div>
      <div style="text-align:center; margin-top:4px">
        ${g.my_winner ? `🎉 完全的中! <b>${g.my_payout}pt</b> 獲得` : (g.my_payout > 0 ? `返金 ${g.my_payout}pt` : '残念、外れ')}
      </div>
    </div>` : '';

  // v866 #448 起案者がタイトル / チーム名 / 試合日時 / 〆切 / フィーを後から
  //   編集できる。 fee はエントリーがあると変更不可 (サーバで弾く)。
  const fmtForLocal = (s) => {
    if (!s) return '';
    // 「2026-06-27 19:00:00」 形式 → 「2026-06-27T19:00」
    return String(s).replace(' ', 'T').slice(0, 16);
  };
  const creatorBlock = (g.is_creator && (g.status === 'open' || g.status === 'closed')) ? `
    <div class="card">
      <h3 style="margin:0 0 4px">起案者メニュー</h3>
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <button class="btn" id="sp-open-edit">✏️ 編集</button>
        ${g.status === 'open' ? `<button class="btn" id="sp-close">受付を締め切る</button>` : ''}
        <button class="btn primary" id="sp-open-finalize">結果を登録する…</button>
        <button class="btn" id="sp-cancel" style="color:#c00">キャンセル (全員返金)</button>
      </div>
      <div id="sp-edit-form" hidden style="margin-top:12px; padding:10px; border:1px solid var(--line); border-radius:8px">
        <div class="bold" style="margin-bottom:6px">✏️ 編集</div>
        <label style="display:block; font-size:13px; margin-top:6px">タイトル</label>
        <input id="sp-edit-title" type="text" maxlength="200" value="${escapeHtml(g.title || '')}" style="width:100%; padding:6px; border:1px solid var(--line); border-radius:6px">
        <div style="display:flex; gap:8px; margin-top:6px">
          <label style="flex:1; font-size:13px">
            ホーム
            <input id="sp-edit-home" type="text" maxlength="80" value="${escapeHtml(g.team_home || '')}" style="width:100%; padding:6px; border:1px solid var(--line); border-radius:6px">
          </label>
          <label style="flex:1; font-size:13px">
            アウェイ
            <input id="sp-edit-away" type="text" maxlength="80" value="${escapeHtml(g.team_away || '')}" style="width:100%; padding:6px; border:1px solid var(--line); border-radius:6px">
          </label>
        </div>
        <label style="display:block; font-size:13px; margin-top:6px">試合日時 (任意)</label>
        <input id="sp-edit-match" type="datetime-local" value="${fmtForLocal(g.match_at)}" style="padding:6px; border:1px solid var(--line); border-radius:6px">
        <label style="display:block; font-size:13px; margin-top:6px">〆切日時 (任意)</label>
        <input id="sp-edit-deadline" type="datetime-local" value="${fmtForLocal(g.deadline_at)}" style="padding:6px; border:1px solid var(--line); border-radius:6px">
        <label style="display:block; font-size:13px; margin-top:6px">
          フィー (pt)
          ${g.entries && g.entries.length ? '<span class="hint-sm" style="color:#c00"> ※ すでに予想者がいるので変更不可</span>' : ''}
        </label>
        <input id="sp-edit-fee" type="number" min="1" max="500" value="${g.fee}" ${g.entries && g.entries.length ? 'disabled' : ''} style="padding:6px; border:1px solid var(--line); border-radius:6px; width:120px">
        <div style="margin-top:10px; display:flex; gap:8px">
          <button class="btn primary" id="sp-edit-save">保存</button>
          <button class="btn" id="sp-edit-cancel">取消</button>
        </div>
      </div>
      <div id="sp-finalize-form" hidden style="margin-top:12px; padding:10px; border:1px solid var(--line); border-radius:8px">
        <div class="bold" style="margin-bottom:6px">最終スコア</div>
        <div style="display:flex; gap:8px; align-items:center; justify-content:center; margin:6px 0">
          <input id="sp-fin-home" type="number" min="0" max="99" value="0" style="width:70px; font-size:32px; text-align:center; border:2px solid #ddd; border-radius:8px; padding:4px">
          <span style="font-size:24px; color:#888">-</span>
          <input id="sp-fin-away" type="number" min="0" max="99" value="0" style="width:70px; font-size:32px; text-align:center; border:2px solid #ddd; border-radius:8px; padding:4px">
        </div>
        <button class="btn primary" id="sp-finalize" style="margin-top:6px">結果を確定して配分する</button>
      </div>
    </div>` : '';

  const entriesBlock = g.entries && g.entries.length ? `
    <div class="card">
      <h3 style="margin:0 0 6px">参加者の予想 (${g.entries.length} 人)</h3>
      ${g.entries.map((e, idx) => g.entries[0].guess_home !== null && e.guess_home !== null
        ? `<div style="border-top:1px solid var(--line); padding:6px 0; display:flex; gap:8px; align-items:center">
             <span class="bold" style="flex:1">${escapeHtml(e.display_name)}</span>
             <span style="font-variant-numeric:tabular-nums; font-size:14px; ${e.is_winner ? 'color:#dc2626; font-weight:700' : ''}">
               ${e.guess_home} - ${e.guess_away}
             </span>
             ${e.is_winner ? `<span style="background:#fef3c7; color:#946d00; padding:1px 6px; border-radius:6px; font-size:11px; font-weight:700">🎉 的中</span>` : ''}
             ${e.payout > 0 ? `<span class="hint-sm">+${e.payout}pt</span>` : ''}
           </div>`
        : `<div style="border-top:1px solid var(--line); padding:6px 0">
             <span class="bold">${escapeHtml(e.display_name)}</span>
             <span class="meta" style="font-size:12px"> ・予想は締切後に公開</span>
           </div>`
      ).join('')}
    </div>` : '';

  app.innerHTML = `
    <div class="card page-header">
      <div style="display:flex; align-items:center; gap:8px">
        <h2 style="margin:0; flex:1">${escapeHtml(g.team_home)} <span class="hint">対</span> ${escapeHtml(g.team_away)}</h2>
        ${statusBadge(g.status)}
        <button id="sp-share" class="btn" style="font-size:12px; padding:4px 8px">💬 共有</button>
      </div>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        ${escapeHtml(g.title)}<br>
        起案: ${escapeHtml(g.creator_name)} ・フィー ${g.fee}pt ・プール ${g.pot_total}pt
        ${g.match_at ? ` ・試合 ${escapeHtml(g.match_at)}` : ''}
      </p>
      ${countdownBlock}
    </div>
    ${myResult}
    ${predictArea}
    ${creatorBlock}
    ${entriesBlock}
  `;

  startSpCountdown();

  document.getElementById('sp-share')?.addEventListener('click', () => {
    shareToSns(`🎯 「${g.team_home} vs ${g.team_away}」 のスコア予想を ${g.status === 'open' ? '受付中' : '結果開示'}! フィー ${g.fee}pt`, `#/score-predictions/${g.id}`);
  });

  if (g.status === 'open') {
    document.getElementById('sp-submit')?.addEventListener('click', async () => {
      const home = parseInt(document.getElementById('sp-home').value, 10);
      const away = parseInt(document.getElementById('sp-away').value, 10);
      if (isNaN(home) || isNaN(away) || home < 0 || away < 0) { toast('スコアは 0 以上'); return; }
      try {
        await post(`/api/score_predictions/games/${g.id}/predict`, { home, away });
        toast('予想を保存しました');
        renderScorePredictionDetail({ params: { id: g.id } });
      } catch (e) { toast('失敗: ' + (e?.message || e)); }
    });
  }

  if (g.is_creator && (g.status === 'open' || g.status === 'closed')) {
    document.getElementById('sp-close')?.addEventListener('click', async () => {
      if (!confirm('受付を締め切りますか?')) return;
      try { await post(`/api/score_predictions/games/${g.id}/close`, {}); renderScorePredictionDetail({ params: { id: g.id } }); }
      catch (e) { toast('失敗: ' + (e?.message || e)); }
    });
    document.getElementById('sp-cancel')?.addEventListener('click', async () => {
      if (!confirm('キャンセルすると全員のフィーが返金され予想は破棄されます。よろしいですか?')) return;
      try { await post(`/api/score_predictions/games/${g.id}/cancel`, {}); navigate('#/score-predictions'); }
      catch (e) { toast('失敗: ' + (e?.message || e)); }
    });
    document.getElementById('sp-open-finalize')?.addEventListener('click', () => {
      const form = document.getElementById('sp-finalize-form');
      form.hidden = !form.hidden;
    });
    // v866 #448 編集フォーム
    document.getElementById('sp-open-edit')?.addEventListener('click', () => {
      const form = document.getElementById('sp-edit-form');
      form.hidden = !form.hidden;
    });
    document.getElementById('sp-edit-cancel')?.addEventListener('click', () => {
      document.getElementById('sp-edit-form').hidden = true;
    });
    document.getElementById('sp-edit-save')?.addEventListener('click', async () => {
      const payload = {
        title:       document.getElementById('sp-edit-title').value.trim(),
        team_home:   document.getElementById('sp-edit-home').value.trim(),
        team_away:   document.getElementById('sp-edit-away').value.trim(),
        match_at:    document.getElementById('sp-edit-match').value,
        deadline_at: document.getElementById('sp-edit-deadline').value,
      };
      const feeEl = document.getElementById('sp-edit-fee');
      if (feeEl && !feeEl.disabled) payload.fee = parseInt(feeEl.value, 10);
      if (!payload.title || !payload.team_home || !payload.team_away) {
        toast('タイトル / チーム名を入力してください'); return;
      }
      try {
        await patch(`/api/score_predictions/games/${g.id}`, payload);
        toast('✏️ 編集を保存しました');
        renderScorePredictionDetail({ params: { id: g.id } });
      } catch (e) { toast('失敗: ' + (e?.message || e)); }
    });
    document.getElementById('sp-finalize')?.addEventListener('click', async () => {
      const home = parseInt(document.getElementById('sp-fin-home').value, 10);
      const away = parseInt(document.getElementById('sp-fin-away').value, 10);
      if (isNaN(home) || isNaN(away) || home < 0 || away < 0) { toast('スコア不正'); return; }
      if (!confirm(`結果 ${home}-${away} で確定し配分しますか? この操作は取り消せません`)) return;
      try {
        await post(`/api/score_predictions/games/${g.id}/finalize`, { home, away });
        toast('結果を開示して配分しました');
        renderScorePredictionDetail({ params: { id: g.id } });
      } catch (e) { toast('失敗: ' + (e?.message || e)); }
    });
  }
}
