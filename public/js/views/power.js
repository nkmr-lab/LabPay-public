// v1024 サンプルサイズ / power analysis (G*Power ベースライン、 中村さん指示「まずは
//   最低限 G*Power の 機能 は 実装」)。 純クライアントサイド計算 (認証不要 / API 不要)。
//
//   LabPay 内アプリなので当然ログイン済ユーザーが使う。 「認証不要」は 意味的に 誤り
//   だった (v1024 デプロイ後 中村さん指摘)。 純クライアントサイド = サーバへの API 呼出
//   なし の 意味。
//
//   実装した検定:
//     - 2 標本 t 検定 (独立、 等分散)
//     - 対応のある t 検定 / 1 標本 t 検定
//     - 一元配置分散分析 (One-way ANOVA)
//     - Pearson 相関
//     - χ² (自由度指定)
//
//   モード:
//     - A priori (α + 目標検定力 + 効果量 → 必要 n)
//     - Post hoc (α + 効果量 + n → 得られる 検定力)
//
//   分布: 正規近似 (z_{α/2} + z_β)² / d² 型 の 古典的 な 公式。 G*Power の 内部で 使う
//     非心 t / F の 厳密計算 との 差は 数% 程度。 v1025+ で 非心分布 + LMM/GLMM シミュ
//     ベース に 拡張予定 (中村さん ビジョン)。

import { escapeHtml } from '../router.js';
import { get, post, patch, del } from '../api.js';
import { toast } from '../app.js';
import { shareDialog } from '../share_to_sns.js';

// ---------------- 正規分布 CDF / PPF ----------------

// pnorm: standard normal CDF (Abramowitz & Stegun 26.2.17)
function pnorm(z) {
  const az = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * az);
  const d = 0.3989422804 * Math.exp(-az * az / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z >= 0 ? 1 - p : p;
}

// qnorm: standard normal inverse CDF (Beasley-Springer / Moro)
function qnorm(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.696830, 220.946098, -275.928510, 138.357751, -30.664798, 2.506628];
  const b = [-54.476098, 161.585836, -155.698979, 66.801311, -13.280681];
  const c = [-0.007784894, -0.322396458, -2.400758278, -2.549732539, 4.374664141, 2.938163983];
  const d = [0.007784695, 0.325844082, 2.445134137, 3.754408661];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
           ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
  } else if (p <= ph) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5]) * q /
           (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
             ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
  }
}

// ---------------- 検定 別 の 計算 ----------------

// 2 標本 t 検定 (独立、 等分散、 群 サイズ 等しい)。 tails: 1 or 2。
// A priori: n_per_group を返す。 Post hoc: power を返す。
function calc_ttest_two_sample(alpha, effect_d, tails, mode, nPerGroup, powerTarget) {
  const za = qnorm(1 - alpha / tails);
  if (mode === 'a_priori') {
    const zb = qnorm(powerTarget);
    // n_per_group = 2 * (z_a + z_b)^2 / d^2 (等分散、 等 n)
    const n = 2 * Math.pow(za + zb, 2) / (effect_d * effect_d);
    return { n_per_group: Math.ceil(n), n_total: Math.ceil(n) * 2 };
  } else {
    // power = Φ(d * sqrt(n/2) - z_a)  (片側部分)
    const ncp = effect_d * Math.sqrt(nPerGroup / 2);
    const p = pnorm(ncp - za) + (tails === 2 ? pnorm(-ncp - za) : 0);
    return { power: Math.max(0, Math.min(1, p)) };
  }
}

// 対応のある t 検定 / 1 標本 t 検定 (共通式)。 tails: 1 or 2。
function calc_ttest_paired(alpha, effect_d, tails, mode, n, powerTarget) {
  const za = qnorm(1 - alpha / tails);
  if (mode === 'a_priori') {
    const zb = qnorm(powerTarget);
    const nn = Math.pow(za + zb, 2) / (effect_d * effect_d);
    return { n_total: Math.ceil(nn) };
  } else {
    const ncp = effect_d * Math.sqrt(n);
    const p = pnorm(ncp - za) + (tails === 2 ? pnorm(-ncp - za) : 0);
    return { power: Math.max(0, Math.min(1, p)) };
  }
}

// 一元配置 ANOVA。 k = 群 数、 f = Cohen's f 効果量。
//   古典的な 近似: N_total ≈ (z_a + z_b)^2 * (1 + (k-1)/2) / f^2
//   より精確 (Cohen 1988): 非心 F を 使う。 ここでは 簡易 に λ = f² × N を 使い、
//   critical F ≈ (z_a + √(2*(k-1)))^2 / (2*(k-1)) から 逆算。
//   MVP: 正規近似 版 N = ((z_a + z_b)² × k) / f²  (k 群、 各群 n = N/k を想定)。
function calc_anova(alpha, effect_f, k, mode, N, powerTarget) {
  const za = qnorm(1 - alpha);
  if (mode === 'a_priori') {
    const zb = qnorm(powerTarget);
    // λ = N × f²、 検定力 ≈ Φ(√λ - z_a × √(1 + ...))
    // シンプル 近似: N = ((z_a + z_b)² × k) / f²  (k で スケール)
    const Ntot = Math.pow(za + zb, 2) * k / (effect_f * effect_f);
    return { n_per_group: Math.ceil(Ntot / k), n_total: Math.ceil(Ntot / k) * k };
  } else {
    // λ = N × f² ; power ≈ Φ(√λ - z_a)
    const lambda = N * effect_f * effect_f;
    const p = pnorm(Math.sqrt(lambda) - za);
    return { power: Math.max(0, Math.min(1, p)) };
  }
}

// Pearson 相関 (H0: ρ=0)。 Fisher z 変換 で 近似:
//   z_r = 0.5 × ln((1+r)/(1-r)), SE(z_r) = 1/√(n-3)
function calc_correlation(alpha, r, tails, mode, n, powerTarget) {
  const za = qnorm(1 - alpha / tails);
  const z_r = 0.5 * Math.log((1 + Math.abs(r)) / (1 - Math.abs(r)));
  if (mode === 'a_priori') {
    const zb = qnorm(powerTarget);
    const nn = Math.pow(za + zb, 2) / (z_r * z_r) + 3;
    return { n_total: Math.ceil(nn) };
  } else {
    if (n <= 3) return { power: 0 };
    const se = 1 / Math.sqrt(n - 3);
    const ncp = z_r / se;
    const p = pnorm(ncp - za) + (tails === 2 ? pnorm(-ncp - za) : 0);
    return { power: Math.max(0, Math.min(1, p)) };
  }
}

// χ² 検定。 df 指定、 効果量 w (Cohen's w)。 λ = N × w²、 検定力 ≈ Φ((√(2λ) - √(2 × df_c)))
//   ここでは df_c = df_null + λ 近似 で 正規化 する 簡易版。
function calc_chi_squared(alpha, w, df, mode, N, powerTarget) {
  // critical χ² を 正規近似 で: χ²_{α, df} ≈ df + √(2 × df) × z_α + 追加項 (ここでは略)
  const chi_crit = df + Math.sqrt(2 * df) * qnorm(1 - alpha);
  if (mode === 'a_priori') {
    // 目標 power から λ を 逆算 (正規化 近似): power = 1 - Φ((chi_crit - (df+λ)) / √(2(df + 2λ)))
    //   これを λ について 数値解。
    const target = powerTarget;
    // λ 探索: 二分探索
    let lo = 0, hi = 1000, mid;
    for (let iter = 0; iter < 60; iter++) {
      mid = (lo + hi) / 2;
      const denom = Math.sqrt(2 * (df + 2 * mid));
      const p = 1 - pnorm((chi_crit - (df + mid)) / denom);
      if (p < target) lo = mid; else hi = mid;
    }
    const lambda = mid;
    const N = lambda / (w * w);
    return { n_total: Math.ceil(N) };
  } else {
    const lambda = N * w * w;
    const denom = Math.sqrt(2 * (df + 2 * lambda));
    const p = 1 - pnorm((chi_crit - (df + lambda)) / denom);
    return { power: Math.max(0, Math.min(1, p)) };
  }
}

// ---------------- v1028 データ タイプ + 実測ベース入力 ----------------
const DATA_TYPES = [
  { id: 'likert7',     label: 'リッカート 7 段階 (1-7)',       meanRange: [1, 7],    sdRange: [0.3, 3],   step: 0.1 },
  { id: 'likert5',     label: 'リッカート 5 段階 (1-5)',       meanRange: [1, 5],    sdRange: [0.2, 2],   step: 0.1 },
  { id: 'continuous',  label: '連続値 (反応時間 / スコア 等)',  meanRange: [null, null], sdRange: [0.0001, null], step: 0.01 },
  { id: 'percentage',  label: '割合 (0-100%)',                meanRange: [0, 100],  sdRange: [0.01, 50], step: 0.1 },
];
function dtDef() { return DATA_TYPES.find(x => x.id === state.dataType) || DATA_TYPES[0]; }

// 実測 → d を 導出
function derivedDFromRaw() {
  if (state.test === 't2') {
    const { mean: mA, sd: sdA } = state.rawA;
    const { mean: mB, sd: sdB } = state.rawB;
    if ([mA, mB, sdA, sdB].some(v => !isFinite(v)) || sdA <= 0 || sdB <= 0) return null;
    const pooled = Math.sqrt((sdA * sdA + sdB * sdB) / 2);
    return Math.abs(mA - mB) / pooled;
  }
  if (state.test === 'tp' || state.test === 't1') {
    const { mean: m, sd } = state.rawDiff;
    if (!isFinite(m) || !isFinite(sd) || sd <= 0) return null;
    return Math.abs(m) / sd;
  }
  return null;
}

// d を 「小/中/大」ラベルに
function dLabel(d) {
  if (d < 0.2) return '極小';
  if (d < 0.35) return '小 (d≈0.2)';
  if (d < 0.65) return '中 (d≈0.5)';
  if (d < 1.0) return '大 (d≈0.8)';
  return '極大';
}

// v1029 「ボタン を 押した ときのみ 表示」 に変更、 プレース は raw-derived-box の
//   textContent へ 一言だけ 反映 (「→ d = 0.500 (中)」)。
function renderDerivedLabel(d) {
  if (d === null) return '';
  return `→ d = ${d.toFixed(3)} (${dLabel(d)})`;
}

