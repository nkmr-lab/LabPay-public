// /#/game-missions — v1274 娯楽ミッション (中村さん要望 D)。
//   主催者 が pt を出資 して 「setlog に投稿すれば 20pt」 等 の ゲリラミッション。
//   同額 を SYSTEM が補助 (50/50)。 参加者 は 対象機能 で 行動 すると 自動 で 支給。
//
// route:
//   /#/game-missions       — 一覧 + 起票ボタン
//   /#/game-missions/new   — 起票フォーム
//   /#/game-missions/{id}  — 詳細 (完了者リスト + 主催者ならキャンセル)

import { get, post } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { toast, state } from '../app.js';

function fmtRemaining(endsAt) {
  const t = new Date(String(endsAt).replace(' ', 'T'));
  const sec = Math.max(0, Math.floor((t - new Date()) / 1000));
  if (sec <= 0) return '終了間近';
  if (sec < 3600) return `あと${Math.floor(sec/60)}分`;
  if (sec < 86400) return `あと${Math.floor(sec/3600)}時間`;
  return `あと${Math.floor(sec/86400)}日`;
}

function statusPill(s) {
  const map = {
    active:    { bg: '#dcfce7', color: '#166534', label: '開催中' },
    ended:     { bg: '#f3f4f6', color: '#6b7280', label: '終了' },
    cancelled: { bg: '#fee2e2', color: '#991b1b', label: 'キャンセル' },
  };
  const m = map[s] || map.ended;
  return `<span style="background:${m.bg}; color:${m.color}; padding:1px 8px; border-radius:8px; font-size:11px; font-weight:600">${m.label}</span>`;
}

// ---------------- 一覧 ----------------

export async function renderGameMissions() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🎯 娯楽ミッション</h2>
      <div class="hint-sm" style="margin-top:4px">
        「setlogに投稿したら20pt」等のゲリラミッションを主催・参加。 主催者が出したptと
        <b>同額をLabPayが補助</b> (50/50) するので、 出資額が実質2倍のプールに。
        参加者は対象機能を使うだけで自動支給されます。
      </div>
      <div class="row" style="margin-top:8px; gap:8px">
        <a href="#/game-missions/new" class="btn primary" style="text-decoration:none; padding:6px 14px; font-size:13px">＋ ミッションを主催する</a>
      </div>
    </div>
    <div id="gm-list"><div class="hint">読み込み中…</div></div>
  `;
  await loadList();
}

async function loadList() {
  const root = document.getElementById('gm-list');
  try {
    const d = await get('/api/game-missions');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = `<div class="card"><div class="empty">まだミッションはありません。 「＋ ミッションを主催する」から始めよう。</div></div>`;
      return;
    }
    root.innerHTML = items.map(m => renderCard(m)).join('');
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="muted">取得失敗: ${escapeHtml(e.message)}</div></div>`;
  }
}

function renderCard(m) {
  const active = m.status === 'active';
  const remainingSlots = m.remaining;
  const pool = (m.host_deposit_pt|0) + (m.system_grant_pt|0);
  const doneBadge = m.completed_by_me ? '<span style="color:#059669; font-weight:700; margin-left:4px">✓ 達成済</span>' : '';
  const mineBadge = m.is_mine ? '<span style="background:#e0e7ff; color:#3730a3; padding:1px 6px; border-radius:6px; font-size:10px; margin-left:4px">主催</span>' : '';
  return `
    <a class="card" href="#/game-missions/${m.id}" style="display:block; text-decoration:none; color:inherit; margin-bottom:8px; padding:10px 14px; ${!active ? 'opacity:0.7' : ''}">
      <div class="row center" style="gap:6px; margin-bottom:4px">
        ${statusPill(m.status)}
        <span class="hint-sm" style="font-size:11px">${escapeHtml(m.feature_label || m.target_feature)}</span>
        ${active ? `<span class="hint-sm" style="font-size:11px; color:#a16207">🕒 ${fmtRemaining(m.ends_at)}</span>` : ''}
        ${mineBadge}${doneBadge}
      </div>
      <div class="bold" style="font-size:15px">${escapeHtml(m.title)}</div>
      <div class="hint-sm" style="margin-top:3px; font-size:12px">
        主催: ${escapeHtml(m.host_display_name || '?')}
        · 賞金プール ${pool}pt (主催 ${m.host_deposit_pt}pt + 補助 ${m.system_grant_pt}pt)
      </div>
      <div class="hint-sm" style="margin-top:2px; font-size:12px">
        報酬 <b>${m.reward_per_participant}pt</b> × 定員 ${m.max_participants}人
        · 残り <b>${remainingSlots}</b>枠 (${m.claimed_count_actual}/${m.max_participants} 達成)
      </div>
    </a>`;
}

