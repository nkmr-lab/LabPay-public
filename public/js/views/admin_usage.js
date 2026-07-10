// v971 fb#478 利用統計 (admin 限定 /#/admin/usage)。
//   目的: 中村さん が 「どの アプリ が 使われて いる か」 を 見て API tier / 実装 優先度 を 決める。
//   ソース: activity_log (直近 40 日 で 968K 行)、 AI 系 は 専用 テーブル。 集計 は 全部 サーバ 側。

import { escapeHtml } from '../router.js';
import { get } from '../api.js';

let period = 30;    // 7 or 30 日

// 機能 名 の 表示 用 マップ (path prefix → 表示 名)
const FEATURE_LABEL = {
  'ai': '🤖 AI (要約 / 全訳 / DR)',
  'kanban': '📋 かんばん',
  'refs': '📚 文献管理',
  'polls': '🗳 投票',
  'public-polls': '🗳 公開投票',
  'joint-events': '🎪 合同研究会',
  'quotes': '💬 名言',
  'nkmr-albums': '📸 中村研アルバム',
  'places': '🍴 食べある記',
  'tier': '🎯 ティア表',
  'purchases': '💴 購入',
  'sell': '🏷 販売',
  'health': '⚖ 体重 / BMI',
  'walk': '🚶 散歩',
  'workouts': '💪 筋トレ',
  'exercise': '🏃 運動 (歩数)',
  'sns': '💬 らぼったー',
  'predictions': '🎯 勝敗予測',
  'quizzes': '📝 クイズ',
  'games': '🎮 ゲーム',
  'timers': '⏱ タイマー',
  'overleaf': '📝 Overleaf',
  'cosense': '📝 Cosense',
  'zoom': '📞 Zoom',
  'notices': '📢 重要連絡',
  'other': '(その他)',
};

const AI_LABEL = {
  'paper_summary':   '📑 論文要約',
  'paper_translate': '📑 論文全訳',
  'deep_research':   '🔎 Deep Research',
  'paper_review':    '🖊 論文査読',
};