// v1029 中村さん指摘「手法A、 手法Bのそれぞれの平均と、 SDを入力したら、 それに応じて
//   どんなグラフになるか (正規分布の場合に) というのを 示してあげて。 で、 その後
//   予想効果量を求めて。 だから、 この値で 予想効果量を求める みたいなボタンを 用意する
//   とよいのかな。 いま、 データの種類を選んだ時点で 何か走るので変」→
//     - dtype 変更で render() (全再描画) するのを やめ、 dtype 依存の 範囲hint と
//       preview グラフ だけ 差し替える (フォーカス が 抜けない)
//     - 平均 / SD 変化 で ライブ preview グラフ を 更新 (2 群の 正規分布 or 差の分布)
//     - 予想 d の 値 は 「この値で 予想効果量を求める」 ボタン を 押した ときのみ
//       表示 + 効果量欄 に 反映
function renderRawInputs() {
  if (!['t2','tp','t1'].includes(state.test)) return '';
  const dt = dtDef();
  const dtSelect = `
    <label class="field">
      <span class="lbl">📏 データ の 種類</span>
      <select id="pw-dtype">
        ${DATA_TYPES.map(x => `<option value="${x.id}" ${x.id===state.dataType?'selected':''}>${escapeHtml(x.label)}</option>`).join('')}
      </select>
    </label>
    <div id="raw-range-hint" class="hint-sm" style="font-size:11px; margin-top:2px">${escapeHtml(rangeHintText())}</div>`;
  const twoGroupInputs = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px">
      <div style="padding:8px; background:#eff6ff; border-radius:6px; border-left:3px solid #2563eb">
        <div class="bold" style="color:#2563eb; font-size:12px; margin-bottom:4px">👤 手法 A / 群 A</div>
        <label class="field" style="margin-bottom:6px"><span class="lbl">予想 平均</span>
          <input type="number" id="raw-mA" step="${dt.step}" value="${state.rawA.mean}">
        </label>
        <label class="field"><span class="lbl">予想 SD</span>
          <input type="number" id="raw-sA" step="${dt.step}" min="0.0001" value="${state.rawA.sd}">
        </label>
      </div>
      <div style="padding:8px; background:#fff7ed; border-radius:6px; border-left:3px solid #ea580c">
        <div class="bold" style="color:#ea580c; font-size:12px; margin-bottom:4px">👥 手法 B / 群 B</div>
        <label class="field" style="margin-bottom:6px"><span class="lbl">予想 平均</span>
          <input type="number" id="raw-mB" step="${dt.step}" value="${state.rawB.mean}">
        </label>
        <label class="field"><span class="lbl">予想 SD</span>
          <input type="number" id="raw-sB" step="${dt.step}" min="0.0001" value="${state.rawB.sd}">
        </label>
      </div>
    </div>`;
  const diffInputs = `
    <div style="padding:8px; background:#faf5ff; border-radius:6px; border-left:3px solid #7b3fa0; margin-top:8px">
      <div class="bold" style="color:#7b3fa0; font-size:12px; margin-bottom:4px">${state.test==='tp' ? '📎 差 (Before − After 等)' : '👤 観測 − 基準'}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
        <label class="field"><span class="lbl">予想 平均</span>
          <input type="number" id="raw-mD" step="${dt.step}" value="${state.rawDiff.mean}">
        </label>
        <label class="field"><span class="lbl">予想 SD</span>
          <input type="number" id="raw-sD" step="${dt.step}" min="0.0001" value="${state.rawDiff.sd}">
        </label>
      </div>
    </div>`;
  return `
    <details class="card" style="background:#fafaf5; border:1px solid #f3f4f6">
      <summary style="cursor:pointer; font-weight:600">🎯 (オプション) 予想データ (平均 + SD) から 効果量 を 導く</summary>
      <div class="hint-sm" style="margin-top:6px; margin-bottom:6px">先行研究 or パイロット の 平均 と SD を 入れて、 グラフ で 手ごたえ を 確認 → 「この値で 予想効果量を 求める」 ボタン で 効果量欄 に 反映 します。</div>
      ${dtSelect}
      ${state.test === 't2' ? twoGroupInputs : diffInputs}
      <!-- ライブ preview グラフ (正規分布) -->
      <div id="raw-preview" style="margin-top:10px">${renderRawPreviewSVG()}</div>
      <div class="row" style="gap:6px; margin-top:8px; align-items:center; flex-wrap:wrap">
        <button id="raw-apply" class="btn primary" style="font-size:12px">→ この値で 予想効果量を 求める (効果量欄に 入れる)</button>
        <span id="raw-derived-box" class="hint-sm"></span>
      </div>
    </details>`;
}

// dtype 依存の 範囲 hint 文字列
function rangeHintText() {
  const dt = dtDef();
  const [mMin, mMax] = dt.meanRange;
  const [sdMin, sdMax] = dt.sdRange;
  return `目安: 平均 ${mMin ?? '−∞'} 〜 ${mMax ?? '∞'} / SD ${sdMin} 〜 ${sdMax ?? '∞'}`;
}

// v1029 ライブ preview: 平均 / SD から 正規分布 を 2 本 (2 標本) or 1 本 (対応/1 標本)
//   描画。 効果量 表示 は しない (「値を まず 見て、 それから 求める」フロー)。
function renderRawPreviewSVG() {
  const W = 600, H = 200, PL = 34, PR = 16, PT = 12, PB = 32;
  // v1029b unary - と ** の 混在 は SyntaxError (「Unary operator used immediately
  //   before exponentiation expression」) に なる の で、 明示 括弧 + 中間 変数 で 回避。
  const dnormAt = (x, mu, sd) => {
    const z = (x - mu) / sd;
    return Math.exp(-(z * z) / 2) / (sd * Math.sqrt(2 * Math.PI));
  };
  let curves = [];   // { mu, sd, color, label }
  if (state.test === 't2') {
    curves.push({ mu: state.rawA.mean, sd: state.rawA.sd, color: '#2563eb', label: '手法 A' });
    curves.push({ mu: state.rawB.mean, sd: state.rawB.sd, color: '#ea580c', label: '手法 B' });
  } else {
    curves.push({ mu: state.rawDiff.mean, sd: state.rawDiff.sd, color: '#7b3fa0', label: state.test === 'tp' ? '差の分布' : '(観測 − 基準) の 分布' });
  }
  // 有効性チェック
  if (curves.some(c => !isFinite(c.mu) || !isFinite(c.sd) || c.sd <= 0)) {
    return `<div class="hint-sm" style="text-align:center; color:#a16207; padding:20px 0">値を 全部 入れると グラフ が 出ます</div>`;
  }
  // x 範囲: 全曲線の平均 ± 4 SD を 覆う
  let xMin = Math.min(...curves.map(c => c.mu - 4 * c.sd));
  let xMax = Math.max(...curves.map(c => c.mu + 4 * c.sd));
  // 差の分布の場合は 0 を必ず含める (0 = 差なし の基準)
  if (state.test !== 't2') {
    xMin = Math.min(xMin, -1 * curves[0].sd);
    xMax = Math.max(xMax, curves[0].sd);
  }
  const pad = (xMax - xMin) * 0.05;
  xMin -= pad; xMax += pad;
  const yMax = Math.max(...curves.map(c => dnormAt(c.mu, c.mu, c.sd))) * 1.15;
  const xToPx = (x) => PL + (x - xMin) / (xMax - xMin) * (W - PL - PR);
  const yToPx = (y) => PT + (1 - y / yMax) * (H - PT - PB);
  const N = 200;
  let svgCurves = '';
  let legends = '';
  curves.forEach((c, i) => {
    const pts = [];
    for (let j = 0; j <= N; j++) {
      const x = xMin + (j / N) * (xMax - xMin);
      pts.push([x, dnormAt(x, c.mu, c.sd)]);
    }
    const linePath = 'M ' + pts.map(([x, y]) => `${xToPx(x).toFixed(1)} ${yToPx(y).toFixed(1)}`).join(' L ');
    const fillPath = linePath + ` L ${xToPx(xMax).toFixed(1)} ${yToPx(0).toFixed(1)} L ${xToPx(xMin).toFixed(1)} ${yToPx(0).toFixed(1)} Z`;
    svgCurves += `<path d="${fillPath}" fill="${c.color}22" stroke="none"/>`;
    svgCurves += `<path d="${linePath}" fill="none" stroke="${c.color}" stroke-width="1.8"/>`;
    // 平均線
    svgCurves += `<line x1="${xToPx(c.mu)}" y1="${yToPx(dnormAt(c.mu, c.mu, c.sd))}" x2="${xToPx(c.mu)}" y2="${H - PB}" stroke="${c.color}" stroke-dasharray="3,3" stroke-width="1"/>`;
    legends += `<line x1="6" y1="${14 + i * 14}" x2="24" y2="${14 + i * 14}" stroke="${c.color}" stroke-width="2"/><text x="28" y="${17 + i * 14}" font-size="10.5" fill="#111">${escapeHtml(c.label)} (μ=${c.mu.toFixed(2)}, σ=${c.sd.toFixed(2)})</text>`;
  });
  // x 軸 tick (5 分割)
  const ticks = [];
  for (let i = 0; i <= 5; i++) {
    const x = xMin + (i / 5) * (xMax - xMin);
    ticks.push(`<line x1="${xToPx(x)}" y1="${H - PB}" x2="${xToPx(x)}" y2="${H - PB + 4}" stroke="#6b7280"/>
                <text x="${xToPx(x)}" y="${H - PB + 15}" text-anchor="middle" font-size="10" fill="#6b7280">${x.toFixed(1)}</text>`);
  }
  // 差の分布 の 0 (基準線)
  const zeroMark = state.test !== 't2' ? `<line x1="${xToPx(0)}" y1="${PT}" x2="${xToPx(0)}" y2="${H - PB}" stroke="#111" stroke-dasharray="2,2" stroke-width="0.8" opacity="0.4"/>
       <text x="${xToPx(0) + 3}" y="${PT + 10}" font-size="10" fill="#111">差なし (0)</text>` : '';
  // 手法差 (2 標本 の みつ) の 帯
  let diffMark = '';
  if (state.test === 't2' && isFinite(state.rawA.mean) && isFinite(state.rawB.mean)) {
    const yBand = yToPx(dnormAt(0,0,1)) * 0.4;
    diffMark = `<line x1="${xToPx(state.rawA.mean)}" y1="${yBand - 4}" x2="${xToPx(state.rawB.mean)}" y2="${yBand - 4}" stroke="#111" stroke-width="1.2" marker-end="url(#raw-arr)"/>
                <line x1="${xToPx(state.rawB.mean)}" y1="${yBand - 4}" x2="${xToPx(state.rawA.mean)}" y2="${yBand - 4}" stroke="#111" stroke-width="1.2" marker-end="url(#raw-arr)"/>
                <text x="${xToPx((state.rawA.mean + state.rawB.mean) / 2)}" y="${yBand - 8}" text-anchor="middle" font-size="11" fill="#111">|M_A − M_B| = ${Math.abs(state.rawA.mean - state.rawB.mean).toFixed(2)}</text>`;
  }
  return `
    <div style="width:100%; overflow-x:auto">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
        <defs><marker id="raw-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#111"/></marker></defs>
        <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
        ${ticks.join('')}
        ${zeroMark}
        ${svgCurves}
        ${diffMark}
        <g transform="translate(${W - PR - 175}, ${PT})">
          <rect x="0" y="0" width="175" height="${8 + curves.length * 14}" fill="#fff" stroke="#e5e7eb" rx="4"/>
          ${legends}
        </g>
      </svg>
    </div>`;
}

// ---------------- 効果量 ヘルパー (旧: 詳しい人向け) ----------------
// 中村さん指摘「効果量は先行研究の平均SDから計算するか、 パイロット、 メタ分析、 分野の
//   慣習で決めるのが望ましい。 ここをなんとか支援できないか」→ 先行研究 / パイロット の
//   値 を 入れて 効果量 を 逆算 する 補助 UI。 検定 タイプ 別 に 現実的 な 入力 セット を 出す。
function renderEffectHelper() {
  if (state.test === 't2') {
    return `
      <details class="card" style="background:#f9fafb; padding:8px 12px">
        <summary style="cursor:pointer; font-weight:600; font-size:13px">🧮 先行研究の平均・SD から Cohen's d を計算 (独立 2 群)</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>d = |M₁ − M₂| / √((SD₁² + SD₂²) / 2)</code></div>
        <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">群 1 の 平均 M₁</span><input type="number" id="eh-m1" step="any"></label>
          <label class="field"><span class="lbl">群 1 の SD₁</span><input type="number" id="eh-sd1" step="any" min="0.0001"></label>
          <label class="field"><span class="lbl">群 2 の 平均 M₂</span><input type="number" id="eh-m2" step="any"></label>
          <label class="field"><span class="lbl">群 2 の SD₂</span><input type="number" id="eh-sd2" step="any" min="0.0001"></label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="t2" class="btn primary" style="font-size:12px">→ d を計算して 効果量欄に入れる</button>
          <span id="eh-out" class="hint-sm"></span>
        </div>
      </details>`;
  }
  if (state.test === 'tp' || state.test === 't1') {
    return `
      <details class="card" style="background:#f9fafb; padding:8px 12px">
        <summary style="cursor:pointer; font-weight:600; font-size:13px">🧮 先行研究 の 平均・SD から Cohen's d を計算 (対応あり / 1 標本)</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>d = |差分の 平均| / SD</code>。 対応あり なら 「差分の 平均・差分の SD」、 1 標本 なら 「観測平均 − 基準値」 と 観測 SD。</div>
        <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">平均 (差 or 観測 − 基準)</span><input type="number" id="eh-m" step="any"></label>
          <label class="field"><span class="lbl">SD (差 or 観測)</span><input type="number" id="eh-sd" step="any" min="0.0001"></label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="tp" class="btn primary" style="font-size:12px">→ d を計算して 効果量欄に入れる</button>
          <span id="eh-out" class="hint-sm"></span>
        </div>
      </details>`;
  }
  if (state.test === 'anova') {
    return `
      <details class="card" style="background:#f9fafb; padding:8px 12px">
        <summary style="cursor:pointer; font-weight:600; font-size:13px">🧮 群平均 + 群内 SD から Cohen's f を計算</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>f = σ_between / σ_within</code>。 σ_between は 群平均の 母標準偏差 (n で 割る 版)、 σ_within は 群内 共通 SD。</div>
        <div style="display:grid; gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">群平均 (カンマ区切り、 例: 3.2, 4.1, 5.0)</span>
            <input type="text" id="eh-means" placeholder="3.2, 4.1, 5.0">
          </label>
          <label class="field"><span class="lbl">群内 共通 SD (プールされた SD 相当)</span>
            <input type="number" id="eh-sdw" step="any" min="0.0001">
          </label>
          <div class="hint-sm">別ルート: partial η² から <code>f = √(η² / (1 − η²))</code>。 η² が 分かる 場合 は 下の 入力。</div>
          <label class="field"><span class="lbl">partial η² (0-1) から でも OK</span>
            <input type="number" id="eh-eta2" step="0.01" min="0" max="0.99">
          </label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="anova" class="btn primary" style="font-size:12px">→ f を計算して 効果量欄に入れる</button>
          <span id="eh-out" class="hint-sm"></span>
        </div>
      </details>`;
  }
  if (state.test === 'corr') {
    return `
      <details class="card" style="background:#f9fafb; padding:8px 12px">
        <summary style="cursor:pointer; font-weight:600; font-size:13px">🧮 決定係数 R² から r を計算</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>r = √R²</code>。 効果量 r そのものを 入れる 方が 直感的 な ケース も 多い ので、 併用推奨。</div>
        <div style="display:grid; gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">R² (決定係数、 0-1)</span>
            <input type="number" id="eh-r2" step="0.01" min="0" max="0.99">
          </label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="corr" class="btn primary" style="font-size:12px">→ r を計算して 効果量欄に入れる</button>
          <span id="eh-out" class="hint-sm"></span>
        </div>
      </details>`;
  }
  if (state.test === 'chi2') {
    return `
      <details class="card" style="background:#f9fafb; padding:8px 12px">
        <summary style="cursor:pointer; font-weight:600; font-size:13px">🧮 期待比率 と 想定比率 から Cohen's w を計算</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>w = √(Σ ((p_i − p_i₀)² / p_i₀))</code>。 p_i₀ が 帰無時 の 期待比率、 p_i が 想定 (対立) の 比率。 それぞれ カンマ区切りで 同じ 長さ、 合計 1 に なる ように。</div>
        <div style="display:grid; gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">帰無時 の 比率 p₀ (カンマ区切り、 例: 0.5, 0.5)</span>
            <input type="text" id="eh-p0" placeholder="0.5, 0.5">
          </label>
          <label class="field"><span class="lbl">想定 の 比率 p (カンマ区切り、 例: 0.6, 0.4)</span>
            <input type="text" id="eh-p1" placeholder="0.6, 0.4">
          </label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="chi2" class="btn primary" style="font-size:12px">→ w を計算して 効果量欄に入れる</button>
          <span id="eh-out" class="hint-sm"></span>
        </div>
      </details>`;
  }
  return '';
}

function computeEffectFromHelper(kind) {
  const setEff = (v) => {
    state.effect = Math.round(v * 1000) / 1000;
    const el = document.getElementById('pw-effect');
    if (el) el.value = state.effect;
    document.getElementById('eh-out').textContent = `→ 効果量 = ${state.effect}`;
  };
  const num = (id) => parseFloat(document.getElementById(id)?.value);
  const csv = (id) => (document.getElementById(id)?.value || '').split(/[,、\s]+/).map(s => parseFloat(s)).filter(n => !isNaN(n));

  if (kind === 't2') {
    const m1 = num('eh-m1'), sd1 = num('eh-sd1'), m2 = num('eh-m2'), sd2 = num('eh-sd2');
    if ([m1, sd1, m2, sd2].some(v => isNaN(v)) || sd1 <= 0 || sd2 <= 0) return alert('4 つ の 値 を 入れて ください (SD は 正)');
    const sd_pooled = Math.sqrt((sd1 * sd1 + sd2 * sd2) / 2);
    setEff(Math.abs(m1 - m2) / sd_pooled);
  } else if (kind === 'tp') {
    const m = num('eh-m'), sd = num('eh-sd');
    if (isNaN(m) || isNaN(sd) || sd <= 0) return alert('平均 と SD を 入れて ください');
    setEff(Math.abs(m) / sd);
  } else if (kind === 'anova') {
    const eta2 = num('eh-eta2');
    if (!isNaN(eta2) && eta2 > 0 && eta2 < 1) { setEff(Math.sqrt(eta2 / (1 - eta2))); return; }
    const means = csv('eh-means'), sdw = num('eh-sdw');
    if (means.length < 2 || isNaN(sdw) || sdw <= 0) return alert('群平均 (2 個 以上) と 群内 SD を 入れる か、 η² を 入れて ください');
    const grand = means.reduce((a, b) => a + b, 0) / means.length;
    const sigmaBetween = Math.sqrt(means.reduce((s, x) => s + (x - grand) * (x - grand), 0) / means.length);
    setEff(sigmaBetween / sdw);
  } else if (kind === 'corr') {
    const r2 = num('eh-r2');
    if (isNaN(r2) || r2 < 0 || r2 > 1) return alert('R² (0-1) を 入れて ください');
    setEff(Math.sqrt(r2));
  } else if (kind === 'chi2') {
    const p0 = csv('eh-p0'), p1 = csv('eh-p1');
    if (p0.length !== p1.length || p0.length < 2) return alert('比率を 同じ 長さ の カンマ区切り で 2 個以上');
    const w = Math.sqrt(p0.reduce((s, p, i) => {
      if (p <= 0) return s;
      const d = p1[i] - p;
      return s + (d * d) / p;
    }, 0));
    setEff(w);
  }
}

// ---------------- UI ----------------

const TESTS = [
  { id: 't2',    label: '📏 2 標本 t 検定 (独立)',        eff: 'd',        effGuide: [['小 d=0.2', 0.2], ['中 d=0.5', 0.5], ['大 d=0.8', 0.8]] },
  { id: 'tp',    label: '📎 対応のある t 検定',           eff: 'd',        effGuide: [['小 d=0.2', 0.2], ['中 d=0.5', 0.5], ['大 d=0.8', 0.8]] },
  { id: 't1',    label: '👤 1 標本 t 検定',              eff: 'd',        effGuide: [['小 d=0.2', 0.2], ['中 d=0.5', 0.5], ['大 d=0.8', 0.8]] },
  { id: 'anova', label: '📊 一元配置 ANOVA',              eff: 'f',        effGuide: [['小 f=0.10', 0.10], ['中 f=0.25', 0.25], ['大 f=0.40', 0.40]] },
  { id: 'corr',  label: '🔗 Pearson 相関',                eff: 'r',        effGuide: [['小 r=0.10', 0.10], ['中 r=0.30', 0.30], ['大 r=0.50', 0.50]] },
  { id: 'chi2',  label: '⁉ χ² (df 指定)',                eff: 'w',        effGuide: [['小 w=0.10', 0.10], ['中 w=0.30', 0.30], ['大 w=0.50', 0.50]] },
];

const state = {
  test: 't2',
  mode: 'a_priori',   // 'a_priori' | 'post_hoc'
  alpha: 0.05,
  tails: 2,
  effect: 0.5,
  power: 0.8,
  n_per_group: 30,
  n_total: 60,
  k: 3,              // ANOVA 群数
  df: 1,             // χ² 自由度
  // v1028 中村さん提案「実測ベース で 平均 / SD から d を 導く 方が 直感的」
  //   dataType: 'continuous' | 'likert5' | 'likert7' | 'percentage' | 'binary'
  //   rawA, rawB: それぞれ の 群 の { mean, sd }
  //   rawDiff:    対応あり / 1 標本 の 差分 { mean, sd }
  dataType: 'likert7',
  rawA: { mean: 4.0, sd: 1.2 },
  rawB: { mean: 4.6, sd: 1.2 },
  rawDiff: { mean: 0.6, sd: 1.2 },
  // v1026 保存 / 共有 メタ
  loaded_id: 0,       // 現在ロード中の power_analyses.id (0 = 新規)
  loaded_name: '',
  loaded_is_shared: false,
  loaded_share_token: null,
  loaded_owner_name: null,   // 他人の共有をロード中の owner
};

export function renderPower() {
  render();
  loadSavedList();
}

// v1026 共有 URL 経由 (/#/power/r/{token}) からロード
export async function renderPowerShared({ params }) {
  try {
    const d = await get('/api/power/r/' + encodeURIComponent(params.token));
    applyLoaded(d);
    render();
    loadSavedList();
    // 自動で計算実行して結果表示
    setTimeout(doCalc, 30);
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="card" style="color:#dc2626">${escapeHtml(e.message || String(e))}</div>`;
  }
}

