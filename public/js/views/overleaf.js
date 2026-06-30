// /#/overleaf — Overleaf プロジェクト追跡 (LabPay 内アプリ)。教員 admin 限定。
//   pyoverleaf が教員アカウントの全共有プロジェクトを定期取得 → 文字数スナップショット
//   が DB に積まれる → ここで「最近動きがあったプロジェクト」を一覧表示、詳細で推移を見る。
//
// 設計:
//   - 一覧: 直近 24h / 7d の文字数増減を出す、並び順 = 最終更新 / 24h 増加 / 7d 増加 / 名前
//   - 詳細: 60 日 chart + 最新ファイル別内訳
//   - admin が collector を設定して走らせる想定。未設定なら「セットアップガイド」表示。

import { get } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { fmtRelative } from '../format.js';

function fmtSigned(n) {
  if (n === 0 || n == null) return '±0';
  return (n > 0 ? '+' : '') + n.toLocaleString('en-US');
}
function colorForDelta(n) {
  if (n == null) return '#888';
  if (n > 0) return '#16a34a';
  if (n < 0) return '#dc2626';
  return '#888';
}

// 14日sparkline (純CSS / SVG 描画、 chart ライブラリ無し)
function sparklineSvg(points) {
  if (!points || !points.length) return '';
  const w = 80, h = 20, pad = 1;
  const cs = points.map(p => p.c);
  const min = Math.min(...cs), max = Math.max(...cs);
  const span = max - min || 1;
  const xStep = (w - pad * 2) / Math.max(1, points.length - 1);
  const pts = points.map((p, i) => {
    const x = pad + i * xStep;
    const y = pad + (h - pad * 2) * (1 - (p.c - min) / span);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle">
    <polyline points="${pts}" fill="none" stroke="#7b3fa0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export async function renderOverleafList() {
  const app = document.getElementById('app');
  if ((state.me?.role || '') !== 'admin') {
    app.innerHTML = `
      <div class="card">
        <h2 style="margin:0">📝 Overleaf 追跡</h2>
        <p>このアプリは教員アカウント(admin)限定です。</p>
      </div>`;
    return;
  }
  app.innerHTML = `
    <div class="card page-header">
      <div class="row center">
        <h2 style="margin:0">📝 Overleaf プロジェクト追跡</h2>
      </div>
      <div id="ovl-status" class="hint" style="margin-top:4px; font-size:11px"></div>
    </div>
    <div class="card">
      <div class="row" style="gap:6px; align-items:center; font-size:13px; flex-wrap:wrap">
        <label>並び順:
          <select id="ovl-sort" style="font-size:12px">
            <option value="recent">最終更新が新しい順</option>
            <option value="delta24">直近24hで増えた順</option>
            <option value="delta7">直近7日で増えた順</option>
            <option value="size">文字数が多い順</option>
            <option value="name">名前順</option>
          </select>
        </label>
        <label style="margin-left:8px">表示:
          <select id="ovl-metric" style="font-size:12px">
            <option value="total">全文字数</option>
            <option value="body">本文のみ (コマンド除外)</option>
            <option value="jp">日本語文字数</option>
            <option value="word">単語数</option>
          </select>
        </label>
        <span id="ovl-count" class="hint-sm" style="margin-left:auto; font-size:11px"></span>
      </div>
    </div>
    <div id="ovl-list" class="list" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
  `;

  // status (collector last run)
  try {
    const s = await get('/api/overleaf/status');
    const st = document.getElementById('ovl-status');
    if (s.last_run) {
      const tag = s.last_run.ok ? '✓' : '✗';
      st.innerHTML = `${tag} 最終取得: ${fmtRelative(s.last_run.finished_at || s.last_run.started_at)} ・プロジェクト ${s.project_count} 件 / snapshot ${s.snapshot_count.toLocaleString()} 件`;
      if (!s.last_run.ok && s.last_run.error_msg) {
        st.innerHTML += ` <span style="color:#dc2626">(err: ${escapeHtml(s.last_run.error_msg.slice(0,120))})</span>`;
      }
    } else {
      st.innerHTML = `⚠ collector がまだ一度も走っていません。サーバで <code>scripts/overleaf_collector.py</code> をセットアップしてください。`;
    }
  } catch (e) { /* status は best-effort */ }

  let items = [];
  try {
    const d = await get('/api/overleaf/projects');
    items = d.items || [];
  } catch (e) {
    document.getElementById('ovl-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  const sortSel   = document.getElementById('ovl-sort');
  const metricSel = document.getElementById('ovl-metric');
  sortSel.addEventListener('change', render);
  metricSel.addEventListener('change', render);

  const metricField = {
    total: ['total_char_count', '字'],
    body:  ['total_char_body',  '字(本文)'],
    jp:    ['total_jp_char_count', '字(日本語)'],
    word:  ['total_word_count', 'words'],
  };

  function render() {
    const sort = sortSel.value;
    const [mField, mUnit] = metricField[metricSel.value];
    const sorted = items.slice().sort((a, b) => {
      const av = a.latest?.[mField] || 0;
      const bv = b.latest?.[mField] || 0;
      const ad24 = a.delta_24h?.[mField === 'total_char_count' ? 'total_char_count' : 'total_char_body'] || 0;
      const bd24 = b.delta_24h?.[mField === 'total_char_count' ? 'total_char_count' : 'total_char_body'] || 0;
      const ad7  = a.delta_7d?.[mField === 'total_char_count' ? 'total_char_count' : 'total_char_body'] || 0;
      const bd7  = b.delta_7d?.[mField === 'total_char_count' ? 'total_char_count' : 'total_char_body'] || 0;
      if (sort === 'recent') return (b.last_remote_updated_at || '').localeCompare(a.last_remote_updated_at || '');
      if (sort === 'delta24') return bd24 - ad24;
      if (sort === 'delta7')  return bd7  - ad7;
      if (sort === 'size')    return bv - av;
      if (sort === 'name')    return (a.name || '').localeCompare(b.name || '');
      return 0;
    });
    document.getElementById('ovl-count').textContent = `${sorted.length} 件`;
    if (!sorted.length) {
      document.getElementById('ovl-list').innerHTML = `<div class="empty">まだプロジェクトがありません。 collector が走るとここに出てきます。</div>`;
      return;
    }
    document.getElementById('ovl-list').innerHTML = sorted.map(p => {
      const cur  = p.latest?.[mField] || 0;
      const d24Key = mField === 'total_char_count' ? 'total_char_count' : 'total_char_body';
      const d24  = p.delta_24h?.[d24Key];
      const d7   = p.delta_7d?.[d24Key];
      const own  = p.owner_name || p.owner_email || '?';
      const lastU = p.last_remote_updated_at ? fmtRelative(p.last_remote_updated_at) : '—';
      const archTag = p.is_archived ? '<span class="tag muted" style="font-size:10px">🗄 archived</span>' : '';
      return `
        <a class="list-item" href="#/overleaf/${p.id}" style="align-items:flex-start">
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
              ${escapeHtml(p.name)} ${archTag}
            </div>
            <div class="meta" style="font-size:12px">
              👤 ${escapeHtml(own)} ・最終更新 ${escapeHtml(lastU)}
              ${p.latest ? ` ・ ${p.latest.file_count} ファイル` : ''}
            </div>
            <div style="margin-top:4px; font-size:13px; display:flex; gap:10px; flex-wrap:wrap; align-items:center">
              <span><b>${cur.toLocaleString()}</b> <span class="muted" style="font-size:11px">${mUnit}</span></span>
              <span style="color:${colorForDelta(d24)}">24h: ${d24 != null ? fmtSigned(d24) : '—'}</span>
              <span style="color:${colorForDelta(d7)}">7d: ${d7 != null ? fmtSigned(d7) : '—'}</span>
              <span style="margin-left:auto">${sparklineSvg(p.sparkline)}</span>
            </div>
          </div>
        </a>`;
    }).join('');
  }
  render();
}

export async function renderOverleafDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  if ((state.me?.role || '') !== 'admin') {
    app.innerHTML = `<div class="card"><p>admin 限定です。</p></div>`;
    return;
  }
  app.innerHTML = `
    <div class="card">
      <a href="#/overleaf" class="hint">← 一覧</a>
      <div id="ovd-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card" id="ovd-chart-card" hidden>
      <h3 style="margin:0 0 8px">📈 文字数推移 (直近 60 日)</h3>
      <div id="ovd-chart"></div>
    </div>
    <div class="card" id="ovd-files-card" hidden>
      <h3 style="margin:0 0 8px">📂 ファイル別内訳 (最新 snapshot)</h3>
      <div id="ovd-files"></div>
    </div>
  `;
  let d;
  try { d = await get('/api/overleaf/projects/' + id); }
  catch (e) {
    document.getElementById('ovd-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }
  const p = d.project;
  const head = document.getElementById('ovd-head');
  const latest = d.latest;
  const own = p.owner_name || p.owner_email || '?';
  const overleafUrl = `https://www.overleaf.com/project/${encodeURIComponent(p.overleaf_id)}`;
  head.innerHTML = `
    <h2 style="margin:0">${escapeHtml(p.name)}</h2>
    <div class="meta" style="margin-top:4px">👤 ${escapeHtml(own)} ・初回観測 ${escapeHtml(p.first_seen_at || '?')} ・最終更新 ${escapeHtml(p.last_remote_updated_at || '?')}</div>
    <div style="margin-top:8px">
      <a class="btn primary" href="${escapeHtml(overleafUrl)}" target="_blank" rel="noopener">↗ Overleaf で開く</a>
    </div>
    ${latest ? `
      <div style="margin-top:10px; display:flex; gap:14px; flex-wrap:wrap">
        <div><div class="muted" style="font-size:11px">全文字数</div><div class="bold" style="font-size:18px">${latest.total_char_count.toLocaleString()}</div></div>
        <div><div class="muted" style="font-size:11px">本文 (cmd除外)</div><div class="bold" style="font-size:18px">${latest.total_char_body.toLocaleString()}</div></div>
        <div><div class="muted" style="font-size:11px">日本語文字</div><div class="bold" style="font-size:18px">${latest.total_jp_char_count.toLocaleString()}</div></div>
        <div><div class="muted" style="font-size:11px">単語数 (英文)</div><div class="bold" style="font-size:18px">${latest.total_word_count.toLocaleString()}</div></div>
        <div><div class="muted" style="font-size:11px">ファイル数</div><div class="bold" style="font-size:18px">${latest.file_count}</div></div>
      </div>` : '<div class="muted" style="margin-top:8px">snapshot がまだありません</div>'}`;

  // chart
  if (d.history && d.history.length >= 2) {
    document.getElementById('ovd-chart-card').hidden = false;
    document.getElementById('ovd-chart').innerHTML = renderHistoryChart(d.history);
  }
  // files
  if (d.files && d.files.length) {
    document.getElementById('ovd-files-card').hidden = false;
    document.getElementById('ovd-files').innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:12px">
        <thead><tr style="border-bottom:1px solid var(--line)">
          <th style="text-align:left; padding:4px">ファイル</th>
          <th style="text-align:right; padding:4px">全文字</th>
          <th style="text-align:right; padding:4px">本文</th>
          <th style="text-align:right; padding:4px">日本語</th>
          <th style="text-align:right; padding:4px">単語</th>
        </tr></thead>
        <tbody>${d.files.map(f => `
          <tr style="border-bottom:1px solid var(--line)">
            <td style="padding:4px">${escapeHtml(f.file_path)}</td>
            <td style="padding:4px; text-align:right">${f.char_count_total.toLocaleString()}</td>
            <td style="padding:4px; text-align:right">${f.char_count_body.toLocaleString()}</td>
            <td style="padding:4px; text-align:right">${f.jp_char_count.toLocaleString()}</td>
            <td style="padding:4px; text-align:right">${f.word_count.toLocaleString()}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }
}

function renderHistoryChart(history) {
  // SVG折れ線。 X = 時間軸、 Y = total_char_count + total_char_body の2系列。
  const w = 640, h = 200, padL = 50, padR = 16, padT = 14, padB = 30;
  const inner_w = w - padL - padR, inner_h = h - padT - padB;
  const xs = history.map(h => new Date(h.taken_at).getTime());
  const totals = history.map(h => h.total_char_count);
  const bodies = history.map(h => h.total_char_body);
  const tMin = Math.min(...xs), tMax = Math.max(...xs);
  const yMax = Math.max(...totals, 100);
  const xAt = t => padL + ((t - tMin) / (tMax - tMin || 1)) * inner_w;
  const yAt = v => padT + inner_h - (v / yMax) * inner_h;
  const linePts = (arr) => arr.map((v, i) => `${xAt(xs[i]).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const yTicks = 4;
  const yAxis = [];
  for (let i = 0; i <= yTicks; i++) {
    const yv = Math.round(yMax * (i / yTicks));
    const y = yAt(yv);
    yAxis.push(`<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#eee" stroke-width="1"/>
                <text x="${padL-4}" y="${y+3}" text-anchor="end" font-size="9" fill="#888">${yv.toLocaleString()}</text>`);
  }
  // X 軸ラベル: 日付 (4 箇所)
  const xLabels = [];
  const nTicks = 4;
  for (let i = 0; i <= nTicks; i++) {
    const t = tMin + (tMax - tMin) * (i / nTicks);
    const d = new Date(t);
    const lbl = `${d.getMonth()+1}/${d.getDate()}`;
    xLabels.push(`<text x="${xAt(t)}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#666">${lbl}</text>`);
  }
  return `
    <svg width="100%" viewBox="0 0 ${w} ${h}" style="display:block; max-width:100%">
      ${yAxis.join('')}
      <polyline points="${linePts(totals)}" fill="none" stroke="#7b3fa0" stroke-width="2"/>
      <polyline points="${linePts(bodies)}" fill="none" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="3,2"/>
      ${xLabels.join('')}
      <text x="${padL}" y="10" font-size="10" fill="#7b3fa0">━━ 全文字数</text>
      <text x="${padL + 90}" y="10" font-size="10" fill="#16a34a">┄┄ 本文(cmd除外)</text>
    </svg>`;
}