// ---------------- 起票 ----------------

export async function renderGameMissionNew() {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  let features = {}, limits = {};
  try {
    const d = await get('/api/game-missions');
    features = d.features || {};
    limits = d.limits || {};
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="muted">取得失敗: ${escapeHtml(e.message)}</div></div>`;
    return;
  }
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">＋ ミッションを主催する</h2>
      <div class="hint-sm" style="margin-top:4px">
        あなたが出したptに <b>同額をLabPayが補助</b> (50/50)。参加者は対象機能を使うだけで
        自動的に報酬がもらえます。 参加が定員に届かなかった分は 半分ずつ返還されます。
      </div>
    </div>
    <div class="card">
      <label class="field">
        <span class="lbl">タイトル (200 字まで)</span>
        <input type="text" id="gm-title" maxlength="200" placeholder="例: setlog に 1 投稿で 20pt!">
      </label>
      <label class="field">
        <span class="lbl">対象機能</span>
        <select id="gm-feature">
          ${Object.entries(features).map(([k, v]) => `<option value="${escapeHtml(k)}">${escapeHtml(v)}</option>`).join('')}
        </select>
        <div class="hint-sm" style="font-size:11px; color:#6b7280">Phase 1 では setlog のみ 判定 hook が 動きます。 それ以外を選ぶと 起票 は 可能 ですが 自動達成 は しません (手動で 中止 して 返還 する形)。</div>
      </label>
      <label class="field">
        <span class="lbl">説明 (任意、 1000 字まで)</span>
        <textarea id="gm-desc" maxlength="1000" rows="2" placeholder="例: 今日の写真を setlog に上げよう"></textarea>
      </label>
      <div class="row" style="gap:8px; flex-wrap:wrap">
        <label class="field" style="flex:1; min-width:120px">
          <span class="lbl">1人あたり報酬 (pt)</span>
          <input type="number" id="gm-reward" min="1" max="${limits.max_reward}" value="20">
        </label>
        <label class="field" style="flex:1; min-width:120px">
          <span class="lbl">定員 (人)</span>
          <input type="number" id="gm-cap" min="1" max="${limits.max_participants}" value="5">
        </label>
        <label class="field" style="flex:1; min-width:120px">
          <span class="lbl">期限 (時間)</span>
          <select id="gm-hours">
            <option value="24">24 時間</option>
            <option value="72" selected>3 日</option>
            <option value="168">1 週間</option>
          </select>
        </label>
      </div>
      <div class="card" style="background:#fef3c7; margin:8px 0; padding:8px 12px; font-size:13px">
        <div id="gm-calc">計算中…</div>
      </div>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <a class="btn" href="#/game-missions" style="text-decoration:none">キャンセル</a>
        <button id="gm-submit" class="btn primary">主催する</button>
      </div>
    </div>
  `;
  const calc = () => {
    const reward = Number(document.getElementById('gm-reward').value) || 0;
    const cap    = Number(document.getElementById('gm-cap').value) || 0;
    const host = reward * cap;
    const pool = host * 2;
    const el = document.getElementById('gm-calc');
    if (host > (limits.max_host_deposit || 200)) {
      el.innerHTML = `<span style="color:#dc2626">⚠ 主催者出資が上限 ${limits.max_host_deposit}pt を超えます (${host}pt)。 報酬 or 定員を下げてください。</span>`;
    } else {
      el.innerHTML = `💰 あなたの出資 <b>${host}pt</b> + LabPay 補助 <b>${host}pt</b> = 賞金プール <b>${pool}pt</b> (${reward}pt × ${cap}人 分)`;
    }
  };
  ['gm-reward','gm-cap'].forEach(id => document.getElementById(id).addEventListener('input', calc));
  calc();

  document.getElementById('gm-submit').addEventListener('click', async () => {
    const body = {
      title: document.getElementById('gm-title').value.trim(),
      description: document.getElementById('gm-desc').value.trim(),
      target_feature: document.getElementById('gm-feature').value,
      reward_per_participant: Number(document.getElementById('gm-reward').value),
      max_participants: Number(document.getElementById('gm-cap').value),
      duration_hours: Number(document.getElementById('gm-hours').value),
    };
    if (!body.title) { toast('タイトルを入れてください'); return; }
    const host = body.reward_per_participant * body.max_participants;
    if (!confirm(`主催しますか?\n\nあなたの出資: ${host}pt (LabPay 補助 +${host}pt = プール ${host*2}pt)\n期限: ${body.duration_hours}時間`)) return;
    const btn = document.getElementById('gm-submit');
    btn.disabled = true; btn.textContent = '起票中…';
    try {
      const r = await post('/api/game-missions', body);
      toast('起票しました 🎯');
      navigate('#/game-missions/' + r.id);
    } catch (e) {
      btn.disabled = false; btn.textContent = '主催する';
      toast('失敗: ' + e.message);
    }
  });
}

// ---------------- 詳細 ----------------

export async function renderGameMissionDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><div class="hint">読み込み中…</div></div>`;
  let m;
  try {
    m = await get('/api/game-missions/' + id);
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="muted">取得失敗: ${escapeHtml(e.message)}</div></div>`;
    return;
  }
  const active = m.status === 'active';
  const pool = (m.host_deposit_pt|0) + (m.system_grant_pt|0);
  const claimedPt = (m.completions || []).reduce((s, c) => s + (c.reward_pt|0), 0);
  const remainingPt = Math.max(0, pool - claimedPt);
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center" style="gap:6px; margin-bottom:6px">
        ${statusPill(m.status)}
        <span class="hint-sm" style="font-size:12px">${escapeHtml(m.feature_label || m.target_feature)}</span>
        ${active ? `<span class="hint-sm" style="font-size:12px; color:#a16207">🕒 ${fmtRemaining(m.ends_at)}</span>` : ''}
      </div>
      <h2 style="margin:0">🎯 ${escapeHtml(m.title)}</h2>
      ${m.description ? `<div class="hint-sm" style="margin-top:6px; white-space:pre-wrap">${escapeHtml(m.description)}</div>` : ''}
      <div class="hint-sm" style="margin-top:6px; font-size:12px">
        主催: ${escapeHtml(m.host_display_name || '?')} ${m.is_mine ? '(あなた)' : ''}
      </div>
    </div>

    <div class="card">
      <div style="font-size:13px; line-height:1.7">
        💰 賞金プール <b>${pool}pt</b> (主催 ${m.host_deposit_pt}pt + LabPay 補助 ${m.system_grant_pt}pt)<br>
        🎁 報酬 <b>${m.reward_per_participant}pt</b> × 定員 ${m.max_participants}人<br>
        📊 達成 ${m.completions ? m.completions.length : 0}人 / 支給済 ${claimedPt}pt / 残プール ${remainingPt}pt<br>
        ${m.completed_by_me ? '<span style="color:#059669; font-weight:700">✓ あなたは達成済です</span>' : ''}
      </div>
      ${m.is_mine && active ? `
        <div class="row" style="margin-top:10px; justify-content:flex-end">
          <button id="gm-cancel" class="btn danger" style="font-size:12px">キャンセルする (残プールを返還)</button>
        </div>` : ''}
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px; font-size:14px">達成者 (${(m.completions || []).length})</h3>
      ${(m.completions && m.completions.length) ? `
        <div style="display:flex; flex-direction:column; gap:4px">
          ${m.completions.map(c => `
            <div class="row" style="gap:6px; align-items:center; padding:4px 0; font-size:13px">
              ${avatarHtml(c.display_name, c.avatar_url, 'sm')}
              <span class="bold">${escapeHtml(c.display_name || '?')}</span>
              <span class="hint-sm" style="font-size:11px; margin-left:auto">+${c.reward_pt}pt · ${String(c.completed_at).slice(5,16).replace('-','/')}</span>
            </div>
          `).join('')}
        </div>` : '<div class="hint-sm" style="color:#9ca3af">まだ達成者はいません</div>'}
    </div>

    <div class="card">
      <a href="#/game-missions" class="hint">← 一覧に戻る</a>
    </div>
  `;
  document.getElementById('gm-cancel')?.addEventListener('click', async () => {
    if (!confirm('ミッションをキャンセルしますか?\n\n残プール ' + remainingPt + 'pt が 主催者と LabPay に 半々で 返還されます。')) return;
    try {
      await post('/api/game-missions/' + id + '/cancel', {});
      toast('キャンセルしました');
      navigate('#/game-missions');
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