function applyLoaded(d) {
  const cfg = d.config || {};
  ['test','mode','alpha','tails','effect','power','n_per_group','n_total','k','df'].forEach(k => {
    if (k in cfg) state[k] = cfg[k];
  });
  state.loaded_id = d.id;
  state.loaded_name = d.name;
  state.loaded_is_shared = !!d.is_shared;
  state.loaded_share_token = d.share_token;
  state.loaded_owner_name = d.is_owner ? null : d.owner_name;
}

function currentConfig() {
  return {
    test: state.test, mode: state.mode, alpha: state.alpha, tails: state.tails,
    effect: state.effect, power: state.power,
    n_per_group: state.n_per_group, n_total: state.n_total,
    k: state.k, df: state.df,
  };
}

function render() {
  const app = document.getElementById('app');
  const t = TESTS.find(x => x.id === state.test);
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📐 サンプルサイズ / 検定力 ${state.loaded_name ? `<span class="hint-sm" style="font-size:13px; margin-left:8px; color:#7b3fa0">📁 ${escapeHtml(state.loaded_name)}${state.loaded_owner_name ? ' (by ' + escapeHtml(state.loaded_owner_name) + ')' : ''}</span>` : ''}</h2>
      <div class="hint-sm" style="margin-top:4px">古典的 G*Power 相当の A priori (必要 n) / Post hoc (検定力) を計算します。 正規近似ベース (G*Power の非心分布計算と数%差)。 v1025+ で LMM/GLMM シミュレーション、 参加者/刺激/試行の比較、 コスト直結を予定。</div>
      <div class="row no-print" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button id="pw-save" class="btn primary" style="font-size:12px; padding:3px 10px">💾 保存 ${state.loaded_id ? '(更新)' : '(名前を付けて)'}</button>
        ${state.loaded_id ? `
          <button id="pw-share" class="btn" style="font-size:12px; padding:3px 10px">📤 共有</button>
          <button id="pw-new" class="btn" style="font-size:12px; padding:3px 10px">🆕 新規</button>
          ${state.loaded_owner_name ? '' : `<button id="pw-delete" class="btn danger" style="font-size:12px; padding:3px 10px">🗑 削除</button>`}
        ` : ''}
      </div>
    </div>

    <div class="card">
      <label class="field">
        <span class="lbl">検定の種類</span>
        <select id="pw-test" style="width:100%">
          ${TESTS.map(x => `<option value="${x.id}" ${x.id===state.test?'selected':''}>${escapeHtml(x.label)}</option>`).join('')}
        </select>
      </label>

      <label class="field">
        <span class="lbl">モード</span>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <button data-pw-mode="a_priori" class="btn ${state.mode==='a_priori'?'primary':''}" style="font-size:12px; padding:4px 10px">🎯 A priori (必要 n)</button>
          <button data-pw-mode="post_hoc" class="btn ${state.mode==='post_hoc'?'primary':''}" style="font-size:12px; padding:4px 10px">🔍 Post hoc (検定力)</button>
        </div>
      </label>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:8px">
        <label class="field"><span class="lbl">有意水準 α</span>
          <input type="number" id="pw-alpha" step="0.005" min="0.001" max="0.5" value="${state.alpha}">
        </label>
        ${['t2','tp','t1','corr'].includes(state.test) ? `
          <label class="field">
            <span class="lbl">仮説の方向</span>
            <select id="pw-tails">
              <option value="2" ${state.tails==2?'selected':''}>両側: 差があるかを判定</option>
              <option value="1" ${state.tails==1?'selected':''}>片側: 想定の大小差を判定</option>
            </select>
            <div class="hint-sm" style="margin-top:2px; font-size:11px">片側は 必要 n が 少し 少なく なる が、 想定と 逆方向 の 差 は 検出しなくなる。</div>
          </label>` : ''}
        ${state.mode==='a_priori' ? `
          <label class="field"><span class="lbl">目標検定力 1 - β</span>
            <input type="number" id="pw-power" step="0.01" min="0.5" max="0.999" value="${state.power}">
          </label>` : `
          <label class="field"><span class="lbl">${state.test==='t2'?'各群のサンプルサイズ n':'全体サンプルサイズ N'}</span>
            <input type="number" id="pw-n" step="1" min="2" value="${state.test==='t2' ? state.n_per_group : state.n_total}">
          </label>`}
        ${state.test==='anova' ? `
          <label class="field"><span class="lbl">群 数 k</span>
            <input type="number" id="pw-k" step="1" min="2" max="20" value="${state.k}">
          </label>` : ''}
        ${state.test==='chi2' ? `
          <label class="field"><span class="lbl">自由度 df</span>
            <input type="number" id="pw-df" step="1" min="1" max="200" value="${state.df}">
          </label>` : ''}
        <label class="field"><span class="lbl">効果量 (${t.eff})</span>
          <input type="number" id="pw-effect" step="0.01" min="0.01" value="${state.effect}">
        </label>
      </div>

      <div class="row" style="gap:6px; margin-top:4px; flex-wrap:wrap">
        <span class="hint-sm">目安:</span>
        ${t.effGuide.map(([lb, v]) => `<button data-pw-eff="${v}" class="btn" style="font-size:11px; padding:2px 8px">${escapeHtml(lb)}</button>`).join('')}
      </div>

      ${renderEffectHelper()}
      ${renderRawInputs()}

      <div class="row" style="margin-top:12px">
        <button id="pw-calc" class="btn primary" style="padding:8px 24px; font-size:14px">🧮 計算</button>
      </div>
    </div>

    <div id="pw-result"></div>

    <div class="card" id="pw-saved-list-card" hidden>
      <div class="bold" style="margin-bottom:6px">📚 保存 済 の 分析</div>
      <div id="pw-saved-list" class="hint-sm">読み込み中…</div>
    </div>

    <details class="card">
      <summary style="cursor:pointer; font-weight:600">📖 効果量の目安 (Cohen)</summary>
      <div style="margin-top:8px; font-size:13px; line-height:1.9">
        <div><b>Cohen's d</b> (t 検定): 0.2 (小) / 0.5 (中) / 0.8 (大)</div>
        <div><b>Cohen's f</b> (ANOVA): 0.10 (小) / 0.25 (中) / 0.40 (大)</div>
        <div><b>Pearson r</b> (相関): 0.10 (小) / 0.30 (中) / 0.50 (大)</div>
        <div><b>Cohen's w</b> (χ²): 0.10 (小) / 0.30 (中) / 0.50 (大)</div>
        <div class="hint-sm" style="margin-top:6px">効果量は先行研究の平均SDから計算するか、 パイロット、 メタ分析、 分野の慣習で決めるのが望ましい。 「中」は 決定に困った時の便宜的な選択。</div>
      </div>
    </details>
  `;

  document.getElementById('pw-test').addEventListener('change', (e) => { state.test = e.target.value; render(); });
  document.querySelectorAll('[data-pw-mode]').forEach(b => {
    b.addEventListener('click', () => { state.mode = b.dataset.pwMode; render(); });
  });
  document.querySelectorAll('[data-pw-eff]').forEach(b => {
    b.addEventListener('click', () => {
      state.effect = parseFloat(b.dataset.pwEff);
      document.getElementById('pw-effect').value = state.effect;
    });
  });
  // v1024b 効果量ヘルパー (先行研究 の 値 から 効果量 を 逆算)
  document.querySelectorAll('[data-eh-calc]').forEach(b => {
    b.addEventListener('click', () => computeEffectFromHelper(b.dataset.ehCalc));
  });
  // v1029 実測ベース 入力
  //   - dtype 変更: 全体 render は せず、 range hint + preview だけ 差し替え (フォーカス残す)
  //   - 平均 / SD 変更: preview グラフ を 差し替え (d の 表示 は しない)
  //   - 「この値で 予想効果量を 求める」ボタン: d を計算 → 効果量欄に反映 → 一言だけ表示
  const dtypeSel = document.getElementById('pw-dtype');
  if (dtypeSel) dtypeSel.addEventListener('change', (e) => {
    state.dataType = e.target.value;
    const rh = document.getElementById('raw-range-hint');
    if (rh) rh.textContent = rangeHintText();
    // preview 更新
    const pv = document.getElementById('raw-preview');
    if (pv) pv.innerHTML = renderRawPreviewSVG();
    // 前回のボタン結果 (derived label) はクリア
    const box = document.getElementById('raw-derived-box');
    if (box) box.textContent = '';
  });
  const rawInputChanged = () => {
    if (state.test === 't2') {
      const mA = parseFloat(document.getElementById('raw-mA')?.value);
      const sA = parseFloat(document.getElementById('raw-sA')?.value);
      const mB = parseFloat(document.getElementById('raw-mB')?.value);
      const sB = parseFloat(document.getElementById('raw-sB')?.value);
      if (!isNaN(mA)) state.rawA.mean = mA;
      if (!isNaN(sA)) state.rawA.sd = sA;
      if (!isNaN(mB)) state.rawB.mean = mB;
      if (!isNaN(sB)) state.rawB.sd = sB;
    } else if (['tp','t1'].includes(state.test)) {
      const m = parseFloat(document.getElementById('raw-mD')?.value);
      const s = parseFloat(document.getElementById('raw-sD')?.value);
      if (!isNaN(m)) state.rawDiff.mean = m;
      if (!isNaN(s)) state.rawDiff.sd = s;
    }
    const pv = document.getElementById('raw-preview');
    if (pv) pv.innerHTML = renderRawPreviewSVG();
    // 前回のボタン結果 (derived label) はクリア (値が変わったので stale)
    const box = document.getElementById('raw-derived-box');
    if (box) box.textContent = '';
  };
  ['raw-mA','raw-sA','raw-mB','raw-sB','raw-mD','raw-sD'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', rawInputChanged);
  });
  document.getElementById('raw-apply')?.addEventListener('click', () => {
    // 最新の form 値を state に反映
    rawInputChanged();
    const d = derivedDFromRaw();
    const box = document.getElementById('raw-derived-box');
    if (d === null) {
      if (box) { box.textContent = '値を 全部 入れて ください (SD は正の値)'; box.style.color = '#a16207'; }
      return;
    }
    state.effect = Math.round(d * 1000) / 1000;
    const el = document.getElementById('pw-effect');
    if (el) el.value = state.effect;
    if (box) { box.innerHTML = `<b style="color:#7b3fa0">${escapeHtml(renderDerivedLabel(d))}</b> を 効果量欄に 入れました。 「🧮 計算」 で 続きへ`; box.style.color = ''; }
  });
  document.getElementById('pw-calc').addEventListener('click', doCalc);
  // v1026 保存 / 共有 / 削除 / 新規
  document.getElementById('pw-save')?.addEventListener('click', onSave);
  document.getElementById('pw-share')?.addEventListener('click', onShare);
  document.getElementById('pw-delete')?.addEventListener('click', onDelete);
  document.getElementById('pw-new')?.addEventListener('click', () => {
    if (!confirm('新規の 分析を 開始 します。 現在の 分析設定 は 未保存 なら 失われます。 続けますか?')) return;
    Object.assign(state, {
      test: 't2', mode: 'a_priori', alpha: 0.05, tails: 2, effect: 0.5, power: 0.8,
      n_per_group: 30, n_total: 60, k: 3, df: 1,
      loaded_id: 0, loaded_name: '', loaded_is_shared: false, loaded_share_token: null, loaded_owner_name: null,
    });
    location.hash = '#/power';
    render(); loadSavedList();
  });
}

async function onSave() {
  // 現在の form の 値 を state に 反映してから保存
  syncFormToState();
  const isUpdate = state.loaded_id > 0 && !state.loaded_owner_name;
  const defaultName = state.loaded_name || `${TESTS.find(x => x.id === state.test).label} - ${new Date().toLocaleString('ja-JP').replace(/\//g,'-').slice(0,16)}`;
  const name = prompt(isUpdate ? '名前を編集 (現在の設定で上書き保存)' : '分析の名前を入力', defaultName);
  if (!name || !name.trim()) return;
  try {
    if (isUpdate) {
      await patch('/api/power/' + state.loaded_id, { name: name.trim(), config: currentConfig() });
      state.loaded_name = name.trim();
      toast('💾 更新しました');
    } else {
      const r = await post('/api/power', { name: name.trim(), config: currentConfig() });
      state.loaded_id = r.id;
      state.loaded_name = name.trim();
      state.loaded_is_shared = false;
      state.loaded_share_token = null;
      state.loaded_owner_name = null;
      toast('💾 保存しました');
    }
    render(); loadSavedList();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onShare() {
  if (!state.loaded_id) return;
  try {
    if (!state.loaded_is_shared) {
      const r = await post('/api/power/' + state.loaded_id + '/share', {});
      state.loaded_is_shared = true;
      state.loaded_share_token = r.share_token;
    }
    const url = '#/power/r/' + state.loaded_share_token;
    shareDialog(`📐 ${state.loaded_name}`, url, {
      pdfTitle: `検定力分析 - ${state.loaded_name}`,
    });
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onDelete() {
  if (!state.loaded_id) return;
  if (!confirm(`「${state.loaded_name}」を削除しますか?`)) return;
  try {
    await del('/api/power/' + state.loaded_id);
    toast('削除しました');
    state.loaded_id = 0; state.loaded_name = ''; state.loaded_is_shared = false;
    state.loaded_share_token = null; state.loaded_owner_name = null;
    location.hash = '#/power';
    render(); loadSavedList();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function loadSavedList() {
  const card = document.getElementById('pw-saved-list-card');
  const root = document.getElementById('pw-saved-list');
  if (!card || !root) return;
  try {
    const d = await get('/api/power');
    const items = d.items || [];
    if (!items.length) { card.hidden = true; return; }
    card.hidden = false;
    root.innerHTML = items.map(it => `
      <div style="display:flex; gap:6px; align-items:center; padding:4px 0; border-bottom:1px solid #f3f4f6">
        <button data-pw-load="${it.id}" class="btn ${state.loaded_id === it.id ? 'primary' : ''}" style="flex:1; text-align:left; font-size:13px; padding:4px 8px">
          ${it.is_shared ? '🌐 ' : ''}${escapeHtml(it.name)}
          <span class="hint-sm" style="font-size:10px; color:#9ca3af"> · ${escapeHtml(it.updated_at)}</span>
        </button>
      </div>`).join('');
    root.querySelectorAll('[data-pw-load]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.pwLoad);
        try {
          const dd = await get('/api/power/' + id);
          applyLoaded(dd);
          render(); loadSavedList();
          setTimeout(doCalc, 30);
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (_) { card.hidden = true; }
}

// 現在の フォーム 値 を state に 反映 (保存前に呼ぶ)
function syncFormToState() {
  const alphaEl = document.getElementById('pw-alpha');
  const effEl = document.getElementById('pw-effect');
  if (alphaEl) state.alpha  = clampFloat(alphaEl.value, 0.001, 0.5);
  if (effEl)   state.effect = clampFloat(effEl.value, 0.001, 10);
  if (['t2','tp','t1','corr'].includes(state.test)) {
    const tailsEl = document.getElementById('pw-tails');
    if (tailsEl) state.tails = parseInt(tailsEl.value, 10);
  }
  if (state.mode === 'a_priori') {
    const pEl = document.getElementById('pw-power');
    if (pEl) state.power = clampFloat(pEl.value, 0.5, 0.999);
  } else {
    const nEl = document.getElementById('pw-n');
    if (nEl) {
      const nVal = parseInt(nEl.value, 10);
      if (state.test === 't2') state.n_per_group = Math.max(2, nVal);
      else                     state.n_total = Math.max(2, nVal);
    }
  }
  if (state.test === 'anova') {
    const kEl = document.getElementById('pw-k');
    if (kEl) state.k = Math.max(2, parseInt(kEl.value, 10));
  }
  if (state.test === 'chi2') {
    const dfEl = document.getElementById('pw-df');
    if (dfEl) state.df = Math.max(1, parseInt(dfEl.value, 10));
  }
}

function doCalc() {
  const t = TESTS.find(x => x.id === state.test);
  syncFormToState();

  let out = null;
  const N = state.test === 't2' ? state.n_per_group : state.n_total;
  try {
    if (state.test === 't2')    out = calc_ttest_two_sample(state.alpha, state.effect, state.tails, state.mode, N, state.power);
    if (state.test === 'tp' || state.test === 't1') out = calc_ttest_paired(state.alpha, state.effect, state.tails, state.mode, N, state.power);
    if (state.test === 'anova') out = calc_anova(state.alpha, state.effect, state.k, state.mode, N, state.power);
    if (state.test === 'corr')  out = calc_correlation(state.alpha, state.effect, state.tails, state.mode, N, state.power);
    if (state.test === 'chi2')  out = calc_chi_squared(state.alpha, state.effect, state.df, state.mode, N, state.power);
  } catch (e) { out = { error: e.message }; }
  renderResult(out, t);
}

// ---------------- グラフ ----------------

// 検定 タイプ / 現在 状態 から (z_alpha, ncp, n) の 3 つ組 を 返す。
//   G*Power 相当の 「H0: 標準正規 N(0,1) vs H1: N(ncp, 1)」 の 対比 で 描く。
function currentDistStats() {
  const alpha = state.alpha;
  const tails = ['t2','tp','t1','corr'].includes(state.test) ? state.tails : 1;
  const za = qnorm(1 - alpha / tails);
  let ncp, n;
  if (state.test === 't2') {
    n = state.n_per_group;
    ncp = state.effect * Math.sqrt(n / 2);
  } else if (state.test === 'tp' || state.test === 't1') {
    n = state.n_total;
    ncp = state.effect * Math.sqrt(n);
  } else if (state.test === 'anova') {
    n = state.n_total;
    ncp = Math.sqrt(n * state.effect * state.effect);   // √λ
  } else if (state.test === 'corr') {
    n = state.n_total;
    const z_r = 0.5 * Math.log((1 + Math.abs(state.effect)) / (1 - Math.abs(state.effect)));
    ncp = n > 3 ? z_r * Math.sqrt(n - 3) : 0;
  } else if (state.test === 'chi2') {
    n = state.n_total;
    ncp = Math.sqrt(n * state.effect * state.effect);
  }
  return { za, ncp, n, tails };
}

// 標準正規 密度
function dnorm(z) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }

// v1027 中村さん指摘「2 手法を比べてるのに 効果なし vs 効果あり の分布が並ぶのが気持ち悪い。
//   2 手法の間に どういう差があるか の方が直感的」→ 各検定タイプ に 「2 群の生分布 (or 相当)」
//   の 直感的プロット を 追加、 従来の H0/H1 検定統計量プロット は details で折り畳み。
function renderIntuitivePlot() {
  if (state.test === 't2' || state.test === 'tp' || state.test === 't1') return renderTwoGroupPlot();
  if (state.test === 'anova') return renderMultiGroupPlot();
  if (state.test === 'corr')  return renderScatterPlot();
  if (state.test === 'chi2')  return renderProportionsPlot();
  return '';
}

// 2 群の生分布: μ_A=0, σ=1、 μ_B=d の 正規分布 を 重ね書き。 効果量 d = 群間差 / SD。
function renderTwoGroupPlot() {
  const d = state.effect;
  if (!isFinite(d) || d <= 0) return '';
  const W = 620, H = 260, PL = 40, PR = 20, PT = 20, PB = 40;
  const xMin = -4, xMax = Math.max(6, d + 4);
  const xToPx = (x) => PL + (x - xMin) / (xMax - xMin) * (W - PL - PR);
  const yMax = 0.42;
  const yToPx = (y) => PT + (1 - y / yMax) * (H - PT - PB);
  const N = 200;
  const ptsA = [], ptsB = [];
  for (let i = 0; i <= N; i++) {
    const x = xMin + (i / N) * (xMax - xMin);
    ptsA.push([x, dnorm(x)]);
    ptsB.push([x, dnorm(x - d)]);
  }
  const toPath = (pts) => 'M ' + pts.map(([x, y]) => `${xToPx(x).toFixed(1)} ${yToPx(y).toFixed(1)}`).join(' L ');
  // 重なり領域 = min(A, B)
  const overlapPts = ptsA.map(([x, yA], i) => [x, Math.min(yA, ptsB[i][1])]);
  const overlapArea = 'M ' + overlapPts.map(([x, y]) => `${xToPx(x).toFixed(1)} ${yToPx(y).toFixed(1)}`).join(' L ') +
                      ` L ${xToPx(xMax).toFixed(1)} ${yToPx(0).toFixed(1)} L ${xToPx(xMin).toFixed(1)} ${yToPx(0).toFixed(1)} Z`;
  // x-軸 tick
  const ticks = [];
  for (let t = Math.ceil(xMin); t <= xMax; t++) {
    ticks.push(`<line x1="${xToPx(t)}" y1="${H - PB}" x2="${xToPx(t)}" y2="${H - PB + 4}" stroke="#6b7280"/>
                <text x="${xToPx(t)}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${t}σ</text>`);
  }
  // 群平均を 縦破線
  const grpA = 0, grpB = d;
  // 平均間の 矢印
  const arrowY = yToPx(dnorm(0)) - 12;
  const label = state.test === 't2' ? ['群 A', '群 B'] : (state.test === 'tp' ? ['ベースライン', '差の 平均'] : ['基準値', '観測平均']);
  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📊 群の分布 (Cohen's d = ${d.toFixed(2)})</div>
      <div style="width:100%; overflow-x:auto">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
          ${ticks.join('')}
          <!-- 重なり (灰) -->
          <path d="${overlapArea}" fill="#9ca3af55" stroke="none"/>
          <!-- A 曲線 (青) + 内部塗り 薄青 -->
          <path d="${toPath(ptsA)} L ${xToPx(xMax).toFixed(1)} ${yToPx(0).toFixed(1)} L ${xToPx(xMin).toFixed(1)} ${yToPx(0).toFixed(1)} Z" fill="#2563eb22"/>
          <path d="${toPath(ptsA)}" fill="none" stroke="#2563eb" stroke-width="2"/>
          <!-- B 曲線 (橙) + 内部塗り 薄橙 -->
          <path d="${toPath(ptsB)} L ${xToPx(xMax).toFixed(1)} ${yToPx(0).toFixed(1)} L ${xToPx(xMin).toFixed(1)} ${yToPx(0).toFixed(1)} Z" fill="#ea580c22"/>
          <path d="${toPath(ptsB)}" fill="none" stroke="#ea580c" stroke-width="2"/>
          <!-- 平均線 -->
          <line x1="${xToPx(grpA)}" y1="${yToPx(dnorm(0))}" x2="${xToPx(grpA)}" y2="${H - PB}" stroke="#2563eb" stroke-dasharray="3,3" stroke-width="1"/>
          <line x1="${xToPx(grpB)}" y1="${yToPx(dnorm(0))}" x2="${xToPx(grpB)}" y2="${H - PB}" stroke="#ea580c" stroke-dasharray="3,3" stroke-width="1"/>
          <!-- 差の矢印 -->
          <line x1="${xToPx(grpA)}" y1="${arrowY}" x2="${xToPx(grpB)}" y2="${arrowY}" stroke="#111" stroke-width="1.2" marker-end="url(#pw-arr)"/>
          <line x1="${xToPx(grpB)}" y1="${arrowY}" x2="${xToPx(grpA)}" y2="${arrowY}" stroke="#111" stroke-width="1.2" marker-end="url(#pw-arr)"/>
          <text x="${xToPx((grpA + grpB) / 2)}" y="${arrowY - 4}" text-anchor="middle" font-size="11" fill="#111">差 = ${d.toFixed(2)} σ</text>
          <defs><marker id="pw-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#111"/></marker></defs>
          <!-- 凡例 -->
          <g transform="translate(${W - PR - 130}, ${PT})">
            <rect x="0" y="0" width="130" height="52" fill="#fff" stroke="#e5e7eb" rx="4"/>
            <line x1="6" y1="14" x2="24" y2="14" stroke="#2563eb" stroke-width="2"/><text x="28" y="17" font-size="10.5" fill="#111">${escapeHtml(label[0])} (μ=0)</text>
            <line x1="6" y1="30" x2="24" y2="30" stroke="#ea580c" stroke-width="2"/><text x="28" y="33" font-size="10.5" fill="#111">${escapeHtml(label[1])} (μ=${d.toFixed(2)}σ)</text>
            <rect x="6" y="40" width="18" height="8" fill="#9ca3af55"/><text x="28" y="47" font-size="10" fill="#111">重なり</text>
          </g>
        </svg>
      </div>
      <div class="hint-sm" style="margin-top:6px">2 群 の 分布 (横軸 は SD 単位)。 重なりが 小さい ほど、 群間差が 大きく 検出しやすい。 d=0.2 で 約 92% 重なり、 d=0.5 で 約 80%、 d=0.8 で 約 69%。</div>
    </div>`;
}

// ANOVA: k 群の分布を重ね書き
function renderMultiGroupPlot() {
  const f = state.effect;
  const k = state.k;
  if (!isFinite(f) || f <= 0 || k < 2) return '';
  // 群平均を σ=1 上で 対称に配置: mean_i = f × (i - (k-1)/2) × √(k / (k-1)) など。
  //   簡易: mean_i を [-a, a] 等間隔、 σ_between = a × √(k / (k-1)) を f に合わせる
  //   → a = f × √((k-1) / k)。 実際は f² = σ_between² / σ²、 σ_between² = Σ(μ_i - μ̄)²/k。
  //   等間隔 μ_i = (i - (k-1)/2) × step、 σ_between² = step² × (k²-1)/12
  //   → step = f × √(12/(k²-1))
  const step = f * Math.sqrt(12 / (k * k - 1));
  const means = Array.from({length: k}, (_, i) => (i - (k - 1) / 2) * step);
  const W = 620, H = 260, PL = 40, PR = 20, PT = 20, PB = 40;
  const xMax = Math.max(4, means[k-1] + 4), xMin = -xMax;
  const xToPx = (x) => PL + (x - xMin) / (xMax - xMin) * (W - PL - PR);
  const yMax = 0.42;
  const yToPx = (y) => PT + (1 - y / yMax) * (H - PT - PB);
  const colors = ['#2563eb','#ea580c','#059669','#a855f7','#dc2626','#eab308','#0891b2','#db2777'];
  const N = 200;
  let curves = '';
  let legends = '';
  for (let g = 0; g < k; g++) {
    const c = colors[g % colors.length];
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const x = xMin + (i / N) * (xMax - xMin);
      pts.push([x, dnorm(x - means[g])]);
    }
    const p = 'M ' + pts.map(([x, y]) => `${xToPx(x).toFixed(1)} ${yToPx(y).toFixed(1)}`).join(' L ');
    curves += `<path d="${p} L ${xToPx(xMax).toFixed(1)} ${yToPx(0).toFixed(1)} L ${xToPx(xMin).toFixed(1)} ${yToPx(0).toFixed(1)} Z" fill="${c}22" stroke="none"/>`;
    curves += `<path d="${p}" fill="none" stroke="${c}" stroke-width="1.6"/>`;
    curves += `<line x1="${xToPx(means[g])}" y1="${yToPx(dnorm(0))}" x2="${xToPx(means[g])}" y2="${H - PB}" stroke="${c}" stroke-dasharray="3,3" stroke-width="0.8"/>`;
    legends += `<line x1="6" y1="${14 + g * 12}" x2="24" y2="${14 + g * 12}" stroke="${c}" stroke-width="2"/><text x="28" y="${17 + g * 12}" font-size="10" fill="#111">群 ${g + 1} (μ=${means[g].toFixed(2)}σ)</text>`;
  }
  const ticks = [];
  for (let t = Math.ceil(xMin); t <= xMax; t++) {
    ticks.push(`<line x1="${xToPx(t)}" y1="${H - PB}" x2="${xToPx(t)}" y2="${H - PB + 4}" stroke="#6b7280"/>
                <text x="${xToPx(t)}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${t}σ</text>`);
  }
  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📊 ${k} 群の分布 (Cohen's f = ${f.toFixed(2)})</div>
      <div style="width:100%; overflow-x:auto">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
          ${ticks.join('')}
          ${curves}
          <g transform="translate(${W - PR - 130}, ${PT})">
            <rect x="0" y="0" width="130" height="${8 + k * 12}" fill="#fff" stroke="#e5e7eb" rx="4"/>
            ${legends}
          </g>
        </svg>
      </div>
      <div class="hint-sm" style="margin-top:6px">${k} 群 (横軸 SD 単位)。 平均間隔 の 広がり (σ_between) が 大きい ほど f も 大きく、 差を 検出しやすい。 f=0.1 (小) は 群平均 の 差 が 群内 SD の 1/10 程度、 f=0.4 (大) は 40% 程度。</div>
    </div>`;
}

// 相関: n 点 の 散布図 (擬似データ)、 想定 r で 線を引く
function renderScatterPlot() {
  const r = state.effect;
  const n = state.n_total;
  if (!isFinite(r) || Math.abs(r) >= 1) return '';
  const nPts = Math.min(n, 200);
  // 擬似データ: 決定的な seed から 疑似 gaussian を 生成
  const pts = [];
  let seed = 42;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  for (let i = 0; i < nPts; i++) {
    const x = gauss();
    const y = r * x + Math.sqrt(1 - r * r) * gauss();
    pts.push([x, y]);
  }
  const W = 620, H = 260, PL = 40, PR = 20, PT = 20, PB = 40;
  const xMin = -3, xMax = 3, yMin = -3, yMax = 3;
  const xToPx = (x) => PL + (x - xMin) / (xMax - xMin) * (W - PL - PR);
  const yToPx = (y) => PT + (1 - (y - yMin) / (yMax - yMin)) * (H - PT - PB);
  const dots = pts.map(([x, y]) => `<circle cx="${xToPx(x).toFixed(1)}" cy="${yToPx(y).toFixed(1)}" r="2.2" fill="#7b3fa0" opacity="0.55"/>`).join('');
  // 回帰線: y = r × x
  const line = `<line x1="${xToPx(xMin)}" y1="${yToPx(r * xMin)}" x2="${xToPx(xMax)}" y2="${yToPx(r * xMax)}" stroke="#dc2626" stroke-width="1.6"/>`;
  const ticks = [];
  for (let t = xMin; t <= xMax; t++) {
    ticks.push(`<line x1="${xToPx(t)}" y1="${H - PB}" x2="${xToPx(t)}" y2="${H - PB + 4}" stroke="#6b7280"/><text x="${xToPx(t)}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${t}</text>`);
    ticks.push(`<line x1="${PL - 4}" y1="${yToPx(t)}" x2="${PL}" y2="${yToPx(t)}" stroke="#6b7280"/><text x="${PL - 6}" y="${yToPx(t) + 3}" text-anchor="end" font-size="10" fill="#6b7280">${t}</text>`);
  }
  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📊 散布図 (r = ${r.toFixed(2)}、 n = ${n} の 擬似データ)</div>
      <div style="width:100%; overflow-x:auto">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
          <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" stroke="#374151"/>
          ${ticks.join('')}
          ${dots}
          ${line}
        </svg>
      </div>
      <div class="hint-sm" style="margin-top:6px">想定 r で 生成した 擬似散布図。 実際の データ が こういう ばらつき方 に なる 想定。 r=0.1 (小) は 直線が ほぼ 見えない、 r=0.5 (大) で ようやく 傾向 が 目視 で 分かる。</div>
    </div>`;
}

// chi²: 帰無 と 想定 の 比率 を 棒グラフで
function renderProportionsPlot() {
  // 効果量 w からは具体的な p 値組が復元できないので、 df+1 個の 均等 帰無 と 想定 (w に対応)
  const w = state.effect;
  const df = state.df;
  const k = df + 1;  // df = k - 1 と仮定
  if (!isFinite(w) || w <= 0 || k < 2 || k > 20) return '';
  const p0 = Array(k).fill(1 / k);
  // 想定: 対称に 1 群を +Δ、 対称に他を -Δ/(k-1)。 w² = Σ(p-p0)²/p0
  // シンプル: 1 群だけ +Δ、 残りは -Δ/(k-1)
  // w² = Δ²/p0 + (k-1) × (Δ/(k-1))²/p0 = Δ²/p0 × (1 + 1/(k-1)) = Δ² × k / ((k-1) × p0)
  // p0 = 1/k → w² = Δ² × k² / (k-1) → Δ = w × √((k-1)/k²) = w × √(k-1)/k
  const delta = w * Math.sqrt(k - 1) / k;
  const p1 = p0.map((v, i) => i === 0 ? v + delta : v - delta / (k - 1));
  const W = 620, H = 240, PL = 40, PR = 20, PT = 20, PB = 40;
  const barW = (W - PL - PR) / k;
  const yMax = Math.max(...p0, ...p1) * 1.3;
  const yToPx = (y) => PT + (1 - y / yMax) * (H - PT - PB);
  let bars = '';
  for (let i = 0; i < k; i++) {
    const x0 = PL + i * barW;
    const bw = (barW - 8) / 2;
    bars += `<rect x="${x0 + 4}" y="${yToPx(p0[i])}" width="${bw}" height="${(H - PB) - yToPx(p0[i])}" fill="#2563eb" opacity="0.7"/>`;
    bars += `<rect x="${x0 + 4 + bw}" y="${yToPx(p1[i])}" width="${bw}" height="${(H - PB) - yToPx(p1[i])}" fill="#ea580c" opacity="0.7"/>`;
    bars += `<text x="${x0 + barW / 2}" y="${H - PB + 14}" text-anchor="middle" font-size="10" fill="#6b7280">カテゴリ ${i + 1}</text>`;
  }
  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📊 比率の分布 (Cohen's w = ${w.toFixed(2)}、 ${k} カテゴリ)</div>
      <div style="width:100%; overflow-x:auto">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
          <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" stroke="#374151"/>
          ${bars}
          <g transform="translate(${W - PR - 120}, ${PT})">
            <rect x="0" y="0" width="120" height="34" fill="#fff" stroke="#e5e7eb" rx="4"/>
            <rect x="6" y="6" width="14" height="10" fill="#2563eb" opacity="0.7"/><text x="24" y="15" font-size="10" fill="#111">帰無 (均等)</text>
            <rect x="6" y="20" width="14" height="10" fill="#ea580c" opacity="0.7"/><text x="24" y="29" font-size="10" fill="#111">想定 (偏り)</text>
          </g>
        </svg>
      </div>
      <div class="hint-sm" style="margin-top:6px">帰無 (等分布) と 想定 (w に相当する偏り) の 比較例。 実際は 効果量 w に 対応する 分布 の 選び方 は 複数ある が、 「1 カテゴリ に 偏る」 パターン を 表示。</div>
    </div>`;
}

// 分布プロット (H0 vs H1、 α/β/power 領域を色分け)
function renderDistPlot() {
  const { za, ncp, tails } = currentDistStats();
  if (!isFinite(ncp) || ncp <= 0) return '';
  const W = 620, H = 260, PL = 40, PR = 20, PT = 20, PB = 40;
  const xMin = -4, xMax = Math.max(6, ncp + 4);
  const xToPx = (x) => PL + (x - xMin) / (xMax - xMin) * (W - PL - PR);
  const yMax = 0.42;   // dnorm(0) ≈ 0.399、 上余白 for label
  const yToPx = (y) => PT + (1 - y / yMax) * (H - PT - PB);
  // 密度サンプル
  const N = 200;
  const h0Points = [], h1Points = [];
  for (let i = 0; i <= N; i++) {
    const x = xMin + (i / N) * (xMax - xMin);
    h0Points.push([x, dnorm(x)]);
    h1Points.push([x, dnorm(x - ncp)]);
  }
  const toPath = (pts) => 'M ' + pts.map(([x, y]) => `${xToPx(x).toFixed(1)} ${yToPx(y).toFixed(1)}`).join(' L ');
  // 領域塗り (path with fill、 baseline を 加える 閉じたパス)
  const areaPath = (pts, filterFn) => {
    const filtered = pts.filter(([x]) => filterFn(x));
    if (!filtered.length) return '';
    const seg = filtered.map(([x, y]) => `${xToPx(x).toFixed(1)} ${yToPx(y).toFixed(1)}`).join(' L ');
    const [x0] = filtered[0], [xE] = filtered[filtered.length - 1];
    return `M ${xToPx(x0).toFixed(1)} ${yToPx(0).toFixed(1)} L ${seg} L ${xToPx(xE).toFixed(1)} ${yToPx(0).toFixed(1)} Z`;
  };
  // α 領域: H0 の 右 (両側 なら 左 も)
  const alphaPathR = areaPath(h0Points, x => x >= za);
  const alphaPathL = tails === 2 ? areaPath(h0Points, x => x <= -za) : '';
  // power 領域: H1 の 右 (critical より右)
  const powerPath = areaPath(h1Points, x => x >= za);
  // β 領域: H1 の 左 (critical より左)
  const betaPath  = areaPath(h1Points, x => x <= za);

  // 軸 tick
  const ticks = [];
  for (let t = Math.ceil(xMin); t <= xMax; t++) {
    ticks.push(`<line x1="${xToPx(t)}" y1="${H - PB}" x2="${xToPx(t)}" y2="${H - PB + 4}" stroke="#6b7280"/>
                <text x="${xToPx(t)}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${t}</text>`);
  }

  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📈 検定統計量 の 分布 (H0 vs H1) — G*Power 型</div>
      <div style="width:100%; overflow-x:auto">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
          <!-- 軸 -->
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
          ${ticks.join('')}
          <!-- β 領域 (灰) -->
          <path d="${betaPath}" fill="#9ca3af44" stroke="none"/>
          <!-- power 領域 (緑) -->
          <path d="${powerPath}" fill="#05966944" stroke="none"/>
          <!-- α 領域 (赤) -->
          <path d="${alphaPathR}" fill="#dc262666" stroke="none"/>
          ${alphaPathL ? `<path d="${alphaPathL}" fill="#dc262666" stroke="none"/>` : ''}
          <!-- H0 curve (青) -->
          <path d="${toPath(h0Points)}" fill="none" stroke="#2563eb" stroke-width="1.8"/>
          <!-- H1 curve (橙) -->
          <path d="${toPath(h1Points)}" fill="none" stroke="#ea580c" stroke-width="1.8"/>
          <!-- critical 線 -->
          <line x1="${xToPx(za)}" y1="${PT}" x2="${xToPx(za)}" y2="${H - PB}" stroke="#111" stroke-dasharray="4,3" stroke-width="1"/>
          <text x="${xToPx(za) + 4}" y="${PT + 12}" font-size="11" fill="#111">critical = ${za.toFixed(2)}</text>
          ${tails === 2 ? `<line x1="${xToPx(-za)}" y1="${PT}" x2="${xToPx(-za)}" y2="${H - PB}" stroke="#111" stroke-dasharray="4,3" stroke-width="1"/>` : ''}
          <!-- H1 ncp 位置 -->
          <line x1="${xToPx(ncp)}" y1="${yToPx(dnorm(0))}" x2="${xToPx(ncp)}" y2="${H - PB}" stroke="#ea580c" stroke-dasharray="2,2" stroke-width="0.8" opacity="0.5"/>
          <text x="${xToPx(ncp) + 4}" y="${yToPx(dnorm(0)) - 4}" font-size="11" fill="#ea580c">ncp = ${ncp.toFixed(2)}</text>
          <!-- 凡例 -->
          <g transform="translate(${W - PR - 130}, ${PT})">
            <rect x="0" y="0" width="130" height="72" fill="#fff" stroke="#e5e7eb" rx="4"/>
            <line x1="6" y1="14" x2="24" y2="14" stroke="#2563eb" stroke-width="2"/>
            <text x="28" y="17" font-size="10.5" fill="#111">H0 (帰無)</text>
            <line x1="6" y1="30" x2="24" y2="30" stroke="#ea580c" stroke-width="2"/>
            <text x="28" y="33" font-size="10.5" fill="#111">H1 (対立)</text>
            <rect x="6" y="40" width="18" height="8" fill="#dc262666"/><text x="28" y="47" font-size="10" fill="#111">α (型 I 誤)</text>
            <rect x="6" y="52" width="18" height="8" fill="#9ca3af44"/><text x="28" y="59" font-size="10" fill="#111">β (型 II 誤)</text>
            <rect x="6" y="64" width="18" height="8" fill="#05966944"/><text x="28" y="71" font-size="10" fill="#111">検定力</text>
          </g>
        </svg>
      </div>
      <div class="hint-sm" style="margin-top:6px"><b>これは「検定 で 計算する t 値 等 の 統計量 の 分布」</b>で、 群 の 生分布 では ない。 青が H0 (効果なし と 仮定)、 橙が H1 (想定効果 が 本当に あった 場合)。 縦点線 が α に対応する 臨界値、 橙が 臨界値より右に はみ出す 面積 が 検定力 (緑)、 臨界値より左に 残る 面積 が β (灰)。 実際の 群の 分布は 上の 「群の分布」プロット で。</div>
    </div>`;
}

// 検定力カーブ (n を 変えた 時 の power)
function renderPowerCurve() {
  const t = TESTS.find(x => x.id === state.test);
  const nowN = state.test === 't2' ? state.n_per_group : state.n_total;
  // n 範囲: 6 〜 max(200, nowN×2)
  const nMax = Math.max(200, nowN * 2);
  const nMin = 4;
  const steps = 80;
  const points = [];
  for (let i = 0; i < steps; i++) {
    const n = Math.round(nMin + (nMax - nMin) * (i / (steps - 1)));
    let p;
    try {
      if (state.test === 't2')    p = calc_ttest_two_sample(state.alpha, state.effect, state.tails, 'post_hoc', n, 0.8).power;
      if (state.test === 'tp' || state.test === 't1') p = calc_ttest_paired(state.alpha, state.effect, state.tails, 'post_hoc', n, 0.8).power;
      if (state.test === 'anova') p = calc_anova(state.alpha, state.effect, state.k, 'post_hoc', n, 0.8).power;
      if (state.test === 'corr')  p = calc_correlation(state.alpha, state.effect, state.tails, 'post_hoc', n, 0.8).power;
      if (state.test === 'chi2')  p = calc_chi_squared(state.alpha, state.effect, state.df, 'post_hoc', n, 0.8).power;
    } catch (_) { p = 0; }
    if (!isFinite(p)) p = 0;
    points.push([n, p]);
  }
  const W = 620, H = 240, PL = 40, PR = 20, PT = 20, PB = 40;
  const xToPx = (x) => PL + (x - nMin) / (nMax - nMin) * (W - PL - PR);
  const yToPx = (y) => PT + (1 - y) * (H - PT - PB);
  const path = 'M ' + points.map(([x, y]) => `${xToPx(x).toFixed(1)} ${yToPx(y).toFixed(1)}`).join(' L ');
  // y = 0.8 line
  const y80 = yToPx(0.8);
  // 現在 n の 点
  let curP = 0;
  try {
    if (state.test === 't2')    curP = calc_ttest_two_sample(state.alpha, state.effect, state.tails, 'post_hoc', nowN, 0.8).power;
    if (state.test === 'tp' || state.test === 't1') curP = calc_ttest_paired(state.alpha, state.effect, state.tails, 'post_hoc', nowN, 0.8).power;
    if (state.test === 'anova') curP = calc_anova(state.alpha, state.effect, state.k, 'post_hoc', nowN, 0.8).power;
    if (state.test === 'corr')  curP = calc_correlation(state.alpha, state.effect, state.tails, 'post_hoc', nowN, 0.8).power;
    if (state.test === 'chi2')  curP = calc_chi_squared(state.alpha, state.effect, state.df, 'post_hoc', nowN, 0.8).power;
  } catch (_) {}
  // x ticks
  const xticks = [];
  const nTicks = 8;
  for (let i = 0; i <= nTicks; i++) {
    const n = Math.round(nMin + (nMax - nMin) * (i / nTicks));
    xticks.push(`<line x1="${xToPx(n)}" y1="${H - PB}" x2="${xToPx(n)}" y2="${H - PB + 4}" stroke="#6b7280"/>
                 <text x="${xToPx(n)}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${n}</text>`);
  }
  const yticks = [];
  for (let p of [0, 0.2, 0.4, 0.6, 0.8, 1.0]) {
    yticks.push(`<line x1="${PL - 4}" y1="${yToPx(p)}" x2="${PL}" y2="${yToPx(p)}" stroke="#6b7280"/>
                 <text x="${PL - 6}" y="${yToPx(p) + 3}" text-anchor="end" font-size="10" fill="#6b7280">${p.toFixed(1)}</text>`);
  }
  const xLabel = state.test === 't2' ? '各群 n' : '全体 N';
  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📈 検定力カーブ (${xLabel} vs 検定力)</div>
      <div style="width:100%; overflow-x:auto">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
          <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" stroke="#374151"/>
          ${xticks.join('')}
          ${yticks.join('')}
          <!-- 検定力 0.8 のライン -->
          <line x1="${PL}" y1="${y80}" x2="${W - PR}" y2="${y80}" stroke="#059669" stroke-dasharray="4,3" stroke-width="1"/>
          <text x="${W - PR - 4}" y="${y80 - 4}" font-size="10" fill="#059669" text-anchor="end">power = 0.8</text>
          <!-- power カーブ -->
          <path d="${path}" fill="none" stroke="#7b3fa0" stroke-width="2"/>
          <!-- 現在 n の 点 -->
          <circle cx="${xToPx(nowN)}" cy="${yToPx(curP)}" r="5" fill="#7b3fa0"/>
          <text x="${xToPx(nowN) + 8}" y="${yToPx(curP) + 4}" font-size="11" fill="#7b3fa0">現在 n=${nowN}, ${(curP * 100).toFixed(0)}%</text>
          <text x="${PL - 30}" y="${(PT + H - PB) / 2}" transform="rotate(-90, ${PL - 30}, ${(PT + H - PB) / 2})" font-size="11" fill="#374151" text-anchor="middle">検定力 (1-β)</text>
          <text x="${(PL + W - PR) / 2}" y="${H - 6}" font-size="11" fill="#374151" text-anchor="middle">${xLabel}</text>
        </svg>
      </div>
      <div class="hint-sm" style="margin-top:6px">n を 増やすと 検定力 が どう 上がる か。 緑の点線 は 慣習的な 目標 (0.8)。 現在 n の 検定力 を 紫の点 で 表示。</div>
    </div>`;
}

function renderResult(out, t) {
  const root = document.getElementById('pw-result');
  if (!out) return;
  if (out.error) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(out.error)}</div>`; return; }
  // A priori の 場合 は 計算 結果 の n を state に 反映 して グラフ を 描く
  if (state.mode === 'a_priori') {
    if (state.test === 't2')    state.n_per_group = out.n_per_group;
    else                        state.n_total     = out.n_total;
  }
  const tailStr = state.tails === 2 ? '両側' : '片側';
  const args = `α=${state.alpha}, ${state.tails === 2 || !['t2','tp','t1','corr'].includes(state.test) ? tailStr : tailStr}, ${t.eff}=${state.effect}`;
  const extraArgs = state.test === 'anova' ? `, k=${state.k}` : (state.test === 'chi2' ? `, df=${state.df}` : '');
  // v1025b 中村さん指摘「計算し直したときに、 グラフが作り変えられない」→ 従来は
  //   root.innerHTML → insertAdjacentHTML の 2 段構え で グラフ を 追記 していたが、
  //   タイミング 依存 で 追記 が スキップ される 事例あり。 結果カード + 分布プロット +
  //   検定力カーブ を 1 つの 文字列に まとめて 一度に innerHTML で セット、 再計算のたび
  //   に 全部 綺麗に 描き直す。
  let resultHtml = '';
  if (state.mode === 'a_priori') {
    const nMsg = state.test === 't2'
      ? `各群 n = <b>${out.n_per_group}</b> (全体 N = ${out.n_total})`
      : state.test === 'anova'
        ? `全体 N = <b>${out.n_total}</b> (各群 n ≈ ${out.n_per_group})`
        : `全体 N = <b>${out.n_total}</b>`;
    resultHtml = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🎯 必要サンプルサイズ (A priori)</div>
        <div style="font-size:26px; line-height:1.5">${nMsg}</div>
        <div class="hint-sm" style="margin-top:8px">検定力 1-β = ${state.power} を得るため。 ${args}${extraArgs}</div>
        <div class="hint-sm" style="margin-top:4px; color:#a16207">脱落・除外を見込んで <b>${Math.ceil((state.test === 't2' ? out.n_total : out.n_total) * 1.10)}</b> 名募集する等の余裕を持たせるとよいです。</div>
      </div>`;
  } else {
    const p = out.power;
    const pctColor = p >= 0.8 ? '#059669' : (p >= 0.6 ? '#a16207' : '#dc2626');
    resultHtml = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🔍 得られる検定力 (Post hoc)</div>
        <div style="font-size:28px; line-height:1.5; color:${pctColor}"><b>${(p * 100).toFixed(1)}%</b></div>
        <div class="hint-sm" style="margin-top:8px">現在の n で 効果量が 想定通り なら 上記 の 確率 で 有意 に なります。 ${args}${extraArgs}, n=${state.test === 't2' ? state.n_per_group : state.n_total}</div>
        ${p < 0.8 ? '<div class="hint-sm" style="margin-top:4px; color:#a16207">💡 検定力 80% 未満: 効果があってもそれを検出できず 「型 II 過誤」 が起きる可能性が高めです。</div>' : ''}
      </div>`;
  }
  // v1027 直感的プロット (2 群 or k 群 or 散布図 or 比率棒) を 主役に、 従来の
  //   G*Power 型 検定統計量プロット は その 下 に 残す (中村さん指示「G*Power の
  //   やつも 残しておいて 良い、 2 群の 分布も やっぱり欲しい」)。
  root.innerHTML = resultHtml + renderIntuitivePlot() + renderDistPlot() + renderPowerCurve();
}

function clampFloat(v, lo, hi) {
  const n = parseFloat(v);
  if (isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
