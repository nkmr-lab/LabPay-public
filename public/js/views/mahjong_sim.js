// /#/mahjong/sim — 麻雀エンジンシミュレータ実行ページ。 v556 #209。
//   1〜30 半荘走らせて結果 + 整合性を表示 (= 内部検証用ツール、 lazy import)。

import { post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

export function renderMahjongSim() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <a href="#/mahjong" class="hint">← 麻雀</a>
      <h2 style="margin:6px 0">🧪 麻雀エンジンシミュレータ</h2>
      <p class="hint" style="font-size:13px; margin:0">
        4 AI で N 半荘を走らせて、 点数合計 100000 不変 / 全 8 局完走を検証します。
        AI は簡易ルール (字牌優先打牌、 鳴き 50%、 ロン即宣言)。
      </p>
    </div>
    <div class="card">
      <label class="field">
        <span class="lbl">半荘数 (1〜30、 多いほど時間かかる)</span>
        <input type="number" id="sim-n" min="1" max="30" value="5" style="width:100px">
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="sim-go" class="primary">シミュレーション開始</button>
      </div>
    </div>
    <div id="sim-result"></div>
  `;
  document.getElementById('sim-go').addEventListener('click', go);
}

async function go() {
  const n = Number(document.getElementById('sim-n').value) || 5;
  const btn = document.getElementById('sim-go');
  btn.disabled = true; btn.textContent = `${n} 半荘走行中…`;
  const root = document.getElementById('sim-result');
  root.innerHTML = '<div class="card"><div class="muted">⏳ AI が打ち合い中… (1 半荘 ≒ 0.5-2 秒)</div></div>';
  try {
    const d = await post('/api/mahjong/sim', { n });
    paint(d);
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="muted">失敗: ${escapeHtml(e.message)}</div></div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'シミュレーション開始';
  }
}

function paint(d) {
  const root = document.getElementById('sim-result');
  const results = d.results || [];
  const total = results.length;
  const ok = results.filter(r => !r.error && r.phase === 'finished_all' && r.sum_invariant === 100000).length;
  const sumKyoku = results.reduce((s, r) => s + (r.events?.kyoku || 0), 0);
  const sumTsumo = results.reduce((s, r) => s + (r.events?.tsumo || 0), 0);
  const sumRon = results.reduce((s, r) => s + (r.events?.ron || 0), 0);
  const sumRyu = results.reduce((s, r) => s + (r.events?.ryukyoku || 0), 0);
  const sumNaki = results.reduce((s, r) => s + (r.events?.naki || 0), 0);
  const sumRiichi = results.reduce((s, r) => s + (r.events?.riichi || 0), 0);

  root.innerHTML = `
    <div class="card">
      <div class="bold" style="font-size:16px; color:var(--primary)">📊 結果サマリ</div>
      <div style="margin-top:6px; font-size:14px">
        <div>${ok}/${total} 半荘整合性 OK · 実行 ${d.elapsed_s} 秒</div>
        <div class="meta">合計 ${sumKyoku} 局 · ツモ ${sumTsumo} · ロン ${sumRon} · 流局 ${sumRyu} · 鳴き ${sumNaki} · リーチ宣言 ${sumRiichi}</div>
      </div>
      ${ok === total ? '<div style="margin-top:8px; padding:6px 12px; background:#dcfce7; color:#15803d; border-radius:6px; font-size:13px">✅ 全 ' + total + ' 半荘で点数合計 100000 不変 / 全 8 局完走</div>' :
       '<div style="margin-top:8px; padding:6px 12px; background:#fecaca; color:#b91c1c; border-radius:6px; font-size:13px">⚠️ ' + (total - ok) + ' 半荘で異常 (下記参照)</div>'}
    </div>
    <div class="card">
      <div class="bold" style="margin-bottom:6px">📜 各半荘の結果</div>
      <table style="width:100%; font-size:12px; border-collapse:collapse">
        <thead>
          <tr style="background:#f3eef8">
            <th style="padding:4px; border:1px solid var(--line)">#</th>
            <th style="padding:4px; border:1px solid var(--line)">局</th>
            <th style="padding:4px; border:1px solid var(--line)">ツモ</th>
            <th style="padding:4px; border:1px solid var(--line)">ロン</th>
            <th style="padding:4px; border:1px solid var(--line)">流局</th>
            <th style="padding:4px; border:1px solid var(--line)">鳴き</th>
            <th style="padding:4px; border:1px solid var(--line)">step</th>
            <th style="padding:4px; border:1px solid var(--line)">終了局</th>
            <th style="padding:4px; border:1px solid var(--line)">最終 (合計)</th>
            <th style="padding:4px; border:1px solid var(--line)">結果</th>
          </tr>
        </thead>
        <tbody>
          ${results.map((r, i) => {
            if (r.error) {
              return `<tr><td colspan="10" style="padding:4px; border:1px solid var(--line); color:#dc2626">#${i+1}: ❌ ${escapeHtml(r.error)}</td></tr>`;
            }
            const scores = (r.final_scores || []).join(' / ');
            const sum = r.sum_invariant;
            const integ = (r.phase === 'finished_all' && sum === 100000);
            return `
              <tr>
                <td style="padding:4px; border:1px solid var(--line); text-align:center">${i+1}</td>
                <td style="padding:4px; border:1px solid var(--line); text-align:center">${r.events.kyoku}</td>
                <td style="padding:4px; border:1px solid var(--line); text-align:center">${r.events.tsumo}</td>
                <td style="padding:4px; border:1px solid var(--line); text-align:center">${r.events.ron}</td>
                <td style="padding:4px; border:1px solid var(--line); text-align:center">${r.events.ryukyoku}</td>
                <td style="padding:4px; border:1px solid var(--line); text-align:center">${r.events.naki}</td>
                <td style="padding:4px; border:1px solid var(--line); text-align:center">${r.events.steps}</td>
                <td style="padding:4px; border:1px solid var(--line); text-align:center">${r.round_index}</td>
                <td style="padding:4px; border:1px solid var(--line); font-family:monospace">${escapeHtml(scores)} (${sum})</td>
                <td style="padding:4px; border:1px solid var(--line); text-align:center">${integ ? '<span style="color:#15803d">✓</span>' : '<span style="color:#dc2626">✗ ' + escapeHtml(r.phase) + '</span>'}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}
