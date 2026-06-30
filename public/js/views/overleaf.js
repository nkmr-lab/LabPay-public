// /#/overleaf — Overleaf プロジェクト追跡 (LabPay 内アプリ)。
//   pyoverleaf が教員アカウントの全共有プロジェクトを定期取得 → 文字数スナップショット
//   が DB に積まれる → ここで「最近動きがあったプロジェクト」を一覧表示、詳細で推移を見る。
//   v889 admin 限定だったのを LabPay ユーザ全員に開放、比較グラフ + stale 除外を追加。
//
// 設計:
//   - 一覧: 直近 24h / 7d の文字数増減を出す、並び順 = 最終更新 / 24h 増加 / 7d 増加 / 名前。
//     1か月以上更新なしのプロジェクトは 💤 タグ表示。
//   - 比較グラフ: 全プロジェクトを 1 つの SVG に重ね描き。stale (1か月以上更新なし) は除外。
//   - 詳細: 60 日 chart + 最新ファイル別内訳。

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';
import { fmtRelative } from '../format.js';

function fmtSigned(n) {
  if (n === 0 || n == null) return '±0';
  return (n > 0 ? '+' : '') + n.toLocaleString('en-US');
}

// v895 過去時刻向け 「N分前 / N時間前 / N日前 / YYYY-MM-DD」 表示。
//   fmtRelative は未来時刻 (締切までN分) 用で、過去だと 「超過」 と返すので overleaf には不適切。
function fmtPast(s) {
  if (!s) return '—';
  const t = new Date(String(s).replace(' ', 'T') + (String(s).includes('T') ? '' : '+09:00')).getTime();
  if (!Number.isFinite(t)) return '—';
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 0)       return new Date(t).toLocaleString('ja-JP', { hour12: false });
  if (diffSec < 60)      return 'たった今';
  if (diffSec < 3600)    return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400)   return `${Math.floor(diffSec / 3600)}時間前`;
  if (diffSec < 86400*7) return `${Math.floor(diffSec / 86400)}日前`;
  // 1週間以上は絶対日付
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function colorForDelta(n) {
  if (n == null) return '#888';
  if (n > 0) return '#16a34a';
  if (n < 0) return '#dc2626';
  return '#888';
}

