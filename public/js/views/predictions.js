// v576 優勝予想 (Championship Prediction) view.
//   /#/predictions          一覧
//   /#/predictions/new      起案
//   /#/predictions/:id      詳細 (予想入力 / 結果開示 / 集計)

import { escapeHtml, navigate } from '../router.js';
import { get, post, patch } from '../api.js';
import { toast, state } from '../app.js';
import { shareToSns } from '../share_to_sns.js';

const MEDAL = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];

function medalFor(i) { return MEDAL[i] ?? `${i+1}位`; }

function statusBadge(st) {
  switch (st) {
    case 'open':      return '<span style="background:#e3f8e6; color:#1e8b3c; padding:1px 8px; border-radius:6px; font-size:11px">受付中</span>';
    case 'closed':    return '<span style="background:#fff5d4; color:#946d00; padding:1px 8px; border-radius:6px; font-size:11px">締切済</span>';
    case 'finished':  return '<span style="background:#e7e7f3; color:#4a106d; padding:1px 8px; border-radius:6px; font-size:11px">結果公開済</span>';
    case 'cancelled': return '<span style="background:#f8e3e3; color:#8b2c1e; padding:1px 8px; border-radius:6px; font-size:11px">キャンセル</span>';
    default: return escapeHtml(st);
  }
}

