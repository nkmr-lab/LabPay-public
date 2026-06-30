// /#/jinrou — 人狼ゲーム Phase 1。 v570 #223。
//   役職: 村人 / 人狼 / 占い師 / 騎士。 4-16 人。
//   夜 (人狼襲撃 + 占い + 護衛) → 昼 (投票で追放) → 勝敗 or 次夜。
//   プレイフィー方式 (lobby 中のみ返金)。

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { createMemberPicker } from '../member_picker.js';

const ROLE_LABELS = {
  villager: { name: '村人', icon: '👨‍🌾', desc: '昼の投票で人狼を追放することが目標', color: '#666' },
  wolf:     { name: '人狼', icon: '🐺', desc: '夜に襲撃、仲間と協力して村人を全滅させる', color: '#dc2626' },
  seer:     { name: '占い師', icon: '🔮', desc: '夜に 1 人占って人狼かどうか分かる', color: '#7c3aed' },
  knight:   { name: '騎士', icon: '🛡', desc: '夜に 1 人護衛、人狼の襲撃から守る', color: '#15803d' },
};

export async function renderJinrou() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; flex-wrap:wrap">
        <h2 style="margin:0">🐺 人狼</h2>
        <span style="flex:1"></span>
        <a class="btn primary" href="#/jinrou/new">＋ 新規卓</a>
      </div>
      <div class="hint-sm" style="margin-top:6px; font-size:12px">
        4-16 人でプレイフィー 2pt → 役職配布 (村人 / 人狼 / 占い師 / 騎士) → 夜 (人狼襲撃 + 占い + 護衛) → 昼 (投票で追放) → 人狼全滅 or 人狼≥村人で決着。
      </div>
    </div>
    <div id="jr-list" class="list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/jinrou/games');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('jr-list').innerHTML = '<div class="empty">卓がありません。「＋ 新規卓」から立ててメンバーを集めましょう (4 人以上必要)。</div>';
      return;
    }
    document.getElementById('jr-list').innerHTML = items.map(g => {
      const statusTag = {
        lobby: `<span class="tag warn">募集中 ${g.player_count}名</span>`,
        night: `<span class="tag" style="background:#1e293b; color:#fff">🌙 夜 R${g.round_no}</span>`,
        day: `<span class="tag" style="background:#fef3c7; color:#a16207">☀ 昼 R${g.round_no}</span>`,
        finished: g.winner === 'village' ? '<span class="tag" style="background:#dcfce7; color:#15803d">村人勝利</span>' :
                  g.winner === 'wolves'  ? '<span class="tag" style="background:#fecaca; color:#b91c1c">人狼勝利</span>' :
                                            '<span class="tag muted">終了</span>',
        cancelled: '<span class="tag" style="background:#fecaca; color:#b91c1c">キャンセル</span>',
      }[g.status] || '';
      const meBadge = g.me_joined && g.status !== 'finished' && g.status !== 'cancelled' && g.status !== 'ended' ? '<span class="tag ok">参加中</span>' : '';
      return `
        <a class="list-item" href="#/jinrou/${g.id}" style="gap:8px; align-items:center">
          <span style="display:inline-flex; flex:none">${avatarHtml(g.creator_name, g.creator_avatar, 'sm')}</span>
          <div class="grow">
            <div class="bold">🐺 人狼 #${g.id} ${statusTag} ${meBadge}</div>
            <div class="meta">${escapeHtml(g.creator_name)} 起案 · プレイフィー ${g.buy_in}pt × ${g.player_count}人</div>
          </div>
        </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('jr-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

export async function renderJinrouNew() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/jinrou" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🐺 人狼 — 新規卓</h2>
      <p class="hint" style="font-size:13px">
        4 人以上で開始可能。役職構成は人数で自動調整 (4-5人: 人狼1 / 占い1 / 騎士1 / 残り村人、 6-8人: 人狼2、 9-12人: 人狼3、 13-16人: 人狼4)。
      </p>
      <label class="field">
        <span class="lbl">プレイフィー (pt 1 人あたり)</span>
        <input type="number" id="jr-buyin" min="1" max="100" value="2">
      </label>
      <div style="margin-top:10px">
        <span class="lbl">招待するメンバー (任意)</span>
        <div id="jr-bulk" class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:6px"></div>
        <div id="jr-chips" class="row" style="gap:6px; flex-wrap:wrap"></div>
      </div>
      <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:13px">
        <input type="checkbox" id="jr-instant" checked>
        対象者で即開始 (3 人以上招待で全員から一括徴収 + 役職配布 + 即 night phase)
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:10px">
        <a href="#/jinrou" class="btn">キャンセル</a>
        <button id="jr-go" class="primary">卓を立てる</button>
      </div>
    </div>
  `;
  let picker = null;
  try {
    picker = await createMemberPicker({
      bulkContainer:  document.getElementById('jr-bulk'),
      chipsContainer: document.getElementById('jr-chips'),
      initial: [],
      excludeIds: [Number(state.me?.id)],
      showGenderBulk: false,
    });
  } catch (e) { document.getElementById('jr-chips').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`; }
  document.getElementById('jr-go').addEventListener('click', async () => {
    const buyIn = Number(document.getElementById('jr-buyin').value) || 1;
    const memberIds = picker ? [...picker.getSelected()] : [];
    const btn = document.getElementById('jr-go');
    btn.disabled = true; btn.textContent = '作成中…';
    const instant = document.getElementById('jr-instant')?.checked && memberIds.length >= 3;
    try {
      const r = await post('/api/jinrou/games', { buy_in: buyIn, member_ids: memberIds, instant_start: instant });
      navigate('#/jinrou/' + r.id);
    } catch (e) { toast('失敗: ' + e.message); btn.disabled = false; btn.textContent = '卓を立てる'; }
  });
}

export async function renderJinrouDetail({ params }) {
  const gid = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="muted">読み込み中…</div></div>`;
  let g;
  try { g = await get('/api/jinrou/games/' + gid); }
  catch (e) { app.innerHTML = `<div class="card"><div class="muted">${escapeHtml(e.message)}</div></div>`; return; }
  paintJinrouDetail(g);
}

function paintJinrouDetail(g) {
  const app = document.getElementById('app');
  const meRole = g.my_role;
  const meRoleInfo = meRole ? ROLE_LABELS[meRole] : null;

  const canJoin = g.status === 'lobby' && !g.me_joined;
  const canLeave = g.status === 'lobby' && g.me_joined && !g.is_creator;
  const canStart = g.status === 'lobby' && g.is_creator && g.players.length >= 4;
  const canCancel = g.is_creator && ['lobby','night','day'].includes(g.status);
  const canAdvance = g.is_creator && ['night','day'].includes(g.status);

  // 自分のアクション (フェーズ別)
  let actionUI = '';
  if (g.me_joined && g.my_alive && (g.status === 'night' || g.status === 'day')) {
    const alivePlayers = g.players.filter(p => p.alive && !p.is_me);
    let actionType = null;
    let title = '';
    if (g.status === 'night') {
      if (meRole === 'wolf') { actionType = 'attack'; title = '🐺 襲撃する相手を選ぶ'; }
      else if (meRole === 'seer') { actionType = 'inspect'; title = '🔮 占う相手を選ぶ'; }
      else if (meRole === 'knight') { actionType = 'protect'; title = '🛡 護衛する相手を選ぶ (人狼の襲撃から守る)'; }
      else { actionUI = '<div class="card"><div class="hint">🌙 夜 — あなたには夜のアクションはありません。起案者が「夜を終える」と昼に進みます。</div></div>'; }
    } else {
      actionType = 'vote';
      title = '☀ 追放する相手を投票';
    }
    if (actionType) {
      const myActionTarget = g.my_action?.target_user_id;
      actionUI = `
        <div class="card">
          <div class="bold" style="margin-bottom:6px">${title}</div>
          <div style="display:flex; flex-wrap:wrap; gap:6px">
            ${alivePlayers.map(p => {
              const sel = myActionTarget === p.user_id;
              return `<button data-action-type="${actionType}" data-action-target="${p.user_id}"
                style="display:flex; align-items:center; gap:4px; padding:6px 10px; border:2px solid ${sel ? 'var(--primary, #4a106d)' : 'var(--line)'}; background:${sel ? '#f7eefa' : '#fff'}; border-radius:6px; cursor:pointer">
                <span style="display:inline-flex; flex:none">${avatarHtml(p.display_name, p.avatar_url, 'xs')}</span>
                <span style="font-size:13px">${escapeHtml(p.display_name)}</span>
                ${sel ? '<span style="color:var(--primary); font-weight:700; margin-left:4px">✓</span>' : ''}
              </button>`;
            }).join('')}
          </div>
          ${myActionTarget ? `<div class="hint-sm" style="margin-top:6px; color:#15803d">✓ 提出済 (進行待ち)</div>` : ''}
        </div>`;
    }
  }
  if (g.me_joined && !g.my_alive && (g.status === 'night' || g.status === 'day')) {
    actionUI = '<div class="card"><div class="hint" style="color:#dc2626">💀 あなたは死亡しています。観戦のみ。</div></div>';
  }

  // 占い結果 (占い師のみ)
  let inspectUI = '';
  if (g.my_role === 'seer' && g.inspect_results.length > 0) {
    inspectUI = `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">🔮 占い結果</div>
        ${g.inspect_results.map(r => {
          const target = g.players.find(p => p.user_id === r.target_uid);
          const isWolf = r.target_role === 'wolf';
          return `<div style="padding:6px 10px; background:${isWolf ? '#fecaca' : '#dcfce7'}; border-left:3px solid ${isWolf ? '#dc2626' : '#15803d'}; border-radius:0 4px 4px 0; margin-bottom:4px; font-size:13px">
            R${r.round} に占った <span class="bold">${escapeHtml(target?.display_name || '?')}</span> は <span class="bold" style="color:${isWolf ? '#dc2626' : '#15803d'}">${isWolf ? '🐺 人狼' : '👨‍🌾 人狼ではない'}</span> でした
          </div>`;
        }).join('')}
      </div>`;
  }

  // ログ表示
  let logUI = '';
  if (g.log && g.log.length > 0) {
    logUI = `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">📜 ログ</div>
        ${g.log.map(e => {
          if (e.event === 'game_start') return `<div class="meta">⏯ ゲーム開始 (${e.players} 人、人狼${e.config?.wolf_count || '?'})</div>`;
          if (e.event === 'night_result') {
            const k = g.players.find(p => p.user_id === e.killed);
            const p = g.players.find(p => p.user_id === e.protected);
            return `<div class="meta">🌙 R${e.round} 夜: ${e.killed ? `<span style="color:#dc2626">${escapeHtml(k?.display_name || '?')} が襲撃されました</span>` : '誰も襲われませんでした'} ${e.protected ? ` (騎士は ${escapeHtml(p?.display_name || '?')} を護衛)` : ''}</div>`;
          }
          if (e.event === 'lynch') {
            const t = g.players.find(p => p.user_id === e.target);
            return `<div class="meta">☀ R${e.round} 昼: <span style="color:#dc2626">${escapeHtml(t?.display_name || '?')} が追放</span></div>`;
          }
          if (e.event === 'finished') return `<div class="meta bold" style="color:${e.winner === 'village' ? '#15803d' : '#dc2626'}">🏁 終了: ${e.winner === 'village' ? '村人勝利' : '人狼勝利'}</div>`;
          return '';
        }).join('')}
      </div>`;
  }

  app.innerHTML = `
    <div class="card">
      <a href="#/jinrou" class="hint">← 一覧</a>
      <h2 style="margin:6px 0">🐺 人狼 #${g.id} ${statusBadge(g)}</h2>
      <div class="meta">${escapeHtml(g.creator_name)} 起案 · プレイフィー ${g.buy_in}pt × ${g.players.length}人</div>
    </div>

    ${meRoleInfo ? `
      <div class="card" style="background:linear-gradient(135deg, ${meRoleInfo.color}, ${meRoleInfo.color}cc); color:#fff">
        <div style="font-size:12px; opacity:0.9">あなたの役職 (秘密)</div>
        <div style="font-size:32px; font-weight:700; line-height:1.2">${meRoleInfo.icon} ${meRoleInfo.name}</div>
        <div style="font-size:13px; opacity:0.95; margin-top:4px">${meRoleInfo.desc}</div>
      </div>` : ''}

    ${actionUI}
    ${inspectUI}

    <div class="card">
      <div class="bold" style="margin-bottom:6px">👥 参加者 (${g.players.length}名、生存 ${g.players.filter(p => p.alive).length})</div>
      <div class="list">
        ${g.players.map(p => {
          const roleInfo = p.role ? ROLE_LABELS[p.role] : null;
          const roleTag = roleInfo ? `<span style="font-size:11px; padding:1px 6px; background:${roleInfo.color}22; color:${roleInfo.color}; border-radius:4px; margin-left:4px">${roleInfo.icon} ${roleInfo.name}</span>` : '';
          return `
            <div class="list-item" style="gap:8px; align-items:center; ${!p.alive ? 'opacity:0.4;' : ''}">
              <span style="display:inline-flex; flex:none">${avatarHtml(p.display_name, p.avatar_url, 'sm')}</span>
              <div class="grow">
                <div class="bold">${!p.alive ? '💀 ' : ''}${escapeHtml(p.display_name)}${p.is_me ? ' (あなた)' : ''}${roleTag}</div>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div class="row" style="gap:6px; margin-top:10px; flex-wrap:wrap; justify-content:flex-end">
        ${canJoin   ? `<button id="jr-join"   class="primary">参加する (フィー ${g.buy_in}pt)</button>` : ''}
        ${canLeave  ? `<button id="jr-leave"  class="btn">脱退 (返金)</button>` : ''}
        ${canStart  ? `<button id="jr-start"  class="primary">役職を配って開始</button>` : ''}
        ${canAdvance ? `<button id="jr-adv"   class="primary">${g.status === 'night' ? '夜を終える (昼へ)' : '昼を終える (次の夜へ)'}</button>` : ''}
        ${canCancel ? `<button id="jr-cancel" class="btn danger">卓を取消</button>` : ''}
      </div>
    </div>

    ${logUI}
  `;

  if (canJoin)   document.getElementById('jr-join').addEventListener('click', () => doJr(g.id, 'join'));
  if (canLeave)  document.getElementById('jr-leave').addEventListener('click', () => { if (confirm('脱退して返金しますか?')) doJr(g.id, 'leave'); });
  if (canStart)  document.getElementById('jr-start').addEventListener('click', () => { if (confirm('役職を配って開始しますか? 配布後は変更不可。')) doJr(g.id, 'start'); });
  if (canAdvance) document.getElementById('jr-adv').addEventListener('click', () => { if (confirm('進行しますか? (アクション未提出者は無効票になります)')) doJr(g.id, 'advance'); });
  if (canCancel) document.getElementById('jr-cancel').addEventListener('click', () => { if (confirm('卓を取消しますか? lobby 中なら全員返金。')) doJr(g.id, 'cancel'); });

  // アクションボタン
  document.querySelectorAll('[data-action-type]').forEach(b => {
    b.addEventListener('click', async () => {
      const type = b.dataset.actionType;
      const target = Number(b.dataset.actionTarget);
      try {
        await post(`/api/jinrou/games/${g.id}/action`, { type, target_user_id: target });
        toast('提出しました');
        await renderJinrouDetail({ params: { id: g.id } });
      } catch (e) { toast('失敗: ' + e.message); }
    });
  });
}

function statusBadge(g) {
  if (g.status === 'lobby') return `<span class="tag warn">募集中 ${g.players.length}名</span>`;
  if (g.status === 'night') return `<span class="tag" style="background:#1e293b; color:#fff">🌙 夜 R${g.round_no}</span>`;
  if (g.status === 'day')   return `<span class="tag" style="background:#fef3c7; color:#a16207">☀ 昼 R${g.round_no}</span>`;
  if (g.status === 'finished') return g.winner === 'village' ? '<span class="tag" style="background:#dcfce7; color:#15803d">村人勝利🎉</span>' : '<span class="tag" style="background:#fecaca; color:#b91c1c">人狼勝利🐺</span>';
  if (g.status === 'cancelled') return '<span class="tag" style="background:#fecaca; color:#b91c1c">キャンセル</span>';
  return '';
}

async function doJr(gid, action) {
  try {
    await post(`/api/jinrou/games/${gid}/${action}`, {});
    toast('完了');
    await renderJinrouDetail({ params: { id: gid } });
  } catch (e) { toast('失敗: ' + e.message); }
}