// sparkline (純 SVG、 chart ライブラリ無し)
function sparklineSvg(points, metricKey = 'c') {
  if (!points || !points.length) return '';
  const w = 80, h = 20, pad = 1;
  const cs = points.map(p => p[metricKey] || 0);
  const min = Math.min(...cs), max = Math.max(...cs);
  const span = max - min || 1;
  const xStep = (w - pad * 2) / Math.max(1, points.length - 1);
  const pts = points.map((p, i) => {
    const x = pad + i * xStep;
    const y = pad + (h - pad * 2) * (1 - ((p[metricKey] || 0) - min) / span);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle">
    <polyline points="${pts}" fill="none" stroke="#7b3fa0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// v898 グラフ絞り込みプリセット。 slug は URL 共有可能、 match は projectName.includes() で判定。
//   よくある共著体パターンを最初から用意。 ここに無いものは「カスタム…」 で自由入力。
// v900 slug は URL に出るので意味のある形に。 例: /#/overleaf?filter=MasterThesis2026
// v901 プリセットを3種に絞った (ユーザ要望)。 他は 「カスタム…」 で自由入力可能。
const FILTER_PRESETS = [
  { slug: 'ResearchProgressReport', label: '📝 Research Progress Report', match: 'Research Progress Report' },
  { slug: 'MasterThesis2026',       label: '🎓 MasterThesis2026',         match: 'MasterThesis2026' },
  { slug: 'BachelorThesis2026',     label: '📜 BachelorThesis2026',       match: 'BachelorThesis2026' },
];

function applyOverleafFilter(items, filterStr) {
  if (!filterStr) return items;
  // preset slug 完全一致 → preset.match で includes 検索 (case insensitive)
  const preset = FILTER_PRESETS.find(p => p.slug === filterStr);
  const needle = (preset ? preset.match : filterStr).toLowerCase();
  return items.filter(p => (p.name || '').toLowerCase().includes(needle));
}

// v903 絞り込み中は project name から 共通部分 (フィルタ文字列) を削って、 個別部分だけを表示。
//   例: filter='Research Progress Report' → 「Research Progress Report（中村聡史）」 → 「中村聡史」
//   括弧/区切り文字も削って、 空になったら元の名前で fallback。
function _escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function shortenName(name, filterStr) {
  if (!name || !filterStr) return name;
  const preset = FILTER_PRESETS.find(p => p.slug === filterStr);
  const needle = preset ? preset.match : filterStr;
  let s = name.replace(new RegExp(_escRe(needle), 'i'), '');
  // 前後の 括弧 / 区切り文字 / 空白 を削る
  s = s.replace(/^[\s（）()「」【】『』、・\-_:：]+/, '')
       .replace(/[\s（）()「」【】『』、・\-_:：]+$/, '');
  return s || name;
}

export async function renderOverleafList({ query = {} } = {}) {
  const app = document.getElementById('app');
  const isAdmin = (state.me?.role || '') === 'admin';
  // v898 URL からモード / 絞り込み 復元
  const urlMode   = (query.mode === 'chart' || query.mode === 'list') ? query.mode : null;
  const urlFilter = query.filter || '';
  app.innerHTML = `
    <style>
      /* v891 横幅オーバーフロー防止。 SVG / テーブル / list-item が viewport を突き抜けるのを抑える。 */
      #app .card, #app .list-item { max-width:100%; box-sizing:border-box; overflow:hidden }
      #app .ovl-row-nums { min-width:0 }
      #app svg { max-width:100% }
    </style>
    <div class="card page-header">
      <div class="row center" style="justify-content:space-between; gap:8px; flex-wrap:wrap">
        <h2 style="margin:0; min-width:0; overflow:hidden; text-overflow:ellipsis">📝 Overleaf 更新状況</h2>
        ${isAdmin ? `<a class="btn" href="#/overleaf/admin" style="padding:4px 10px; font-size:12px; flex-shrink:0">⚙ 設定</a>` : ''}
      </div>
      <div id="ovl-status" class="hint" style="margin-top:4px; font-size:11px; word-break:break-word"></div>
    </div>
    <div class="card">
      <div class="row" style="gap:6px; align-items:center; font-size:13px; flex-wrap:wrap">
        <div class="row" style="gap:0; border-radius:14px; overflow:hidden; border:1px solid var(--primary-soft)">
          <button id="ovl-mode-list"  type="button" style="border:none; padding:5px 14px; font-size:12px; cursor:pointer; background:var(--primary); color:#fff">🗂 一覧</button>
          <button id="ovl-mode-chart" type="button" style="border:none; padding:5px 14px; font-size:12px; cursor:pointer; background:#fff; color:var(--primary)">📊 比較</button>
        </div>
        <label>並び順:
          <select id="ovl-sort" style="font-size:12px">
            <option value="recent">最終更新が新しい順</option>
            <option value="delta24">直近24hで増えた順</option>
            <option value="delta7">直近7日で増えた順</option>
            <option value="size">文字数が多い順</option>
            <option value="name">名前順</option>
          </select>
        </label>
        <label>表示:
          <select id="ovl-metric" style="font-size:12px">
            <option value="body" selected>本文のみ (cmd除外)</option>
            <option value="total">全文字 (TeXコマンド込み)</option>
            <option value="jp">日本語文字</option>
            <option value="word">英単語数</option>
          </select>
        </label>
        <span id="ovl-count" class="hint-sm" style="margin-left:auto; font-size:11px"></span>
      </div>
    </div>
    <div id="ovl-body" style="margin-top:8px"><div class="muted">読み込み中…</div></div>
  `;

  // status (collector last run)
  try {
    const s = await get('/api/overleaf/status');
    const st = document.getElementById('ovl-status');
    if (s.last_run) {
      const tag = s.last_run.ok ? '✓' : '✗';
      st.innerHTML = `${tag} 最終取得: ${fmtPast(s.last_run.finished_at || s.last_run.started_at)} ・プロジェクト ${s.project_count} 件 / snapshot ${s.snapshot_count.toLocaleString()} 件`;
      if (!s.last_run.ok && s.last_run.error_msg) {
        st.innerHTML += ` <span style="color:#dc2626">(err: ${escapeHtml(s.last_run.error_msg.slice(0,120))})</span>`;
      }
    } else {
      st.innerHTML = `⚠ collector がまだ一度も走っていません。 admin がサーバで <code>scripts/overleaf_collector.py</code> をセットアップ中の可能性。`;
    }
  } catch (e) { /* status は best-effort */ }

  let items = [];
  try {
    const d = await get('/api/overleaf/projects');
    items = d.items || [];
  } catch (e) {
    document.getElementById('ovl-body').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }

  const sortSel   = document.getElementById('ovl-sort');
  const metricSel = document.getElementById('ovl-metric');
  const modeListBtn  = document.getElementById('ovl-mode-list');
  const modeChartBtn = document.getElementById('ovl-mode-chart');
  // metric の latest フィールド + 単位 + spark/history のキー。
  // v898 hotfix: render() からも sortItems() からも参照されるので applyMode('chart') の
  //   初回呼び出しより前に宣言しないと TDZ で 「Cannot access 'metricField' before init」 になる。
  const metricField = {
    total: { latest: 'total_char_count',    unit: '字',            sparkKey: 'c'  },
    body:  { latest: 'total_char_body',     unit: '字 (本文)',      sparkKey: 'cb' },
    jp:    { latest: 'total_jp_char_count', unit: '字 (日本語)',    sparkKey: 'jp' },
    word:  { latest: 'total_word_count',    unit: 'words',         sparkKey: 'w'  },
  };
  // v898 URL の query が優先、 次に localStorage、 ない時 list
  let viewMode = urlMode || (() => {
    try { return localStorage.getItem('labpay.overleaf.viewMode') === 'chart' ? 'chart' : 'list'; }
    catch { return 'list'; }
  })();
  let activeFilter = urlFilter;

  // v898 URL を絞り込み/モードと同期 (history.replaceState で hashchange 抑止 → 二重 render 防止)
  const syncUrl = () => {
    const params = new URLSearchParams();
    if (viewMode === 'chart')  params.set('mode', 'chart');
    if (activeFilter)          params.set('filter', activeFilter);
    const qs = params.toString();
    const newHash = '#/overleaf' + (qs ? '?' + qs : '');
    if (location.hash !== newHash) {
      try { history.replaceState(history.state, '', newHash); } catch (_) {}
    }
  };

  const applyMode = (next) => {
    viewMode = next;
    try { localStorage.setItem('labpay.overleaf.viewMode', next); } catch (_) {}
    const set = (b, on) => {
      b.style.background = on ? 'var(--primary)' : '#fff';
      b.style.color      = on ? '#fff'           : 'var(--primary)';
    };
    set(modeListBtn,  viewMode === 'list');
    set(modeChartBtn, viewMode === 'chart');
    syncUrl();
    render();
  };
  modeListBtn.addEventListener('click',  () => applyMode('list'));
  modeChartBtn.addEventListener('click', () => applyMode('chart'));
  if (viewMode === 'chart') applyMode('chart');

  sortSel.addEventListener('change', render);
  metricSel.addEventListener('change', render);

  // v898 絞り込み UI を動的に挿入 (sort/metric の隣)。
  // v901 active filter が変わるたびに毎回 リビルドするように変更。 これで custom 入力後に
  //   ドロップダウンが 「🔎 「<typed>」」 と現在のカスタム値を反映する。
  function refreshFilterUI() {
    const row = sortSel.closest('.row');
    if (!row) return;
    // 既存があれば一旦削除
    const existing = row.querySelector('#ovl-filter')?.closest('label');
    if (existing) existing.remove();
    const isCustomActive = activeFilter && !FILTER_PRESETS.some(p => p.slug === activeFilter);
    const customLabel = isCustomActive ? `🔎 「${activeFilter}」` : '🔎 カスタム…';
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:inline-flex; align-items:center; gap:4px';
    lbl.innerHTML = `絞り込み:
      <select id="ovl-filter" style="font-size:12px; max-width:240px">
        <option value="">全件</option>
        ${FILTER_PRESETS.map(p => `<option value="${escapeHtml(p.slug)}" ${activeFilter===p.slug?'selected':''}>${p.label}</option>`).join('')}
        <option value="__custom__" ${isCustomActive ? 'selected' : ''}>${escapeHtml(customLabel)}</option>
      </select>`;
    row.insertBefore(lbl, document.getElementById('ovl-count'));
    document.getElementById('ovl-filter').addEventListener('change', (ev) => {
      let v = ev.target.value;
      if (v === '__custom__') {
        const cur = (activeFilter && !FILTER_PRESETS.some(p => p.slug === activeFilter)) ? activeFilter : '';
        v = prompt('プロジェクト名の一部を入れてください (大文字小文字無視で部分一致):', cur);
        if (v === null) {
          // キャンセル → 元の値に戻す
          refreshFilterUI();
          return;
        }
        v = v.trim();
      }
      activeFilter = v;
      syncUrl();
      refreshFilterUI();  // v901 ドロップダウンも再描画 (custom 値を反映)
      render();
    });
  }
  refreshFilterUI();

  function sortItems(arr) {
    const sort = sortSel.value;
    const mf = metricField[metricSel.value];
    const deltaKey = mf.latest === 'total_char_count' ? 'total_char_count' : 'total_char_body';
    return arr.slice().sort((a, b) => {
      const av = a.latest?.[mf.latest] || 0, bv = b.latest?.[mf.latest] || 0;
      const ad24 = a.delta_24h?.[deltaKey] || 0, bd24 = b.delta_24h?.[deltaKey] || 0;
      const ad7  = a.delta_7d?.[deltaKey]  || 0, bd7  = b.delta_7d?.[deltaKey]  || 0;
      if (sort === 'recent') return (b.last_remote_updated_at || '').localeCompare(a.last_remote_updated_at || '');
      if (sort === 'delta24') return bd24 - ad24;
      if (sort === 'delta7')  return bd7  - ad7;
      if (sort === 'size')    return bv - av;
      if (sort === 'name')    return (a.name || '').localeCompare(b.name || '');
      return 0;
    });
  }

  function render() {
    // v898 絞り込み (preset slug or 任意 substring)
    const filtered = applyOverleafFilter(items, activeFilter);
    const sorted = sortItems(filtered);
    const mf = metricField[metricSel.value];
    const countEl = document.getElementById('ovl-count');
    const body = document.getElementById('ovl-body');
    // 絞り込みチップ表示 (絞り込みが有効な時、 解除ボタン付き)
    const filterChip = activeFilter ? (() => {
      const preset = FILTER_PRESETS.find(p => p.slug === activeFilter);
      const lbl = preset ? preset.label : `🔎 「${activeFilter}」`;
      return `<div class="card" style="margin-bottom:8px; padding:6px 10px; background:#f3e8ff; border-left:3px solid #7b3fa0; font-size:12px">
        絞り込み中: <b>${escapeHtml(lbl)}</b> (${filtered.length}件マッチ)
        <a href="#" id="ovl-filter-clear" style="margin-left:8px; color:#7b3fa0">✕ 解除</a>
      </div>`;
    })() : '';

    if (viewMode === 'chart') {
      // v889 stale (1か月以上更新なし) を除外。
      // v896 sparkline.length >= 2 だと初日(今日のデータしか無い)に全部消える問題があったので
      //   >= 1 に緩めて、 1点だけのプロジェクトもドットで表示。 多日分溜まったら線になる。
      const active = sorted.filter(p => !p.is_stale && p.sparkline && p.sparkline.length >= 1);
      const stale  = sorted.filter(p => p.is_stale);
      const noData = sorted.filter(p => !p.is_stale && (!p.sparkline || !p.sparkline.length));
      const maxLen = active.reduce((m, p) => Math.max(m, p.sparkline.length), 0);
      const singleDayNote = (maxLen <= 1) ? `
        <div class="card" style="margin-top:10px; font-size:12px; background:#fff8e1; border-left:3px solid #f59e0b">
          ⏳ まだ今日 1 日分のデータしかないので、推移グラフは点だけです。明日以降データが溜まると折れ線が描かれます (collector は 1 時間おきに自動実行)。
        </div>` : '';
      countEl.textContent = `${active.length} 件アクティブ / ${stale.length} 件 stale 除外`;
      if (!active.length) {
        body.innerHTML = filterChip + `<div class="empty">${activeFilter ? '絞り込み条件に該当するプロジェクトがありません。' : '過去 1 か月で更新があったプロジェクトがありません。'}</div>${singleDayNote}`;
        wireFilterChip();
        return;
      }
      // v903 絞り込み中は stale プロジェクトも文字数+最終更新日付きで一覧表示。
      //   グラフには出さない (古い + 動かないので線にならない) が、
      //   「過去にXX字書いた人」として参照できるように。
      const staleDetailRow = (p) => {
        const cur = p.latest?.[mf.latest];
        return `
          <a class="list-item" href="#/overleaf/${p.id}" style="align-items:flex-start; font-size:12px" title="${escapeHtml(p.name)}">
            <div class="grow" style="min-width:0">
              <div style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
                💤 ${escapeHtml(shortenName(p.name, activeFilter))}
              </div>
              <div class="meta" style="font-size:11px; margin-top:2px">
                ${cur != null ? `<b>${cur.toLocaleString()}</b> <span class="muted">${mf.unit}</span> ・` : ''}
                最終更新 ${escapeHtml(fmtPast(p.last_remote_updated_at))}
              </div>
            </div>
          </a>`;
      };
      const staleSummary = stale.length
        ? (activeFilter
            ? `<details class="card" style="margin-top:10px" open>
                 <summary style="cursor:pointer; font-size:12px; color:#666; padding:4px 0">
                   💤 1か月以上更新なし (グラフ非表示: ${stale.length} 件)
                 </summary>
                 <div class="list" style="margin-top:6px">${stale.map(staleDetailRow).join('')}</div>
               </details>`
            : `<div class="card" style="margin-top:10px; font-size:12px">
                 <div class="muted" style="margin-bottom:4px">💤 1か月以上更新なし (グラフから除外: ${stale.length} 件)</div>
                 <div style="display:flex; gap:6px; flex-wrap:wrap">
                   ${stale.map(p => `<span class="tag" style="font-size:11px; background:#f3f4f6; color:#666">${escapeHtml(p.name)}</span>`).join('')}
                 </div>
               </div>`)
        : '';
      body.innerHTML = filterChip + singleDayNote + renderCompareChart(active, mf, activeFilter) + staleSummary;
      wireFilterChip();
      return;
    }

    // list mode (v896 stale は折りたたみ)
    if (!sorted.length) {
      countEl.textContent = '0 件';
      body.innerHTML = filterChip + `<div class="empty">${activeFilter ? '絞り込み条件に該当するプロジェクトがありません。' : 'まだプロジェクトがありません。 collector が走るとここに出てきます。'}</div>`;
      wireFilterChip();
      return;
    }
    const activeList = sorted.filter(p => !p.is_stale);
    const staleList  = sorted.filter(p => p.is_stale);
    countEl.textContent = `${activeList.length} 件アクティブ${staleList.length ? ` (+ 1か月以上更新なし ${staleList.length} 件)` : ''}`;
    const deltaKey = mf.latest === 'total_char_count' ? 'total_char_count' : 'total_char_body';
    const renderRow = (p) => {
      const cur  = p.latest?.[mf.latest] || 0;
      const d24  = p.delta_24h?.[deltaKey];
      const d7   = p.delta_7d?.[deltaKey];
      const lastU = fmtPast(p.last_remote_updated_at);
      const lastUTitle = p.last_remote_updated_at ? `title="${escapeHtml(p.last_remote_updated_at)}"` : '';
      const tags = [];
      if (p.is_stale)    tags.push('<span class="tag muted" style="font-size:10px; background:#f3f4f6">💤 1か月以上更新なし</span>');
      if (p.is_archived) tags.push('<span class="tag muted" style="font-size:10px">🗄 archived</span>');
      const displayName = shortenName(p.name, activeFilter);
      return `
        <a class="list-item" href="#/overleaf/${p.id}" style="align-items:flex-start" title="${escapeHtml(p.name)}">
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
              ${escapeHtml(displayName)} ${tags.join(' ')}
            </div>
            <div class="meta" style="font-size:12px">
              最終更新 <span ${lastUTitle}>${escapeHtml(lastU)}</span>
              ${p.latest?.main_file_path ? ` ・🎯 ${escapeHtml(p.latest.main_file_path)}` : (p.latest ? ` ・${p.latest.file_count}ファイル` : '')}
            </div>
            <div style="margin-top:4px; font-size:13px; display:flex; gap:10px; flex-wrap:wrap; align-items:center">
              <span><b>${cur.toLocaleString()}</b> <span class="muted" style="font-size:11px">${mf.unit}</span></span>
              <span style="color:${colorForDelta(d24)}">24h: ${d24 != null ? fmtSigned(d24) : '—'}</span>
              <span style="color:${colorForDelta(d7)}">7d: ${d7 != null ? fmtSigned(d7) : '—'}</span>
              <span style="margin-left:auto">${sparklineSvg(p.sparkline, mf.sparkKey)}</span>
            </div>
          </div>
        </a>`;
    };
    const activeHtml = activeList.length
      ? `<div class="list">${activeList.map(renderRow).join('')}</div>`
      : `<div class="empty">過去1か月で更新があったプロジェクトがありません。</div>`;
    const staleHtml = staleList.length
      ? `<details class="card" style="margin-top:10px">
           <summary style="cursor:pointer; font-size:13px; color:#666; padding:4px 0">
             💤 1か月以上更新なし (${staleList.length} 件) — タップで展開
           </summary>
           <div class="list" style="margin-top:8px">${staleList.map(renderRow).join('')}</div>
         </details>`
      : '';
    body.innerHTML = filterChip + activeHtml + staleHtml;
    wireFilterChip();
  }

  // 絞り込みチップの ✕ 解除 をクリックすると、 絞り込みを解除して再 render。
  function wireFilterChip() {
    document.getElementById('ovl-filter-clear')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      activeFilter = '';
      syncUrl();
      refreshFilterUI();
      render();
    });
  }

  render();
}

// 複数プロジェクトを 1 つの SVG に重ね描き。 各プロジェクトに固有色を振る。
function renderCompareChart(items, mf, filterStr = '') {
  const w = 720, h = 360, padL = 60, padR = 20, padT = 24, padB = 40;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  // 全 sparkline points を 走査して時間軸と最大値を出す
  const allPts = [];
  for (const p of items) for (const s of (p.sparkline || [])) {
    const t = new Date(s.d).getTime();
    if (isFinite(t)) allPts.push({ t, v: s[mf.sparkKey] || 0 });
  }
  if (allPts.length < 1) return `<div class="card"><div class="muted">データ不足です</div></div>`;
  const tMin = Math.min(...allPts.map(p => p.t));
  const tMax = Math.max(...allPts.map(p => p.t));
  const yMax = Math.max(...allPts.map(p => p.v), 100);
  // v896 全部同じ日 (初日) のときは X 軸中央にドットを集める。 複数日あれば通常スケール。
  const xAt = t => (tMax === tMin)
    ? padL + innerW / 2
    : padL + ((t - tMin) / (tMax - tMin)) * innerW;
  const yAt = v => padT + innerH - (v / yMax) * innerH;

  // 軸グリッド
  const yTicks = 5;
  const yAxis = [];
  for (let i = 0; i <= yTicks; i++) {
    const yv = Math.round(yMax * (i / yTicks));
    const y = yAt(yv);
    yAxis.push(`<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#eee" stroke-width="1"/>
                <text x="${padL-6}" y="${y+3}" text-anchor="end" font-size="10" fill="#888">${yv.toLocaleString()}</text>`);
  }
  const nXTicks = 6;
  const xLabels = [];
  for (let i = 0; i <= nXTicks; i++) {
    const t = tMin + (tMax - tMin) * (i / nXTicks);
    const d = new Date(t);
    xLabels.push(`<text x="${xAt(t)}" y="${h - 12}" text-anchor="middle" font-size="10" fill="#666">${d.getMonth()+1}/${d.getDate()}</text>`);
  }

  // v904 凡例と線は文字数の多い順に並べる (見やすさ)。 hue は同じ並び順で割り振り、
  //   線の重なり順も多い人が後 (上) に来るようにする。
  const sortedByCount = items.slice().sort((a, b) => (b.latest?.[mf.latest] || 0) - (a.latest?.[mf.latest] || 0));
  const lines = [];
  const legend = [];
  sortedByCount.forEach((p, idx) => {
    const hue = (idx * 360 / Math.max(sortedByCount.length, 1)) % 360;
    const color = `hsl(${hue.toFixed(0)}, 65%, 45%)`;
    const pts = (p.sparkline || []).map(s => {
      const t = new Date(s.d).getTime();
      return `${xAt(t).toFixed(1)},${yAt(s[mf.sparkKey] || 0).toFixed(1)}`;
    }).join(' ');
    if (!pts) return;
    lines.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`);
    // 終点に小さなドット + ラベル
    const last = (p.sparkline || []).slice(-1)[0];
    if (last) {
      const lx = xAt(new Date(last.d).getTime()), ly = yAt(last[mf.sparkKey] || 0);
      lines.push(`<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${color}"/>`);
    }
    legend.push(`
      <div style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; background:#fafafa; border-radius:10px; font-size:11px">
        <span style="display:inline-block; width:10px; height:10px; background:${color}; border-radius:2px"></span>
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:160px" title="${escapeHtml(p.name)}">${escapeHtml(shortenName(p.name, filterStr))}</span>
        <span class="muted">(${(p.latest?.[mf.latest] || 0).toLocaleString()})</span>
      </div>`);
  });

  return `
    <div class="card">
      <h3 style="margin:0 0 8px; font-size:14px">📊 ${escapeHtml(mf.unit)}の推移比較 (直近60日)</h3>
      <svg width="100%" viewBox="0 0 ${w} ${h}" style="display:block; max-width:100%; background:#fff">
        ${yAxis.join('')}
        ${lines.join('')}
        ${xLabels.join('')}
      </svg>
      <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap">
        ${legend.join('')}
      </div>
    </div>`;
}

