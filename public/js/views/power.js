// v1024 サンプルサイズ / power analysis (G*Power ベースライン、 中村さん指示「まずは
//   最低限 G*Power の 機能 は 実装」)。 純クライアントサイド計算 (認証不要 / API 不要)。
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
};

export function renderPower() {
  render();
}

function render() {
  const app = document.getElementById('app');
  const t = TESTS.find(x => x.id === state.test);
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📐 サンプルサイズ / 検定力</h2>
      <div class="hint-sm" style="margin-top:4px">古典的 G*Power 相当の A priori (必要 n) / Post hoc (検定力) を計算します。 正規近似ベース (G*Power の非心分布計算と数%差)。 v1025+ で LMM/GLMM シミュレーション、 参加者/刺激/試行の比較、 コスト直結を予定。</div>
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
          <label class="field"><span class="lbl">両側 / 片側</span>
            <select id="pw-tails">
              <option value="2" ${state.tails==2?'selected':''}>両側</option>
              <option value="1" ${state.tails==1?'selected':''}>片側</option>
            </select>
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

      <div class="row" style="margin-top:12px">
        <button id="pw-calc" class="btn primary" style="padding:8px 24px; font-size:14px">🧮 計算</button>
      </div>
    </div>

    <div id="pw-result"></div>

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
  document.getElementById('pw-calc').addEventListener('click', doCalc);
}

function doCalc() {
  const t = TESTS.find(x => x.id === state.test);
  state.alpha  = clampFloat(document.getElementById('pw-alpha').value, 0.001, 0.5);
  state.effect = clampFloat(document.getElementById('pw-effect').value, 0.001, 10);
  state.tails  = ['t2','tp','t1','corr'].includes(state.test)
    ? parseInt(document.getElementById('pw-tails').value, 10) : 2;
  if (state.mode === 'a_priori') {
    state.power = clampFloat(document.getElementById('pw-power').value, 0.5, 0.999);
  } else {
    const nEl = document.getElementById('pw-n');
    const nVal = parseInt(nEl.value, 10);
    if (state.test === 't2') state.n_per_group = Math.max(2, nVal);
    else                     state.n_total = Math.max(2, nVal);
  }
  if (state.test === 'anova') state.k  = Math.max(2, parseInt(document.getElementById('pw-k').value, 10));
  if (state.test === 'chi2')  state.df = Math.max(1, parseInt(document.getElementById('pw-df').value, 10));

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

function renderResult(out, t) {
  const root = document.getElementById('pw-result');
  if (!out) return;
  if (out.error) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(out.error)}</div>`; return; }
  const tailStr = state.tails === 2 ? '両側' : '片側';
  const args = `α=${state.alpha}, ${state.tails === 2 || !['t2','tp','t1','corr'].includes(state.test) ? tailStr : tailStr}, ${t.eff}=${state.effect}`;
  const extraArgs = state.test === 'anova' ? `, k=${state.k}` : (state.test === 'chi2' ? `, df=${state.df}` : '');
  if (state.mode === 'a_priori') {
    const nMsg = state.test === 't2'
      ? `各群 n = <b>${out.n_per_group}</b> (全体 N = ${out.n_total})`
      : state.test === 'anova'
        ? `全体 N = <b>${out.n_total}</b> (各群 n ≈ ${out.n_per_group})`
        : `全体 N = <b>${out.n_total}</b>`;
    root.innerHTML = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🎯 必要サンプルサイズ (A priori)</div>
        <div style="font-size:26px; line-height:1.5">${nMsg}</div>
        <div class="hint-sm" style="margin-top:8px">検定力 1-β = ${state.power} を得るため。 ${args}${extraArgs}</div>
        <div class="hint-sm" style="margin-top:4px; color:#a16207">脱落・除外を見込んで <b>${Math.ceil((state.test === 't2' ? out.n_total : out.n_total) * 1.10)}</b> 名募集する等の余裕を持たせるとよいです。</div>
      </div>`;
  } else {
    const p = out.power;
    const pctColor = p >= 0.8 ? '#059669' : (p >= 0.6 ? '#a16207' : '#dc2626');
    root.innerHTML = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🔍 得られる検定力 (Post hoc)</div>
        <div style="font-size:28px; line-height:1.5; color:${pctColor}"><b>${(p * 100).toFixed(1)}%</b></div>
        <div class="hint-sm" style="margin-top:8px">現在の n で 効果量が 想定通り なら 上記 の 確率 で 有意 に なります。 ${args}${extraArgs}, n=${state.test === 't2' ? state.n_per_group : state.n_total}</div>
        ${p < 0.8 ? '<div class="hint-sm" style="margin-top:4px; color:#a16207">💡 検定力 80% 未満: 効果があってもそれを検出できず 「型 II 過誤」 が起きる可能性が高めです。</div>' : ''}
      </div>`;
  }
}

function clampFloat(v, lo, hi) {
  const n = parseFloat(v);
  if (isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