export async function renderPredictions() {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  try {
    const d = await get('/api/predictions/games');
    const items = d.items || [];
    app.innerHTML = `
      <div class="card page-header">
        <h2 style="margin:0">🏆 優勝予想</h2>
        <p class="hint" style="margin:6px 0 0; font-size:13px">
          W 杯やスポーツ大会、学会 best paper など「順位」を予想して参加フィーを山分け。
          配分は <b>1位的中者で山分け</b> (場代 5% のみシステム取り)。
          ランキング表示のスコアは 1位=5 / 2位=3 / 3位=2 / 4位=1 の一致和。
        </p>
        <p style="margin:8px 0 0">
          <a class="btn primary" href="#/predictions/new">＋ 予想を起案する</a>
        </p>
      </div>
      ${items.length ? items.map(g => `
        <a class="card" href="#/predictions/${g.id}" style="display:block; text-decoration:none; color:inherit">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px">
            <div class="bold" style="flex:1">${escapeHtml(g.title)}</div>
            ${statusBadge(g.status)}
            ${g.me_entered ? '<span style="color:#1e8b3c; font-size:11px">✓ 参加済</span>' : ''}
          </div>
          <div class="meta" style="font-size:12px">
            起案: ${escapeHtml(g.creator_name)} ・
            参加 ${g.entry_count} 人・
            ${g.predict_count}位まで予想・
            フィー ${g.fee}pt ・
            プール ${g.pot_total}pt
            ${g.deadline_at ? ` ・締切 ${escapeHtml(g.deadline_at)}` : ''}
          </div>
        </a>
      `).join('') : `
        <div class="card"><div class="hint" style="text-align:center; padding:20px">まだ予想が起案されていません。最初の起案をどうぞ。</div></div>
      `}
    `;
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="hint">読み込み失敗: ${escapeHtml(String(e?.message || e))}</div></div>`;
  }
}

export async function renderPredictionNew() {
  const { createMemberPicker } = await import('../member_picker.js');
  const app = document.getElementById('app');
  // 候補は textarea で 1 行 = 1 候補 (絵文字 + 名前をスペース区切り)
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 10px">🏆 予想を起案する</h2>
      <label style="display:block; margin-bottom:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">タイトル</div>
        <input id="pn-title" class="input" placeholder="例: 2026 ワールドカップ優勝予想" maxlength="200">
      </label>
      <label style="display:block; margin-bottom:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">説明 (任意)</div>
        <textarea id="pn-desc" class="input" rows="2" placeholder="例: 北中米開催。開催前までに予想を出してね" maxlength="1000"></textarea>
      </label>
      <div style="display:flex; gap:10px; margin-bottom:10px">
        <label style="flex:1">
          <div class="bold" style="font-size:13px; margin-bottom:4px">予想範囲</div>
          <select id="pn-count" class="input">
            <option value="1">1位のみ</option>
            <option value="2">1位 / 2位</option>
            <option value="4" selected>1位 〜 4位</option>
          </select>
        </label>
        <label style="flex:1">
          <div class="bold" style="font-size:13px; margin-bottom:4px">参加フィー (10-100pt)</div>
          <input id="pn-fee" class="input" type="number" min="10" max="100" value="50">
        </label>
      </div>
      <label style="display:block; margin-bottom:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">締切 (任意 / 過ぎたら予想不可)</div>
        <input id="pn-deadline" class="input" type="datetime-local">
      </label>
      <label style="display:block; margin-bottom:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">候補リスト (1 行 = 1 候補)</div>
        <p class="hint" style="font-size:12px; margin:0 0 4px">先頭の絵文字 (旗 / アイコン) はスペース区切りで任意。例: <code>🇧🇷 ブラジル</code></p>
        <textarea id="pn-candidates" class="input" rows="12" placeholder="🇧🇷 ブラジル&#10;🇦🇷 アルゼンチン&#10;🇫🇷 フランス&#10;…"></textarea>
      </label>
      <div style="margin-bottom:10px">
        <div class="bold" style="font-size:13px; margin-bottom:4px">📣 通知を飛ばすメンバー (任意。起案直後に admin_notice で受付開始を通知)</div>
        <div id="pn-notify-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="pn-notify-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <div style="display:flex; gap:8px">
        <button class="btn primary" id="pn-submit">起案する</button>
        <a class="btn" href="#/predictions">キャンセル</a>
      </div>
    </div>
  `;
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer:  document.getElementById('pn-notify-bulk'),
      chipsContainer: document.getElementById('pn-notify-chips'),
      initial: [],
      excludeIds: [Number(state.me?.id)],
      showGenderBulk: false,
    });
  } catch (_) {}
  document.getElementById('pn-submit').addEventListener('click', async () => {
    const title = document.getElementById('pn-title').value.trim();
    const desc  = document.getElementById('pn-desc').value.trim();
    const count = parseInt(document.getElementById('pn-count').value, 10);
    const fee   = parseInt(document.getElementById('pn-fee').value, 10);
    const dl    = document.getElementById('pn-deadline').value;
    const raw   = document.getElementById('pn-candidates').value;
    if (!title) { toast('タイトルを入れてください'); return; }
    if (!(fee >= 10 && fee <= 100)) { toast('フィーは 10-100pt'); return; }
    const candidates = raw.split('\n').map(line => line.trim()).filter(Boolean).map((line, i) => {
      const m = line.match(/^(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*|\S+)\s+(.+)$/u);
      if (m) return { id: `c${i}`, name: m[2], flag: m[1] };
      return { id: `c${i}`, name: line, flag: null };
    });
    if (candidates.length < count + 1) {
      toast(`候補が少ないです。 ${count + 1} 個以上入れてください`); return;
    }
    const body = { title, fee, predict_count: count, candidates };
    if (desc) body.description = desc;
    if (dl) body.deadline_at = dl.replace('T', ' ') + ':00';
    if (picker) body.notify_user_ids = [...picker.getSelected()];
    try {
      const r = await post('/api/predictions/games', body);
      navigate(`#/predictions/${r.id}`);
    } catch (e) {
      toast('起案失敗: ' + (e?.message || e));
    }
  });
}