export async function renderOverleafDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
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
  const overleafUrl = `https://www.overleaf.com/project/${encodeURIComponent(p.overleaf_id)}`;
  head.innerHTML = `
    <h2 style="margin:0">${escapeHtml(p.name)}</h2>
    <div class="meta" style="margin-top:4px">初回観測 ${escapeHtml(fmtPast(p.first_seen_at))} ・最終更新 <span title="${escapeHtml(p.last_remote_updated_at || '')}">${escapeHtml(fmtPast(p.last_remote_updated_at))}</span></div>
    <div style="margin-top:8px">
      <a class="btn primary" href="${escapeHtml(overleafUrl)}" target="_blank" rel="noopener">↗ Overleaf で開く</a>
    </div>
    ${latest ? `
      ${latest.main_file_path ? `<div class="hint" style="margin-top:8px; font-size:12px">🎯 メイン: <code>${escapeHtml(latest.main_file_path)}</code> (これだけ集計対象)</div>` : ''}
      <div style="margin-top:10px; display:flex; gap:14px; flex-wrap:wrap">
        <div><div class="muted" style="font-size:11px">本文 (cmd除外)</div><div class="bold" style="font-size:18px">${latest.total_char_body.toLocaleString()}</div></div>
        <div><div class="muted" style="font-size:11px">日本語文字</div><div class="bold" style="font-size:18px">${latest.total_jp_char_count.toLocaleString()}</div></div>
        <div><div class="muted" style="font-size:11px">英単語数</div><div class="bold" style="font-size:18px">${latest.total_word_count.toLocaleString()}</div></div>
        <div><div class="muted" style="font-size:11px">ファイル数</div><div class="bold" style="font-size:18px">${latest.file_count}</div></div>
        <div><div class="muted" style="font-size:11px">全文字 (cmd込み)</div><div class="muted" style="font-size:14px">${latest.total_char_count.toLocaleString()}</div></div>
      </div>` : '<div class="muted" style="margin-top:8px">snapshot がまだありません</div>'}`;

  if (d.history && d.history.length >= 2) {
    document.getElementById('ovd-chart-card').hidden = false;
    document.getElementById('ovd-chart').innerHTML = renderHistoryChart(d.history);
  }
  if (d.files && d.files.length) {
    document.getElementById('ovd-files-card').hidden = false;
    document.getElementById('ovd-files').innerHTML = `
      <div style="overflow-x:auto; max-width:100%">
      <table style="width:100%; border-collapse:collapse; font-size:12px; min-width:480px">
        <thead><tr style="border-bottom:1px solid var(--line)">
          <th style="text-align:left; padding:4px">ファイル</th>
          <th style="text-align:right; padding:4px">本文</th>
          <th style="text-align:right; padding:4px">全文字</th>
          <th style="text-align:right; padding:4px">日本語</th>
          <th style="text-align:right; padding:4px">英単語</th>
        </tr></thead>
        <tbody>${d.files.map(f => {
          const isMain = latest && latest.main_file_path === f.file_path;
          return `
          <tr style="border-bottom:1px solid var(--line); ${isMain ? 'background:#f3e8ff' : ''}">
            <td style="padding:4px; word-break:break-all">${isMain ? '🎯 ' : ''}${escapeHtml(f.file_path)}${isMain ? ' <span class="muted" style="font-size:10px">(集計対象)</span>' : ''}</td>
            <td style="padding:4px; text-align:right"><b>${f.char_count_body.toLocaleString()}</b></td>
            <td style="padding:4px; text-align:right" class="muted">${f.char_count_total.toLocaleString()}</td>
            <td style="padding:4px; text-align:right">${f.jp_char_count.toLocaleString()}</td>
            <td style="padding:4px; text-align:right">${f.word_count.toLocaleString()}</td>
          </tr>`;}).join('')}
        </tbody>
      </table>
      </div>`;
  }
}