export async function renderAdminUsage() {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card">📊 利用統計 を 読み込み中…</div>`;
  try {
    const d = await get('/api/admin/usage/summary', { days: period });
    app.innerHTML = renderPage(d);
    attachHandlers();
  } catch (e) {
    app.innerHTML = `<div class="card">⚠ 読み込み 失敗: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderPage(d) {
  const s = d.summary || {};
  return `
    <div class="card">
      <div class="row center" style="gap:8px">
        <h2 style="margin:0">📊 利用統計</h2>
        <span style="flex:1"></span>
        <button data-usage-period="7"  class="${period===7  ? 'primary' : ''}" style="font-size:12px; padding:4px 10px">直近 7 日</button>
        <button data-usage-period="30" class="${period===30 ? 'primary' : ''}" style="font-size:12px; padding:4px 10px">直近 30 日</button>
      </div>
      <div class="hint-sm" style="margin-top:6px">
        activity_log から 集計。 SPA の 定期 polling 系 (unread_count / latest_id / me 等) と POS scanner tick は
        「使ってる」 の 判定 から 除外 済み。 「機能 別」 は path prefix → カテゴリ の 分類。
      </div>
      <div style="margin-top:10px; display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:8px">
        ${statCard('👤 アクティブ ユーザ', s.active_users || 0)}
        ${statCard('📅 アクティブ 日数', s.active_days_seen || 0)}
        ${statCard('📊 有効 アクション', (s.total_hits || 0).toLocaleString())}
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">📈 DAU (直近 30 日)</h3>
      ${renderDauChart(d.dau_30d || [])}
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">🤖 AI 機能 の 呼び出し (直近 ${period} 日)</h3>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:8px">
        ${Object.entries(d.ai || {}).map(([k, a]) => renderAiCard(k, a)).join('')}
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">🧩 機能 別 (直近 ${period} 日、 ユニーク ユーザ 数 順)</h3>
      ${renderFeaturesTable(d.features || [])}
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">🏆 トップ ユーザ (直近 ${period} 日)</h3>
      ${renderUsersTable(d.top_users || [])}
    </div>

    <details class="card">
      <summary style="cursor:pointer; font-weight:600">🔍 トップ 30 raw path (参考、 ノイズ除去 後)</summary>
      ${renderPathsTable(d.top_paths || [])}
    </details>
  `;
}

function statCard(label, val) {
  return `
    <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:10px 12px">
      <div style="font-size:11px; color:#6b7280">${label}</div>
      <div style="font-size:22px; font-weight:700; color:#1f2937">${val}</div>
    </div>`;
}

function renderAiCard(key, a) {
  const runs = +a.runs || 0;
  const users = +a.users || 0;
  const done  = +a.done_count || 0;
  const err   = +a.error_count || 0;
  const pend  = +a.pending_count || 0;
  const doneRate = runs ? Math.round((done / runs) * 100) : 0;
  return `
    <div style="border:1px solid #e5e7eb; border-radius:6px; padding:10px 12px">
      <div style="font-size:13px; font-weight:600">${AI_LABEL[key] || key}</div>
      <div style="margin-top:4px; font-size:22px; font-weight:700; color:#4a106d">${runs}</div>
      <div style="font-size:11px; color:#6b7280">${users} 人 が 利用</div>
      <div style="margin-top:6px; font-size:11px; color:#374151">
        <span style="color:#10b981">✓ ${done}</span>
         · <span style="color:#dc2626">✗ ${err}</span>
         · <span style="color:#ea580c">⏳ ${pend}</span>
         · 成功率 ${doneRate}%
      </div>
    </div>`;
}

function renderFeaturesTable(features) {
  if (!features.length) return `<div class="hint-sm">データ なし</div>`;
  const maxUsers = Math.max(...features.map(f => +f.unique_users), 1);
  return `
    <div style="display:grid; grid-template-columns: minmax(0, 1fr) 60px 100px; gap:6px 12px; align-items:center; font-size:13px">
      <div style="font-weight:600; color:#6b7280; font-size:11px">機能</div>
      <div style="font-weight:600; color:#6b7280; font-size:11px; text-align:right">ユーザ</div>
      <div style="font-weight:600; color:#6b7280; font-size:11px; text-align:right">アクション</div>
      ${features.map(f => {
        const pct = Math.round((+f.unique_users / maxUsers) * 100);
        return `
          <div style="min-width:0">
            <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(FEATURE_LABEL[f.feature] || f.feature)}</div>
            <div style="height:4px; background:#f3f4f6; border-radius:2px; margin-top:2px">
              <div style="height:100%; width:${pct}%; background:#4a106d; border-radius:2px"></div>
            </div>
          </div>
          <div style="text-align:right; font-weight:600">${f.unique_users}</div>
          <div style="text-align:right; color:#6b7280">${(+f.hits).toLocaleString()}</div>
        `;
      }).join('')}
    </div>`;
}

function renderUsersTable(users) {
  if (!users.length) return `<div class="hint-sm">データ なし</div>`;
  return `
    <div style="display:grid; grid-template-columns: 24px minmax(0, 1fr) 60px 60px; gap:6px 10px; align-items:center; font-size:13px">
      <div style="font-weight:600; color:#6b7280; font-size:11px">#</div>
      <div style="font-weight:600; color:#6b7280; font-size:11px">ユーザ</div>
      <div style="font-weight:600; color:#6b7280; font-size:11px; text-align:right">日数</div>
      <div style="font-weight:600; color:#6b7280; font-size:11px; text-align:right">アクション</div>
      ${users.map((u, i) => `
        <div style="color:#9ca3af; text-align:right">${i + 1}</div>
        <div style="min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(u.display_name || `(user #${u.user_id})`)}</div>
        <div style="text-align:right">${u.active_days}</div>
        <div style="text-align:right; color:#6b7280">${(+u.hits).toLocaleString()}</div>
      `).join('')}
    </div>`;
}

function renderPathsTable(paths) {
  if (!paths.length) return `<div class="hint-sm">データ なし</div>`;
  return `
    <div style="display:grid; grid-template-columns: 40px minmax(0,1fr) 60px 60px; gap:4px 10px; align-items:center; font-size:12px; margin-top:8px">
      <div style="font-weight:600; color:#6b7280">method</div>
      <div style="font-weight:600; color:#6b7280">path</div>
      <div style="font-weight:600; color:#6b7280; text-align:right">hits</div>
      <div style="font-weight:600; color:#6b7280; text-align:right">users</div>
      ${paths.map(p => `
        <div style="font-family: ui-monospace, monospace; font-size:10px; color:#6b7280">${escapeHtml(p.method)}</div>
        <div style="font-family: ui-monospace, monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(p.path)}</div>
        <div style="text-align:right">${(+p.n).toLocaleString()}</div>
        <div style="text-align:right; color:#6b7280">${p.users}</div>
      `).join('')}
    </div>`;
}

// SVG line chart for DAU (last 30 days)
function renderDauChart(dau) {
  if (!dau.length) return `<div class="hint-sm">データ なし</div>`;
  const W = 640, H = 140, PAD_L = 30, PAD_R = 8, PAD_T = 10, PAD_B = 20;
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;
  const maxN = Math.max(...dau.map(x => +x.n), 1);
  const step = iw / Math.max(dau.length - 1, 1);
  const pts = dau.map((r, i) => {
    const x = PAD_L + i * step;
    const y = PAD_T + ih - (+r.n / maxN) * ih;
    return [x, y, r];
  });
  const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  // grid: 3 horizontal lines at 25/50/75 percent of maxN
  const grid = [0.25, 0.5, 0.75, 1].map(f => {
    const y = PAD_T + ih - f * ih;
    const label = Math.round(maxN * f);
    return `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#e5e7eb"/>
            <text x="${PAD_L - 4}" y="${y + 3}" font-size="9" fill="#9ca3af" text-anchor="end">${label}</text>`;
  }).join('');
  const xlabels = [dau[0], dau[Math.floor(dau.length / 2)], dau[dau.length - 1]].map((r, i) => {
    const pos = [PAD_L, PAD_L + iw / 2, PAD_L + iw][i];
    return `<text x="${pos}" y="${H - 4}" font-size="9" fill="#6b7280" text-anchor="middle">${(r?.d || '').slice(5)}</text>`;
  }).join('');
  const dots = pts.map(([x, y, r]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#4a106d"><title>${r.d}: ${r.n} 人</title></circle>`).join('');
  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%; max-width:100%; height:auto; display:block">
      ${grid}
      <polyline points="${poly}" fill="none" stroke="#4a106d" stroke-width="1.5" stroke-linejoin="round"/>
      ${dots}
      ${xlabels}
    </svg>`;
}

function attachHandlers() {
  document.querySelectorAll('[data-usage-period]').forEach(b => {
    b.addEventListener('click', () => {
      period = Number(b.dataset.usagePeriod);
      renderAdminUsage();
    });
  });
}