export async function renderPredictionDetail(ctx) {
  const app = document.getElementById('app');
  const gid = parseInt(ctx.params.id, 10);
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  let g;
  try {
    g = await get(`/api/predictions/games/${gid}`);
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="hint">読み込み失敗: ${escapeHtml(String(e?.message || e))}</div></div>`;
    return;
  }
  app.innerHTML = renderDetailHtml(g);
  wireDetail(g);
}

function renderDetailHtml(g) {
  const candById = Object.fromEntries(g.candidates.map(c => [c.id, c]));
  const renderRanks = (ranks) => ranks
    ? ranks.map((cid, i) => `<div style="display:flex; gap:6px; align-items:center">
        <span style="width:30px">${medalFor(i)}</span>
        <span>${escapeHtml(candById[cid]?.flag || '')} ${escapeHtml(candById[cid]?.name || cid)}</span>
      </div>`).join('')
    : '<div class="meta">非公開 (結果開示後に表示)</div>';

  const candidatesHtml = g.candidates.map((c, i) =>
    `<button class="pred-cand" data-cid="${escapeHtml(c.id)}"
       style="display:inline-flex; gap:4px; align-items:center; margin:3px;
              padding:6px 10px; border:1px solid var(--line); border-radius:8px;
              background:#fff; cursor:pointer">
       <span style="font-size:18px">${escapeHtml(c.flag || '')}</span>
       <span>${escapeHtml(c.name)}</span>
     </button>`
  ).join('');

  const slotsHtml = Array.from({length: g.predict_count}, (_, i) =>
    `<div class="pred-slot" data-i="${i}"
       style="display:flex; align-items:center; gap:8px; padding:6px 10px;
              border:2px dashed var(--line); border-radius:8px; margin:4px 0; min-height:36px">
       <span style="font-size:18px; width:32px">${medalFor(i)}</span>
       <span class="slot-content" style="flex:1; color:#999">タップで下から選択</span>
       <button class="slot-clear" type="button"
         style="background:none; border:none; color:#c00; cursor:pointer; font-size:18px"
         hidden>×</button>
     </div>`
  ).join('');

  let predictArea = '';
  if (g.status === 'open') {
    if (g.me_entered) {
      predictArea = `
        <div class="card">
          <h3 style="margin:0 0 6px">あなたの予想 (変更可能)</h3>
          <div id="pred-slots">${slotsHtml}</div>
          <div style="margin:10px 0 6px"><div class="bold" style="font-size:13px">候補から選ぶ</div></div>
          <div id="pred-cands">${candidatesHtml}</div>
          <button class="btn primary" id="pred-submit" style="margin-top:10px">予想を更新する</button>
        </div>`;
    } else {
      predictArea = `
        <div class="card">
          <h3 style="margin:0 0 4px">予想を入力する</h3>
          <p class="hint" style="margin:0 0 8px; font-size:12px">参加フィー ${g.fee}pt を支払って予想を提出します。締切前なら何度でも変更可能。</p>
          <div id="pred-slots">${slotsHtml}</div>
          <div style="margin:10px 0 6px"><div class="bold" style="font-size:13px">候補から選ぶ</div></div>
          <div id="pred-cands">${candidatesHtml}</div>
          <button class="btn primary" id="pred-submit" style="margin-top:10px">フィー ${g.fee}pt を支払って予想する</button>
        </div>`;
    }
  } else if (g.status === 'closed') {
    predictArea = `
      <div class="card">
        <h3 style="margin:0 0 4px">締切済み</h3>
        <p class="hint" style="margin:0">起案者が結果を開示するのを待ちましょう。</p>
      </div>`;
  } else if (g.status === 'cancelled') {
    predictArea = `
      <div class="card">
        <h3 style="margin:0 0 4px">キャンセル済</h3>
        <p class="hint" style="margin:0">参加フィーは全員に返金されました。</p>
      </div>`;
  }

  const myResult = (g.status === 'finished' && g.my_ranks) ? `
    <div class="card">
      <h3 style="margin:0 0 6px">あなたの予想と結果</h3>
      <div style="display:flex; gap:16px">
        <div style="flex:1">
          <div class="bold" style="font-size:12px; margin-bottom:4px">あなたの予想</div>
          ${renderRanks(g.my_ranks)}
        </div>
        <div style="flex:1">
          <div class="bold" style="font-size:12px; margin-bottom:4px">正解</div>
          ${renderRanks(g.actual)}
        </div>
      </div>
      <div style="margin-top:8px">スコア: <b>${g.my_score ?? 0}</b> / 払い戻し: <b>${g.my_payout ?? 0}pt</b></div>
    </div>` : '';

  const actualBlock = (g.status === 'finished' && g.actual) ? `
    <div class="card">
      <h3 style="margin:0 0 6px">📣 正解</h3>
      ${renderRanks(g.actual)}
    </div>` : '';

  const creatorBlock = (g.is_creator && (g.status === 'open' || g.status === 'closed')) ? `
    <div class="card">
      <h3 style="margin:0 0 4px">起案者メニュー</h3>
      <p class="hint" style="margin:0 0 8px; font-size:12px">受付を締め切ったら結果を開示できます。まだ誰も参加していない場合はキャンセルもできます。</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        ${g.status === 'open' ? `<button class="btn" id="pred-close">受付を締め切る</button>` : ''}
        <button class="btn primary" id="pred-open-finalize">結果を開示する…</button>
        <button class="btn" id="pred-cancel" style="color:#c00">キャンセル (全員フィー返金)</button>
      </div>
      <div id="pred-finalize-form" hidden style="margin-top:12px; padding:10px; border:1px solid var(--line); border-radius:8px">
        <div class="bold" style="margin-bottom:6px">正解の順位を入力</div>
        <div id="pred-actual-slots">${slotsHtml.replace(/class="pred-slot"/g, 'class="pred-actual-slot"').replace(/data-i="(\d+)"/g, 'data-i="$1" data-mode="actual"')}</div>
        <div style="margin:8px 0 6px"><div class="bold" style="font-size:13px">候補から選ぶ</div></div>
        <div id="pred-actual-cands">${candidatesHtml.replace(/class="pred-cand"/g, 'class="pred-actual-cand"')}</div>
        <button class="btn primary" id="pred-finalize" style="margin-top:10px">結果を確定して配分する</button>
      </div>
    </div>` : '';

  // ranks が入っているかで公開状態を判定 (サーバ側で締切後は ranks を埋めて返す)。
  const ranksRevealed = (g.entries || []).some(e => Array.isArray(e.ranks));
  const entriesBlock = (g.entries && g.entries.length) ? `
    <div class="card">
      <h3 style="margin:0 0 6px">参加者の予想 (${g.entries.length} 人${ranksRevealed ? ' / スコア順' : ' / 受付中 — 締切後に公開'})</h3>
      ${g.entries.map((e, idx) => Array.isArray(e.ranks)
        ? `<div style="border-top:1px solid var(--line); padding:6px 0">
             <div style="display:flex; align-items:center; gap:8px">
               <span style="font-size:13px; color:#888; width:24px">#${idx + 1}</span>
               <span class="bold">${escapeHtml(e.display_name)}</span>
               <span class="meta" style="font-size:12px">スコア ${e.score ?? 0}${typeof e.payout === 'number' && e.payout > 0 ? ` / 払戻 ${e.payout}pt` : ''}</span>
             </div>
             <div style="margin-top:4px; font-size:13px">${e.ranks.map((cid, i) =>
               `<span style="margin-right:8px">${medalFor(i)} ${escapeHtml(candById[cid]?.flag || '')}${escapeHtml(candById[cid]?.name || cid)}</span>`).join('')}</div>
           </div>`
        : `<div style="border-top:1px solid var(--line); padding:6px 0">
             <span class="bold">${escapeHtml(e.display_name)}</span>
             <span class="meta" style="font-size:12px"> ・予想は締切後に公開</span>
           </div>`
      ).join('')}
    </div>` : '';

  // v582 #226 締切までのカウントダウン (締切がある時だけ出す)。
  // v689 #273 締切が既に過ぎていれば「締切終了」をシンプルに表示。 status badge も
  //   server が「open」のままでも視覚的には「締切済」に下げる。
  const deadlinePassed = g.deadline_at
    && new Date(String(g.deadline_at).replace(' ', 'T')).getTime() <= Date.now();
  const effectiveStatus = (g.status === 'open' && deadlinePassed) ? 'closed' : g.status;
  const countdownBlock = !g.deadline_at ? '' : (deadlinePassed
    ? `<div style="margin-top:8px; padding:8px 12px; background:linear-gradient(90deg, #fee2e2, #fecaca);
                   border-left:4px solid #dc2626; border-radius:6px; font-size:14px; color:#7f1d1d">
         ⏰ 締切終了
         <span class="hint-sm" style="margin-left:6px">(${escapeHtml(g.deadline_at)})</span>
       </div>`
    : `<div id="pred-countdown" data-deadline="${escapeHtml(g.deadline_at)}"
            style="margin-top:8px; padding:8px 12px; background:linear-gradient(90deg, #fef3c7, #fff5d4);
                   border-left:4px solid #f59e0b; border-radius:6px; font-size:14px; color:#946d00">
         ⏳ 締切まで <b id="pred-cd-text">計算中…</b>
         <span class="hint-sm" style="margin-left:6px">(${escapeHtml(g.deadline_at)})</span>
       </div>`);
  // v848 #431 起案者はタイトル / 説明を編集できる (open / closed 中のみ)
  const canEdit = g.is_creator && (g.status === 'open' || g.status === 'closed');
  // v871 #453 〆切 / 候補 / 予想件数も編集可能に (候補と件数はエントリー 0 件のときだけ)。
  const fmtLocal = (s) => s ? String(s).replace(' ', 'T').slice(0, 16) : '';
  const hasEntries = (g.entries || []).length > 0;
  const editForm = canEdit ? `
    <div id="pred-edit-form" hidden style="margin-top:10px; padding:10px; border:1px dashed #c4b5fd; border-radius:8px; background:#faf5ff">
      <div class="bold" style="font-size:13px; margin-bottom:6px">✏️ 編集</div>
      <label class="field"><span class="lbl">タイトル</span>
        <input type="text" id="pred-edit-title" maxlength="200">
      </label>
      <label class="field"><span class="lbl">説明 (任意)</span>
        <textarea id="pred-edit-desc" rows="3" maxlength="2000"></textarea>
      </label>
      <label class="field"><span class="lbl">〆切日時 (任意)</span>
        <input type="datetime-local" id="pred-edit-deadline">
      </label>
      <label class="field">
        <span class="lbl">候補 (1 行 1 件、例: 日本 / ブラジル / アルゼンチン…)</span>
        ${hasEntries ? '<div class="hint-sm" style="color:#c00">※ すでに予想者がいるので候補は変更できません</div>' : ''}
        <textarea id="pred-edit-cands" rows="4" ${hasEntries ? 'disabled' : ''}>${escapeHtml((g.candidates || []).map(c => c.name).join('\n'))}</textarea>
      </label>
      <label class="field"><span class="lbl">予想する上位順位数 (1-50)
        ${hasEntries ? '<span class="hint-sm" style="color:#c00"> ※ 予想者がいるので変更不可</span>' : ''}
      </span>
        <input type="number" id="pred-edit-pc" min="1" max="50" value="${g.predict_count}" ${hasEntries ? 'disabled' : ''} style="width:100px">
      </label>
      <div class="row" style="gap:6px">
        <button class="btn primary" id="pred-edit-save">保存</button>
        <button class="btn" id="pred-edit-cancel">キャンセル</button>
      </div>
    </div>` : '';
  return `
    <div class="card page-header">
      <div style="display:flex; align-items:center; gap:8px">
        <h2 style="margin:0; flex:1" id="pred-title-display">${escapeHtml(g.title)}</h2>
        <span id="pred-status-badge">${statusBadge(effectiveStatus)}</span>
        ${canEdit ? '<button id="pred-edit-btn" class="btn" style="font-size:12px; padding:4px 8px" title="タイトル / 説明を編集">✏️</button>' : ''}
        <button id="pred-share" class="btn" style="font-size:12px; padding:4px 8px" title="らぼったーで共有">💬 共有</button>
      </div>
      <p class="hint" style="margin:6px 0 0; font-size:13px">
        起案: ${escapeHtml(g.creator_name)} ・
        ${g.predict_count}位まで予想・
        フィー ${g.fee}pt ・
        プール ${g.pot_total}pt
      </p>
      ${countdownBlock}
      <p id="pred-desc-display" style="margin:8px 0 0; white-space:pre-wrap" ${g.description ? '' : 'hidden'}>${escapeHtml(g.description || '')}</p>
      ${editForm}
    </div>
    ${actualBlock}
    ${myResult}
    ${predictArea}
    ${creatorBlock}
    ${entriesBlock}
  `;
}

let predCountdownTimer = null;
function startPredCountdown() {
  if (predCountdownTimer) { clearInterval(predCountdownTimer); predCountdownTimer = null; }
  const root = document.getElementById('pred-countdown');
  if (!root) return;
  const deadlineIso = (root.dataset.deadline || '').replace(' ', 'T');
  const target = new Date(deadlineIso).getTime();
  if (!target || isNaN(target)) return;
  const txt = document.getElementById('pred-cd-text');
  const tick = () => {
    const root2 = document.getElementById('pred-countdown');
    if (!root2) { clearInterval(predCountdownTimer); predCountdownTimer = null; return; }
    const diff = target - Date.now();
    if (diff <= 0) {
      // v689 #273 「⏳ 締切まで締切超過 ⛔」だと重ね表示で変だった → root 全体を
      //   「⏰ 締切終了」に置き換え。 status badge も「受付中」のままなら「締切済」に下げる。
      root.innerHTML = '⏰ 締切終了';
      root.style.background = 'linear-gradient(90deg, #fee2e2, #fecaca)';
      root.style.borderLeftColor = '#dc2626';
      root.style.color = '#7f1d1d';
      const badge = document.getElementById('pred-status-badge');
      if (badge && /受付中/.test(badge.textContent)) {
        badge.innerHTML = '<span style="background:#fff5d4; color:#946d00; padding:1px 8px; border-radius:6px; font-size:11px">締切済</span>';
      }
      clearInterval(predCountdownTimer); predCountdownTimer = null;
      return;
    }
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    txt.textContent = days > 0
      ? `${days} 日 ${hours} 時間 ${mins} 分 ${secs} 秒`
      : `${hours} 時間 ${mins} 分 ${secs} 秒`;
  };
  tick();
  predCountdownTimer = setInterval(tick, 1000);
}

function wireDetail(g) {
  startPredCountdown();
  document.getElementById('pred-share')?.addEventListener('click', () => {
    shareToSns(`🏆 「${g.title}」の優勝予想を受付中! フィー ${g.fee}pt`, `#/predictions/${g.id}`);
  });
  // v848 #431 起案者によるタイトル / 説明編集
  const editBtn   = document.getElementById('pred-edit-btn');
  const editForm  = document.getElementById('pred-edit-form');
  const titleDsp  = document.getElementById('pred-title-display');
  const descDsp   = document.getElementById('pred-desc-display');
  const titleInp  = document.getElementById('pred-edit-title');
  const descInp   = document.getElementById('pred-edit-desc');
  const deadlineInp = document.getElementById('pred-edit-deadline');
  const candsInp    = document.getElementById('pred-edit-cands');
  const pcInp       = document.getElementById('pred-edit-pc');
  editBtn?.addEventListener('click', () => {
    if (titleInp) titleInp.value = g.title || '';
    if (descInp)  descInp.value  = g.description || '';
    if (deadlineInp) deadlineInp.value = g.deadline_at ? String(g.deadline_at).replace(' ', 'T').slice(0, 16) : '';
    if (editForm) editForm.hidden = false;
  });
  document.getElementById('pred-edit-cancel')?.addEventListener('click', () => {
    if (editForm) editForm.hidden = true;
  });
  document.getElementById('pred-edit-save')?.addEventListener('click', async () => {
    const t = (titleInp?.value || '').trim();
    const d = (descInp?.value  || '').trim();
    if (!t) { toast('タイトルを入れてください'); return; }
    const payload = { title: t, description: d, deadline_at: deadlineInp?.value || '' };
    // v871 #453 候補 / 予想件数は entries が 0 のとき (disabled でないとき) だけ送る
    if (candsInp && !candsInp.disabled) {
      const arr = candsInp.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (arr.length < 2) { toast('候補は 2 件以上必要'); return; }
      payload.candidates = arr;
    }
    if (pcInp && !pcInp.disabled) {
      const pc = parseInt(pcInp.value, 10);
      if (isNaN(pc) || pc < 1 || pc > 50) { toast('予想件数は 1-50'); return; }
      payload.predict_count = pc;
    }
    try {
      await patch(`/api/predictions/games/${g.id}`, payload);
      toast('保存しました');
      // 候補 / 件数を変えた場合は描画を再取得した方が早い
      if (payload.candidates || payload.predict_count || payload.deadline_at !== (g.deadline_at || '')) {
        renderPredictionDetail({ params: { id: g.id } });
        return;
      }
      g.title = t; g.description = d;
      if (titleDsp) titleDsp.textContent = t;
      if (descDsp)  { descDsp.textContent = d; descDsp.hidden = !d; }
      if (editForm) editForm.hidden = true;
    } catch (e) { toast('失敗: ' + (e?.message || e)); }
  });
  const candById = Object.fromEntries(g.candidates.map(c => [c.id, c]));
  // 自分予想 (予想入力)
  if (g.status === 'open') {
    const slotsRoot = document.getElementById('pred-slots');
    const candsRoot = document.getElementById('pred-cands');
    if (slotsRoot && candsRoot) {
      const initial = g.my_ranks || Array.from({length: g.predict_count}, () => null);
      const picked = [...initial];
      const refresh = () => {
        slotsRoot.querySelectorAll('.pred-slot').forEach(slot => {
          const i = parseInt(slot.dataset.i, 10);
          const cid = picked[i];
          const content = slot.querySelector('.slot-content');
          const clear = slot.querySelector('.slot-clear');
          if (cid) {
            content.innerHTML = `${escapeHtml(candById[cid]?.flag || '')} <b>${escapeHtml(candById[cid]?.name || cid)}</b>`;
            content.style.color = 'var(--text)';
            clear.hidden = false;
          } else {
            content.textContent = 'タップで下から選択';
            content.style.color = '#999';
            clear.hidden = true;
          }
        });
        candsRoot.querySelectorAll('.pred-cand').forEach(b => {
          const cid = b.dataset.cid;
          const used = picked.includes(cid);
          b.style.opacity = used ? '0.35' : '1';
          b.style.pointerEvents = used ? 'none' : 'auto';
        });
      };
      slotsRoot.addEventListener('click', (ev) => {
        const c = ev.target.closest('.slot-clear');
        if (!c) return;
        const slot = c.closest('.pred-slot');
        picked[parseInt(slot.dataset.i, 10)] = null;
        refresh();
      });
      candsRoot.addEventListener('click', (ev) => {
        const b = ev.target.closest('.pred-cand');
        if (!b) return;
        const cid = b.dataset.cid;
        if (picked.includes(cid)) return;
        const idx = picked.findIndex(x => x === null);
        if (idx < 0) { toast('全部埋まっています。不要なものを × で消してください'); return; }
        picked[idx] = cid;
        refresh();
      });
      refresh();
      document.getElementById('pred-submit').addEventListener('click', async () => {
        if (picked.some(x => !x)) { toast('全 ' + g.predict_count + ' 位を埋めてください'); return; }
        try {
          await post(`/api/predictions/games/${g.id}/predict`, { ranks: picked });
          toast('予想を保存しました');
          renderPredictionDetail({ params: { id: g.id } });
        } catch (e) {
          toast('送信失敗: ' + (e?.message || e));
        }
      });
    }
  }
  // 起案者メニュー
  if (g.is_creator && (g.status === 'open' || g.status === 'closed')) {
    document.getElementById('pred-close')?.addEventListener('click', async () => {
      if (!confirm('受付を締め切りますか? (まだ結果開示ではありません)')) return;
      try {
        await post(`/api/predictions/games/${g.id}/close`, {});
        toast('締め切りました');
        renderPredictionDetail({ params: { id: g.id } });
      } catch (e) { toast('失敗: ' + (e?.message || e)); }
    });
    document.getElementById('pred-cancel')?.addEventListener('click', async () => {
      if (!confirm('キャンセルすると全員のフィーが返金され予想は破棄されます。よろしいですか?')) return;
      try {
        await post(`/api/predictions/games/${g.id}/cancel`, {});
        toast('キャンセルしました');
        navigate('#/predictions');
      } catch (e) { toast('失敗: ' + (e?.message || e)); }
    });
    const openBtn = document.getElementById('pred-open-finalize');
    const form    = document.getElementById('pred-finalize-form');
    openBtn?.addEventListener('click', () => { form.hidden = !form.hidden; });
    // actual 入力
    const actualSlotsRoot = document.getElementById('pred-actual-slots');
    const actualCandsRoot = document.getElementById('pred-actual-cands');
    if (actualSlotsRoot && actualCandsRoot) {
      const actual = Array.from({length: g.predict_count}, () => null);
      const refresh = () => {
        actualSlotsRoot.querySelectorAll('.pred-actual-slot').forEach(slot => {
          const i = parseInt(slot.dataset.i, 10);
          const cid = actual[i];
          const content = slot.querySelector('.slot-content');
          const clear = slot.querySelector('.slot-clear');
          if (cid) {
            content.innerHTML = `${escapeHtml(candById[cid]?.flag || '')} <b>${escapeHtml(candById[cid]?.name || cid)}</b>`;
            content.style.color = 'var(--text)';
            clear.hidden = false;
          } else {
            content.textContent = 'タップで下から選択';
            content.style.color = '#999';
            clear.hidden = true;
          }
        });
        actualCandsRoot.querySelectorAll('.pred-actual-cand').forEach(b => {
          const cid = b.dataset.cid;
          const used = actual.includes(cid);
          b.style.opacity = used ? '0.35' : '1';
          b.style.pointerEvents = used ? 'none' : 'auto';
        });
      };
      actualSlotsRoot.addEventListener('click', (ev) => {
        const c = ev.target.closest('.slot-clear');
        if (!c) return;
        const slot = c.closest('.pred-actual-slot');
        actual[parseInt(slot.dataset.i, 10)] = null;
        refresh();
      });
      actualCandsRoot.addEventListener('click', (ev) => {
        const b = ev.target.closest('.pred-actual-cand');
        if (!b) return;
        const cid = b.dataset.cid;
        if (actual.includes(cid)) return;
        const idx = actual.findIndex(x => x === null);
        if (idx < 0) return;
        actual[idx] = cid;
        refresh();
      });
      refresh();
      document.getElementById('pred-finalize').addEventListener('click', async () => {
        if (actual.some(x => !x)) { toast('全 ' + g.predict_count + ' 位を埋めてください'); return; }
        if (!confirm('結果を確定して配分しますか? この操作は取り消せません')) return;
        try {
          await post(`/api/predictions/games/${g.id}/finalize`, { actual });
          toast('結果を開示し配分しました');
          renderPredictionDetail({ params: { id: g.id } });
        } catch (e) { toast('失敗: ' + (e?.message || e)); }
      });
    }
  }
}