function renderHistoryChart(history) {
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

// v890 admin 設定 (cookie 管理 + collector 即時実行)
export async function renderOverleafAdmin() {
  const app = document.getElementById('app');
  if ((state.me?.role || '') !== 'admin') {
    app.innerHTML = `<div class="card"><p>admin 限定です。</p></div>`;
    return;
  }
  app.innerHTML = `
    <div class="card">
      <a href="#/overleaf" class="hint">← Overleaf 一覧</a>
      <h2 style="margin:6px 0 0">⚙ Overleaf 更新状況 設定</h2>
      <p class="hint" style="margin:4px 0 0; font-size:11px">
        教員アカウントの Overleaf cookie を登録し、collector を走らせて文字数 snapshot を取得します。
        cookie は数か月で失効するので、その時はここから貼り直し。
      </p>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px">🔑 cookie (overleaf_session2)</h3>
      <div id="ova-cookie-status" class="muted" style="font-size:12px">確認中…</div>

      <details style="margin-top:10px">
        <summary style="cursor:pointer; font-size:13px; color:var(--primary)">cookie の取得方法 (Chrome)</summary>
        <ol style="font-size:12px; line-height:1.6; margin:6px 0 0 18px">
          <li>Chrome で https://www.overleaf.com に教員アカウントでログイン</li>
          <li>DevTools (F12) > Application > Cookies > <code>https://www.overleaf.com</code></li>
          <li><code>overleaf_session2</code> 行の Value を全選択 → コピー (<code>s%3A...</code> で始まる長い文字列)</li>
          <li>下のテキストボックスに貼り付けて「保存」</li>
        </ol>
      </details>

      <label class="field" style="margin-top:10px">
        <span class="lbl">新しい cookie 値</span>
        <textarea id="ova-cookie-input" rows="3" placeholder="s%3A…" style="font-family:monospace; font-size:11px; word-break:break-all"></textarea>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="ova-verify" class="btn">🩺 検証 (保存せず確認)</button>
        <button id="ova-save"   class="primary">💾 保存して検証</button>
      </div>
      <div id="ova-verify-result" style="margin-top:6px; font-size:12px"></div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px">🔄 collector を実行</h3>
      <p class="hint" style="font-size:11px; margin:0 0 8px">
        手動で 1 回走らせます。 250プロジェクト程度で 3〜10 分。完了すると下の履歴に反映されます。
      </p>
      <button id="ova-run" class="primary">▶ いま実行</button>
      <span id="ova-run-result" style="margin-left:8px; font-size:12px"></span>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px">📊 直近の実行履歴</h3>
      <div id="ova-runs" class="muted">読み込み中…</div>
    </div>
  `;

  // Wire up

  async function loadCookieStatus() {
    try {
      const r = await get('/api/overleaf/admin/cookie');
      document.getElementById('ova-cookie-status').innerHTML = r.has_cookie
        ? `✓ 設定済み: <code>${escapeHtml(r.masked)}</code>`
        : `⚠ 未設定 — cookie を貼って保存してください`;
    } catch (e) {
      document.getElementById('ova-cookie-status').textContent = '取得失敗: ' + e.message;
    }
  }

  async function loadRuns() {
    try {
      const r = await get('/api/overleaf/admin/runs');
      const items = r.items || [];
      if (!items.length) {
        document.getElementById('ova-runs').innerHTML = '<div class="empty">まだ実行ログがありません</div>';
        return;
      }
      document.getElementById('ova-runs').innerHTML = `
        <div style="overflow-x:auto; max-width:100%">
        <table style="width:100%; border-collapse:collapse; font-size:12px; min-width:560px">
          <thead><tr style="border-bottom:1px solid var(--line)">
            <th style="text-align:left; padding:4px">開始</th>
            <th style="text-align:left; padding:4px">終了</th>
            <th style="text-align:center; padding:4px">結果</th>
            <th style="text-align:right; padding:4px">プロジェクト数</th>
            <th style="text-align:left; padding:4px">エラー</th>
          </tr></thead>
          <tbody>${items.map(it => {
            const dur = it.finished_at ? '' : ' <span style="color:#f59e0b">(実行中)</span>';
            const okTag = it.ok ? '<span style="color:#16a34a">✓ OK</span>'
                                : (it.finished_at ? '<span style="color:#dc2626">✗ 失敗</span>' : '<span class="muted">…</span>');
            const errSnippet = it.error_msg ? `<span style="color:#dc2626">${escapeHtml(String(it.error_msg).slice(0, 100))}</span>` : '';
            return `<tr style="border-bottom:1px solid var(--line)">
              <td style="padding:4px">${escapeHtml(it.started_at)}${dur}</td>
              <td style="padding:4px">${escapeHtml(it.finished_at || '—')}</td>
              <td style="padding:4px; text-align:center">${okTag}</td>
              <td style="padding:4px; text-align:right">${it.projects_seen}</td>
              <td style="padding:4px">${errSnippet}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
        </div>`;
    } catch (e) {
      document.getElementById('ova-runs').textContent = '失敗: ' + e.message;
    }
  }

  async function doVerify(saveFirst) {
    const input = document.getElementById('ova-cookie-input').value.trim();
    const out = document.getElementById('ova-verify-result');
    out.innerHTML = '<span class="muted">処理中…</span>';
    try {
      if (saveFirst) {
        if (!input) { out.innerHTML = '<span style="color:#dc2626">cookie を貼ってください</span>'; return; }
        await post('/api/overleaf/admin/cookie', { cookie: input });
        document.getElementById('ova-cookie-input').value = '';
        await loadCookieStatus();
      }
      const r = await post('/api/overleaf/admin/verify', {});
      if (r.ok) {
        out.innerHTML = `<span style="color:#16a34a">✓ cookie 有効 (HTTP ${r.http_code})</span>`;
      } else {
        out.innerHTML = `<span style="color:#dc2626">✗ 無効: ${escapeHtml(r.reason || '')} (HTTP ${r.http_code || '—'})</span>`;
      }
    } catch (e) {
      out.innerHTML = `<span style="color:#dc2626">エラー: ${escapeHtml(e.message)}</span>`;
    }
  }

  document.getElementById('ova-verify').addEventListener('click', () => doVerify(false));
  document.getElementById('ova-save')  .addEventListener('click', () => doVerify(true));
  document.getElementById('ova-run')   .addEventListener('click', async () => {
    const out = document.getElementById('ova-run-result');
    out.innerHTML = '<span class="muted">起動中…</span>';
    try {
      const r = await post('/api/overleaf/admin/run', {});
      out.innerHTML = `<span style="color:#16a34a">✓ 起動しました (PID ${r.pid}) — 数分後にまた更新</span>`;
      setTimeout(loadRuns, 2500);
    } catch (e) {
      out.innerHTML = `<span style="color:#dc2626">${escapeHtml(e.message)}</span>`;
    }
  });

  loadCookieStatus();
  loadRuns();
}

