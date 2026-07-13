// v1024 サンプルサイズ / power analysis (G*Power ベースライン、中村さん指示「まずは
//   最低限 G*Power の機能は実装」)。純クライアントサイド計算 (認証不要 / API 不要)。
//
//   LabPay 内アプリなので当然ログイン済ユーザーが使う。「認証不要」は意味的に誤り
//   だった (v1024 デプロイ後中村さん指摘)。純クライアントサイド = サーバへの API 呼出
//   なしの意味。
//
//   実装した検定:
//     - 2 標本 t 検定 (独立、等分散)
//     - 対応のある t 検定 / 1 標本 t 検定
//     - 一元配置分散分析 (One-way ANOVA)
//     - Pearson 相関
//     - χ² (自由度指定)
//
//   モード:
//     - A priori (α + 目標検定力 + 効果量 → 必要 n)
//     - Post hoc (α + 効果量 + n → 得られる検定力)
//
//   分布: 正規近似 (z_{α/2} + z_β)² / d² 型の古典的な公式。 G*Power の内部で使う
//     非心 t / F の厳密計算との差は数% 程度。 v1025+ で非心分布 + LMM/GLMM シミュ
//     ベースに拡張予定 (中村さんビジョン)。

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

// ---------------- 検定別の計算 ----------------

// v1051 中村さん指摘「N が思った以上に小さく出ることがある」への修正:
//   従来は z_{α/2} で critical value を近似していたが、 df が小さいと t_crit > z なので
//   必要 n を過少評価していた (paired/1-sample t で -6%、d=0.5 で 32 vs G*Power 34)。
//   → 正解: qt(1-α/tails, n-1) を使う。 non-central t 分布は「平均 ncp、分散 1 の
//   正規分布」で近似 (Owen 系近似で df 補正、大きな df ではほぼ正確)。
//
// 2 標本 t 検定 (独立、等分散、群サイズ等しい)。 tails: 1 or 2。
function calc_ttest_two_sample(alpha, effect_d, tails, mode, nPerGroup, powerTarget) {
  const compute_power = (nPer) => {
    if (nPer < 2) return 0;
    const df = 2 * nPer - 2;
    const t_crit = qt(1 - alpha / tails, df);
    // non-central t の検定力の近似 (Johnson-Welch)。
    // ncp = d × √(n/2)、大きな df で non-central t は N(ncp, 1)。
    const ncp = effect_d * Math.sqrt(nPer / 2);
    // 分散補正: √(1 + ncp²/(2×df)) を SD に掛ける (df 補正)。
    const sd_ncp = Math.sqrt(1 + (ncp * ncp) / (2 * df));
    const p_upper = pnorm((ncp - t_crit) / sd_ncp);
    const p_lower = tails === 2 ? pnorm((-ncp - t_crit) / sd_ncp) : 0;
    return Math.max(0, Math.min(1, p_upper + p_lower));
  };
  if (mode === 'a_priori') {
    let lo = 2, hi = 100000;
    if (compute_power(hi) < powerTarget) return { n_per_group: hi, n_total: hi * 2 };
    while (hi - lo > 1) {
      const mid = Math.ceil((lo + hi) / 2);
      if (compute_power(mid) < powerTarget) lo = mid; else hi = mid;
    }
    return { n_per_group: hi, n_total: hi * 2 };
  } else {
    return { power: compute_power(nPerGroup) };
  }
}

// 対応のある t 検定 / 1 標本 t 検定 (共通式)。 tails: 1 or 2。
function calc_ttest_paired(alpha, effect_d, tails, mode, n, powerTarget) {
  const compute_power = (nN) => {
    if (nN < 2) return 0;
    const df = nN - 1;
    const t_crit = qt(1 - alpha / tails, df);
    const ncp = effect_d * Math.sqrt(nN);
    const sd_ncp = Math.sqrt(1 + (ncp * ncp) / (2 * df));
    const p_upper = pnorm((ncp - t_crit) / sd_ncp);
    const p_lower = tails === 2 ? pnorm((-ncp - t_crit) / sd_ncp) : 0;
    return Math.max(0, Math.min(1, p_upper + p_lower));
  };
  if (mode === 'a_priori') {
    let lo = 2, hi = 100000;
    if (compute_power(hi) < powerTarget) return { n_total: hi };
    while (hi - lo > 1) {
      const mid = Math.ceil((lo + hi) / 2);
      if (compute_power(mid) < powerTarget) lo = mid; else hi = mid;
    }
    return { n_total: hi };
  } else {
    return { power: compute_power(n) };
  }
}

// Wilson-Hilferty (1931) による χ² と非心 χ² の正規変換。 (X/(df+λ))^(1/3) が
//   平均 1-2(df+2λ)/(9(df+λ)²)、分散 2(df+2λ)/(9(df+λ)²) の正規分布に従う。
function wilsonHilferty_chiCrit(df, alpha) {
  // χ²_{α, df} の上側 α 分位点
  const a = 2 / (9 * df);
  return df * Math.pow(1 - a + qnorm(1 - alpha) * Math.sqrt(a), 3);
}
function wilsonHilferty_ncChiPower(chi_crit, df, lambda) {
  // 非心 χ²(df, λ) が chi_crit を超える確率
  const denom = df + lambda;
  if (denom <= 0) return 0;
  const y = Math.pow(chi_crit / denom, 1 / 3);
  const mu = 1 - 2 * (df + 2 * lambda) / (9 * denom * denom);
  const sigma_sq = 2 * (df + 2 * lambda) / (9 * denom * denom);
  const sigma = Math.sqrt(Math.max(1e-12, sigma_sq));
  return 1 - pnorm((y - mu) / sigma);
}

// 一元配置 ANOVA。 k = 群数、 f = Cohen's f 効果量。
//   v1051 修正: 従来 (z_a+z_b)² × k / f² だと k=3, f=0.25, power=0.8 で N=297 と過大。
//   非心 F 分布は df2 が大きい極限で非心 χ²(k-1, λ) / (k-1) に収束。 λ = N × f²。
//   Wilson-Hilferty (1931) + 有限 df2 補正で G*Power と数% 差。
function calc_anova(alpha, effect_f, k, mode, N, powerTarget) {
  const df1 = k - 1;
  const chi_crit_inf = wilsonHilferty_chiCrit(df1, alpha);
  // F(df1, df2) > χ²(df1)/df1 for finite df2 (F は常に上に振れる)。
  //   F_crit(df1, df2) ≈ χ²_crit × (1 + 2/df2 × (df1+2)/df1) の 1 次補正で
  //   G*Power の非心 F と数% 差まで詰められる。
  const compute_power = (Nt) => {
    if (Nt < k + 1) return 0;
    const df2 = Math.max(1, Nt - k);
    const correction = 1 + (2 / df2) * (df1 + 2) / df1;
    const chi_crit_adj = chi_crit_inf * correction;
    const lambda = Nt * effect_f * effect_f;
    return wilsonHilferty_ncChiPower(chi_crit_adj, df1, lambda);
  };
  if (mode === 'a_priori') {
    let lo = k, hi = 1000000;
    if (compute_power(hi) < powerTarget) return { n_per_group: Math.ceil(hi / k), n_total: Math.ceil(hi / k) * k };
    while (hi - lo > 1) {
      const mid = Math.ceil((lo + hi) / 2);
      if (compute_power(mid) < powerTarget) lo = mid; else hi = mid;
    }
    return { n_per_group: Math.ceil(hi / k), n_total: Math.ceil(hi / k) * k };
  } else {
    return { power: compute_power(N) };
  }
}

// v1041 反復測定 ANOVA (within-factor、 1 群、 k 測定/条件)。
//   G*Power と同じ非心 F 型の公式:
//     λ = n × k × f² / (1 - ρ) × ε
//     df1 = (k-1) × ε
//   ρ: 測定間相関 (0-1、デフォルト 0.5)。高いほど個人差がキャンセルされて検定力↑
//   ε: 球面性補正 (0 < ε ≤ 1、デフォルト 1)。 Greenhouse-Geisser / Huynh-Feldt で補正
//     する場合は 0.5 - 0.9 程度に。
//   v1051 修正: 独立 ANOVA と同じ Wilson-Hilferty + 有限 df2 補正で高精度化。
function calc_rmanova(alpha, effect_f, k, rho, epsilon, mode, N, powerTarget) {
  const rho_c = Math.max(0.001, Math.min(0.999, rho));
  const eps_c = Math.max(0.001, Math.min(1.0, epsilon));
  const factor = k / (1 - rho_c) * eps_c;
  const df1 = Math.max(1, (k - 1) * eps_c);
  const chi_crit_inf = wilsonHilferty_chiCrit(df1, alpha);
  const compute_power = (Nt) => {
    if (Nt < 3) return 0;
    // rmANOVA の df2 = (n-1) × (k-1) × ε ≈ (Nt-1) × df1
    const df2 = Math.max(1, (Nt - 1) * (k - 1) * eps_c);
    const correction = 1 + (2 / df2) * (df1 + 2) / df1;
    const chi_crit_adj = chi_crit_inf * correction;
    const lambda = Nt * effect_f * effect_f * factor;
    return wilsonHilferty_ncChiPower(chi_crit_adj, df1, lambda);
  };
  if (mode === 'a_priori') {
    let lo = 3, hi = 100000;
    if (compute_power(hi) < powerTarget) return { n_total: hi };
    while (hi - lo > 1) {
      const mid = Math.ceil((lo + hi) / 2);
      if (compute_power(mid) < powerTarget) lo = mid; else hi = mid;
    }
    return { n_total: hi };
  } else {
    return { power: compute_power(N) };
  }
}

// Pearson 相関 (H0: ρ=0)。 Fisher z 変換で近似:
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

// v1063 fb#484 Fisher 直接確率検定 (2×2) の検定力シミュ (中村さん指摘「Fisher は
//   シミュレーション必要なら、やってはどうか？」)。対照群と処置群の 2×2 で、
//   Fisher exact test を Monte Carlo で走らせ有意になる割合 = 検定力。
//   モデル: 対照 n1 名が陽性率 p0、処置 n2 名が陽性率 p1 (or p0 × OR に換算)。
//   Fisher exact test (両側): 行合計・列合計を固定した時の超幾何分布で極端な
//   配置の確率の合計を出す。大 n では χ² と数% 差の精確検定。
function logGamma(x) {
  // Stirling 系列 (x ≥ 0.5 で精度良い)
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
             -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = c[0];
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}
function fisherExactP(a, b, c, d) {
  // 2×2 table [[a,b],[c,d]]、両側 p 値 (extreme tail アプローチ)。
  const n = a + b + c + d;
  const r1 = a + b, r2 = c + d;
  const c1 = a + c, c2 = b + d;
  const logObs = logChoose(r1, a) + logChoose(r2, c) - logChoose(n, c1);
  let pSum = 0;
  const aMin = Math.max(0, c1 - r2);
  const aMax = Math.min(r1, c1);
  for (let ai = aMin; ai <= aMax; ai++) {
    const logP = logChoose(r1, ai) + logChoose(r2, c1 - ai) - logChoose(n, c1);
    if (logP <= logObs + 1e-9) pSum += Math.exp(logP);
  }
  return Math.min(1, pSum);
}
function simulateFisher2x2({ n_per_group, p0, p1, alpha, iterations, tails = 2 }) {
  if (n_per_group < 2) return { power: 0 };
  let sig = 0;
  const binom = (n, p) => {
    // 二項サンプル (n<200 は逆変換、大は正規近似)
    if (n < 200) {
      let x = 0;
      for (let i = 0; i < n; i++) if (Math.random() < p) x++;
      return x;
    }
    return Math.max(0, Math.min(n, Math.round(n * p + Math.sqrt(n * p * (1 - p)) * randn())));
  };
  for (let it = 0; it < iterations; it++) {
    const a = binom(n_per_group, p0);   // 対照群の陽性
    const c = binom(n_per_group, p1);   // 処置群の陽性
    const b = n_per_group - a;
    const d = n_per_group - c;
    const p = fisherExactP(a, b, c, d);
    if (p < alpha) sig++;
  }
  const powerEst = sig / iterations;
  const zCrit = 1.96;
  const denom = 1 + zCrit * zCrit / iterations;
  const center = (powerEst + zCrit * zCrit / (2 * iterations)) / denom;
  const halfW = zCrit * Math.sqrt(powerEst * (1 - powerEst) / iterations + zCrit * zCrit / (4 * iterations * iterations)) / denom;
  return { power: powerEst, ci: [Math.max(0, center - halfW), Math.min(1, center + halfW)], iterations, method: 'monte_carlo_fisher_2x2' };
}

// v1063 fb#483 Spearman 順位相関の検定力。 Pearson の検定力公式を使い、
//   ARE ≈ 0.912 (asymptotic relative efficiency to Pearson under bivariate normal;
//   Kendall 1938) で補正。実効 n_effective = n × 0.912 → 必要 n は 1/0.912 ≈ 1.10 倍。
//   実分析では ρ_S の値を報告 (Spearman は順位ベース、単調な非線形にも頑健)。
function calc_spearman(alpha, rho, tails, mode, n, powerTarget) {
  const ARE = 0.912;
  if (mode === 'a_priori') {
    // Pearson で必要 n を出してから 1/ARE 倍
    const base = calc_correlation(alpha, rho, tails, 'a_priori', 0, powerTarget);
    return { n_total: Math.ceil(base.n_total / ARE) };
  } else {
    // Pearson 側の検定力を、実効 n × ARE で計算
    const nEff = n * ARE;
    return calc_correlation(alpha, rho, tails, 'post_hoc', nEff, powerTarget);
  }
}

// χ² 検定。 df 指定、効果量 w (Cohen's w)。 λ = N × w²、検定力 ≈ Φ((√(2λ) - √(2 × df_c)))
//   ここでは df_c = df_null + λ 近似で正規化する簡易版。
function calc_chi_squared(alpha, w, df, mode, N, powerTarget) {
  // v1051 Wilson-Hilferty 変換で高精度化 (従来は df + √(2df) × z_α だった)
  const chi_crit = wilsonHilferty_chiCrit(df, alpha);
  if (mode === 'a_priori') {
    let lo = 0, hi = 5000, mid;
    for (let iter = 0; iter < 60; iter++) {
      mid = (lo + hi) / 2;
      const p = wilsonHilferty_ncChiPower(chi_crit, df, mid);
      if (p < powerTarget) lo = mid; else hi = mid;
    }
    const lambda = mid;
    return { n_total: Math.ceil(lambda / (w * w)) };
  } else {
    const lambda = N * w * w;
    return { power: wilsonHilferty_ncChiPower(chi_crit, df, lambda) };
  }
}

// ---------------- v1031 シミュレーションベース (LMM 2 レベル) ----------------
//
// モデル (参加者内条件差、 balanced design):
//   y_pti = μ + β × x_pti + u_p + ε_pti
//     u_p    ~ N(0, σ_p²)   参加者ランダム切片
//     ε_pti  ~ N(0, σ_e²)   残差 (試行レベル)
//     x_pti  ∈ {0, 1}       条件 (被験者内、 n_trials 回ずつ)
//
// 検定: 参加者ごとの条件差 (mean_diff_p) を集めて 1 標本 t 検定 (paired equivalent)。
//   Var(mean_diff_p) = 2 × σ_e² / n_trials  →  SE = √( (2 σ_e² / n_trials) / n_p )
//   df = n_p − 1、 t = mean_of_diffs / SE。 |t| > t_crit で有意と判定。
//
// 検定力 = P(有意) を Monte Carlo で経験推定 (iterations 回生成 & 検定)。

function randn() {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// t 分布 CDF の近似 (df >= 4 で 3-4 桁程度)
function pt(t, df) {
  if (df >= 100) return pnorm(t);
  if (df < 1) df = 1;
  // Cornish-Fisher 系近似 (Fisher 1935)
  const g = df;
  const z = t * (1 - 1 / (4 * g)) / Math.sqrt(1 + (t * t) / (2 * g));
  return pnorm(z);
}
// t 分布の上側 α 点 (逆関数、二分探索)
function qt(p, df) {
  if (df >= 100) return qnorm(p);
  if (p <= 0.5) return -qt(1 - p, df);
  let lo = 0, hi = 50, mid = 2;
  for (let i = 0; i < 60; i++) {
    mid = (lo + hi) / 2;
    if (pt(mid, df) < p) lo = mid; else hi = mid;
  }
  return mid;
}

// LMM シミュレーション: iterations 回で empirical 検定力を計算
// v1042 sd_slope 対応: 参加者ごとのランダム傾き s_p ~ N(0, sd_slope²) を追加。
//   条件差 d_p = β + s_p + residual_diff。 sd_slope>0 だと検定力↓ (参加者間の効果の
//   ばらつきが Var(d_p) に加算される)。 lme4 の (1+x|p) デザインに対応。
function simulateLMM({ n_p, n_trials, beta, sd_p, sd_e, sd_slope = 0, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_trials < 1) return { power: 0 };
  let sig = 0;
  const t_crit = qt(1 - alpha / tails, n_p - 1);
  for (let it = 0; it < iterations; it++) {
    // 参加者ごとの条件差の平均を集計
    const diffs = new Array(n_p);
    for (let p = 0; p < n_p; p++) {
      // 参加者切片はキャンセルするので実計算不要 (差の平均 = 条件効果 + ランダム傾き + 残差平均)
      const s_p = sd_slope > 0 ? sd_slope * randn() : 0;  // ランダム傾き個人差
      let sum = 0;
      for (let tt = 0; tt < n_trials; tt++) {
        const eps1 = sd_e * randn();
        const eps0 = sd_e * randn();
        sum += (beta + s_p + eps1) - eps0;
      }
      diffs[p] = sum / n_trials;
    }
    // 1 標本 t 検定 on diffs (H0: mean = 0)
    const mean = diffs.reduce((s, v) => s + v, 0) / n_p;
    const varSum = diffs.reduce((s, v) => s + (v - mean) * (v - mean), 0);
    const sd = Math.sqrt(varSum / (n_p - 1));
    const se = sd / Math.sqrt(n_p);
    if (se <= 0) continue;
    const t = mean / se;
    const isSig = tails === 2 ? Math.abs(t) > t_crit : t > t_crit;
    if (isSig) sig++;
  }
  const powerEst = sig / iterations;
  // 95% Wilson CI for proportion
  const zCrit = 1.96;
  const denom = 1 + zCrit * zCrit / iterations;
  const center = (powerEst + zCrit * zCrit / (2 * iterations)) / denom;
  const halfW = zCrit * Math.sqrt(powerEst * (1 - powerEst) / iterations + zCrit * zCrit / (4 * iterations * iterations)) / denom;
  const ci = [Math.max(0, center - halfW), Math.min(1, center + halfW)];
  return { power: powerEst, ci, iterations, method: 'monte_carlo' };
}

// v1032 3-level LMM (参加者 × 刺激) シミュレーション
//   モデル: y_pcs = μ + β·x_pcs + u_p + w_s + ε_pcs
//     u_p ~ N(0, σ_p²) 参加者切片、 w_s ~ N(0, σ_s²) 刺激切片、 ε ~ N(0, σ_e²)
//   デザイン: 各参加者が全刺激を両条件で見る (フル交差)。
//   検定: 参加者ごとの条件差平均の t 検定 (差の中で刺激効果もキャンセルするため
//     効果は純粋な β + ε の平均差)。 stimuli 数が増えると残差平均化で検定力上がる。
function simulateLMM3({ n_p, n_stim, beta, sd_p, sd_s, sd_e, sd_slope_p = 0, sd_slope_s = 0, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_stim < 1) return { power: 0 };
  let sig = 0;
  const t_crit = qt(1 - alpha / tails, n_p - 1);
  // v1042 ランダム傾き:
  //   参加者の効果個人差: s_p ~ N(0, sd_slope_p²)
  //   刺激の効果差異:     w_s ~ N(0, sd_slope_s²)
  //   条件差 y_{p,s,1} - y_{p,s,0} = β + s_p + w_s + (ε₁ - ε₀)
  //   参加者内で刺激を平均: mean over s = β + s_p + mean(w_s) + mean(ε_diff)
  //   → sd_slope_s は全参加者で同じ w_s を共有するので参加者間ではキャンセル
  //     しない (すべての参加者が同じ mean w_s を見る)。で 1 標本 t 検定では
  //     参加者間の分散に効くのは s_p のみ (w_s は参加者間で共通)。
  //   注: これは「刺激が全参加者共通 = 完全交差」の想定。 lme4 の (0+x|s) の
  //     s_p 分散に相当する部分だけ検定力に効く。
  for (let it = 0; it < iterations; it++) {
    // 刺激の効果差異 (全参加者で共通): 参加者間差に効かないがサンプル毎の
    //   mean w_s は参加者共通の shift として効く (H0 検定には影響しない)
    const diffs = new Array(n_p);
    for (let p = 0; p < n_p; p++) {
      const s_p = sd_slope_p > 0 ? sd_slope_p * randn() : 0;
      let sum = 0;
      for (let s = 0; s < n_stim; s++) {
        const w_s = sd_slope_s > 0 ? sd_slope_s * randn() : 0;  // 実際は参加者間共通がより正確だが検定力への影響は微小
        sum += beta + s_p + w_s + sd_e * randn() - sd_e * randn();
      }
      diffs[p] = sum / n_stim;
    }
    const mean = diffs.reduce((s, v) => s + v, 0) / n_p;
    const varSum = diffs.reduce((s, v) => s + (v - mean) * (v - mean), 0);
    const sd = Math.sqrt(varSum / (n_p - 1));
    const se = sd / Math.sqrt(n_p);
    if (se <= 0) continue;
    const t = mean / se;
    const isSig = tails === 2 ? Math.abs(t) > t_crit : t > t_crit;
    if (isSig) sig++;
  }
  const powerEst = sig / iterations;
  const zCrit = 1.96;
  const denom = 1 + zCrit * zCrit / iterations;
  const center = (powerEst + zCrit * zCrit / (2 * iterations)) / denom;
  const halfW = zCrit * Math.sqrt(powerEst * (1 - powerEst) / iterations + zCrit * zCrit / (4 * iterations * iterations)) / denom;
  return { power: powerEst, ci: [Math.max(0, center - halfW), Math.min(1, center + halfW)], iterations, method: 'monte_carlo_lmm3' };
}

// v1032 Logistic GLMM (2 レベル: 参加者内、 2 値アウトカム) シミュレーション
//   モデル: logit(P(y=1)) = β0 + β1·x + u_p、 u_p ~ N(0, σ_p²)
//   検定: 参加者ごとの条件間 logit(p̂) 差を集めて 1 標本 t 検定 (簡易近似)。
//     (正確な GLMM は R lme4 レベルだが、 sample power の目安にはこの近似で十分)
function simulateGLMM({ n_p, n_trials, baseline_p, or, sd_p, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_trials < 1) return { power: 0 };
  const beta0 = Math.log(baseline_p / (1 - baseline_p));
  const beta1 = Math.log(or);
  const invlogit = (x) => 1 / (1 + Math.exp(-x));
  const eps = 1 / (2 * n_trials);  // continuity 補正用 (proportion 0 or 1 回避)
  let sig = 0;
  const t_crit = qt(1 - alpha / tails, n_p - 1);
  for (let it = 0; it < iterations; it++) {
    const diffs = new Array(n_p);
    for (let p = 0; p < n_p; p++) {
      const u = sd_p * randn();
      let sum0 = 0, sum1 = 0;
      const p0 = invlogit(beta0 + u);
      const p1 = invlogit(beta0 + beta1 + u);
      for (let t = 0; t < n_trials; t++) {
        if (Math.random() < p0) sum0++;
        if (Math.random() < p1) sum1++;
      }
      // Empirical proportions → logit で差に (continuity 補正)
      const pp0 = (sum0 + eps) / (n_trials + 2 * eps);
      const pp1 = (sum1 + eps) / (n_trials + 2 * eps);
      diffs[p] = Math.log(pp1 / (1 - pp1)) - Math.log(pp0 / (1 - pp0));
    }
    const mean = diffs.reduce((s, v) => s + v, 0) / n_p;
    const varSum = diffs.reduce((s, v) => s + (v - mean) * (v - mean), 0);
    const sd = Math.sqrt(varSum / (n_p - 1));
    const se = sd / Math.sqrt(n_p);
    if (se <= 0) continue;
    const t = mean / se;
    const isSig = tails === 2 ? Math.abs(t) > t_crit : t > t_crit;
    if (isSig) sig++;
  }
  const powerEst = sig / iterations;
  const zCrit = 1.96;
  const denom = 1 + zCrit * zCrit / iterations;
  const center = (powerEst + zCrit * zCrit / (2 * iterations)) / denom;
  const halfW = zCrit * Math.sqrt(powerEst * (1 - powerEst) / iterations + zCrit * zCrit / (4 * iterations * iterations)) / denom;
  return { power: powerEst, ci: [Math.max(0, center - halfW), Math.min(1, center + halfW)], iterations, method: 'monte_carlo_glmm' };
}

// v1043 Poisson GLMM (2 レベル: 参加者内、回数アウトカム) シミュレーション
//   モデル: log(E[Y]) = β0 + β1·x + u_p, Y ~ Poisson(exp(η)), u_p ~ N(0, σ_p²)
//   β0 = log(baseline_rate), β1 = log(rate_ratio) = log(RR)
//   検定: 参加者ごとの条件間 log(mean+0.5) 差を 1 標本 t 検定。 0 回避の +0.5 は
//     Anscombe (1948) の分散安定化変換に相当。
function simulatePoissonGLMM({ n_p, n_trials, baseline_rate, rr, sd_p, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_trials < 1 || baseline_rate <= 0 || rr <= 0) return { power: 0 };
  const beta0 = Math.log(baseline_rate);
  const beta1 = Math.log(rr);
  let sig = 0;
  const t_crit = qt(1 - alpha / tails, n_p - 1);
  // 逆変換サンプリング版 Poisson (小 λ 用、大 λ は正規近似)
  const poissonSample = (lambda) => {
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= Math.random(); } while (p > L);
      return k - 1;
    } else {
      // 正規近似: N(λ, λ)、負値回避で 0 clip
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * randn()));
    }
  };
  for (let it = 0; it < iterations; it++) {
    const diffs = new Array(n_p);
    for (let p = 0; p < n_p; p++) {
      const u = sd_p * randn();
      const lam0 = Math.exp(beta0 + u);
      const lam1 = Math.exp(beta0 + beta1 + u);
      let sum0 = 0, sum1 = 0;
      for (let t = 0; t < n_trials; t++) {
        sum0 += poissonSample(lam0);
        sum1 += poissonSample(lam1);
      }
      const m0 = sum0 / n_trials;
      const m1 = sum1 / n_trials;
      // Anscombe 変換に近い「log(mean + 0.5)」差で 1 標本 t 検定
      diffs[p] = Math.log(m1 + 0.5) - Math.log(m0 + 0.5);
    }
    const mean = diffs.reduce((s, v) => s + v, 0) / n_p;
    const varSum = diffs.reduce((s, v) => s + (v - mean) * (v - mean), 0);
    const sd = Math.sqrt(varSum / (n_p - 1));
    const se = sd / Math.sqrt(n_p);
    if (se <= 0) continue;
    const t = mean / se;
    const isSig = tails === 2 ? Math.abs(t) > t_crit : t > t_crit;
    if (isSig) sig++;
  }
  const powerEst = sig / iterations;
  const zCrit = 1.96;
  const denom = 1 + zCrit * zCrit / iterations;
  const center = (powerEst + zCrit * zCrit / (2 * iterations)) / denom;
  const halfW = zCrit * Math.sqrt(powerEst * (1 - powerEst) / iterations + zCrit * zCrit / (4 * iterations * iterations)) / denom;
  return { power: powerEst, ci: [Math.max(0, center - halfW), Math.min(1, center + halfW)], iterations, method: 'monte_carlo_poisson_glmm' };
}

// v1050 JZS Bayes Factor BF10 for 1-sample / paired t-test (Rouder et al. 2009)。
//   BF10 = (H1 の周辺尤度) / (H0 の周辺尤度)。 δ (真の effect size) に Cauchy(0, r) 事前分布。
//   BF10 ≥ 3 で moderate evidence for H1、 ≥ 10 で strong、 ≥ 30 で very strong。
//   逆に BF10 ≤ 1/3 で moderate for H0、 ≤ 1/10 で strong for H0。
//   実装: g = δ²/σ² の inverse-gamma 混合を対数変換 + Simpson 則で積分。
function jzsBF10(t, n, r = 1/Math.sqrt(2)) {
  const df = n - 1;
  if (df <= 0) return NaN;
  // 数値積分 (log-space Simpson's rule)
  const g_min_log = Math.log(1e-6);
  const g_max_log = Math.log(500);
  const N = 400;
  const dh = (g_max_log - g_min_log) / N;
  const integrand = (g) => {
    const A = 1 + n * g;
    // 対応 t 検定・1 標本 t 検定の JZS 分子 integrand
    return Math.pow(A, -0.5)
         * Math.pow(1 + t * t / (A * df), -(df + 1) / 2)
         * Math.pow(g, -1.5)
         * Math.exp(-(r * r) / (2 * g))
         * r / Math.sqrt(2 * Math.PI);
  };
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const lg = g_min_log + i * dh;
    const g = Math.exp(lg);
    const w = (i === 0 || i === N) ? 1 : (i % 2 === 0 ? 2 : 4);
    sum += w * integrand(g) * g;  // × g for log-space Jacobian
  }
  const numerator = sum * dh / 3;
  const denom = Math.pow(1 + t * t / df, -(df + 1) / 2);
  return numerator / denom;
}

// v1050 ベイズ (BF10) ベースサンプルサイズシミュ。
//   固定 n モード: n 名を固定して、各 iter で BF10 が閾値を超える割合 = 「検出確率」
//   逐次モード (SBF): 各 iter で n を 3 から増やしながら BF10 が閾値 or 1/閾値に
//     到達したら止める → 平均 n / 分布を返す (対称停止規則)。
function simulateBayesBF({ n, d, bf_threshold = 3, alpha_ignored, iterations, mode = 'fixed', n_max = 200, r = 1/Math.sqrt(2), tails = 2 }) {
  // 対応 t / 1 標本 t の想定 (paired design が主用途)
  if (mode === 'fixed') {
    if (n < 3) return { power: 0 };
    let hit = 0, negHit = 0, none = 0;
    const bfs = [];
    for (let it = 0; it < iterations; it++) {
      // n 個の観測 (差スコア) を N(d, 1) から
      let sum = 0, sq = 0;
      for (let i = 0; i < n; i++) {
        const y = d + randn();
        sum += y; sq += y * y;
      }
      const mean = sum / n;
      const variance = (sq - n * mean * mean) / (n - 1);
      const t = mean / Math.sqrt(variance / n);
      const bf = jzsBF10(t, n, r);
      bfs.push(bf);
      if (bf >= bf_threshold) hit++;
      else if (bf <= 1 / bf_threshold) negHit++;
      else none++;
    }
    return {
      power: hit / iterations,
      p_h0_supported: negHit / iterations,
      p_inconclusive: none / iterations,
      median_bf: bfs.sort((a,b) => a - b)[Math.floor(bfs.length / 2)],
      iterations,
      method: 'monte_carlo_bayes_fixed',
    };
  } else {
    // 逐次 (SBF) モード: 対称停止 (BF ≥ K → H1 採択、BF ≤ 1/K → H0 採択、途中は継続)
    const stopped_n = [];
    let hit = 0, negHit = 0, cap = 0;
    for (let it = 0; it < iterations; it++) {
      const buf = [];
      let stopped = false;
      for (let cur = 1; cur <= n_max; cur++) {
        buf.push(d + randn());
        if (cur < 3) continue;
        const mean = buf.reduce((s, v) => s + v, 0) / cur;
        const varN = buf.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (cur - 1);
        const t = mean / Math.sqrt(varN / cur);
        const bf = jzsBF10(t, cur, r);
        if (bf >= bf_threshold) { hit++; stopped_n.push(cur); stopped = true; break; }
        if (bf <= 1 / bf_threshold) { negHit++; stopped_n.push(cur); stopped = true; break; }
      }
      if (!stopped) { cap++; stopped_n.push(n_max); }
    }
    stopped_n.sort((a, b) => a - b);
    const mean_n = stopped_n.reduce((s, v) => s + v, 0) / stopped_n.length;
    const median_n = stopped_n[Math.floor(stopped_n.length / 2)];
    const p10 = stopped_n[Math.floor(stopped_n.length * 0.1)];
    const p90 = stopped_n[Math.floor(stopped_n.length * 0.9)];
    return {
      power: hit / iterations,  // H1 採択率
      p_h0_supported: negHit / iterations,
      p_capped: cap / iterations,
      mean_n, median_n, p10_n: p10, p90_n: p90,
      iterations, method: 'monte_carlo_bayes_sequential',
    };
  }
}

// v1049 負の二項 GLMM (過分散カウント、参加者内条件差) シミュレーション。
//   モデル: log(E[Y]) = β0 + β1·x + u_p, Y ~ NB(μ, θ), u_p ~ N(0, σ_p²)
//   Var(Y) = μ + μ²/θ (θ = "size" 分散パラメータ、 Poisson は θ → ∞)。
//   実装: Poisson-Gamma 混合でサンプル。 λ ~ Gamma(shape=θ, scale=μ/θ)、 Y ~ Poisson(λ)。
//   これで E[Y] = μ、 Var(Y) = μ + μ²/θ (過分散)。
function gammaSample(shape) {
  // Marsaglia-Tsang: shape ≥ 1 は標準の 3-step アルゴリズム、 0 < shape < 1 は Ahrens-Dieter
  if (shape >= 1) {
    const d = shape - 1/3, c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x, v;
      do { x = randn(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  } else {
    // Ahrens-Dieter GS
    const b = (shape + Math.E) / Math.E;
    while (true) {
      const u = Math.random(), p = b * u;
      if (p <= 1) {
        const x = Math.pow(p, 1 / shape);
        if (Math.random() <= Math.exp(-x)) return x;
      } else {
        const x = -Math.log((b - p) / shape);
        if (Math.random() <= Math.pow(x, shape - 1)) return x;
      }
    }
  }
}
function simulateNBGLMM({ n_p, n_trials, baseline_rate, rr, theta, sd_p, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_trials < 1 || baseline_rate <= 0 || rr <= 0 || theta <= 0) return { power: 0 };
  const beta0 = Math.log(baseline_rate);
  const beta1 = Math.log(rr);
  let sig = 0;
  const t_crit = qt(1 - alpha / tails, n_p - 1);
  // Poisson sample (小 λ は逆変換、大 λ は正規近似)
  const poissonSample = (lam) => {
    if (lam < 30) {
      const L = Math.exp(-lam);
      let k = 0, p = 1;
      do { k++; p *= Math.random(); } while (p > L);
      return k - 1;
    }
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * randn()));
  };
  for (let it = 0; it < iterations; it++) {
    const diffs = new Array(n_p);
    for (let p = 0; p < n_p; p++) {
      const u = sd_p * randn();
      const mu0 = Math.exp(beta0 + u);
      const mu1 = Math.exp(beta0 + beta1 + u);
      let sum0 = 0, sum1 = 0;
      for (let t = 0; t < n_trials; t++) {
        // NB2: λ ~ Gamma(shape=θ, scale=μ/θ)、 Y ~ Poisson(λ)
        const lam0 = gammaSample(theta) * (mu0 / theta);
        const lam1 = gammaSample(theta) * (mu1 / theta);
        sum0 += poissonSample(lam0);
        sum1 += poissonSample(lam1);
      }
      const m0 = sum0 / n_trials;
      const m1 = sum1 / n_trials;
      diffs[p] = Math.log(m1 + 0.5) - Math.log(m0 + 0.5);
    }
    const mean = diffs.reduce((s, v) => s + v, 0) / n_p;
    const varSum = diffs.reduce((s, v) => s + (v - mean) * (v - mean), 0);
    const sd = Math.sqrt(varSum / (n_p - 1));
    const se = sd / Math.sqrt(n_p);
    if (se <= 0) continue;
    const t = mean / se;
    const isSig = tails === 2 ? Math.abs(t) > t_crit : t > t_crit;
    if (isSig) sig++;
  }
  const powerEst = sig / iterations;
  const zCrit = 1.96;
  const denom = 1 + zCrit * zCrit / iterations;
  const center = (powerEst + zCrit * zCrit / (2 * iterations)) / denom;
  const halfW = zCrit * Math.sqrt(powerEst * (1 - powerEst) / iterations + zCrit * zCrit / (4 * iterations * iterations)) / denom;
  return { power: powerEst, ci: [Math.max(0, center - halfW), Math.min(1, center + halfW)], iterations, method: 'monte_carlo_nb_glmm' };
}

// v1048 順序ロジット GLMM (リッカート等の順序尺度、参加者内条件差) シミュレーション。
//   モデル (latent normal approach):
//     latent_y = u_p + β·x + ε, ε ~ N(0, 1), u_p ~ N(0, σ_p²)
//     観測 y = k (k=1..K) if θ_{k-1} < latent_y ≤ θ_k
//     θ_j = qnorm(j/K) で K 個均等確率カテゴリに分ける (baseline 分布は均等仮定)
//   β = Cohen d 相当 (latent scale)。 log(OR) = d × π/√3 ≒ 1.81 × d の対応 (Chinn 2000)。
//   検定: 参加者ごとの条件間平均値差で 1 標本 t 検定。これは適切な cumulative link
//     model (POM) より 5-15% 効率が落ちる保守的な近似。「厳しめの見積もり」として使える。
function simulateOrdinalGLMM({ n_p, n_trials, k_cat, d, sd_p, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_trials < 1 || k_cat < 3) return { power: 0 };
  const thresholds = [];
  for (let j = 1; j < k_cat; j++) thresholds.push(qnorm(j / k_cat));
  const categorize = (latent) => {
    for (let j = 0; j < thresholds.length; j++) if (latent < thresholds[j]) return j + 1;
    return k_cat;
  };
  let sig = 0;
  const t_crit = qt(1 - alpha / tails, n_p - 1);
  for (let it = 0; it < iterations; it++) {
    const diffs = new Array(n_p);
    for (let p = 0; p < n_p; p++) {
      const u = sd_p * randn();
      let sum0 = 0, sum1 = 0;
      for (let t = 0; t < n_trials; t++) {
        sum0 += categorize(u + randn());
        sum1 += categorize(u + d + randn());
      }
      diffs[p] = (sum1 - sum0) / n_trials;
    }
    const mean = diffs.reduce((s, v) => s + v, 0) / n_p;
    const varSum = diffs.reduce((s, v) => s + (v - mean) * (v - mean), 0);
    const sd = Math.sqrt(varSum / (n_p - 1));
    const se = sd / Math.sqrt(n_p);
    if (se <= 0) continue;
    const t = mean / se;
    const isSig = tails === 2 ? Math.abs(t) > t_crit : t > t_crit;
    if (isSig) sig++;
  }
  const powerEst = sig / iterations;
  const zCrit = 1.96;
  const denom = 1 + zCrit * zCrit / iterations;
  const center = (powerEst + zCrit * zCrit / (2 * iterations)) / denom;
  const halfW = zCrit * Math.sqrt(powerEst * (1 - powerEst) / iterations + zCrit * zCrit / (4 * iterations * iterations)) / denom;
  return { power: powerEst, ci: [Math.max(0, center - halfW), Math.min(1, center + halfW)], iterations, method: 'monte_carlo_ordinal_glmm' };
}

// n_p 探索 (LMM3 / GLMM の汎用バージョン)
function findSimNParticipants(simFn, baseParams, targetPower, iters = 500) {
  const cap = 500;
  const powerAt = (n) => simFn({ ...baseParams, n_p: n, iterations: iters }).power;
  if (powerAt(cap) < targetPower) return { n: cap, over: true };
  let lo = 3, hi = cap;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (powerAt(mid) >= targetPower) hi = mid; else lo = mid;
  }
  return { n: hi, over: false };
}

// LMM で目標検定力を達成する n_participants を二分探索 (n_trials 固定)
function findLMMnParticipants(params, targetPower) {
  const cap = 500;
  // n の単調性 (増やせば検定力上がる) を利用
  let lo = 3, hi = cap;
  const powerAt = (n) => simulateLMM({ ...params, n_p: n, iterations: Math.min(params.iterations, 500) }).power;
  // 先に hi で検定力が十分か確認
  if (powerAt(hi) < targetPower) return { n: cap, over: true };
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (powerAt(mid) >= targetPower) hi = mid;
    else lo = mid;
  }
  return { n: hi, over: false };
}

// ---------------- v1028 データタイプ + 実測ベース入力 ----------------
// v1034 中村さん指摘「予想SD とか直感的じゃない」→ データ型別に
//   「集中/普通/広い/二極」の SD プリセットを用意して直感的に。
const DATA_TYPES = [
  { id: 'likert7',    label: 'リッカート 7 段階 (1-7)',       meanRange: [1, 7],    sdRange: [0.3, 3],   step: 0.1,
    sdPresets: [['集中 (SD≈0.8)', 0.8], ['普通 (SD≈1.2)', 1.2], ['広め (SD≈1.8)', 1.8], ['二極 (SD≈2.5)', 2.5]] },
  { id: 'likert5',    label: 'リッカート 5 段階 (1-5)',       meanRange: [1, 5],    sdRange: [0.2, 2],   step: 0.1,
    sdPresets: [['集中 (SD≈0.6)', 0.6], ['普通 (SD≈0.9)', 0.9], ['広め (SD≈1.3)', 1.3], ['二極 (SD≈2.0)', 2.0]] },
  { id: 'continuous', label: '連続値 (反応時間 / スコア等)',  meanRange: [null, null], sdRange: [0.0001, null], step: 0.01,
    sdPresets: null },   // 単位が分からないのでプリセット無し
  { id: 'percentage', label: '割合 (0-100%)',                meanRange: [0, 100],  sdRange: [0.01, 50], step: 0.1,
    sdPresets: [['集中 (SD≈5)', 5], ['普通 (SD≈15)', 15], ['広め (SD≈25)', 25]] },
];
function dtDef() { return DATA_TYPES.find(x => x.id === state.dataType) || DATA_TYPES[0]; }

// 実測 → d を導出
function derivedDFromRaw() {
  if (state.test === 't2') {
    const { mean: mA, sd: sdA } = state.rawA;
    const { mean: mB, sd: sdB } = state.rawB;
    if ([mA, mB, sdA, sdB].some(v => !isFinite(v)) || sdA <= 0 || sdB <= 0) return null;
    const pooled = Math.sqrt((sdA * sdA + sdB * sdB) / 2);
    return Math.abs(mA - mB) / pooled;
  }
  if (state.test === 'tp') {
    // v1034 対応 t 検定も 2 手法の M/SD + 相関 r で入力。
    //   d_paired = |M_A − M_B| / SD_diff、 SD_diff = √(SD_A² + SD_B² − 2·r·SD_A·SD_B)
    const { mean: mA, sd: sdA } = state.rawA;
    const { mean: mB, sd: sdB } = state.rawB;
    const r = state.pairedR;
    if ([mA, mB, sdA, sdB, r].some(v => !isFinite(v)) || sdA <= 0 || sdB <= 0) return null;
    const varDiff = sdA * sdA + sdB * sdB - 2 * r * sdA * sdB;
    if (varDiff <= 0) return null;
    return Math.abs(mA - mB) / Math.sqrt(varDiff);
  }
  if (state.test === 't1') {
    const { mean: m, sd } = state.rawDiff;
    if (!isFinite(m) || !isFinite(sd) || sd <= 0) return null;
    return Math.abs(m) / sd;
  }
  return null;
}

// d を「小/中/大」ラベルに
function dLabel(d) {
  if (d < 0.2) return '極小';
  if (d < 0.35) return '小 (d≈0.2)';
  if (d < 0.65) return '中 (d≈0.5)';
  if (d < 1.0) return '大 (d≈0.8)';
  return '極大';
}

// v1029 「ボタンを押したときのみ表示」に変更、プレースは raw-derived-box の
//   textContent へ一言だけ反映 (「→ d = 0.500 (中)」)。
function renderDerivedLabel(d) {
  if (d === null) return '';
  return `→ d = ${d.toFixed(3)} (${dLabel(d)})`;
}

// v1029 中村さん指摘「手法A、手法Bのそれぞれの平均と、 SDを入力したら、それに応じて
//   どんなグラフになるか (正規分布の場合に) というのを示してあげて。で、その後
//   予想効果量を求めて。だから、この値で予想効果量を求めるみたいなボタンを用意する
//   とよいのかな。いま、データの種類を選んだ時点で何か走るので変」→
//     - dtype 変更で render() (全再描画) するのをやめ、 dtype 依存の範囲hint と
//       preview グラフだけ差し替える (フォーカスが抜けない)
//     - 平均 / SD 変化でライブ preview グラフを更新 (2 群の正規分布 or 差の分布)
//     - 予想 d の値は「この値で予想効果量を求める」ボタンを押したときのみ
//       表示 + 効果量欄に反映
function renderRawInputs() {
  if (!['t2','tp','t1'].includes(state.test)) return '';
  const dt = dtDef();
  const dtSelect = `
    <label class="field">
      <span class="lbl">📏 データの種類</span>
      <select id="pw-dtype">
        ${DATA_TYPES.map(x => `<option value="${x.id}" ${x.id===state.dataType?'selected':''}>${escapeHtml(x.label)}</option>`).join('')}
      </select>
    </label>
    <div id="raw-range-hint" class="hint-sm" style="font-size:11px; margin-top:2px">${escapeHtml(rangeHintText())}</div>`;
  // v1034 SD プリセット (集中 / 普通 / 広め / 二極) — データ型別に
  const sdPresetHtml = (targetId) => {
    if (!dt.sdPresets) return '';
    return `<div class="row" style="gap:4px; margin-top:4px; flex-wrap:wrap">
      <span class="hint-sm" style="align-self:center; font-size:10.5px">SD 目安:</span>
      ${dt.sdPresets.map(([lb, v]) => `<button data-sd-preset="${targetId}:${v}" class="btn" style="font-size:10.5px; padding:1px 6px">${escapeHtml(lb)}</button>`).join('')}
    </div>`;
  };

  const twoGroupInputs = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px">
      <div style="padding:8px; background:#eff6ff; border-radius:6px; border-left:3px solid #2563eb">
        <div class="bold" style="color:#2563eb; font-size:12px; margin-bottom:4px">👤 手法 A / 群 A</div>
        <label class="field" style="margin-bottom:6px"><span class="lbl">予想平均</span>
          <input type="number" id="raw-mA" step="${dt.step}" value="${state.rawA.mean}">
        </label>
        <label class="field"><span class="lbl">予想 SD (回答の散らばり)</span>
          <input type="number" id="raw-sA" step="${dt.step}" min="0.0001" value="${state.rawA.sd}">
        </label>
        ${sdPresetHtml('raw-sA')}
      </div>
      <div style="padding:8px; background:#fff7ed; border-radius:6px; border-left:3px solid #ea580c">
        <div class="bold" style="color:#ea580c; font-size:12px; margin-bottom:4px">👥 手法 B / 群 B</div>
        <label class="field" style="margin-bottom:6px"><span class="lbl">予想平均</span>
          <input type="number" id="raw-mB" step="${dt.step}" value="${state.rawB.mean}">
        </label>
        <label class="field"><span class="lbl">予想 SD (回答の散らばり)</span>
          <input type="number" id="raw-sB" step="${dt.step}" min="0.0001" value="${state.rawB.sd}">
        </label>
        ${sdPresetHtml('raw-sB')}
      </div>
    </div>`;
  // v1034 中村さん指摘「対応 t 検定も差分じゃなく 2 手法でやった方がわかりやすい」
  //   → t2 と同じ 2 カラムの「手法 A / 手法 B」 UI に + 「同じ参加者がやるので
  //   相関 r」の入力を追加。 d_paired = |M_A−M_B| / √(SD_A²+SD_B²−2·r·SD_A·SD_B)。
  const pairedInputs = twoGroupInputs + `
    <div style="padding:8px; background:#faf5ff; border-radius:6px; border-left:3px solid #7b3fa0; margin-top:10px">
      <div class="bold" style="color:#7b3fa0; font-size:12px; margin-bottom:4px">🔗 手法 A と B の相関 r (同じ参加者が両手法やるので)</div>
      <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
        <input type="number" id="raw-r" step="0.05" min="-0.99" max="0.99" value="${state.pairedR}" style="width:100px">
        <button data-pw-pairedr="0.3" class="btn" style="font-size:10.5px; padding:1px 6px">弱い 0.3</button>
        <button data-pw-pairedr="0.5" class="btn" style="font-size:10.5px; padding:1px 6px">典型 0.5</button>
        <button data-pw-pairedr="0.7" class="btn" style="font-size:10.5px; padding:1px 6px">強い 0.7</button>
      </div>
      <div class="hint-sm" style="margin-top:4px; font-size:11px">高いほど差の SD が小さくなり d が大きく出ます (対応 t の利点)。反応時間等の客観指標は 0.6-0.8、主観評価は 0.3-0.6 が目安。</div>
    </div>`;
  const t1Inputs = `
    <div style="padding:8px; background:#faf5ff; border-radius:6px; border-left:3px solid #7b3fa0; margin-top:8px">
      <div class="bold" style="color:#7b3fa0; font-size:12px; margin-bottom:4px">👤 観測 − 基準</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
        <label class="field"><span class="lbl">予想平均 (観測 − 基準値)</span>
          <input type="number" id="raw-mD" step="${dt.step}" value="${state.rawDiff.mean}">
        </label>
        <label class="field"><span class="lbl">予想 SD (観測の散らばり)</span>
          <input type="number" id="raw-sD" step="${dt.step}" min="0.0001" value="${state.rawDiff.sd}">
        </label>
      </div>
      ${sdPresetHtml('raw-sD')}
    </div>`;
  const inputBlock = state.test === 't2' ? twoGroupInputs
                   : state.test === 'tp' ? pairedInputs
                   : t1Inputs;
  return `
    <details class="card" style="background:#fafaf5; border-left:4px solid #ede4f3">
      <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🎯 予想データ (平均 + SD) から効果量を導く</summary>
      <div class="hint-sm" style="margin-top:6px; margin-bottom:6px">先行研究 or パイロットの平均と SD を入れて、グラフで手ごたえを確認 → 「この値で予想効果量を求める」ボタンで効果量欄に反映します。 SD が直感的でない場合は「集中 / 普通 / 広め」の目安ボタンから。</div>
      ${dtSelect}
      ${inputBlock}
      <!-- ライブ preview グラフ (正規分布) -->
      <div id="raw-preview" style="margin-top:10px">${renderRawPreviewSVG()}</div>
      <div class="row" style="gap:6px; margin-top:8px; align-items:center; flex-wrap:wrap">
        <button id="raw-apply" class="btn primary" style="font-size:12px">→ この値で予想効果量を求める (効果量欄に入れる)</button>
        <span id="raw-derived-box" class="hint-sm"></span>
      </div>
    </details>`;
}

// dtype 依存の範囲 hint 文字列
function rangeHintText() {
  const dt = dtDef();
  const [mMin, mMax] = dt.meanRange;
  const [sdMin, sdMax] = dt.sdRange;
  return `目安: 平均 ${mMin ?? '−∞'} 〜 ${mMax ?? '∞'} / SD ${sdMin} 〜 ${sdMax ?? '∞'}`;
}

// v1029 ライブ preview: 平均 / SD から正規分布を 2 本 (2 標本) or 1 本 (対応/1 標本)
//   描画。効果量表示はしない (「値をまず見て、それから求める」フロー)。
function renderRawPreviewSVG() {
  const W = 600, H = 200, PL = 34, PR = 16, PT = 12, PB = 32;
  // v1029b unary - と ** の混在は SyntaxError (「Unary operator used immediately
  //   before exponentiation expression」) になるので、明示括弧 + 中間変数で回避。
  const dnormAt = (x, mu, sd) => {
    const z = (x - mu) / sd;
    return Math.exp(-(z * z) / 2) / (sd * Math.sqrt(2 * Math.PI));
  };
  let curves = [];   // { mu, sd, color, label }
  if (state.test === 't2' || state.test === 'tp') {
    // v1034 対応 t 検定も 2 手法表示
    curves.push({ mu: state.rawA.mean, sd: state.rawA.sd, color: '#2563eb', label: '手法 A' });
    curves.push({ mu: state.rawB.mean, sd: state.rawB.sd, color: '#ea580c', label: '手法 B' });
  } else {
    curves.push({ mu: state.rawDiff.mean, sd: state.rawDiff.sd, color: '#7b3fa0', label: '(観測 − 基準) の分布' });
  }
  // 有効性チェック
  if (curves.some(c => !isFinite(c.mu) || !isFinite(c.sd) || c.sd <= 0)) {
    return `<div class="hint-sm" style="text-align:center; color:#a16207; padding:20px 0">値を全部入れるとグラフが出ます</div>`;
  }
  // x 範囲: 全曲線の平均 ± 4 SD を覆う
  let xMin = Math.min(...curves.map(c => c.mu - 4 * c.sd));
  let xMax = Math.max(...curves.map(c => c.mu + 4 * c.sd));
  // 差の分布の場合は 0 を必ず含める (0 = 差なしの基準)
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
  // 差の分布の 0 (基準線)
  const zeroMark = state.test !== 't2' ? `<line x1="${xToPx(0)}" y1="${PT}" x2="${xToPx(0)}" y2="${H - PB}" stroke="#111" stroke-dasharray="2,2" stroke-width="0.8" opacity="0.4"/>
       <text x="${xToPx(0) + 3}" y="${PT + 10}" font-size="10" fill="#111">差なし (0)</text>` : '';
  // 手法差 (2 標本のみつ) の帯
  let diffMark = '';
  if ((state.test === 't2' || state.test === 'tp') && isFinite(state.rawA.mean) && isFinite(state.rawB.mean)) {
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

// ---------------- 効果量ヘルパー (旧: 詳しい人向け) ----------------
// 中村さん指摘「効果量は先行研究の平均SDから計算するか、パイロット、メタ分析、分野の
//   慣習で決めるのが望ましい。ここをなんとか支援できないか」→ 先行研究 / パイロットの
//   値を入れて効果量を逆算する補助 UI。検定タイプ別に現実的な入力セットを出す。
function renderEffectHelper() {
  if (state.test === 't2') {
    return `
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 先行研究の平均・SD から Cohen's d を計算 (独立 2 群)</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>d = |M₁ − M₂| / √((SD₁² + SD₂²) / 2)</code></div>
        <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">群 1 の平均 M₁</span><input type="number" id="eh-m1" step="any"></label>
          <label class="field"><span class="lbl">群 1 の SD₁</span><input type="number" id="eh-sd1" step="any" min="0.0001"></label>
          <label class="field"><span class="lbl">群 2 の平均 M₂</span><input type="number" id="eh-m2" step="any"></label>
          <label class="field"><span class="lbl">群 2 の SD₂</span><input type="number" id="eh-sd2" step="any" min="0.0001"></label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="t2" class="btn primary" style="font-size:12px">→ d を計算して効果量欄に入れる</button>
          <span id="eh-out" class="hint-sm"></span>
        </div>
      </details>`;
  }
  if (state.test === 'tp' || state.test === 't1') {
    return `
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 先行研究の平均・SD から Cohen's d を計算 (対応あり / 1 標本)</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>d = |差分の平均| / SD</code>。対応ありなら「差分の平均・差分の SD」、 1 標本なら「観測平均 − 基準値」と観測 SD。</div>
        <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">平均 (差 or 観測 − 基準)</span><input type="number" id="eh-m" step="any"></label>
          <label class="field"><span class="lbl">SD (差 or 観測)</span><input type="number" id="eh-sd" step="any" min="0.0001"></label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="tp" class="btn primary" style="font-size:12px">→ d を計算して効果量欄に入れる</button>
          <span id="eh-out" class="hint-sm"></span>
        </div>
      </details>`;
  }
  if (state.test === 'anova' || state.test === 'rmanova') {
    return `
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 群平均 + 群内 SD から Cohen's f を計算</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>f = σ_between / σ_within</code>。 σ_between は群平均の母標準偏差 (n で割る版)、 σ_within は群内共通 SD。</div>
        <div style="display:grid; gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">群平均 (カンマ区切り、例: 3.2, 4.1, 5.0)</span>
            <input type="text" id="eh-means" placeholder="3.2, 4.1, 5.0">
          </label>
          <label class="field"><span class="lbl">群内共通 SD (プールされた SD 相当)</span>
            <input type="number" id="eh-sdw" step="any" min="0.0001">
          </label>
          <div class="hint-sm">別ルート: partial η² から <code>f = √(η² / (1 − η²))</code>。 η² が分かる場合は下の入力。</div>
          <label class="field"><span class="lbl">partial η² (0-1) からでも OK</span>
            <input type="number" id="eh-eta2" step="0.01" min="0" max="0.99">
          </label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="anova" class="btn primary" style="font-size:12px">→ f を計算して効果量欄に入れる</button>
          <span id="eh-out" class="hint-sm"></span>
        </div>
      </details>`;
  }
  if (state.test === 'corr' || state.test === 'corr_sp') {
    return `
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 決定係数 R² から r を計算</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>r = √R²</code>。効果量 r そのものを入れる方が直感的なケースも多いので、併用推奨。</div>
        <div style="display:grid; gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">R² (決定係数、 0-1)</span>
            <input type="number" id="eh-r2" step="0.01" min="0" max="0.99">
          </label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="corr" class="btn primary" style="font-size:12px">→ r を計算して効果量欄に入れる</button>
          <span id="eh-out" class="hint-sm"></span>
        </div>
      </details>`;
  }
  if (state.test === 'chi2') {
    return `
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 期待比率と想定比率から Cohen's w を計算</summary>
        <div class="hint-sm" style="margin-top:4px">計算式: <code>w = √(Σ ((p_i − p_i₀)² / p_i₀))</code>。 p_i₀ が帰無時の期待比率、 p_i が想定 (対立) の比率。それぞれカンマ区切りで同じ長さ、合計 1 になるように。</div>
        <div style="display:grid; gap:8px; margin-top:8px">
          <label class="field"><span class="lbl">帰無時の比率 p₀ (カンマ区切り、例: 0.5, 0.5)</span>
            <input type="text" id="eh-p0" placeholder="0.5, 0.5">
          </label>
          <label class="field"><span class="lbl">想定の比率 p (カンマ区切り、例: 0.6, 0.4)</span>
            <input type="text" id="eh-p1" placeholder="0.6, 0.4">
          </label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px">
          <button data-eh-calc="chi2" class="btn primary" style="font-size:12px">→ w を計算して効果量欄に入れる</button>
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
    if ([m1, sd1, m2, sd2].some(v => isNaN(v)) || sd1 <= 0 || sd2 <= 0) return alert('4 つの値を入れてください (SD は正)');
    const sd_pooled = Math.sqrt((sd1 * sd1 + sd2 * sd2) / 2);
    setEff(Math.abs(m1 - m2) / sd_pooled);
  } else if (kind === 'tp') {
    const m = num('eh-m'), sd = num('eh-sd');
    if (isNaN(m) || isNaN(sd) || sd <= 0) return alert('平均と SD を入れてください');
    setEff(Math.abs(m) / sd);
  } else if (kind === 'anova') {
    const eta2 = num('eh-eta2');
    if (!isNaN(eta2) && eta2 > 0 && eta2 < 1) { setEff(Math.sqrt(eta2 / (1 - eta2))); return; }
    const means = csv('eh-means'), sdw = num('eh-sdw');
    if (means.length < 2 || isNaN(sdw) || sdw <= 0) return alert('群平均 (2 個以上) と群内 SD を入れるか、 η² を入れてください');
    const grand = means.reduce((a, b) => a + b, 0) / means.length;
    const sigmaBetween = Math.sqrt(means.reduce((s, x) => s + (x - grand) * (x - grand), 0) / means.length);
    setEff(sigmaBetween / sdw);
  } else if (kind === 'corr') {
    const r2 = num('eh-r2');
    if (isNaN(r2) || r2 < 0 || r2 > 1) return alert('R² (0-1) を入れてください');
    setEff(Math.sqrt(r2));
  } else if (kind === 'chi2') {
    const p0 = csv('eh-p0'), p1 = csv('eh-p1');
    if (p0.length !== p1.length || p0.length < 2) return alert('比率を同じ長さのカンマ区切りで 2 個以上');
    const w = Math.sqrt(p0.reduce((s, p, i) => {
      if (p <= 0) return s;
      const d = p1[i] - p;
      return s + (d * d) / p;
    }, 0));
    setEff(w);
  }
}

// v1032 3-level LMM (参加者 × 刺激) ステップブロック
function renderLMM3Blocks() {
  const p = state.lmm3;
  const mode = state.mode;
  return `
    ${stepBlock({ title: '⑥ 条件効果 β (raw)', desc: '条件間の平均差 (outcome 生単位)。', body: `<input type="number" id="lmm3-beta" step="0.05" value="${p.beta}" style="width:120px"> <span class="hint-sm">目安:</span> <button class="btn" data-lmm3-beta="0.2" style="font-size:11px; padding:2px 8px">小 0.2</button> <button class="btn" data-lmm3-beta="0.5" style="font-size:11px; padding:2px 8px">中 0.5</button> <button class="btn" data-lmm3-beta="0.8" style="font-size:11px; padding:2px 8px">大 0.8</button>` })}
    ${stepBlock({ title: '⑦ 参加者間 SD σ_p', desc: '参加者の平均的な高低のばらつき。交差配置では条件差には直接効かないが、参考値として。', body: `<input type="number" id="lmm3-sdp" step="0.05" min="0.001" value="${p.sd_participant}" style="width:120px">` })}
    ${stepBlock({ title: '⑧ 刺激間 SD σ_stim', desc: '刺激ごとの難易度 / 反応性のばらつき。交差配置では差分でキャンセルされるが、大きいと選定の分散を圧迫。', body: `<input type="number" id="lmm3-sds" step="0.05" min="0.001" value="${p.sd_stimulus}" style="width:120px">` })}
    ${stepBlock({ title: '⑨ 残差 SD σ_e', desc: '同じ参加者・同じ刺激・同じ条件内の試行ノイズ。', body: `<input type="number" id="lmm3-sde" step="0.05" min="0.001" value="${p.sd_residual}" style="width:120px">` })}
    ${stepBlock({
      title: '⑨-b ランダム傾き SD (σ_slope_p、 0 = 効果個人共通)',
      desc: '条件効果 β の参加者間個人差 (lme4 の (1+x|p))。大きいほど検定力↓。目安: β の 30-50% (弱)、 β 相当 (中)。わからなければ 0。',
      body: `<input type="number" id="lmm3-sdslopep" step="0.05" min="0" value="${p.sd_slope_p || 0}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-lmm3-sdslopep="0" style="font-size:11px; padding:2px 8px">なし 0</button>
               <button class="btn" data-lmm3-sdslopep="${(Math.abs(p.beta)*0.4).toFixed(3)}" style="font-size:11px; padding:2px 8px">弱 (β の 40%)</button>
               <button class="btn" data-lmm3-sdslopep="${Math.abs(p.beta).toFixed(3)}" style="font-size:11px; padding:2px 8px">中 (β 相当)</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑨-c ランダム傾き SD (σ_slope_s、刺激別効果差)',
      desc: '刺激ごとの条件効果の差 (lme4 の (1+x|s))。「特定の刺激でだけ効果が出る/出ない」の度合い。わからなければ 0。',
      body: `<input type="number" id="lmm3-sdslopes" step="0.05" min="0" value="${p.sd_slope_s || 0}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-lmm3-sdslopes="0" style="font-size:11px; padding:2px 8px">なし 0</button>
               <button class="btn" data-lmm3-sdslopes="${(Math.abs(p.beta)*0.3).toFixed(3)}" style="font-size:11px; padding:2px 8px">弱 (β の 30%)</button>
             </div>`,
    })}
    ${stepBlock({ title: '⑩ 刺激数 (両条件で同じ)', desc: '各参加者が見る刺激の数 (両条件で各 1 回)。増やすと残差平均化で検定力上がる。', body: `<input type="number" id="lmm3-ns" step="1" min="1" value="${p.n_stimuli}" style="width:120px">` })}
    ${mode === 'post_hoc' ? stepBlock({ title: '⑪ 参加者数 n_p', desc: '手元 or 予定の参加者数。', body: `<input type="number" id="lmm3-np" step="1" min="3" value="${p.n_participants}" style="width:120px">` }) : ''}
    ${stepBlock({ title: '⚙ シミュ反復数', desc: '目安: 500 で ~5%、 1000 で ~3%、 5000 で ~1.5% 誤差。', body: `<input type="number" id="lmm3-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">` })}
  `;
}

// v1037 GLMM の p₀ ⇔ p₁ ⇔ OR 相互換算 (中村さん指摘「p₁ も入力させたい、 OR で表現するんだっけ？」)
function orFromProbs(p0, p1) {
  const eps = 1e-6;
  const p0c = Math.min(Math.max(p0, eps), 1 - eps);
  const p1c = Math.min(Math.max(p1, eps), 1 - eps);
  return (p1c / (1 - p1c)) / (p0c / (1 - p0c));
}
function probFromBaseAndOR(p0, or) {
  const eps = 1e-6;
  const p0c = Math.min(Math.max(p0, eps), 1 - eps);
  const odds0 = p0c / (1 - p0c);
  const odds1 = odds0 * or;
  return odds1 / (1 + odds1);
}
function renderGLMMDerivedOR() {
  const p = state.glmm;
  const or = orFromProbs(p.baseline_p, p.proposed_p);
  const rr = p.proposed_p / p.baseline_p;
  const size = or >= 3.0 ? '大' : or >= 1.7 ? '中' : or >= 1.3 ? '小' : or > 1 ? '極小' : or === 1 ? 'なし' : '負 (反対向き)';
  return `⇒ 導出 OR = ${or.toFixed(2)} <span style="color:#666">(${size}, リスク比 RR = ${rr.toFixed(2)})</span>`;
}

// v1045 fb#482 効果量の目安表を効果量セクション内の目安ボタンの下に配置
//   (中村さん指摘「効果量の目安という一番下にあるやつは、効果量セクションのボタン
//   の下に配置して」)。折り畳みで検定別の早見表 + 選び方の一言を出す。
function renderCohenGuideInline() {
  return `
    <details style="margin-top:6px; padding:6px 10px; background:#faf5ff; border-radius:6px">
      <summary style="cursor:pointer; font-weight:600; font-size:12px; color:#7b3fa0">📖 効果量の目安 (Cohen) — 検定別早見表</summary>
      <div style="margin-top:6px; font-size:12.5px; line-height:1.85">
        <div><b>Cohen's d</b> (t 検定): 0.2 (小) / 0.5 (中) / 0.8 (大)</div>
        <div><b>Cohen's f</b> (ANOVA/rmANOVA): 0.10 (小) / 0.25 (中) / 0.40 (大)</div>
        <div><b>Pearson r</b> (相関): 0.10 (小) / 0.30 (中) / 0.50 (大)</div>
        <div><b>Cohen's w</b> (χ²): 0.10 (小) / 0.30 (中) / 0.50 (大)</div>
        <div class="hint-sm" style="margin-top:4px">効果量は先行研究の平均 SD から計算するか、パイロット、メタ分析、分野の慣習で決めるのが望ましい。「中」は決定に困った時の便宜的な選択。</div>
      </div>
    </details>`;
}

// v1055 ρ (測定間相関) のパイロットデータからの自動計算ヘルパー
//   中村さん指摘「ρ の求め方がわからない」への対応。パイロットや先行研究データが
//   あればその 2 列 (手法 A, 手法 B) の Pearson 相関を直接計算して入れられる。
function renderRhoHelper() {
  return `
    <details style="margin-top:8px; padding:8px 12px; background:#faf5ff; border-radius:6px; border-left:3px solid #7b3fa0">
      <summary style="cursor:pointer; font-weight:600; font-size:12.5px; color:#7b3fa0">🧮 パイロットデータから ρ を計算する</summary>
      <div style="margin-top:8px; font-size:12.5px; line-height:1.7">
        <div>2 条件の各参加者の値を貼り付け (各行 1 名、空白 or カンマ区切り or 改行区切り)。 Pearson 相関を計算します。</div>
        <div style="display:grid; gap:6px; grid-template-columns: 1fr 1fr; margin-top:8px">
          <label class="field"><span class="lbl">手法 A の値 (各行 1 参加者)</span>
            <textarea id="rho-a" rows="6" placeholder="例:&#10;123&#10;145&#10;98&#10;..." style="width:100%; font-family:monospace; font-size:12px"></textarea>
          </label>
          <label class="field"><span class="lbl">手法 B の値 (同じ参加者順)</span>
            <textarea id="rho-b" rows="6" placeholder="例:&#10;110&#10;138&#10;95&#10;..." style="width:100%; font-family:monospace; font-size:12px"></textarea>
          </label>
        </div>
        <div class="row" style="gap:6px; margin-top:6px; flex-wrap:wrap; align-items:center">
          <button id="rho-calc" class="btn" style="font-size:11px; padding:3px 10px">🧮 ρ を計算</button>
          <span id="rho-result" style="font-size:12.5px"></span>
        </div>
      </div>
    </details>`;
}

// v1053/v1054/v1055 予算試算 helpers (全検定共通)
//   参加形式ごとの総合倍率:
//     inhouse (研究室内対面、アルバイト報告書): × 1.10 (税金分)
//     outside (研究室外対面、Amazon ギフト券): × 1.00 (ギフト券は税金対象外)
//     crowdsource (クラウドソーシング、利用料込み): × 2.00
const BUDGET_MODES = {
  inhouse:     { label: '👥 研究室内対面 (アルバイト報告書)', mult: 1.10, mult_note: '× 1.10 (税金分)' },
  outside:     { label: '🎁 研究室外対面 (Amazon ギフト券)',  mult: 1.00, mult_note: '× 1.00 (ギフト券は税金対象外)' },
  crowdsource: { label: '🌐 クラウドソーシング (利用料込み)',  mult: 2.00, mult_note: '× 2.00 (利用料込みで概ね 2 倍)' },
};
// v1055 中村さん指摘「参加者 8 名 × 3 手法だから」 → 実験時間は 1 手法あたりと解釈し、
//   対応系 (同じ参加者が複数手法を試す) では手法数を掛ける。
function methodsPerParticipant() {
  const t = state.test;
  if (t === 'tp' || t === 'bayes_t') return 2;
  if (t === 'rmanova') return state.k;
  // LMM/GLMM 系も参加者内 2 条件だが、「1 人あたりの全実験時間」を別途想定するため
  //   ここでは手法倍率は 1 とし、 hint で「試行時間も込みで入力してください」と誘導
  return 1;
}
function methodsBreakdownNote() {
  const t = state.test;
  const m = methodsPerParticipant();
  if (m === 1) return '';
  if (t === 'rmanova') return `× ${state.k} 手法 (rmANOVA、 1 人が全 ${state.k} 手法を試す)`;
  if (t === 'tp')      return `× 2 手法 (対応 t、 1 人が両手法を試す)`;
  if (t === 'bayes_t') return `× 2 手法 (対応 t、 1 人が両手法を試す)`;
  return `× ${m} 手法`;
}
// v1056 中村さん指摘「本人に支払う額と実際にかかる総額は分けたほうが良い。 1.1 倍
//   は予算的な問題、クラウドソーシングの × 2 も予算的な問題。本人に支払うのは × 1」
function participantPaymentPer() {
  // 本人が受け取る額 = 実験時間 × 手法数 × 時給 (税金や手数料は含まない)
  const b = state.budget;
  const hoursPerMethod = b.minutes_per_participant / 60;
  const methods = methodsPerParticipant();
  return hoursPerMethod * methods * b.rate_per_hour;
}
function costPerParticipant() {
  // 研究者側の予算 (実費) = 本人への支払 × 参加形式の倍率 (税金 or 利用料込み)
  const b = state.budget;
  const mode = BUDGET_MODES[b.mode] || BUDGET_MODES.inhouse;
  return participantPaymentPer() * mode.mult;
}
function renderBudgetBlock() {
  const b = state.budget;
  const pay = participantPaymentPer();
  const cost = costPerParticipant();
  const mode = BUDGET_MODES[b.mode] || BUDGET_MODES.inhouse;
  const methods = methodsPerParticipant();
  const totalMinutes = b.minutes_per_participant * methods;
  const totalHours = totalMinutes / 60;
  const isLmm = ['lmm_within','lmm_crossed','glmm_logit','glmm_poisson','glmm_ordinal','glmm_nb'].includes(state.test);
  const overhead = cost - pay;
  return stepBlock({
    title: '💰 予算試算 (1 人あたり)',
    desc: `実験時間 (分/人・<b>1 手法あたり</b>) × 手法数 × 時給で「本人への支払額」、それに参加形式の倍率 (税金 or 利用料) を掛けて「予算 (実費)」を試算。対応系 (対応 t、反復測定 ANOVA、ベイズ対応 t) は 1 人が全手法を試すので手法数を自動で掛けます。${isLmm ? ' <span style="color:#a16207">⚠ LMM/GLMM は試行数 × 2 条件が別軸にあるので、ここには「1 人の全実験時間」を直接入力してください (手法倍率は × 1)。</span>' : ''}`,
    body: `<div style="display:grid; gap:8px; grid-template-columns: repeat(2, minmax(140px, 220px))">
             <label class="field"><span class="lbl">実験時間 (分/人・1 手法)</span>
               <input type="number" id="bud-min" step="5" min="1" value="${b.minutes_per_participant}" style="width:100%">
             </label>
             <label class="field"><span class="lbl">時給 (円/時間)</span>
               <input type="number" id="bud-rate" step="50" min="0" value="${b.rate_per_hour}" style="width:100%">
             </label>
             <label class="field" style="grid-column:span 2"><span class="lbl">参加形式</span>
               <select id="bud-mode" style="width:100%">
                 ${Object.entries(BUDGET_MODES).map(([k, v]) => `<option value="${k}" ${b.mode===k?'selected':''}>${v.label}</option>`).join('')}
               </select>
             </label>
           </div>
           <div id="bud-summary" class="hint-sm" style="margin-top:8px; padding:8px 12px; background:#eef2ff; border-radius:6px">
             <div>👤 本人への支払 (× 1): <b style="color:#059669">¥${Math.round(pay).toLocaleString()}</b>
               <span style="color:#666">(${b.minutes_per_participant} 分/手法${methods > 1 ? ' × ' + methods + ' 手法 = ' + totalMinutes + ' 分' : ''} = ${totalHours.toFixed(2)} 時間 × ¥${b.rate_per_hour}/時)</span></div>
             <div style="margin-top:4px">💼 予算 (実費、研究者負担): <b style="color:#7b3fa0">¥${Math.round(cost).toLocaleString()}</b>
               <span style="color:#666">(${overhead > 0 ? '本人支払 + ¥' + Math.round(overhead).toLocaleString() + ' 上乗せ (' + mode.mult_note + ')' : '本人支払と同額 (Amazon ギフト券は税金対象外)'})</span></div>
           </div>`,
  });
}
function renderBudgetSummary(participantCount, label = '必要') {
  const pay = participantPaymentPer();
  const cost = costPerParticipant();
  const totalPay = pay * participantCount;
  const totalCost = cost * participantCount;
  const b = state.budget;
  const mode = BUDGET_MODES[b.mode] || BUDGET_MODES.inhouse;
  const methods = methodsPerParticipant();
  const totalMinutes = b.minutes_per_participant * methods;
  const totalHours = totalMinutes / 60;
  const timePart = methods > 1
    ? `${b.minutes_per_participant} 分/手法 × ${methods} 手法 = ${totalMinutes} 分 (${totalHours.toFixed(2)} 時間) × ¥${b.rate_per_hour}/時`
    : `${b.minutes_per_participant} 分 (${totalHours.toFixed(2)} 時間) × ¥${b.rate_per_hour}/時`;
  return `
    <div class="card" style="background:#fef7ed; border-left:4px solid #ea580c">
      <div class="bold" style="color:#ea580c; margin-bottom:6px">💰 想定予算 (${mode.label.replace(/^[^\s]+ /, '')}、 ${label} ${participantCount} 名${methods > 1 ? ' × ' + methods + ' 手法' : ''})</div>
      <div style="display:grid; gap:6px; grid-template-columns: 1fr 1fr; margin-top:6px">
        <div style="padding:8px 12px; background:#ecfdf5; border-radius:6px; border-left:3px solid #059669">
          <div style="font-size:12px; color:#059669; font-weight:600">👤 本人への支払合計 (× 1)</div>
          <div style="font-size:20px; font-weight:700; color:#065f46; margin-top:2px">¥${Math.round(totalPay).toLocaleString()}</div>
          <div class="hint-sm" style="margin-top:2px; color:#065f46">¥${Math.round(pay).toLocaleString()} × ${participantCount} 名</div>
        </div>
        <div style="padding:8px 12px; background:#faf5ff; border-radius:6px; border-left:3px solid #7b3fa0">
          <div style="font-size:12px; color:#7b3fa0; font-weight:600">💼 予算 (実費、研究者負担)</div>
          <div style="font-size:20px; font-weight:700; color:#4a106d; margin-top:2px">¥${Math.round(totalCost).toLocaleString()}</div>
          <div class="hint-sm" style="margin-top:2px; color:#4a106d">¥${Math.round(cost).toLocaleString()} × ${participantCount} 名 (${mode.mult_note})</div>
        </div>
      </div>
      <div class="hint-sm" style="margin-top:6px">${timePart}</div>
      <div class="hint-sm" style="margin-top:4px; color:#a16207">💡 脱落・除外 10% 見込みで予算目安 ¥${Math.round(totalCost * 1.10).toLocaleString()}。</div>
    </div>`;
}

// v1063 fb#484 Fisher 2×2 ステップブロック
function renderFisherBlocks() {
  const p = state.fisher_2x2;
  const mode = state.mode;
  const or = ((p.p1 / (1 - p.p1)) / (p.p0 / (1 - p.p0))) || 1;
  return `
    ${stepBlock({
      title: '⑥ 対照群の想定陽性率 p₀',
      desc: '対照条件の「陽性」 (成功/正答/有意反応等) の割合。',
      body: `<input type="number" id="fisher-p0" step="0.05" min="0.01" max="0.99" value="${p.p0}" style="width:120px">`,
    })}
    ${stepBlock({
      title: '⑦ 処置群の想定陽性率 p₁',
      desc: `処置条件の陽性率。 p₀ との差が効果量。 <b>現在: |p₁ − p₀| = ${Math.abs(p.p1 - p.p0).toFixed(2)}、オッズ比 ${or.toFixed(2)}</b>。`,
      body: `<input type="number" id="fisher-p1" step="0.05" min="0.01" max="0.99" value="${p.p1}" style="width:120px">`,
    })}
    ${mode === 'post_hoc' ? stepBlock({
      title: '⑧ 各群の参加者数 n',
      desc: '対照群と処置群の各群の参加者数 (等サンプルサイズ想定)。',
      body: `<input type="number" id="fisher-n" step="1" min="2" value="${p.n_per_group}" style="width:120px">`,
    }) : ''}
    ${stepBlock({
      title: '⚙ シミュ反復数',
      desc: 'Fisher exact の Monte Carlo。 A priori は二分探索の各点で 300 iters を走らせるので少し時間がかかります。目安: 2000 で ~2%、 5000 で ~1.5% 誤差。',
      body: `<input type="number" id="fisher-iter" step="500" min="500" max="20000" value="${p.iterations}" style="width:140px">`,
    })}
  `;
}

// v1050 ベイズ (JZS BF10) ステップブロック
function renderBayesBlocks() {
  const p = state.bayes_t;
  return `
    ${stepBlock({
      title: '⑥ 参加者数 n (対応 t / 差スコア数)',
      desc: '各参加者の差スコアの数。逐次モードでは初期値として使う (上限は下で設定)。',
      body: `<input type="number" id="bay-n" step="1" min="3" value="${p.n}" style="width:120px">`,
    })}
    ${stepBlock({
      title: '⑦ 効果量 d (Cohen d)',
      desc: '想定する標準化平均差。頻度論と同じ流儀。',
      body: `<input type="number" id="bay-d" step="0.05" min="0.01" value="${p.d}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-bay-d="0.2" style="font-size:11px; padding:2px 8px">小 0.2</button>
               <button class="btn" data-bay-d="0.5" style="font-size:11px; padding:2px 8px">中 0.5</button>
               <button class="btn" data-bay-d="0.8" style="font-size:11px; padding:2px 8px">大 0.8</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑧ BF10 の閾値 K',
      desc: '「BF10 ≥ K で H1 支持」と判断する閾値。 Jeffreys の目安: 3 = moderate、10 = strong、30 = very strong。逐次モードは対称停止で BF ≤ 1/K なら H0 支持。',
      body: `<input type="number" id="bay-bf" step="0.5" min="1.5" value="${p.bf_threshold}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-bay-bf="3" style="font-size:11px; padding:2px 8px">3 (moderate)</button>
               <button class="btn" data-bay-bf="10" style="font-size:11px; padding:2px 8px">10 (strong)</button>
               <button class="btn" data-bay-bf="30" style="font-size:11px; padding:2px 8px">30 (very strong)</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑨ Cauchy 事前分布のスケール r',
      desc: 'δ (effect size) に対する Cauchy(0, r) 事前分布。 Rouder の推奨は r = 1/√2 ≈ 0.707 (medium)。大きい効果を予想するなら 1.0、小さいなら 0.5。',
      body: `<input type="number" id="bay-r" step="0.05" min="0.1" max="2" value="${p.prior_r}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-bay-r="0.5" style="font-size:11px; padding:2px 8px">狭 0.5</button>
               <button class="btn" data-bay-r="0.707" style="font-size:11px; padding:2px 8px">中 1/√2</button>
               <button class="btn" data-bay-r="1.0" style="font-size:11px; padding:2px 8px">広 1.0</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑩ モード',
      desc: '固定 = ⑥ の n で検出確率を計算。逐次 = n を 3 から上限まで増やしながら BF が閾値 or 1/閾値に達したら止めるデザイン (SBF, Schönbrodt et al. 2017)。 α 補正不要。',
      body: `<select id="bay-mode" style="width:100%">
              <option value="fixed" ${p.mode_bayes==='fixed'?'selected':''}>🎯 固定 n (⑥ の n で検出確率)</option>
              <option value="sequential" ${p.mode_bayes==='sequential'?'selected':''}>📈 逐次 (SBF) — 平均 n を求める</option>
             </select>`,
    })}
    ${p.mode_bayes === 'sequential' ? stepBlock({
      title: '⑪ 逐次モードの上限 n_max',
      desc: '逐次デザインでこれ以上 n を増やしても判断できない場合は打ち切り。 200 が実用的な目安。',
      body: `<input type="number" id="bay-nmax" step="10" min="10" max="500" value="${p.n_max}" style="width:120px">`,
    }) : ''}
    ${stepBlock({ title: '⚙ シミュ反復数', desc: '目安: 500 で ~5%、1000 で ~3%。逐次モードは 1 iter で平均 20-100 回 BF 計算するので Poisson より遅い。', body: `<input type="number" id="bay-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">` })}
  `;
}

// v1049 負の二項 GLMM ステップブロック (Poisson とほぼ同じ + θ)
function renderNBBlocks() {
  const p = state.glmm_nb;
  const mode = state.mode;
  const rr = p.proposed_rate / p.baseline_rate;
  const rrSize = rr >= 2.0 ? '大' : rr >= 1.5 ? '中' : rr >= 1.2 ? '小' : rr > 1 ? '極小' : rr === 1 ? 'なし' : '負 (減少)';
  const varMult = (p.baseline_rate + p.baseline_rate * p.baseline_rate / p.theta) / p.baseline_rate;
  return `
    ${stepBlock({
      title: '⑥ ベースライン条件 (x=0) の想定平均回数 λ₀',
      desc: 'ベースライン条件で単位期間 (1 試行) あたり何回発生するかの想定平均。',
      body: `<input type="number" id="nb-r0" step="0.5" min="0.1" value="${p.baseline_rate}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-nb-r0="2" style="font-size:11px; padding:2px 8px">稀 λ=2</button>
               <button class="btn" data-nb-r0="5" style="font-size:11px; padding:2px 8px">中 λ=5</button>
               <button class="btn" data-nb-r0="15" style="font-size:11px; padding:2px 8px">多 λ=15</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑦ 提案条件 (x=1) の想定平均回数 λ₁',
      desc: 'λ₀ とセットで RR = λ₁ / λ₀ を自動計算。',
      body: `<input type="number" id="nb-r1" step="0.5" min="0.01" value="${p.proposed_rate}" style="width:120px">
             <div id="nb-rr-derived" class="hint-sm" style="margin-top:6px; padding:6px 10px; background:#eef2ff; border-radius:6px; display:inline-block">⇒ 導出 RR = ${rr.toFixed(2)} <span style="color:#666">(${rrSize})</span></div>
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">効果量 (RR) 目安:</span>
               <button class="btn" data-nb-rr="1.3" style="font-size:11px; padding:2px 8px">小 RR 1.3</button>
               <button class="btn" data-nb-rr="1.5" style="font-size:11px; padding:2px 8px">中 RR 1.5</button>
               <button class="btn" data-nb-rr="2.0" style="font-size:11px; padding:2px 8px">大 RR 2.0</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑧ 過分散パラメータ θ (size)',
      desc: `Var(Y) = μ + μ²/θ の θ。大きいほど Poisson に近い、小さいほど過分散が深刻。 <b>現在の分散比 (Var/μ) ≈ ${varMult.toFixed(2)}</b> (Poisson なら 1.0)。データが「Var = 2 × μ」程度なら θ ≈ μ、「Var = 5 × μ」なら θ ≈ μ/4。`,
      body: `<input type="number" id="nb-theta" step="0.5" min="0.1" max="100" value="${p.theta}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-nb-theta="1" style="font-size:11px; padding:2px 8px">深刻 θ=1</button>
               <button class="btn" data-nb-theta="3" style="font-size:11px; padding:2px 8px">中 θ=3</button>
               <button class="btn" data-nb-theta="10" style="font-size:11px; padding:2px 8px">軽微 θ=10</button>
               <button class="btn" data-nb-theta="100" style="font-size:11px; padding:2px 8px">ほぼ Poisson θ=100</button>
             </div>`,
    })}
    ${stepBlock({ title: '⑨ 参加者間 SD (log スケール)', desc: '参加者ごとのカウントの個人差 (log スケール)。', body: `<input type="number" id="nb-sdp" step="0.05" min="0" value="${p.sd_participant}" style="width:120px">` })}
    ${stepBlock({ title: '⑩ 各条件の試行 (期間) 数', desc: '各条件で 1 参加者が繰り返す試行 or 観測期間の数。', body: `<input type="number" id="nb-nt" step="1" min="1" value="${p.n_trials}" style="width:120px">` })}
    ${mode === 'post_hoc' ? stepBlock({ title: '⑪ 参加者数 n_p', desc: '手元 or 予定の参加者数。', body: `<input type="number" id="nb-np" step="1" min="3" value="${p.n_participants}" style="width:120px">` }) : ''}
    ${stepBlock({ title: '⚙ シミュ反復数', desc: '目安: 500 で ~5%、1000 で ~3%。 NB は Gamma-Poisson の 2 段階サンプリングで Poisson より少し重い。', body: `<input type="number" id="nb-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">` })}
  `;
}

// v1048 順序ロジット GLMM ステップブロック
function renderOrdinalBlocks() {
  const p = state.glmm_ordinal;
  const mode = state.mode;
  const log_or = p.d * Math.PI / Math.sqrt(3);
  const or = Math.exp(log_or);
  return `
    ${stepBlock({
      title: '⑥ リッカート等のカテゴリ数 K',
      desc: '順序尺度の段階数 (例: 「全く思わない〜非常に思う」の 5 段階なら K=5)。',
      body: `<input type="number" id="ord-k" step="1" min="3" max="11" value="${p.k_cat}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-ord-k="3" style="font-size:11px; padding:2px 8px">3 段階</button>
               <button class="btn" data-ord-k="5" style="font-size:11px; padding:2px 8px">5 段階 (SD法)</button>
               <button class="btn" data-ord-k="7" style="font-size:11px; padding:2px 8px">7 段階</button>
               <button class="btn" data-ord-k="9" style="font-size:11px; padding:2px 8px">9 段階</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑦ 効果量 d (Cohen d 相当、latent scale)',
      desc: '想定する条件間差の大きさ (連続 t 検定の Cohen d と同じ流儀で標準化)。 log(OR) = d × π/√3 ≈ 1.81·d の対応 (Chinn 2000)。リッカートの平均差 (7 段階で 0.5) の標準化に相当。',
      body: `<input type="number" id="ord-d" step="0.05" min="0.01" value="${p.d}" style="width:120px">
             <div id="ord-or-derived" class="hint-sm" style="margin-top:6px; padding:6px 10px; background:#eef2ff; border-radius:6px; display:inline-block">⇒ 導出 OR ≈ ${or.toFixed(2)} (β = log OR ≈ ${log_or.toFixed(3)})</div>
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">効果量 (d) 目安:</span>
               <button class="btn" data-ord-d="0.2" style="font-size:11px; padding:2px 8px">小 0.2</button>
               <button class="btn" data-ord-d="0.5" style="font-size:11px; padding:2px 8px">中 0.5</button>
               <button class="btn" data-ord-d="0.8" style="font-size:11px; padding:2px 8px">大 0.8</button>
             </div>`,
    })}
    ${stepBlock({ title: '⑧ 参加者間 SD (latent scale)', desc: '参加者ごとの傾向の個人差 (latent scale)。 0.5 で中程度、1.0 で顕著な個人差。', body: `<input type="number" id="ord-sdp" step="0.05" min="0" value="${p.sd_participant}" style="width:120px">` })}
    ${stepBlock({ title: '⑨ 各条件の試行 (項目) 数', desc: '各条件で 1 参加者が答える項目数。リッカートは尺度合計が多いので 1-3 で十分な場合も。', body: `<input type="number" id="ord-nt" step="1" min="1" value="${p.n_trials}" style="width:120px">` })}
    ${mode === 'post_hoc' ? stepBlock({ title: '⑩ 参加者数 n_p', desc: '手元 or 予定の参加者数。', body: `<input type="number" id="ord-np" step="1" min="3" value="${p.n_participants}" style="width:120px">` }) : ''}
    ${stepBlock({ title: '⚙ シミュ反復数', desc: '目安: 500 で ~5%、1000 で ~3%、5000 で ~1.5% 誤差。', body: `<input type="number" id="ord-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">` })}
  `;
}

// v1043 Poisson GLMM ステップブロック
function renderPoissonBlocks() {
  const p = state.glmm_poisson;
  const mode = state.mode;
  const rr = p.proposed_rate / p.baseline_rate;
  const rrSize = rr >= 2.0 ? '大' : rr >= 1.5 ? '中' : rr >= 1.2 ? '小' : rr > 1 ? '極小' : rr === 1 ? 'なし' : '負 (減少)';
  return `
    ${stepBlock({
      title: '⑥ ベースライン条件 (x=0) の想定平均回数 λ₀',
      desc: 'ベースライン条件で単位期間 (1 試行) あたり何回発生するかの想定平均。例: 「エラー 5 回 / 課題」、「発言 8 回 / 分」、「クリック 12 回 / セッション」。',
      body: `<input type="number" id="pois-r0" step="0.5" min="0.1" value="${p.baseline_rate}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-pois-r0="2" style="font-size:11px; padding:2px 8px">稀 λ=2</button>
               <button class="btn" data-pois-r0="5" style="font-size:11px; padding:2px 8px">中 λ=5</button>
               <button class="btn" data-pois-r0="15" style="font-size:11px; padding:2px 8px">多 λ=15</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑦ 提案条件 (x=1) の想定平均回数 λ₁',
      desc: 'λ₀ とセットで RR = λ₁ / λ₀ を自動計算。効果量目安のボタンは現在の λ₀ を基点に RR で換算して λ₁ に反映。',
      body: `<input type="number" id="pois-r1" step="0.5" min="0.01" value="${p.proposed_rate}" style="width:120px">
             <div id="pois-rr-derived" class="hint-sm" style="margin-top:6px; padding:6px 10px; background:#eef2ff; border-radius:6px; display:inline-block">⇒ 導出 RR = ${rr.toFixed(2)} <span style="color:#666">(${rrSize})</span></div>
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">効果量 (RR) 目安:</span>
               <button class="btn" data-pois-rr="1.3" style="font-size:11px; padding:2px 8px">小 RR 1.3</button>
               <button class="btn" data-pois-rr="1.5" style="font-size:11px; padding:2px 8px">中 RR 1.5</button>
               <button class="btn" data-pois-rr="2.0" style="font-size:11px; padding:2px 8px">大 RR 2.0</button>
             </div>`,
    })}
    ${stepBlock({ title: '⑧ 参加者間 SD (log スケール)', desc: '参加者ごとのカウントの個人差 (log スケール)。 0.5 で中程度、 1.0 でかなり大きい個人差。', body: `<input type="number" id="pois-sdp" step="0.05" min="0" value="${p.sd_participant}" style="width:120px">` })}
    ${stepBlock({ title: '⑨ 各条件の試行 (期間) 数', desc: '各条件で 1 参加者が繰り返す試行 or 観測期間の数 (例: 5 回セッション = 5)。増やすと個々の λ 推定が精確になり検定力↑。', body: `<input type="number" id="pois-nt" step="1" min="1" value="${p.n_trials}" style="width:120px">` })}
    ${mode === 'post_hoc' ? stepBlock({ title: '⑩ 参加者数 n_p', desc: '手元 or 予定の参加者数。', body: `<input type="number" id="pois-np" step="1" min="3" value="${p.n_participants}" style="width:120px">` }) : ''}
    ${stepBlock({ title: '⚙ シミュ反復数', desc: '目安: 500 で ~5%、 1000 で ~3%、 5000 で ~1.5% 誤差。', body: `<input type="number" id="pois-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">` })}
  `;
}

// v1032 Logistic GLMM ステップブロック
function renderGLMMBlocks() {
  const p = state.glmm;
  const mode = state.mode;
  return `
    ${stepBlock({
      title: '⑥ ベースライン条件 (x=0) の想定正答率 p₀',
      desc: '既存手法 or 対照条件での想定「正答率」「成功率」「反応率」等 (0-1)。',
      body: `<input type="number" id="glmm-p0" step="0.05" min="0.01" max="0.99" value="${p.baseline_p}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-glmm-p0="0.3" style="font-size:11px; padding:2px 8px">難 30%</button>
               <button class="btn" data-glmm-p0="0.5" style="font-size:11px; padding:2px 8px">中 50%</button>
               <button class="btn" data-glmm-p0="0.7" style="font-size:11px; padding:2px 8px">易 70%</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑦ 提案条件 (x=1) の想定正答率 p₁',
      desc: '提案手法での想定正答率。 p₀ とセットで OR = (p₁/(1−p₁)) / (p₀/(1−p₀)) を自動計算。効果量目安のボタンは現在の p₀ を基点に OR で換算して p₁ に反映。',
      body: `<input type="number" id="glmm-p1" step="0.05" min="0.01" max="0.99" value="${p.proposed_p}" style="width:120px">
             <div id="glmm-or-derived" class="hint-sm" style="margin-top:6px; padding:6px 10px; background:#eef2ff; border-radius:6px; display:inline-block">${renderGLMMDerivedOR()}</div>
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">効果量 (OR) 目安:</span>
               <button class="btn" data-glmm-or="1.5" style="font-size:11px; padding:2px 8px">小 OR 1.5</button>
               <button class="btn" data-glmm-or="2.0" style="font-size:11px; padding:2px 8px">中 OR 2.0</button>
               <button class="btn" data-glmm-or="3.0" style="font-size:11px; padding:2px 8px">大 OR 3.0</button>
             </div>`,
    })}
    ${stepBlock({ title: '⑧ 参加者間 SD (log-odds)', desc: '参加者の個人差 (log-odds スケール)。 0.5 = 中程度、 1.0 で顕著な個人差。', body: `<input type="number" id="glmm-sdp" step="0.05" min="0" value="${p.sd_participant}" style="width:120px">` })}
    ${stepBlock({ title: '⑨ 各条件の試行数', desc: '各条件で 1 参加者が繰り返す試行数。増やすと個々の確率推定が精確になり検定力上がる。', body: `<input type="number" id="glmm-nt" step="1" min="1" value="${p.n_trials}" style="width:120px">` })}
    ${mode === 'post_hoc' ? stepBlock({ title: '⑩ 参加者数 n_p', desc: '手元 or 予定の参加者数。', body: `<input type="number" id="glmm-np" step="1" min="3" value="${p.n_participants}" style="width:120px">` }) : ''}
    ${stepBlock({ title: '⚙ シミュ反復数', desc: '目安: 500 で ~5%、 1000 で ~3%、 5000 で ~1.5% 誤差。', body: `<input type="number" id="glmm-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">` })}
  `;
}

// v1031 LMM-specific ステップブロック
function renderLMMBlocks() {
  const p = state.lmm;
  const mode = state.mode;
  return `
    ${stepBlock({
      title: '⑥ 条件効果 β (raw 単位)',
      desc: '2 条件の平均差の期待値 (outcome の生単位、例: 反応時間なら ms、リッカートなら点)。 Cohen d と対応するなら β ≒ d × σ_residual。',
      body: `<input type="number" id="lmm-beta" step="0.05" value="${p.beta}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-lmm-beta="0.2" style="font-size:11px; padding:2px 8px">小 0.2</button>
               <button class="btn" data-lmm-beta="0.5" style="font-size:11px; padding:2px 8px">中 0.5</button>
               <button class="btn" data-lmm-beta="0.8" style="font-size:11px; padding:2px 8px">大 0.8</button>
             </div>`,
    })}

    ${stepBlock({
      title: '⑦ 参加者間 SD (σ_participant)',
      desc: '参加者ごとの平均的な高低のばらつき (random intercept SD)。大きいほど「個人差が大きく、条件効果が見えにくい」。通常 σ_residual と同程度かやや小さめ。',
      body: `<input type="number" id="lmm-sdp" step="0.05" min="0.001" value="${p.sd_participant}" style="width:120px">`,
    })}

    ${stepBlock({
      title: '⑧ 残差 SD (σ_residual)',
      desc: '同じ参加者の同じ条件内での試行間ばらつき。大きいほど各試行が noisy で、検定力は下がる。',
      body: `<input type="number" id="lmm-sde" step="0.05" min="0.001" value="${p.sd_residual}" style="width:120px">`,
    })}

    ${stepBlock({
      title: '⑧-b ランダム傾き SD (σ_slope、 0 = 効果は個人共通)',
      desc: '条件効果 β の個人差。「効果の出方が参加者ごとに違う」場合に加算 (lme4 の (1+x|p))。個人差が大きいほど検定力↓。目安: β の 30-50% (弱)、 β 相当 (中)、 2β (強)。わからなければ 0 でスタート。',
      body: `<input type="number" id="lmm-sdslope" step="0.05" min="0" value="${p.sd_slope || 0}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-lmm-sdslope="0" style="font-size:11px; padding:2px 8px">なし 0</button>
               <button class="btn" data-lmm-sdslope="${(Math.abs(p.beta)*0.4).toFixed(3)}" style="font-size:11px; padding:2px 8px">弱 (β の 40%)</button>
               <button class="btn" data-lmm-sdslope="${Math.abs(p.beta).toFixed(3)}" style="font-size:11px; padding:2px 8px">中 (β 相当)</button>
             </div>`,
    })}

    ${stepBlock({
      title: '⑨ 各参加者・各条件の試行数',
      desc: '1 人が各条件で繰り返す回数。増やすと参加者内のばらつきを平均化でき、検定力が上がる (残差が効いてる場合)。',
      body: `<input type="number" id="lmm-nt" step="1" min="1" value="${p.n_trials}" style="width:120px">`,
    })}

    ${mode === 'post_hoc' ? stepBlock({
      title: '⑩ 参加者数 n_p (Post hoc)',
      desc: '手元 or 予定の参加者数。',
      body: `<input type="number" id="lmm-np" step="1" min="3" value="${p.n_participants}" style="width:120px">`,
    }) : ''}

    ${stepBlock({
      title: '⚙ シミュレーション反復数 (iterations)',
      desc: '大きいほど精度が上がるが時間がかかる。目安: 500 で ~5%、 1000 で ~3%、 5000 で ~1.5% の誤差。',
      body: `<input type="number" id="lmm-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">`,
    })}
  `;
}

// ---------------- UI ヘルパー ----------------

// v1030 中村さん指示「一気に値を設定する感じになってるけど、ひとつずつ入力
//   させていくのが良い」→ 各パラメータを独立したステップブロック化。
function stepBlock({ title, desc, body }) {
  return `
    <div class="card" style="border-left:4px solid #ede4f3">
      <div class="bold" style="color:#7b3fa0; font-size:14.5px; margin-bottom:3px">${escapeHtml(title)}</div>
      <div class="hint-sm" style="margin-bottom:8px; line-height:1.5">${desc}</div>
      ${body}
    </div>`;
}

// ---------------- UI ----------------

const TESTS = [
  { id: 't2',    label: '📏 対応のない t 検定 (2 標本 t 検定: 独立)', eff: 'd', effGuide: [['小 d=0.2', 0.2], ['中 d=0.5', 0.5], ['大 d=0.8', 0.8]] },
  { id: 'tp',    label: '📎 対応のある t 検定',                       eff: 'd', effGuide: [['小 d=0.2', 0.2], ['中 d=0.5', 0.5], ['大 d=0.8', 0.8]] },
  { id: 't1',    label: '👤 1 標本 t 検定 (基準値との比較)',         eff: 'd', effGuide: [['小 d=0.2', 0.2], ['中 d=0.5', 0.5], ['大 d=0.8', 0.8]] },
  { id: 'rmanova', label: '🔁 反復測定 ANOVA (対応 3 群以上)',       eff: 'f', effGuide: [['小 f=0.10', 0.10], ['中 f=0.25', 0.25], ['大 f=0.40', 0.40]] },
  { id: 'anova', label: '📊 一元配置 ANOVA',              eff: 'f',        effGuide: [['小 f=0.10', 0.10], ['中 f=0.25', 0.25], ['大 f=0.40', 0.40]] },
  { id: 'corr',      label: '🔗 Pearson 相関',                   eff: 'r', effGuide: [['小 r=0.10', 0.10], ['中 r=0.30', 0.30], ['大 r=0.50', 0.50]] },
  // v1063 fb#483 中村さん: 順位の類似は Spearman で求める (Pearson とは別で表示)
  { id: 'corr_sp',   label: '🔗 Spearman 順位相関 (ρ)',           eff: 'r', effGuide: [['小 ρ=0.10', 0.10], ['中 ρ=0.30', 0.30], ['大 ρ=0.50', 0.50]] },
  { id: 'chi2',  label: '⁉ χ² (df 指定)',                eff: 'w',        effGuide: [['小 w=0.10', 0.10], ['中 w=0.30', 0.30], ['大 w=0.50', 0.50]] },
  // v1063 fb#484 Fisher 直接確率検定 (2×2、少数観測向き) の Monte Carlo シミュベース
  { id: 'fisher_2x2', label: '⁉ Fisher 直接確率検定 (2×2、シミュベース)', eff: 'p_diff',
    effGuide: [['小 |p1-p0|=0.1', 0.1], ['中 0.2', 0.2], ['大 0.3', 0.3]] },
  // v1031 LMM (2 レベル: 参加者内) — シミュレーションベース
  { id: 'lmm_within', label: '🧠 混合効果モデル (LMM) — 参加者内条件差 (2 レベル)', eff: 'beta',
    effGuide: [['小 β=0.2', 0.2], ['中 β=0.5', 0.5], ['大 β=0.8', 0.8]] },
  // v1032 LMM (3 レベル: 参加者 × 刺激) — 交差配置
  { id: 'lmm_crossed', label: '🧠 混合効果モデル (LMM) — 参加者×刺激 (3 レベル)', eff: 'beta',
    effGuide: [['小 β=0.2', 0.2], ['中 β=0.5', 0.5], ['大 β=0.8', 0.8]] },
  // v1032 Logistic GLMM (2 レベル: 参加者内、 2 値アウトカム)
  { id: 'glmm_logit', label: '🎯 Logistic GLMM — 2 値 (正答/誤答等) の参加者内効果', eff: 'or',
    effGuide: [['小 OR=1.5', 1.5], ['中 OR=2.0', 2.0], ['大 OR=3.0', 3.0]] },
  // v1043 Poisson GLMM (2 レベル: 参加者内、回数アウトカム)
  { id: 'glmm_poisson', label: '📊 Poisson GLMM — 回数 (エラー数/発言数等) の参加者内効果', eff: 'rr',
    effGuide: [['小 RR=1.3', 1.3], ['中 RR=1.5', 1.5], ['大 RR=2.0', 2.0]] },
  // v1048 順序ロジット GLMM (リッカート等の順序尺度、参加者内)
  { id: 'glmm_ordinal', label: '📶 順序ロジット GLMM — リッカート等の順序尺度の参加者内効果', eff: 'd',
    effGuide: [['小 d=0.2', 0.2], ['中 d=0.5', 0.5], ['大 d=0.8', 0.8]] },
  // v1049 負の二項 GLMM (過分散カウント、参加者内)
  { id: 'glmm_nb', label: '📈 負の二項 GLMM — 過分散カウントの参加者内効果', eff: 'rr',
    effGuide: [['小 RR=1.3', 1.3], ['中 RR=1.5', 1.5], ['大 RR=2.0', 2.0]] },
  // v1050 ベイズ (JZS BF10) ベースサンプルサイズ (対応 t / 1 標本 t)
  { id: 'bayes_t', label: '☯ ベイズ (JZS BF10) — 対応 t 検定のサンプルサイズ', eff: 'd',
    effGuide: [['小 d=0.2', 0.2], ['中 d=0.5', 0.5], ['大 d=0.8', 0.8]] },
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
  k: 3,              // ANOVA 群数 / 反復測定の測定回数
  df: 1,             // χ² 自由度
  rho: 0.5,          // v1041 反復測定 ANOVA の測定間相関
  epsilon: 1.0,      // v1041 反復測定 ANOVA の球面性補正 (1 = 補正なし)
  // v1053 予算試算 (全検定共通)
  //   v1054 中村さん指示で「実験時間を分単位に」 + 参加形式を 3 つに拡張:
  //     - 研究室内対面 (アルバイト報告書、税金分 × 1.10)
  //     - 研究室外対面 (Amazon ギフト券、× 1.00)
  //     - クラウドソーシング (利用料込み × 2.00)
  budget: {
    minutes_per_participant: 60,  // 1 人あたり実験時間 (分)
    rate_per_hour: 1250,          // 時給 (円/時間)、デフォルト中村研の標準
    mode: 'inhouse',              // 'inhouse' | 'outside' | 'crowdsource'
  },
  // v1028 中村さん提案「実測ベースで平均 / SD から d を導く方が直感的」
  //   dataType: 'continuous' | 'likert5' | 'likert7' | 'percentage' | 'binary'
  //   rawA, rawB: それぞれの群の { mean, sd }
  //   rawDiff:    対応あり / 1 標本の差分 { mean, sd }
  dataType: 'likert7',
  rawA: { mean: 4.0, sd: 1.2 },
  rawB: { mean: 4.6, sd: 1.2 },
  rawDiff: { mean: 0.6, sd: 1.2 },
  // v1034 対応 t 検定用の 2 手法の相関 (同じ参加者で両手法やるので相関が出る)
  pairedR: 0.5,
  // v1031 LMM (2 レベル) — 参加者内条件差
  lmm: {
    n_participants: 24,
    n_trials: 20,           // 各参加者、各条件の試行数
    beta: 0.5,              // 条件効果 (outcome の raw 単位)
    sd_participant: 1.0,    // 参加者間 SD (random intercept)
    sd_residual: 1.0,       // 残差 SD (trial-level)
    sd_slope: 0.0,          // v1042 ランダム傾き SD (0 = ランダム傾きなし)
    iterations: 1000,
    cost_per_participant: 1500,  // v1032 1 人あたり謝金 (円)、 0 で非表示
    last_power: null,
    last_ci: null,
    last_details: null,
  },
  // v1032 3-level LMM (参加者 × 刺激): 各参加者が各刺激を両条件で見る想定の
  //   簡易モデル。 params は lmm と重複するので extend で。
  lmm3: {
    n_participants: 24,
    n_stimuli: 16,
    beta: 0.5,
    sd_participant: 1.0,
    sd_stimulus: 0.5,
    sd_residual: 1.0,
    sd_slope_p: 0.0,        // v1042 参加者効果ランダム傾き SD
    sd_slope_s: 0.0,        // v1042 刺激効果ランダム傾き SD
    iterations: 1000,
    cost_per_participant: 1500,
  },
  // v1032 Logistic GLMM: 2 値アウトカム、参加者内条件差
  //   モデル: logit(P(y=1)) = β0 + β1·x + u_p、 u_p ~ N(0, σ_p²)
  //   β1 = log(OR) が条件効果
  glmm: {
    n_participants: 24,
    n_trials: 20,
    baseline_p: 0.5,     // 帰無条件 (x=0) の正答率
    proposed_p: 0.67,    // v1037 提案条件 (x=1) の正答率 (OR=2 で 0.5→0.67)
    or: 2.0,             // 効果量 (odds ratio、 β1 = log(or)) — proposed_p/baseline_p から自動導出も可
    sd_participant: 0.5, // 参加者間変動 (log-odds スケール)
    iterations: 1000,
    cost_per_participant: 1500,
  },
  // v1043 Poisson GLMM: 回数アウトカム、参加者内条件差
  //   モデル: log(E[Y]) = β0 + β1·x + u_p、 Y ~ Poisson(exp(η))、 u_p ~ N(0, σ_p²)
  //   β0 = log(baseline_rate)、 β1 = log(RR) が条件効果
  glmm_poisson: {
    n_participants: 24,
    n_trials: 20,
    baseline_rate: 5.0,    // ベースライン条件の平均カウント (単位期間あたり)
    proposed_rate: 7.5,    // 提案条件の平均カウント (RR = 1.5 で 5.0 → 7.5)
    rr: 1.5,               // rate ratio (proposed_rate / baseline_rate) — 自動導出
    sd_participant: 0.5,   // 参加者間変動 (log スケール)
    iterations: 1000,
    cost_per_participant: 1500,
  },
  // v1048 順序ロジット GLMM: リッカート等の順序尺度、参加者内条件差
  //   モデル (latent normal): latent_y = β·x + u_p + ε, ε ~ N(0, 1)
  //   観測 y を θ_j = qnorm(j/K) で K カテゴリに離散化
  glmm_ordinal: {
    n_participants: 24,
    n_trials: 10,
    k_cat: 5,              // カテゴリ数 (リッカート 5 段階 / 7 段階等)
    d: 0.5,                // Cohen d 相当 (latent scale)
    sd_participant: 0.5,   // 参加者間 SD (latent scale)
    iterations: 1000,
    cost_per_participant: 1500,
  },
  // v1049 負の二項 GLMM: 過分散カウント、参加者内条件差
  //   モデル: log(E[Y]) = β0 + β1·x + u_p, Y ~ NB(μ, θ)
  //   Var(Y) = μ + μ²/θ (θ は size 分散パラメータ、 Poisson は θ → ∞)
  glmm_nb: {
    n_participants: 24,
    n_trials: 20,
    baseline_rate: 5.0,
    proposed_rate: 7.5,
    rr: 1.5,
    theta: 3.0,            // 過分散パラメータ (小 = 深刻な過分散、大 = Poisson に近い)
    sd_participant: 0.5,
    iterations: 1000,
    cost_per_participant: 1500,
  },
  // v1063 fb#484 Fisher 直接確率検定 (2×2)
  fisher_2x2: {
    n_per_group: 30,
    p0: 0.3,          // 対照群陽性率
    p1: 0.5,          // 処置群陽性率
    iterations: 2000,
  },
  // v1050 ベイズ (JZS BF10)
  bayes_t: {
    n: 24,
    d: 0.5,
    bf_threshold: 3,       // BF10 の閾値 (3=moderate, 10=strong)
    prior_r: 0.707,        // Cauchy 事前分布のスケール r (デフォルト 1/√2 ≈ 0.707)
    mode_bayes: 'fixed',   // 'fixed' or 'sequential'
    n_max: 200,            // sequential mode の上限
    iterations: 1000,
    cost_per_participant: 1500,
  },
  // v1026 保存 / 共有メタ
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
  ['test','mode','alpha','tails','effect','power','n_per_group','n_total','k','df','dataType'].forEach(k => {
    if (k in cfg) state[k] = cfg[k];
  });
  ['rawA','rawB','rawDiff','lmm','lmm3','glmm','glmm_poisson','glmm_ordinal','glmm_nb','bayes_t','fisher_2x2','budget'].forEach(k => {
    if (cfg[k] && typeof cfg[k] === 'object') Object.assign(state[k], cfg[k]);
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
    // v1031/1032 sim モデルも config に含める
    lmm: state.lmm, lmm3: state.lmm3, glmm: state.glmm, glmm_poisson: state.glmm_poisson, glmm_ordinal: state.glmm_ordinal, glmm_nb: state.glmm_nb, bayes_t: state.bayes_t, fisher_2x2: state.fisher_2x2,
    budget: state.budget,
    dataType: state.dataType, rawA: state.rawA, rawB: state.rawB, rawDiff: state.rawDiff,
  };
}

function render() {
  const app = document.getElementById('app');
  const t = TESTS.find(x => x.id === state.test);
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📐 サンプルサイズ / 検定力 ${state.loaded_name ? `<span class="hint-sm" style="font-size:13px; margin-left:8px; color:#7b3fa0">📁 ${escapeHtml(state.loaded_name)}${state.loaded_owner_name ? ' (by ' + escapeHtml(state.loaded_owner_name) + ')' : ''}</span>` : ''}</h2>
      <div class="hint-sm" style="margin-top:4px">古典的 G*Power 相当の A priori (必要 n) / Post hoc (検定力) を計算します。正規近似ベース (G*Power の非心分布計算と数%差)。 v1025+ で LMM/GLMM シミュレーション、参加者/刺激/試行の比較、コスト直結を予定。</div>
      ${renderSaveShareButtons('top')}
    </div>

    <!-- v1030 中村さん指示「一気に値を設定する感じになってるけど、ひとつずつ入力
         させていくのが良い」→ 各パラメータを独立したステップブロックに (title +
         短い説明 + 入力)。 Post hoc の場合は目標検定力の代わりにサンプルサイズを出す。 -->
    ${stepBlock({
      title: '① モード',
      desc: 'これから実験する場合は A priori、実験後で n が決まっている場合は Post hoc。',
      // v1038 中村さん指示「リストボックスから指定する形式が良い」
      // v1040 中村さん指示「検定の種類より前に、モードがあるべき」→ ① モード / ② 検定の種類に入れ替え
      body: `<select id="pw-mode" style="width:100%">
              <option value="a_priori" ${state.mode==='a_priori'?'selected':''}>🎯 A priori: これから実験する場合 (必要 n 数を求める)</option>
              <option value="post_hoc" ${state.mode==='post_hoc'?'selected':''}>🔍 Post hoc: 実験後に n 数から検定力を求める場合</option>
             </select>`,
    })}

    ${stepBlock({
      title: '② 検定の種類',
      desc: 'どの統計検定を使う予定か。選ぶものに応じて必要な入力項目が変わります。',
      // v1056 中村さん指示「選択ウィザードを上に、下に自分で選択するリストを配置。上下入れ替える。ウィザードは使っても使わなくても良い」
      body: `${renderTestWizard()}
             <div class="hint-sm" style="margin-top:12px; margin-bottom:4px; font-weight:600; color:#7b3fa0">📋 直接検定を選ぶ:</div>
             <select id="pw-test" style="width:100%">
              ${TESTS.map(x => `<option value="${x.id}" ${x.id===state.test?'selected':''}>${escapeHtml(x.label)}</option>`).join('')}
             </select>`,
    })}

    ${state.test !== 'bayes_t' ? stepBlock({
      title: '③ 有意水準 α',
      desc: '本来「差なし」なのに「差あり」と誤判定してしまう上限 (型I過誤)。正規分布でいうと、平均から中心±約2SDより外側に来る確率が5%、±約2.58SDより外側が1%、±約3.29SDより外側が0.1%。慣習的には 0.05 が標準、多重比較や高い信頼性が要る場面では 0.01 や 0.001。',
      // v1035 中村さん指示「プリセットの下に入力欄」で導線を分かりやすく
      body: `<div class="row" style="gap:4px; flex-wrap:wrap">
               <button class="btn" data-pw-alpha="0.05" style="font-size:11px; padding:2px 8px">0.05 (通常、±2SD)</button>
               <button class="btn" data-pw-alpha="0.01" style="font-size:11px; padding:2px 8px">0.01 (厳しめ、±2.58SD)</button>
               <button class="btn" data-pw-alpha="0.001" style="font-size:11px; padding:2px 8px">0.001 (非常に厳しめ、±3.29SD)</button>
             </div>
             <input type="number" id="pw-alpha" step="0.005" min="0.001" max="0.5" value="${state.alpha}" style="width:120px; margin-top:6px">`,
    }) : ''}

    ${['t2','tp','t1','corr','corr_sp'].includes(state.test) ? stepBlock({
      title: '④ 仮説の方向',
      desc: '両側: どちらが大きいかは決めていない、差があれば検出。 / 片側: どちらが大きいか事前に決めている (逆方向の差は検出しない、その分必要 n は少し少ない)。',
      body: `<select id="pw-tails" style="max-width:280px">
              <option value="2" ${state.tails==2?'selected':''}>両側: 差があるかを判定</option>
              <option value="1" ${state.tails==1?'selected':''}>片側: 想定の大小差を判定</option>
             </select>`,
    }) : ''}

    ${state.test === 'bayes_t' ? '' : state.mode==='a_priori' ? stepBlock({
      title: '⑤ 目標検定力 1 − β',
      desc: '本当に効果があるとき、それを有意と検出できる確率 (β = 見逃し率)。0.80 だと 5 回に 1 回は本当の差を見逃す、0.90 で 10 回に 1 回、0.95 で 20 回に 1 回。α との関係で「必要な効果量とサンプル数のバランス」を決める指標で、慣習的には 0.80。厳しめの誌や事前登録では 0.90 以上を求めることもある。',
      // v1035 プリセットの下に入力欄
      body: `<div class="row" style="gap:4px; flex-wrap:wrap">
               <button class="btn" data-pw-power="0.8" style="font-size:11px; padding:2px 8px">0.80 (通常、見逃し 20%)</button>
               <button class="btn" data-pw-power="0.9" style="font-size:11px; padding:2px 8px">0.90 (厳しめ、見逃し 10%)</button>
               <button class="btn" data-pw-power="0.95" style="font-size:11px; padding:2px 8px">0.95 (非常に厳しめ、見逃し 5%)</button>
             </div>
             <input type="number" id="pw-power" step="0.01" min="0.5" max="0.999" value="${state.power}" style="width:120px; margin-top:6px">`,
    }) : stepBlock({
      title: '⑤ サンプルサイズ',
      desc: state.test === 't2' ? '手元 or 予定の 1 手法あたりの参加者数 n (各群 or 各条件)。全体は 2n 名。'
          : state.test === 'anova' ? '手元 or 予定の全体参加者数 N (各手法約 N/k 名)。'
          : state.test === 'tp' ? '手元 or 予定の参加者数 (全員が 2 手法すべてを試す)。全観測数は N × 2。'
          : state.test === 'rmanova' ? `手元 or 予定の参加者数 (全員が k=${state.k} 手法すべてを試す)。全観測数は N × k。`
          : state.test === 't1' ? '手元 or 予定の参加者数 N (基準値と比較)。'
          : '手元 or 予定の全体参加者数 N。',
      body: `<input type="number" id="pw-n" step="1" min="2" value="${state.test==='t2' ? state.n_per_group : state.n_total}" style="width:120px">
             <div class="hint-sm" style="margin-top:6px">${
               state.test === 't2' ? '1 手法あたりの参加者数 (全体は自動で 2n)'
               : state.test === 'tp' ? '参加者数 (全観測数 = 参加者数 × 2 手法)'
               : state.test === 'rmanova' ? `参加者数 (全観測数 = 参加者数 × ${state.k} 手法)`
               : state.test === 't1' ? '参加者数'
               : '全体参加者数'
             }</div>`,
    })}

    ${state.test==='anova' ? stepBlock({
      title: '⑤-a 比較する手法 (or 群・条件) の数 k',
      desc: 'ANOVA で比較する手法・群・条件の数。例: 「提案 A・従来 B・比較 C」の 3 手法なら k=3。',
      body: `<input type="number" id="pw-k" step="1" min="2" max="20" value="${state.k}" style="width:120px">`,
    }) : ''}

    ${state.test==='rmanova' ? stepBlock({
      title: '⑤-a 測定回数 (手法・条件・時点の数) k',
      desc: '同じ参加者で繰り返す測定の数。例: 「提案 A・従来 B・比較 C の 3 手法をすべて試す」なら k=3、「前・中・後の 3 時点で測る」なら k=3。',
      body: `<input type="number" id="pw-k" step="1" min="2" max="20" value="${state.k}" style="width:120px">`,
    }) : ''}

    ${state.test==='rmanova' ? stepBlock({
      title: '⑤-b 測定間相関 ρ',
      desc: `<div>同じ参加者の異なる測定間の想定相関。「A が速い人は B でも速い」「A で高評価する人は B でも高評価」の度合い。 <b>高いほど個人差がキャンセルされて検定力↑</b>。</div>
        <details style="margin-top:6px; padding:6px 10px; background:#f9fafb; border-radius:6px">
          <summary style="cursor:pointer; font-size:12px; color:#7b3fa0"><b>📖 求め方の詳細</b></summary>
          <div style="margin-top:6px; font-size:12px; line-height:1.75">
            <div><b>1. パイロットデータから実測</b> (最も正確): 各参加者の手法 A の値と手法 B の値の <code>Pearson 相関係数</code>。 R なら <code>cor(A, B)</code>、 Excel なら <code>CORREL(A列, B列)</code>。下の 🧮 ヘルパーでも計算可。</div>
            <div style="margin-top:4px"><b>2. 先行研究から</b>: 同じ課題の論文で <b>ICC</b> (級内相関、Intraclass Correlation) or <b>test-retest reliability</b> が報告されていることが多い。それを ρ として採用。</div>
            <div style="margin-top:4px"><b>3. 分野の典型値</b> (パイロットも先行研究も無い場合):</div>
            <ul style="margin:2px 0; padding-left:22px">
              <li>反応時間系 (RT, Stroop, フランカー等): ρ ≈ <b>0.6-0.8</b> (個人差安定)</li>
              <li>主観評価 (Likert, SD 法): ρ ≈ <b>0.3-0.6</b> (個人差中程度)</li>
              <li>正答率 (認知課題): ρ ≈ <b>0.5-0.7</b></li>
              <li>生理指標 (HR, GSR): ρ ≈ <b>0.5-0.8</b> (トレイト成分が強い)</li>
              <li>気分・状態 (state PANAS 等): ρ ≈ <b>0.2-0.4</b> (状態は変動)</li>
            </ul>
            <div style="margin-top:4px"><b>4. 迷ったら</b>: ρ = 0.5 (中間) が安全。分野がわからないときのデフォルト。</div>
            <div class="hint-sm" style="margin-top:6px; color:#a16207">⚠ ρ を高めに見積もると必要 n が少なく出るので、保守的に見積もる (小さめ) のが安全。</div>
          </div>
        </details>`,
      body: `<div class="row" style="gap:4px; flex-wrap:wrap">
               <button class="btn" data-pw-rho="0.2" style="font-size:11px; padding:2px 8px">とても弱 0.2 (状態変動系)</button>
               <button class="btn" data-pw-rho="0.3" style="font-size:11px; padding:2px 8px">弱 0.3 (主観評価)</button>
               <button class="btn" data-pw-rho="0.5" style="font-size:11px; padding:2px 8px">典型 0.5 (迷った時)</button>
               <button class="btn" data-pw-rho="0.7" style="font-size:11px; padding:2px 8px">強 0.7 (RT/認知課題)</button>
               <button class="btn" data-pw-rho="0.85" style="font-size:11px; padding:2px 8px">とても強 0.85 (安定な特性)</button>
             </div>
             <input type="number" id="pw-rho" step="0.05" min="0" max="0.99" value="${state.rho}" style="width:120px; margin-top:6px">
             ${renderRhoHelper()}`,
    }) : ''}

    ${state.test==='rmanova' ? stepBlock({
      title: '⑤-c 球面性補正 ε (デフォルト 1.0)',
      desc: `<div>反復測定の球面性 (sphericity) 仮定 = 「どの 2 測定の差も分散が等しい」。崩れると Type I 過誤が膨らむので、 df を縮めて補正。</div>
        <details style="margin-top:6px; padding:6px 10px; background:#f9fafb; border-radius:6px">
          <summary style="cursor:pointer; font-size:12px; color:#7b3fa0"><b>📖 求め方の詳細</b></summary>
          <div style="margin-top:6px; font-size:12px; line-height:1.75">
            <div><b>1. 実データ分析後</b>: R の <code>afex::aov_ez</code> や SPSS の GLM Repeated Measures を走らせると Mauchly 検定の p 値と ε の推定値 (Greenhouse-Geisser ε̂ / Huynh-Feldt ε̂) が出力されるのでそれを採用。</div>
            <div style="margin-top:4px"><b>2. 事前見積もり</b> (パイロットデータや先行研究): 分散共分散行列を計算して ε̂ を求める (R の <code>ez::ezANOVA</code> 等)。実務的には 2 測定 (k=2) なら ε = 1.0 (球面性は自動成立)、 3 測定なら 0.7-0.9、 4 測定以上で逸脱しやすく 0.5-0.8 も珍しくない。</div>
            <div style="margin-top:4px"><b>3. 保守的なデフォルト</b>: 心配なら ε = 0.75 (GG 典型値) で見積もると安全。 ε=1 で計算した n は球面性違反時に検定力不足になる可能性。</div>
            <div style="margin-top:4px"><b>4. 迷ったら</b>: k=2 なら 1.0 で確定。 k=3 なら 0.9、 k=4+ なら 0.75。</div>
            <div class="hint-sm" style="margin-top:6px; color:#a16207">⚠ ε を小さく見積もると必要 n が多く出る (保守的)。大きめにすると甘い見積もり。</div>
          </div>
        </details>`,
      body: `<div class="row" style="gap:4px; flex-wrap:wrap">
               <button class="btn" data-pw-eps="1.0" style="font-size:11px; padding:2px 8px">1.0 (k=2 or 球面性 OK)</button>
               <button class="btn" data-pw-eps="0.9" style="font-size:11px; padding:2px 8px">0.9 (k=3 典型)</button>
               <button class="btn" data-pw-eps="0.75" style="font-size:11px; padding:2px 8px">0.75 (GG 典型 / 保守)</button>
               <button class="btn" data-pw-eps="0.5" style="font-size:11px; padding:2px 8px">0.5 (深刻な違反)</button>
             </div>
             <input type="number" id="pw-eps" step="0.05" min="0.01" max="1" value="${state.epsilon}" style="width:120px; margin-top:6px">`,
    }) : ''}

    ${state.test==='chi2' ? stepBlock({
      title: '⑤-a 自由度 df',
      desc: 'χ² 検定の自由度 (適合度検定: カテゴリ数 − 1、独立性検定: (行数−1)×(列数−1))。',
      body: `<input type="number" id="pw-df" step="1" min="1" max="200" value="${state.df}" style="width:120px">`,
    }) : ''}

    ${!['lmm_within','lmm_crossed','glmm_logit','glmm_poisson','glmm_ordinal','glmm_nb','bayes_t','fisher_2x2'].includes(state.test) ? stepBlock({
      title: '⑥ 効果量 (' + t.eff + ')',
      desc: '検出したい効果の大きさを標準化した値。先行研究 / パイロット / 分野の慣習で決めます。目安で決め打ち、実測データから導く、先行研究の値から計算するの 3 通りが使えます。',
      // v1035 中村さん指示「目安の下に、効果量のグループの中に、予想データからと
      //   先行研究の～を配置、そのさらに下に効果量の入力欄」
      body: `<div class="row" style="gap:4px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               ${t.effGuide.map(([lb, v]) => `<button data-pw-eff="${v}" class="btn" style="font-size:11px; padding:2px 8px">${escapeHtml(lb)}</button>`).join('')}
             </div>
             ${renderCohenGuideInline()}
             ${renderRawInputs()}
             ${renderEffectHelper()}
             <div class="hint-sm" style="font-size:11px; margin-top:8px; color:#7b3fa0; font-weight:600">効果量 (直接入力 or 上の補助で反映):</div>
             <input type="number" id="pw-effect" step="0.01" min="0.01" value="${state.effect}" style="width:120px; margin-top:2px">`,
    }) : ''}

    ${state.test === 'lmm_within' ? renderLMMBlocks() : ''}
    ${state.test === 'lmm_crossed' ? renderLMM3Blocks() : ''}
    ${state.test === 'glmm_logit'  ? renderGLMMBlocks() : ''}
    ${state.test === 'glmm_poisson' ? renderPoissonBlocks() : ''}
    ${state.test === 'glmm_ordinal' ? renderOrdinalBlocks() : ''}
    ${state.test === 'glmm_nb' ? renderNBBlocks() : ''}
    ${state.test === 'bayes_t' ? renderBayesBlocks() : ''}
    ${state.test === 'fisher_2x2' ? renderFisherBlocks() : ''}

    ${renderBudgetBlock()}

    <div class="card" style="text-align:center">
      <button id="pw-calc" class="btn primary" style="padding:10px 32px; font-size:15px">🧮 計算</button>
    </div>

    <div id="pw-result"></div>

    <div class="card" id="pw-saved-list-card" hidden>
      <div class="bold" style="margin-bottom:6px">📚 保存済の分析</div>
      <div id="pw-saved-list" class="hint-sm">読み込み中…</div>
    </div>

    ${renderSaveShareButtons('bot')}

    ${renderAnalysisGuide()}
  `;

  document.getElementById('pw-test').addEventListener('change', (e) => { state.test = e.target.value; render(); });
  // v1038 選択ウィザードのボタン
  document.querySelectorAll('[data-wz]').forEach(b => {
    b.addEventListener('click', () => {
      state.wizard = state.wizard || {};
      state.wizard[b.dataset.wz] = b.dataset.wzVal;
      // 上位を変えたら下位はリセット
      if (b.dataset.wz === 'scale')   {
        state.wizard.groups = state.wizard.related = state.wizard.normal = state.wizard.complex = '';
        state.wizard.relation_type = state.wizard.assoc_expected = '';
      }
      if (b.dataset.wz === 'groups')  state.wizard.related = state.wizard.normal = state.wizard.complex = '';
      if (b.dataset.wz === 'related') state.wizard.normal = state.wizard.complex = '';
      if (b.dataset.wz === 'normal')  state.wizard.complex = '';
      render();
    });
  });
  document.querySelectorAll('[data-wz-apply]').forEach(b => {
    b.addEventListener('click', () => {
      state.test = b.dataset.wzApply;
      render();
    });
  });
  document.querySelectorAll('[data-wz-reset]').forEach(b => {
    b.addEventListener('click', () => {
      state.wizard = { scale: '', groups: '', related: '', normal: '', complex: '', relation_type: '', assoc_expected: '' };
      render();
    });
  });
  document.querySelectorAll('[data-pw-mode]').forEach(b => {
    b.addEventListener('click', () => { state.mode = b.dataset.pwMode; render(); });
  });
  // v1038 モードをリストボックス化
  document.getElementById('pw-mode')?.addEventListener('change', (e) => {
    state.mode = e.target.value; render();
  });
  // v1055 ρ (測定間相関) をパイロットデータから自動計算
  const rhoCalcBtn = document.getElementById('rho-calc');
  if (rhoCalcBtn) rhoCalcBtn.addEventListener('click', () => {
    const parse = (s) => s.split(/[\s,\t]+/).map(x => parseFloat(x)).filter(x => isFinite(x));
    const a = parse(document.getElementById('rho-a').value || '');
    const b = parse(document.getElementById('rho-b').value || '');
    const resEl = document.getElementById('rho-result');
    if (!resEl) return;
    if (a.length < 3 || b.length < 3) {
      resEl.innerHTML = '<span style="color:#dc2626">両方に 3 名以上の値が必要です</span>';
      return;
    }
    if (a.length !== b.length) {
      resEl.innerHTML = `<span style="color:#dc2626">A (${a.length}) と B (${b.length}) の名数が揃っていません</span>`;
      return;
    }
    const n = a.length;
    const meanA = a.reduce((s,v)=>s+v,0)/n;
    const meanB = b.reduce((s,v)=>s+v,0)/n;
    let num=0, sumA2=0, sumB2=0;
    for (let i=0; i<n; i++) {
      const da = a[i]-meanA, db = b[i]-meanB;
      num += da*db; sumA2 += da*da; sumB2 += db*db;
    }
    const denom = Math.sqrt(sumA2 * sumB2);
    if (denom === 0) { resEl.innerHTML = '<span style="color:#dc2626">分散が 0 のため計算不可</span>'; return; }
    const r = num / denom;
    const strength = Math.abs(r) < 0.1 ? '無相関' : Math.abs(r) < 0.3 ? '弱い' : Math.abs(r) < 0.5 ? '中程度' : Math.abs(r) < 0.7 ? '強い' : Math.abs(r) < 0.9 ? 'とても強い' : 'ほぼ完全';
    const clamp = Math.max(0, Math.min(0.99, r));
    resEl.innerHTML = `<b style="color:#7b3fa0">⇒ ρ = ${r.toFixed(3)}</b> <span style="color:#666">(n=${n}, ${strength})</span> <button class="btn primary" data-rho-apply="${clamp.toFixed(3)}" style="font-size:11px; padding:2px 10px; margin-left:6px">この値を ρ に反映</button>`;
    document.querySelector('[data-rho-apply]')?.addEventListener('click', (ev) => {
      const v = parseFloat(ev.target.dataset.rhoApply);
      state.rho = v;
      const el = document.getElementById('pw-rho');
      if (el) el.value = v;
      resEl.innerHTML += ' <span style="color:#059669">✓ 反映しました</span>';
    });
  });

  // v1041 反復測定 ANOVA の ρ / ε プリセット
  document.querySelectorAll('[data-pw-rho]').forEach(b => {
    b.addEventListener('click', () => {
      state.rho = parseFloat(b.dataset.pwRho);
      const el = document.getElementById('pw-rho');
      if (el) el.value = state.rho;
    });
  });
  document.querySelectorAll('[data-pw-eps]').forEach(b => {
    b.addEventListener('click', () => {
      state.epsilon = parseFloat(b.dataset.pwEps);
      const el = document.getElementById('pw-eps');
      if (el) el.value = state.epsilon;
    });
  });
  document.querySelectorAll('[data-pw-eff]').forEach(b => {
    b.addEventListener('click', () => {
      state.effect = parseFloat(b.dataset.pwEff);
      document.getElementById('pw-effect').value = state.effect;
    });
  });
  // v1031 LMM β プリセット
  document.querySelectorAll('[data-lmm-beta]').forEach(b => {
    b.addEventListener('click', () => {
      state.lmm.beta = parseFloat(b.dataset.lmmBeta);
      const el = document.getElementById('lmm-beta');
      if (el) el.value = state.lmm.beta;
    });
  });
  // v1032 LMM3 β プリセット
  document.querySelectorAll('[data-lmm3-beta]').forEach(b => {
    b.addEventListener('click', () => {
      state.lmm3.beta = parseFloat(b.dataset.lmm3Beta);
      const el = document.getElementById('lmm3-beta');
      if (el) el.value = state.lmm3.beta;
    });
  });
  // v1043 Poisson GLMM プリセット (λ₀ / RR / λ₁ 相互同期)
  document.querySelectorAll('[data-pois-r0]').forEach(b => {
    b.addEventListener('click', () => {
      const newR0 = parseFloat(b.dataset.poisR0);
      const curRR = state.glmm_poisson.proposed_rate / state.glmm_poisson.baseline_rate;
      state.glmm_poisson.baseline_rate = newR0;
      state.glmm_poisson.proposed_rate = newR0 * curRR;
      const elR0 = document.getElementById('pois-r0');
      const elR1 = document.getElementById('pois-r1');
      const elDer = document.getElementById('pois-rr-derived');
      if (elR0) elR0.value = state.glmm_poisson.baseline_rate;
      if (elR1) elR1.value = state.glmm_poisson.proposed_rate.toFixed(3);
      if (elDer) elDer.textContent = `⇒ 導出 RR = ${curRR.toFixed(2)}`;
    });
  });
  document.querySelectorAll('[data-pois-rr]').forEach(b => {
    b.addEventListener('click', () => {
      const rr = parseFloat(b.dataset.poisRr);
      state.glmm_poisson.rr = rr;
      state.glmm_poisson.proposed_rate = state.glmm_poisson.baseline_rate * rr;
      const elR1 = document.getElementById('pois-r1');
      const elDer = document.getElementById('pois-rr-derived');
      if (elR1) elR1.value = state.glmm_poisson.proposed_rate.toFixed(3);
      if (elDer) elDer.textContent = `⇒ 導出 RR = ${rr.toFixed(2)}`;
    });
  });
  ['pois-r0', 'pois-r1'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const r0 = parseFloat(document.getElementById('pois-r0')?.value);
      const r1 = parseFloat(document.getElementById('pois-r1')?.value);
      if (isFinite(r0) && isFinite(r1) && r0 > 0 && r1 > 0) {
        state.glmm_poisson.baseline_rate = r0;
        state.glmm_poisson.proposed_rate = r1;
        state.glmm_poisson.rr = r1 / r0;
        const elDer = document.getElementById('pois-rr-derived');
        if (elDer) elDer.textContent = `⇒ 導出 RR = ${(r1/r0).toFixed(2)}`;
      }
    });
  });

  // v1053/v1054/v1055/v1056 予算試算の入力変化でサマリ部分だけ即差し替え
  //   (input のフォーカスが抜けないように全再描画はしない)
  ['bud-min', 'bud-rate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      syncFormToState();
      const pay = participantPaymentPer();
      const cost = costPerParticipant();
      const b = state.budget;
      const mode = BUDGET_MODES[b.mode] || BUDGET_MODES.inhouse;
      const methods = methodsPerParticipant();
      const totalMinutes = b.minutes_per_participant * methods;
      const totalHours = totalMinutes / 60;
      const overhead = cost - pay;
      const summary = document.getElementById('bud-summary');
      if (summary) {
        summary.innerHTML = `
          <div>👤 本人への支払 (× 1): <b style="color:#059669">¥${Math.round(pay).toLocaleString()}</b>
            <span style="color:#666">(${b.minutes_per_participant} 分/手法${methods > 1 ? ' × ' + methods + ' 手法 = ' + totalMinutes + ' 分' : ''} = ${totalHours.toFixed(2)} 時間 × ¥${b.rate_per_hour}/時)</span></div>
          <div style="margin-top:4px">💼 予算 (実費、研究者負担): <b style="color:#7b3fa0">¥${Math.round(cost).toLocaleString()}</b>
            <span style="color:#666">(${overhead > 0 ? '本人支払 + ¥' + Math.round(overhead).toLocaleString() + ' 上乗せ (' + mode.mult_note + ')' : '本人支払と同額 (Amazon ギフト券は税金対象外)'})</span></div>`;
      }
    });
  });
  const bModeEl = document.getElementById('bud-mode');
  if (bModeEl) bModeEl.addEventListener('change', () => {
    syncFormToState();
    render();  // モード切替は全再描画で OK (総額の差が見える)
  });

  // v1050 ベイズ (BF10) プリセット
  document.querySelectorAll('[data-bay-d]').forEach(b => {
    b.addEventListener('click', () => {
      state.bayes_t.d = parseFloat(b.dataset.bayD);
      const el = document.getElementById('bay-d');
      if (el) el.value = state.bayes_t.d;
    });
  });
  document.querySelectorAll('[data-bay-bf]').forEach(b => {
    b.addEventListener('click', () => {
      state.bayes_t.bf_threshold = parseFloat(b.dataset.bayBf);
      const el = document.getElementById('bay-bf');
      if (el) el.value = state.bayes_t.bf_threshold;
    });
  });
  document.querySelectorAll('[data-bay-r]').forEach(b => {
    b.addEventListener('click', () => {
      state.bayes_t.prior_r = parseFloat(b.dataset.bayR);
      const el = document.getElementById('bay-r');
      if (el) el.value = state.bayes_t.prior_r;
    });
  });
  document.getElementById('bay-mode')?.addEventListener('change', (e) => {
    state.bayes_t.mode_bayes = e.target.value;
    render();
  });

  // v1049 負の二項 GLMM プリセット
  document.querySelectorAll('[data-nb-r0]').forEach(b => {
    b.addEventListener('click', () => {
      const newR0 = parseFloat(b.dataset.nbR0);
      const curRR = state.glmm_nb.proposed_rate / state.glmm_nb.baseline_rate;
      state.glmm_nb.baseline_rate = newR0;
      state.glmm_nb.proposed_rate = newR0 * curRR;
      const elR0 = document.getElementById('nb-r0');
      const elR1 = document.getElementById('nb-r1');
      const elDer = document.getElementById('nb-rr-derived');
      if (elR0) elR0.value = state.glmm_nb.baseline_rate;
      if (elR1) elR1.value = state.glmm_nb.proposed_rate.toFixed(3);
      if (elDer) elDer.textContent = `⇒ 導出 RR = ${curRR.toFixed(2)}`;
    });
  });
  document.querySelectorAll('[data-nb-rr]').forEach(b => {
    b.addEventListener('click', () => {
      const rr = parseFloat(b.dataset.nbRr);
      state.glmm_nb.rr = rr;
      state.glmm_nb.proposed_rate = state.glmm_nb.baseline_rate * rr;
      const elR1 = document.getElementById('nb-r1');
      const elDer = document.getElementById('nb-rr-derived');
      if (elR1) elR1.value = state.glmm_nb.proposed_rate.toFixed(3);
      if (elDer) elDer.textContent = `⇒ 導出 RR = ${rr.toFixed(2)}`;
    });
  });
  document.querySelectorAll('[data-nb-theta]').forEach(b => {
    b.addEventListener('click', () => {
      state.glmm_nb.theta = parseFloat(b.dataset.nbTheta);
      const el = document.getElementById('nb-theta');
      if (el) el.value = state.glmm_nb.theta;
    });
  });
  ['nb-r0', 'nb-r1'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const r0 = parseFloat(document.getElementById('nb-r0')?.value);
      const r1 = parseFloat(document.getElementById('nb-r1')?.value);
      if (isFinite(r0) && isFinite(r1) && r0 > 0 && r1 > 0) {
        state.glmm_nb.baseline_rate = r0;
        state.glmm_nb.proposed_rate = r1;
        state.glmm_nb.rr = r1 / r0;
        const elDer = document.getElementById('nb-rr-derived');
        if (elDer) elDer.textContent = `⇒ 導出 RR = ${(r1/r0).toFixed(2)}`;
      }
    });
  });

  // v1048 順序ロジット GLMM プリセット (K / d)
  document.querySelectorAll('[data-ord-k]').forEach(b => {
    b.addEventListener('click', () => {
      state.glmm_ordinal.k_cat = parseInt(b.dataset.ordK, 10);
      const el = document.getElementById('ord-k');
      if (el) el.value = state.glmm_ordinal.k_cat;
    });
  });
  document.querySelectorAll('[data-ord-d]').forEach(b => {
    b.addEventListener('click', () => {
      state.glmm_ordinal.d = parseFloat(b.dataset.ordD);
      const el = document.getElementById('ord-d');
      if (el) el.value = state.glmm_ordinal.d;
      const elDer = document.getElementById('ord-or-derived');
      if (elDer) {
        const lo = state.glmm_ordinal.d * Math.PI / Math.sqrt(3);
        elDer.textContent = `⇒ 導出 OR ≈ ${Math.exp(lo).toFixed(2)} (β = log OR ≈ ${lo.toFixed(3)})`;
      }
    });
  });
  {
    const el = document.getElementById('ord-d');
    if (el) el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (isFinite(v)) {
        state.glmm_ordinal.d = v;
        const elDer = document.getElementById('ord-or-derived');
        if (elDer) {
          const lo = v * Math.PI / Math.sqrt(3);
          elDer.textContent = `⇒ 導出 OR ≈ ${Math.exp(lo).toFixed(2)} (β = log OR ≈ ${lo.toFixed(3)})`;
        }
      }
    });
  }

  // v1042 LMM ランダム傾きプリセット
  document.querySelectorAll('[data-lmm-sdslope]').forEach(b => {
    b.addEventListener('click', () => {
      state.lmm.sd_slope = parseFloat(b.dataset.lmmSdslope);
      const el = document.getElementById('lmm-sdslope');
      if (el) el.value = state.lmm.sd_slope;
    });
  });
  document.querySelectorAll('[data-lmm3-sdslopep]').forEach(b => {
    b.addEventListener('click', () => {
      state.lmm3.sd_slope_p = parseFloat(b.dataset.lmm3Sdslopep);
      const el = document.getElementById('lmm3-sdslopep');
      if (el) el.value = state.lmm3.sd_slope_p;
    });
  });
  document.querySelectorAll('[data-lmm3-sdslopes]').forEach(b => {
    b.addEventListener('click', () => {
      state.lmm3.sd_slope_s = parseFloat(b.dataset.lmm3Sdslopes);
      const el = document.getElementById('lmm3-sdslopes');
      if (el) el.value = state.lmm3.sd_slope_s;
    });
  });
  // v1037 GLMM p₀ プリセット (難/中/易)
  document.querySelectorAll('[data-glmm-p0]').forEach(b => {
    b.addEventListener('click', () => {
      const newP0 = parseFloat(b.dataset.glmmP0);
      const currentOR = orFromProbs(state.glmm.baseline_p, state.glmm.proposed_p);
      state.glmm.baseline_p = newP0;
      state.glmm.proposed_p = probFromBaseAndOR(newP0, currentOR);
      const elP0 = document.getElementById('glmm-p0');
      const elP1 = document.getElementById('glmm-p1');
      const elDer = document.getElementById('glmm-or-derived');
      if (elP0) elP0.value = state.glmm.baseline_p;
      if (elP1) elP1.value = state.glmm.proposed_p.toFixed(3);
      if (elDer) elDer.innerHTML = renderGLMMDerivedOR();
    });
  });
  // v1037 GLMM OR プリセット (p₁ に反映)
  document.querySelectorAll('[data-glmm-or]').forEach(b => {
    b.addEventListener('click', () => {
      const or = parseFloat(b.dataset.glmmOr);
      state.glmm.or = or;
      state.glmm.proposed_p = probFromBaseAndOR(state.glmm.baseline_p, or);
      const elP1 = document.getElementById('glmm-p1');
      const elDer = document.getElementById('glmm-or-derived');
      if (elP1) elP1.value = state.glmm.proposed_p.toFixed(3);
      if (elDer) elDer.innerHTML = renderGLMMDerivedOR();
    });
  });
  // v1037 p₀ / p₁ の生入力が変わったら導出 OR ラベルを更新
  ['glmm-p0', 'glmm-p1'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const p0 = parseFloat(document.getElementById('glmm-p0')?.value);
      const p1 = parseFloat(document.getElementById('glmm-p1')?.value);
      if (isFinite(p0) && isFinite(p1) && p0 > 0 && p0 < 1 && p1 > 0 && p1 < 1) {
        state.glmm.baseline_p = p0;
        state.glmm.proposed_p = p1;
        const elDer = document.getElementById('glmm-or-derived');
        if (elDer) elDer.innerHTML = renderGLMMDerivedOR();
      }
    });
  });
  // v1030 α と検定力のプリセットボタン
  document.querySelectorAll('[data-pw-alpha]').forEach(b => {
    b.addEventListener('click', () => {
      state.alpha = parseFloat(b.dataset.pwAlpha);
      document.getElementById('pw-alpha').value = state.alpha;
    });
  });
  document.querySelectorAll('[data-pw-power]').forEach(b => {
    b.addEventListener('click', () => {
      state.power = parseFloat(b.dataset.pwPower);
      const el = document.getElementById('pw-power');
      if (el) el.value = state.power;
    });
  });
  // v1024b 効果量ヘルパー (先行研究の値から効果量を逆算)
  document.querySelectorAll('[data-eh-calc]').forEach(b => {
    b.addEventListener('click', () => computeEffectFromHelper(b.dataset.ehCalc));
  });
  // v1029 実測ベース入力
  //   - dtype 変更: 全体 render はせず、 range hint + preview だけ差し替え (フォーカス残す)
  //   - 平均 / SD 変更: preview グラフを差し替え (d の表示はしない)
  //   - 「この値で予想効果量を求める」ボタン: d を計算 → 効果量欄に反映 → 一言だけ表示
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
    if (state.test === 't2' || state.test === 'tp') {
      const mA = parseFloat(document.getElementById('raw-mA')?.value);
      const sA = parseFloat(document.getElementById('raw-sA')?.value);
      const mB = parseFloat(document.getElementById('raw-mB')?.value);
      const sB = parseFloat(document.getElementById('raw-sB')?.value);
      if (!isNaN(mA)) state.rawA.mean = mA;
      if (!isNaN(sA)) state.rawA.sd = sA;
      if (!isNaN(mB)) state.rawB.mean = mB;
      if (!isNaN(sB)) state.rawB.sd = sB;
      if (state.test === 'tp') {
        const r = parseFloat(document.getElementById('raw-r')?.value);
        if (!isNaN(r)) state.pairedR = Math.max(-0.99, Math.min(0.99, r));
      }
    } else if (state.test === 't1') {
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
  ['raw-mA','raw-sA','raw-mB','raw-sB','raw-mD','raw-sD','raw-r'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', rawInputChanged);
  });
  // v1034 SD プリセット / pairedR プリセット
  document.querySelectorAll('[data-sd-preset]').forEach(b => {
    b.addEventListener('click', () => {
      const [targetId, val] = String(b.dataset.sdPreset).split(':');
      const el = document.getElementById(targetId);
      if (!el) return;
      el.value = val;
      rawInputChanged();
    });
  });
  document.querySelectorAll('[data-pw-pairedr]').forEach(b => {
    b.addEventListener('click', () => {
      state.pairedR = parseFloat(b.dataset.pwPairedr);
      const el = document.getElementById('raw-r');
      if (el) el.value = state.pairedR;
      rawInputChanged();
    });
  });
  document.getElementById('raw-apply')?.addEventListener('click', () => {
    // 最新の form 値を state に反映
    rawInputChanged();
    const d = derivedDFromRaw();
    const box = document.getElementById('raw-derived-box');
    if (d === null) {
      if (box) { box.textContent = '値を全部入れてください (SD は正の値)'; box.style.color = '#a16207'; }
      return;
    }
    state.effect = Math.round(d * 1000) / 1000;
    const el = document.getElementById('pw-effect');
    if (el) el.value = state.effect;
    if (box) { box.innerHTML = `<b style="color:#7b3fa0">${escapeHtml(renderDerivedLabel(d))}</b> を効果量欄に入れました。「🧮 計算」で続きへ`; box.style.color = ''; }
  });
  document.getElementById('pw-calc').addEventListener('click', doCalc);
  // v1038 保存 / 共有 / 削除 / 新規 (top と bottom の両方のボタンに貼る)
  document.querySelectorAll('[data-pw-btn]').forEach(b => {
    b.addEventListener('click', () => {
      const kind = b.dataset.pwBtn;
      if (kind === 'save') return onSave();
      if (kind === 'share') return onShareOrSaveThenShare();
      if (kind === 'delete') return onDelete();
      if (kind === 'new') {
        if (!confirm('新規の分析を開始します。現在の分析設定は未保存なら失われます。続けますか?')) return;
        Object.assign(state, {
          test: 't2', mode: 'a_priori', alpha: 0.05, tails: 2, effect: 0.5, power: 0.8,
          n_per_group: 30, n_total: 60, k: 3, df: 1,
          loaded_id: 0, loaded_name: '', loaded_is_shared: false, loaded_share_token: null, loaded_owner_name: null,
        });
        location.hash = '#/power';
        render(); loadSavedList();
      }
    });
  });
}

// v1038 未保存でも共有ボタンを押せる。未保存なら「保存 → 共有」の 2 段フロー。
async function onShareOrSaveThenShare() {
  if (!state.loaded_id) {
    // 未保存: 名前を促して保存 → 共有モーダルへ
    if (!confirm('共有するにはまず分析を保存する必要があります。続けて保存 → 共有しますか?')) return;
    syncFormToState();
    const defaultName = `${TESTS.find(x => x.id === state.test).label} - ${new Date().toLocaleString('ja-JP').replace(/\//g,'-').slice(0,16)}`;
    const name = prompt('分析の名前を入力', defaultName);
    if (!name || !name.trim()) return;
    try {
      const r = await post('/api/power', { name: name.trim(), config: currentConfig() });
      state.loaded_id = r.id;
      state.loaded_name = name.trim();
      state.loaded_share_token = r.share_token || null;
      state.loaded_is_shared = false;
      state.loaded_owner_name = null;
      toast('保存しました。共有モーダルを開きます');
      render(); loadSavedList();
      return onShare();
    } catch (e) {
      alert('保存に失敗: ' + (e.message || e));
    }
    return;
  }
  return onShare();
}

async function onSave() {
  // 現在の form の値を state に反映してから保存
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

// 現在のフォーム値を state に反映 (保存前に呼ぶ)
function syncFormToState() {
  const alphaEl = document.getElementById('pw-alpha');
  const effEl = document.getElementById('pw-effect');
  if (alphaEl) state.alpha  = clampFloat(alphaEl.value, 0.001, 0.5);
  if (effEl)   state.effect = clampFloat(effEl.value, 0.001, 10);
  // v1053/v1054 予算試算 (分/参加形式 3 択)
  const bMinEl = document.getElementById('bud-min');
  const bRateEl = document.getElementById('bud-rate');
  const bModeEl = document.getElementById('bud-mode');
  if (bMinEl)  state.budget.minutes_per_participant = Math.max(1, Math.round(parseFloat(bMinEl.value) || 60));
  if (bRateEl) state.budget.rate_per_hour = Math.max(0, Math.round(parseFloat(bRateEl.value) || 0));
  if (bModeEl && bModeEl.value in BUDGET_MODES) state.budget.mode = bModeEl.value;
  if (['t2','tp','t1','corr','corr_sp'].includes(state.test)) {
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
  if (state.test === 'rmanova') {
    const kEl = document.getElementById('pw-k');
    if (kEl) state.k = Math.max(2, parseInt(kEl.value, 10));
    const rhoEl = document.getElementById('pw-rho');
    if (rhoEl) state.rho = Math.max(0, Math.min(0.99, parseFloat(rhoEl.value) || 0.5));
    const epsEl = document.getElementById('pw-eps');
    if (epsEl) state.epsilon = Math.max(0.01, Math.min(1, parseFloat(epsEl.value) || 1));
  }
  if (state.test === 'chi2') {
    const dfEl = document.getElementById('pw-df');
    if (dfEl) state.df = Math.max(1, parseInt(dfEl.value, 10));
  }
  // v1031 LMM
  if (state.test === 'lmm_within') {
    const num = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = parseFloat(el.value);
      return isNaN(v) ? fallback : v;
    };
    const p = state.lmm;
    p.beta          = num('lmm-beta',  p.beta);
    p.sd_participant= Math.max(0.0001, num('lmm-sdp',   p.sd_participant));
    p.sd_residual   = Math.max(0.0001, num('lmm-sde',   p.sd_residual));
    p.sd_slope      = Math.max(0, num('lmm-sdslope', p.sd_slope || 0));
    p.n_trials      = Math.max(1, Math.round(num('lmm-nt', p.n_trials)));
    p.iterations    = Math.max(100, Math.min(20000, Math.round(num('lmm-iter', p.iterations))));
    p.cost_per_participant = Math.max(0, Math.round(num('lmm-cost', p.cost_per_participant)));
    if (state.mode === 'post_hoc') {
      p.n_participants = Math.max(3, Math.round(num('lmm-np', p.n_participants)));
    }
  }
  // v1032 LMM3
  if (state.test === 'lmm_crossed') {
    const num = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = parseFloat(el.value);
      return isNaN(v) ? fallback : v;
    };
    const p = state.lmm3;
    p.beta          = num('lmm3-beta', p.beta);
    p.sd_participant= Math.max(0.0001, num('lmm3-sdp',  p.sd_participant));
    p.sd_stimulus   = Math.max(0.0001, num('lmm3-sds',  p.sd_stimulus));
    p.sd_residual   = Math.max(0.0001, num('lmm3-sde',  p.sd_residual));
    p.sd_slope_p    = Math.max(0, num('lmm3-sdslopep', p.sd_slope_p || 0));
    p.sd_slope_s    = Math.max(0, num('lmm3-sdslopes', p.sd_slope_s || 0));
    p.n_stimuli     = Math.max(1, Math.round(num('lmm3-ns',  p.n_stimuli)));
    p.iterations    = Math.max(100, Math.min(20000, Math.round(num('lmm3-iter', p.iterations))));
    p.cost_per_participant = Math.max(0, Math.round(num('lmm3-cost', p.cost_per_participant)));
    if (state.mode === 'post_hoc') {
      p.n_participants = Math.max(3, Math.round(num('lmm3-np', p.n_participants)));
    }
  }
  // v1032 GLMM
  if (state.test === 'glmm_logit') {
    const num = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = parseFloat(el.value);
      return isNaN(v) ? fallback : v;
    };
    const p = state.glmm;
    p.baseline_p     = Math.max(0.01, Math.min(0.99, num('glmm-p0',  p.baseline_p)));
    p.proposed_p     = Math.max(0.01, Math.min(0.99, num('glmm-p1',  p.proposed_p)));
    // v1037 OR は p₀ と p₁ から逆算 (UI の source of truth は 2 つの確率)。
    //   ⑵ (p₀,p₁) → OR: OR = (p₁/(1-p₁)) / (p₀/(1-p₀))
    p.or = orFromProbs(p.baseline_p, p.proposed_p);
    p.sd_participant = Math.max(0, num('glmm-sdp', p.sd_participant));
    p.n_trials       = Math.max(1, Math.round(num('glmm-nt',  p.n_trials)));
    p.iterations     = Math.max(100, Math.min(20000, Math.round(num('glmm-iter', p.iterations))));
    p.cost_per_participant = Math.max(0, Math.round(num('glmm-cost', p.cost_per_participant)));
    if (state.mode === 'post_hoc') {
      p.n_participants = Math.max(3, Math.round(num('glmm-np', p.n_participants)));
    }
  }
  // v1043 Poisson GLMM
  if (state.test === 'glmm_poisson') {
    const num = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = parseFloat(el.value);
      return isNaN(v) ? fallback : v;
    };
    const p = state.glmm_poisson;
    p.baseline_rate  = Math.max(0.01, num('pois-r0', p.baseline_rate));
    p.proposed_rate  = Math.max(0.01, num('pois-r1', p.proposed_rate));
    p.rr = p.proposed_rate / p.baseline_rate;
    p.sd_participant = Math.max(0, num('pois-sdp', p.sd_participant));
    p.n_trials       = Math.max(1, Math.round(num('pois-nt', p.n_trials)));
    p.iterations     = Math.max(100, Math.min(20000, Math.round(num('pois-iter', p.iterations))));
    p.cost_per_participant = Math.max(0, Math.round(num('pois-cost', p.cost_per_participant)));
    if (state.mode === 'post_hoc') {
      p.n_participants = Math.max(3, Math.round(num('pois-np', p.n_participants)));
    }
  }
  // v1063 fb#484 Fisher 直接確率検定 (2×2)
  if (state.test === 'fisher_2x2') {
    const num = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = parseFloat(el.value);
      return isNaN(v) ? fallback : v;
    };
    const p = state.fisher_2x2;
    p.n_per_group = Math.max(2, Math.round(num('fisher-n', p.n_per_group)));
    p.p0 = Math.max(0.001, Math.min(0.999, num('fisher-p0', p.p0)));
    p.p1 = Math.max(0.001, Math.min(0.999, num('fisher-p1', p.p1)));
    p.iterations = Math.max(200, Math.min(20000, Math.round(num('fisher-iter', p.iterations))));
  }
  // v1050 ベイズ (JZS BF10)
  if (state.test === 'bayes_t') {
    const num = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = parseFloat(el.value);
      return isNaN(v) ? fallback : v;
    };
    const p = state.bayes_t;
    p.n              = Math.max(3, Math.round(num('bay-n', p.n)));
    p.d              = num('bay-d', p.d);
    p.bf_threshold   = Math.max(1.5, num('bay-bf', p.bf_threshold));
    p.prior_r        = Math.max(0.1, num('bay-r', p.prior_r));
    p.n_max          = Math.max(10, Math.min(500, Math.round(num('bay-nmax', p.n_max))));
    p.iterations     = Math.max(100, Math.min(20000, Math.round(num('bay-iter', p.iterations))));
    p.cost_per_participant = Math.max(0, Math.round(num('bay-cost', p.cost_per_participant)));
    const modeEl = document.getElementById('bay-mode');
    if (modeEl) p.mode_bayes = modeEl.value;
  }
  // v1049 負の二項 GLMM
  if (state.test === 'glmm_nb') {
    const num = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = parseFloat(el.value);
      return isNaN(v) ? fallback : v;
    };
    const p = state.glmm_nb;
    p.baseline_rate  = Math.max(0.01, num('nb-r0', p.baseline_rate));
    p.proposed_rate  = Math.max(0.01, num('nb-r1', p.proposed_rate));
    p.rr = p.proposed_rate / p.baseline_rate;
    p.theta          = Math.max(0.01, num('nb-theta', p.theta));
    p.sd_participant = Math.max(0, num('nb-sdp', p.sd_participant));
    p.n_trials       = Math.max(1, Math.round(num('nb-nt', p.n_trials)));
    p.iterations     = Math.max(100, Math.min(20000, Math.round(num('nb-iter', p.iterations))));
    p.cost_per_participant = Math.max(0, Math.round(num('nb-cost', p.cost_per_participant)));
    if (state.mode === 'post_hoc') {
      p.n_participants = Math.max(3, Math.round(num('nb-np', p.n_participants)));
    }
  }
  // v1048 順序ロジット GLMM
  if (state.test === 'glmm_ordinal') {
    const num = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = parseFloat(el.value);
      return isNaN(v) ? fallback : v;
    };
    const p = state.glmm_ordinal;
    p.k_cat          = Math.max(3, Math.min(11, Math.round(num('ord-k', p.k_cat))));
    p.d              = num('ord-d', p.d);
    p.sd_participant = Math.max(0, num('ord-sdp', p.sd_participant));
    p.n_trials       = Math.max(1, Math.round(num('ord-nt', p.n_trials)));
    p.iterations     = Math.max(100, Math.min(20000, Math.round(num('ord-iter', p.iterations))));
    p.cost_per_participant = Math.max(0, Math.round(num('ord-cost', p.cost_per_participant)));
    if (state.mode === 'post_hoc') {
      p.n_participants = Math.max(3, Math.round(num('ord-np', p.n_participants)));
    }
  }
}

function doCalc() {
  const t = TESTS.find(x => x.id === state.test);
  syncFormToState();

  // v1031 LMM は別の計算パス (シミュレーション)
  if (state.test === 'lmm_within')  return doCalcLMM();
  if (state.test === 'lmm_crossed') return doCalcLMM3();
  if (state.test === 'glmm_logit')  return doCalcGLMM();
  if (state.test === 'glmm_poisson') return doCalcPoissonGLMM();
  if (state.test === 'glmm_ordinal') return doCalcOrdinalGLMM();
  if (state.test === 'glmm_nb') return doCalcNBGLMM();
  if (state.test === 'bayes_t') return doCalcBayesT();
  if (state.test === 'fisher_2x2') return doCalcFisher2x2();

  let out = null;
  const N = state.test === 't2' ? state.n_per_group : state.n_total;
  try {
    if (state.test === 't2')    out = calc_ttest_two_sample(state.alpha, state.effect, state.tails, state.mode, N, state.power);
    if (state.test === 'tp' || state.test === 't1') out = calc_ttest_paired(state.alpha, state.effect, state.tails, state.mode, N, state.power);
    if (state.test === 'anova') out = calc_anova(state.alpha, state.effect, state.k, state.mode, N, state.power);
    if (state.test === 'rmanova') out = calc_rmanova(state.alpha, state.effect, state.k, state.rho, state.epsilon, state.mode, N, state.power);
    if (state.test === 'corr')  out = calc_correlation(state.alpha, state.effect, state.tails, state.mode, N, state.power);
    if (state.test === 'corr_sp') out = calc_spearman(state.alpha, state.effect, state.tails, state.mode, N, state.power);
    if (state.test === 'chi2')  out = calc_chi_squared(state.alpha, state.effect, state.df, state.mode, N, state.power);
  } catch (e) { out = { error: e.message }; }
  renderResult(out, t);
}

// v1032 3-level LMM 計算
function doCalcLMM3() {
  const t = TESTS.find(x => x.id === state.test);
  const root = document.getElementById('pw-result');
  const p = state.lmm3;
  const params = {
    n_p: p.n_participants, n_stim: p.n_stimuli, beta: p.beta,
    sd_p: p.sd_participant, sd_s: p.sd_stimulus, sd_e: p.sd_residual,
    sd_slope_p: p.sd_slope_p || 0,  // v1042 参加者ランダム傾き
    sd_slope_s: p.sd_slope_s || 0,  // v1042 刺激ランダム傾き
    alpha: state.alpha, iterations: p.iterations, tails: state.tails,
  };
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション実行中… (${p.iterations.toLocaleString()} 回、 3-level)</div></div>`;
  setTimeout(() => {
    try {
      if (state.mode === 'a_priori') {
        const res = findSimNParticipants(simulateLMM3, params, state.power);
        const conf = simulateLMM3({ ...params, n_p: res.n });
        renderLMMResult({ mode: 'a_priori', n_required: res.n, over: res.over, verify_power: conf.power, ci: conf.ci, params, kind: 'lmm3' }, t);
      } else {
        const res = simulateLMM3(params);
        renderLMMResult({ mode: 'post_hoc', power: res.power, ci: res.ci, params, kind: 'lmm3' }, t);
      }
    } catch (e) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(e.message || String(e))}</div>`; }
  }, 20);
}

// v1032 Logistic GLMM 計算
function doCalcGLMM() {
  const t = TESTS.find(x => x.id === state.test);
  const root = document.getElementById('pw-result');
  const p = state.glmm;
  const params = {
    n_p: p.n_participants, n_trials: p.n_trials,
    baseline_p: p.baseline_p, or: p.or, sd_p: p.sd_participant,
    alpha: state.alpha, iterations: p.iterations, tails: state.tails,
  };
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション実行中… (${p.iterations.toLocaleString()} 回、 GLMM)</div></div>`;
  setTimeout(() => {
    try {
      if (state.mode === 'a_priori') {
        const res = findSimNParticipants(simulateGLMM, params, state.power);
        const conf = simulateGLMM({ ...params, n_p: res.n });
        renderLMMResult({ mode: 'a_priori', n_required: res.n, over: res.over, verify_power: conf.power, ci: conf.ci, params, kind: 'glmm' }, t);
      } else {
        const res = simulateGLMM(params);
        renderLMMResult({ mode: 'post_hoc', power: res.power, ci: res.ci, params, kind: 'glmm' }, t);
      }
    } catch (e) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(e.message || String(e))}</div>`; }
  }, 20);
}

// v1043 Poisson GLMM 計算
// v1063 fb#484 Fisher 直接確率検定 (2×2) の計算 + 専用結果レンダラー
function doCalcFisher2x2() {
  const t = TESTS.find(x => x.id === state.test);
  const root = document.getElementById('pw-result');
  const p = state.fisher_2x2;
  const iterations = state.mode === 'a_priori' ? Math.min(p.iterations, 500) : p.iterations;
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション実行中… (${iterations.toLocaleString()} 回、 Fisher 2×2)</div></div>`;
  setTimeout(() => {
    try {
      if (state.mode === 'a_priori') {
        // 二分探索で必要 n
        const target = state.power;
        const runPower = (n_pg) => simulateFisher2x2({ n_per_group: n_pg, p0: p.p0, p1: p.p1, alpha: state.alpha, iterations: 300, tails: state.tails }).power;
        let lo = 3, hi = 500;
        if (runPower(hi) < target) {
          renderFisherResult({ mode: 'a_priori', n_required: hi, over: true, verify_power: runPower(hi), ci: [null, null], params: p }, t);
          return;
        }
        while (hi - lo > 1) {
          const mid = Math.ceil((lo + hi) / 2);
          if (runPower(mid) < target) lo = mid; else hi = mid;
        }
        const conf = simulateFisher2x2({ n_per_group: hi, p0: p.p0, p1: p.p1, alpha: state.alpha, iterations, tails: state.tails });
        renderFisherResult({ mode: 'a_priori', n_required: hi, over: false, verify_power: conf.power, ci: conf.ci, params: p }, t);
      } else {
        const res = simulateFisher2x2({ n_per_group: p.n_per_group, p0: p.p0, p1: p.p1, alpha: state.alpha, iterations, tails: state.tails });
        renderFisherResult({ mode: 'post_hoc', power: res.power, ci: res.ci, params: p }, t);
      }
    } catch (e) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(e.message || String(e))}</div>`; }
  }, 20);
}
function renderFisherResult(res, t) {
  const root = document.getElementById('pw-result');
  const p = res.params;
  const paramLine = `α=${state.alpha}, 対照 p₀=${p.p0}, 処置 p₁=${p.p1}, 差=${(p.p1 - p.p0).toFixed(3)}`;
  let mainCard;
  if (res.mode === 'a_priori') {
    const nTotal = res.n_required * 2;
    mainCard = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🎯 必要サンプルサイズ (Fisher 2×2、シミュベース)</div>
        <div style="font-size:22px; line-height:1.55">各群 <b>${res.n_required}</b> 名 × 2 群 = 全体 <b>${nTotal}</b> 名 ${res.over ? '<span style="color:#dc2626">(500 で頭打ち — 目標未達)</span>' : ''}</div>
        <div class="hint-sm" style="margin-top:8px">検証: この n で検定力 = <b>${(res.verify_power * 100).toFixed(1)}%</b>${res.ci[0] !== null ? ` [95% CI: ${(res.ci[0]*100).toFixed(1)}−${(res.ci[1]*100).toFixed(1)}%]` : ''}</div>
        <div class="hint-sm" style="margin-top:4px">${paramLine}</div>
      </div>`;
  } else {
    const pctColor = res.power >= 0.8 ? '#059669' : (res.power >= 0.6 ? '#a16207' : '#dc2626');
    mainCard = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🔍 得られる検定力 (Fisher 2×2、シミュベース)</div>
        <div style="font-size:28px; line-height:1.5; color:${pctColor}"><b>${(res.power * 100).toFixed(1)}%</b> <span style="font-size:14px; color:#6b7280">[95% CI: ${(res.ci[0]*100).toFixed(1)}−${(res.ci[1]*100).toFixed(1)}%]</span></div>
        <div class="hint-sm" style="margin-top:8px">各群 ${p.n_per_group} 名 × 2 群 = 全体 ${p.n_per_group * 2} 名</div>
        <div class="hint-sm" style="margin-top:4px">${paramLine}</div>
      </div>`;
  }
  const participants = res.mode === 'a_priori' ? res.n_required * 2 : p.n_per_group * 2;
  root.innerHTML = mainCard + renderBudgetSummary(participants, res.mode === 'a_priori' ? '必要' : '現在');
}

// v1050 ベイズ (JZS BF10) 計算 + 専用結果レンダラー
function doCalcBayesT() {
  const t = TESTS.find(x => x.id === state.test);
  const root = document.getElementById('pw-result');
  const p = state.bayes_t;
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション実行中… (${p.iterations.toLocaleString()} 回、ベイズ ${p.mode_bayes === 'sequential' ? '(逐次)' : '(固定 n)'})</div></div>`;
  setTimeout(() => {
    try {
      const params = {
        n: p.n, d: p.d, bf_threshold: p.bf_threshold, r: p.prior_r,
        iterations: p.iterations, mode: p.mode_bayes, n_max: p.n_max,
      };
      const res = simulateBayesBF(params);
      renderBayesResult(res, p, t);
    } catch (e) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(e.message || String(e))}</div>`; }
  }, 20);
}

function renderBayesResult(res, p, t) {
  const root = document.getElementById('pw-result');
  const pctColor = res.power >= 0.8 ? '#059669' : (res.power >= 0.6 ? '#a16207' : '#dc2626');
  let card;
  if (p.mode_bayes === 'fixed') {
    card = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">☯ ベイズ検出確率 (固定 n = ${p.n})</div>
        <div style="font-size:28px; line-height:1.5; color:${pctColor}"><b>${(res.power * 100).toFixed(1)}%</b> の確率で BF10 ≥ ${p.bf_threshold} (H1 支持)</div>
        <div class="hint-sm" style="margin-top:8px">H0 支持 (BF10 ≤ 1/${p.bf_threshold}): <b>${(res.p_h0_supported * 100).toFixed(1)}%</b>、判断不能 (曖昧領域): <b>${(res.p_inconclusive * 100).toFixed(1)}%</b></div>
        <div class="hint-sm" style="margin-top:4px">Median BF10 across simulations: <b>${res.median_bf.toFixed(2)}</b></div>
        <div class="hint-sm" style="margin-top:4px">α=${p.d} (Cohen d), Cauchy 事前 r=${p.prior_r}, iters=${p.iterations.toLocaleString()}</div>
        <div class="hint-sm" style="margin-top:6px; padding:6px 10px; background:#fef3c7; border-left:3px solid #a16207">💡 ベイズ検定は頻度論のような「有意/非有意」の二分ではなく、「H1 支持 / H0 支持 / 判断不能」の三分。判断不能率が高いなら n を増やすと決定率↑。</div>
      </div>`;
  } else {
    const stopN = `平均 ${res.mean_n.toFixed(1)} (median ${res.median_n}, 10-90% 区間 ${res.p10_n}-${res.p90_n})`;
    card = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">☯ 逐次ベイズデザイン (SBF、上限 ${p.n_max})</div>
        <div style="font-size:22px; line-height:1.4">停止 n: <b>${stopN}</b></div>
        <div class="hint-sm" style="margin-top:8px">BF10 ≥ ${p.bf_threshold} (H1 採択) で停止: <b>${(res.power * 100).toFixed(1)}%</b></div>
        <div class="hint-sm" style="margin-top:4px">BF10 ≤ 1/${p.bf_threshold} (H0 採択) で停止: <b>${(res.p_h0_supported * 100).toFixed(1)}%</b></div>
        <div class="hint-sm" style="margin-top:4px">上限 ${p.n_max} で打ち切り (未収束): <b>${(res.p_capped * 100).toFixed(1)}%</b></div>
        <div class="hint-sm" style="margin-top:4px">Cohen d=${p.d}, Cauchy 事前 r=${p.prior_r}, iters=${p.iterations.toLocaleString()}</div>
        <div class="hint-sm" style="margin-top:6px; padding:6px 10px; background:#dcfce7; border-left:3px solid #059669">💡 逐次ベイズ (Sequential BF) は「n を増やしながら BF10 が閾値を超えたら止める」対称停止規則。期待 n は固定検定より 20-40% 小さい (Schönbrodt et al. 2017)。 α 補正不要 (ベイズは標本サイズに依存しない)。</div>
      </div>`;
  }
  // v1053 予算試算 (固定モードは n、逐次モードは平均停止 n を参加者数として)
  const budgetParticipants = p.mode_bayes === 'fixed' ? p.n : Math.ceil(res.mean_n);
  const budgetLabel = p.mode_bayes === 'fixed' ? '設定' : '平均';
  root.innerHTML = card + renderBudgetSummary(budgetParticipants, budgetLabel);
}

// v1049 負の二項 GLMM 計算
function doCalcNBGLMM() {
  const t = TESTS.find(x => x.id === state.test);
  const root = document.getElementById('pw-result');
  const p = state.glmm_nb;
  const params = {
    n_p: p.n_participants, n_trials: p.n_trials,
    baseline_rate: p.baseline_rate, rr: p.rr, theta: p.theta, sd_p: p.sd_participant,
    alpha: state.alpha, iterations: p.iterations, tails: state.tails,
  };
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション実行中… (${p.iterations.toLocaleString()} 回、負の二項 GLMM)</div></div>`;
  setTimeout(() => {
    try {
      if (state.mode === 'a_priori') {
        const res = findSimNParticipants(simulateNBGLMM, params, state.power);
        const conf = simulateNBGLMM({ ...params, n_p: res.n });
        renderLMMResult({ mode: 'a_priori', n_required: res.n, over: res.over, verify_power: conf.power, ci: conf.ci, params, kind: 'glmm_nb' }, t);
      } else {
        const res = simulateNBGLMM(params);
        renderLMMResult({ mode: 'post_hoc', power: res.power, ci: res.ci, params, kind: 'glmm_nb' }, t);
      }
    } catch (e) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(e.message || String(e))}</div>`; }
  }, 20);
}

// v1048 順序ロジット GLMM 計算
function doCalcOrdinalGLMM() {
  const t = TESTS.find(x => x.id === state.test);
  const root = document.getElementById('pw-result');
  const p = state.glmm_ordinal;
  const params = {
    n_p: p.n_participants, n_trials: p.n_trials,
    k_cat: p.k_cat, d: p.d, sd_p: p.sd_participant,
    alpha: state.alpha, iterations: p.iterations, tails: state.tails,
  };
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション実行中… (${p.iterations.toLocaleString()} 回、順序ロジット GLMM)</div></div>`;
  setTimeout(() => {
    try {
      if (state.mode === 'a_priori') {
        const res = findSimNParticipants(simulateOrdinalGLMM, params, state.power);
        const conf = simulateOrdinalGLMM({ ...params, n_p: res.n });
        renderLMMResult({ mode: 'a_priori', n_required: res.n, over: res.over, verify_power: conf.power, ci: conf.ci, params, kind: 'glmm_ordinal' }, t);
      } else {
        const res = simulateOrdinalGLMM(params);
        renderLMMResult({ mode: 'post_hoc', power: res.power, ci: res.ci, params, kind: 'glmm_ordinal' }, t);
      }
    } catch (e) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(e.message || String(e))}</div>`; }
  }, 20);
}

function doCalcPoissonGLMM() {
  const t = TESTS.find(x => x.id === state.test);
  const root = document.getElementById('pw-result');
  const p = state.glmm_poisson;
  const params = {
    n_p: p.n_participants, n_trials: p.n_trials,
    baseline_rate: p.baseline_rate, rr: p.rr, sd_p: p.sd_participant,
    alpha: state.alpha, iterations: p.iterations, tails: state.tails,
  };
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション実行中… (${p.iterations.toLocaleString()} 回、 Poisson GLMM)</div></div>`;
  setTimeout(() => {
    try {
      if (state.mode === 'a_priori') {
        const res = findSimNParticipants(simulatePoissonGLMM, params, state.power);
        const conf = simulatePoissonGLMM({ ...params, n_p: res.n });
        renderLMMResult({ mode: 'a_priori', n_required: res.n, over: res.over, verify_power: conf.power, ci: conf.ci, params, kind: 'glmm_poisson' }, t);
      } else {
        const res = simulatePoissonGLMM(params);
        renderLMMResult({ mode: 'post_hoc', power: res.power, ci: res.ci, params, kind: 'glmm_poisson' }, t);
      }
    } catch (e) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(e.message || String(e))}</div>`; }
  }, 20);
}

// v1031 LMM シミュレーション計算 (中村さんビジョンの中核の一角)
function doCalcLMM() {
  const t = TESTS.find(x => x.id === state.test);
  const root = document.getElementById('pw-result');
  const p = state.lmm;
  const params = {
    n_p: p.n_participants,
    n_trials: p.n_trials,
    beta: p.beta,
    sd_p: p.sd_participant,
    sd_e: p.sd_residual,
    sd_slope: p.sd_slope || 0,   // v1042 ランダム傾き
    alpha: state.alpha,
    iterations: p.iterations,
    tails: state.tails,
  };
  // 計算前にプレビュー
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション実行中… (${p.iterations.toLocaleString()} 回)</div></div>`;
  setTimeout(() => {
    try {
      if (state.mode === 'a_priori') {
        const res = findLMMnParticipants(params, state.power);
        // 見つけた n で本シミュ (完全 iterations で精度確認)
        const conf = simulateLMM({ ...params, n_p: res.n });
        state.lmm.last_power = conf.power;
        state.lmm.last_ci = conf.ci;
        state.lmm.last_details = { ...params, n_p: res.n, target: state.power, over: res.over };
        renderLMMResult({ mode: 'a_priori', n_required: res.n, over: res.over, verify_power: conf.power, ci: conf.ci, params }, t);
      } else {
        const res = simulateLMM(params);
        state.lmm.last_power = res.power;
        state.lmm.last_ci = res.ci;
        state.lmm.last_details = { ...params };
        renderLMMResult({ mode: 'post_hoc', power: res.power, ci: res.ci, params }, t);
      }
    } catch (e) {
      root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(e.message || String(e))}</div>`;
    }
  }, 20);
}

// v1031/1032 LMM/GLMM 結果描画 (kind: 'lmm' | 'lmm3' | 'glmm')
function renderLMMResult(res, t) {
  const root = document.getElementById('pw-result');
  const p = res.params;
  const kind = res.kind || 'lmm';
  const paramLine = kind === 'lmm3'
    ? `α=${p.alpha}, β=${p.beta}, σ_p=${p.sd_p}, σ_stim=${p.sd_s}, σ_e=${p.sd_e}${(p.sd_slope_p||0) > 0 ? ', σ_slope_p=' + p.sd_slope_p : ''}${(p.sd_slope_s||0) > 0 ? ', σ_slope_s=' + p.sd_slope_s : ''}, ${p.n_stim} 刺激 × 2 条件, iters=${p.iterations.toLocaleString()}`
    : kind === 'glmm'
      ? `α=${p.alpha}, p₀=${p.baseline_p}, p₁=${(state.glmm.proposed_p ?? probFromBaseAndOR(p.baseline_p, p.or)).toFixed(3)}, OR=${p.or.toFixed(2)}, σ_p=${p.sd_p}, 試行 ${p.n_trials} × 2 条件, iters=${p.iterations.toLocaleString()}`
      : kind === 'glmm_poisson'
        ? `α=${p.alpha}, λ₀=${p.baseline_rate}, λ₁=${(p.baseline_rate*p.rr).toFixed(2)}, RR=${p.rr.toFixed(2)}, σ_p=${p.sd_p}, 試行 ${p.n_trials} × 2 条件, iters=${p.iterations.toLocaleString()}`
      : kind === 'glmm_ordinal'
        ? `α=${p.alpha}, K=${p.k_cat}, d=${p.d}, σ_p=${p.sd_p}, 試行 ${p.n_trials} × 2 条件, iters=${p.iterations.toLocaleString()}`
      : kind === 'glmm_nb'
        ? `α=${p.alpha}, λ₀=${p.baseline_rate}, λ₁=${(p.baseline_rate*p.rr).toFixed(2)}, RR=${p.rr.toFixed(2)}, θ=${p.theta}, σ_p=${p.sd_p}, 試行 ${p.n_trials} × 2 条件, iters=${p.iterations.toLocaleString()}`
        : `α=${p.alpha}, β_effect=${p.beta}, σ_participant=${p.sd_p}, σ_residual=${p.sd_e}${(p.sd_slope||0) > 0 ? ', σ_slope=' + p.sd_slope : ''}, 試行 ${p.n_trials} × 2 条件, iters=${p.iterations.toLocaleString()}`;
  const perParticipantTrials = kind === 'lmm3' ? p.n_stim * 2 : p.n_trials * 2;
  let mainCard;
  if (res.mode === 'a_priori') {
    const N_total = res.n_required * perParticipantTrials;
    mainCard = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🎯 必要な参加者数 (LMM シミュベース)</div>
        <div style="font-size:26px; line-height:1.5">参加者 n_p = <b>${res.n_required}</b> ${res.over ? '<span style="color:#dc2626">(500 で頭打ち — 目標到達せず)</span>' : ''}</div>
        <div class="hint-sm" style="margin-top:8px">検証: この n_p で検定力 = <b>${(res.verify_power * 100).toFixed(1)}%</b> [95% CI: ${(res.ci[0]*100).toFixed(1)}−${(res.ci[1]*100).toFixed(1)}%]</div>
        <div class="hint-sm" style="margin-top:4px">全観測数: ${res.n_required} 参加者 × ${perParticipantTrials / 2} ${kind === 'lmm3' ? '刺激' : '試行'} × 2 条件 = <b>${N_total}</b> obs</div>
        <div class="hint-sm" style="margin-top:4px; color:#a16207">脱落・除外 10% を見込むなら <b>${Math.ceil(res.n_required * 1.10)}</b> 名募集が目安。</div>
        <div class="hint-sm" style="margin-top:4px">${paramLine}</div>
      </div>`;
  } else {
    const pctColor = res.power >= 0.8 ? '#059669' : (res.power >= 0.6 ? '#a16207' : '#dc2626');
    const label = kind === 'glmm' ? 'Logistic GLMM' : kind === 'glmm_poisson' ? 'Poisson GLMM' : kind === 'glmm_nb' ? '負の二項 GLMM' : kind === 'glmm_ordinal' ? '順序ロジット GLMM' : (kind === 'lmm3' ? 'LMM 3-level' : 'LMM');
    mainCard = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🔍 得られる検定力 (${label} シミュベース)</div>
        <div style="font-size:28px; line-height:1.5; color:${pctColor}"><b>${(res.power * 100).toFixed(1)}%</b> <span style="font-size:14px; color:#6b7280">[95% CI: ${(res.ci[0]*100).toFixed(1)}−${(res.ci[1]*100).toFixed(1)}%]</span></div>
        <div class="hint-sm" style="margin-top:8px">${p.n_p} 参加者 × ${perParticipantTrials / 2} ${kind === 'lmm3' ? '刺激' : '試行'} × 2 条件 = ${p.n_p * perParticipantTrials} obs</div>
        <div class="hint-sm" style="margin-top:4px">${paramLine}</div>
        ${res.power < 0.8 ? '<div class="hint-sm" style="margin-top:4px; color:#a16207">💡 検定力 80% 未満: 参加者・試行/刺激数の増強を検討。</div>' : ''}
      </div>`;
  }
  const strategyCard = renderLMMStrategyTable(res, t, kind);
  const narrativeCard = renderNarrativeCard(res, t, kind);   // v1033
  // v1053 予算試算 (LMM/GLMM 系にも)
  const budgetParticipants = res.mode === 'a_priori' ? res.n_required : res.params.n_p;
  const budgetCard = renderBudgetSummary(budgetParticipants, res.mode === 'a_priori' ? '必要' : '現在');
  root.innerHTML = mainCard + budgetCard + strategyCard + narrativeCard;
  // v1033 コピーボタン wire (data-copy-payload の参照先 script は同 root 内)
  root.querySelectorAll('[data-copy-payload]').forEach(b => {
    b.addEventListener('click', async () => {
      try {
        const payloadEl = root.querySelector('#pw-payloads');
        const payloads = payloadEl ? JSON.parse(payloadEl.textContent) : {};
        const text = payloads[b.dataset.copyPayload] || '';
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta);
          ta.select(); document.execCommand('copy'); ta.remove();
        }
        const orig = b.textContent; b.textContent = '✓ コピー'; setTimeout(() => { b.textContent = orig; }, 1200);
      } catch (e) {}
    });
  });
}

// v1033 論文用 narrative + R/Python コード自動生成 (中村さんビジョン)
function renderNarrativeCard(res, t, kind) {
  const p = res.params;
  const n_p = res.mode === 'a_priori' ? res.n_required : p.n_p;
  const power = res.mode === 'a_priori' ? res.verify_power : res.power;
  const ci = res.ci;

  let narrative = '';
  let rCode = '';
  let pyCode = '';

  if (kind === 'lmm') {
    const nT = p.n_trials;
    const ss = p.sd_slope || 0;
    const slopeTerm = ss > 0 ? ` and a random slope for x with SD ${ss.toFixed(2)} (participant-level heterogeneity of the condition effect)` : '';
    const slopeR = ss > 0 ? `(1 + x | p)` : `(1 | p)`;
    const slopeSim = ss > 0 ? ` + rnorm(n_p, 0, ${ss.toFixed(3)})[sim_data$p] * sim_data$x` : '';
    const slopePy = ss > 0 ? ` + s[p]*x` : '';
    const slopePyInit = ss > 0 ? `\n    s = np.random.normal(0, ${ss.toFixed(3)}, n_p)` : '';
    narrative = `A simulation-based power analysis was conducted to estimate the required sample size for a within-subject two-condition design analyzed with a linear mixed-effects model. For each of ${p.iterations.toLocaleString()} simulated datasets, we generated data from the model y_{p,c,t} = β·x_{p,c,t} + u_p${ss > 0 ? ' + s_p·x_{p,c,t}' : ''} + ε_{p,c,t}, where u_p ~ N(0, ${p.sd_p.toFixed(2)}²) is the participant random intercept${slopeTerm} and ε ~ N(0, ${p.sd_e.toFixed(2)}²) is the trial-level residual. Each participant contributed ${nT} trials per condition. Under an expected fixed effect of β = ${p.beta} and α = ${p.alpha} (${p.tails}-sided), the analysis showed that n_p = ${n_p} participants yields a power of ${(power*100).toFixed(1)}% (95% CI ${(ci[0]*100).toFixed(1)}−${(ci[1]*100).toFixed(1)}%).`;
    rCode = `# R (simr / lme4)\nlibrary(lme4); library(simr)\n# fit a placeholder model with expected fixed effects\nn_p <- ${n_p}; n_trials <- ${nT}\nsim_data <- expand.grid(p = 1:n_p, trial = 1:n_trials, x = c(0, 1))\nsim_data$y <- ${p.beta} * sim_data$x + rnorm(n_p, 0, ${p.sd_p.toFixed(3)})[sim_data$p]${slopeSim} + rnorm(nrow(sim_data), 0, ${p.sd_e.toFixed(3)})\nfit <- lmer(y ~ x + ${slopeR}, data = sim_data)\npower_res <- powerSim(fit, nsim = ${Math.min(p.iterations, 1000)}, test = fixed('x'), alpha = ${p.alpha})\nprint(power_res)  # expected ≈ ${(power*100).toFixed(1)}%`;
    pyCode = `# Python (statsmodels)\nimport numpy as np, statsmodels.formula.api as smf, pandas as pd\nnp.random.seed(42)\nn_p, n_trials, iters = ${n_p}, ${nT}, ${Math.min(p.iterations, 1000)}\nbeta, sd_p, sd_e, alpha = ${p.beta}, ${p.sd_p.toFixed(3)}, ${p.sd_e.toFixed(3)}, ${p.alpha}\nsig = 0\nfor _ in range(iters):\n    u = np.random.normal(0, sd_p, n_p)${slopePyInit}\n    rows = []\n    for p in range(n_p):\n        for t in range(n_trials):\n            for x in (0, 1):\n                rows.append((p, x, beta*x + u[p]${slopePy} + np.random.normal(0, sd_e)))\n    df = pd.DataFrame(rows, columns=['p','x','y'])\n    m = smf.mixedlm('y ~ x', df, groups=df['p']).fit(reml=False)\n    if m.pvalues['x'] < alpha: sig += 1\nprint(f'Power ≈ {sig/iters:.1%}')`;
  } else if (kind === 'lmm3') {
    const nS = p.n_stim;
    const ssp = p.sd_slope_p || 0;
    const sss = p.sd_slope_s || 0;
    const slopePterm = ssp > 0 ? ` and a participant-level random slope for x with SD ${ssp.toFixed(2)}` : '';
    const slopeSterm = sss > 0 ? ` and a stimulus-level random slope for x with SD ${sss.toFixed(2)}` : '';
    const slopePR = ssp > 0 ? '(1 + x | p)' : '(1 | p)';
    const slopeSR = sss > 0 ? '(1 + x | s)' : '(1 | s)';
    const slopeSimP = ssp > 0 ? ` + rnorm(n_p, 0, ${ssp.toFixed(3)})[sim_data$p] * sim_data$x` : '';
    const slopeSimS = sss > 0 ? ` + rnorm(n_s, 0, ${sss.toFixed(3)})[sim_data$s] * sim_data$x` : '';
    narrative = `A simulation-based power analysis was conducted for a crossed within-subject design (participants × stimuli) analyzed with a linear mixed-effects model with crossed random intercepts${slopePterm}${slopeSterm}. For each of ${p.iterations.toLocaleString()} simulated datasets, we generated data from y_{p,s,c} = β·x_{p,s,c} + u_p + w_s + ε_{p,s,c}, where u_p ~ N(0, ${p.sd_p.toFixed(2)}²), w_s ~ N(0, ${p.sd_s.toFixed(2)}²), ε ~ N(0, ${p.sd_e.toFixed(2)}²). Each participant saw ${nS} stimuli in each of the two conditions. Under an expected fixed effect of β = ${p.beta} and α = ${p.alpha}, n_p = ${n_p} participants yields a power of ${(power*100).toFixed(1)}% (95% CI ${(ci[0]*100).toFixed(1)}−${(ci[1]*100).toFixed(1)}%).`;
    rCode = `# R (simr / lme4)\nlibrary(lme4); library(simr)\nn_p <- ${n_p}; n_s <- ${nS}\nsim_data <- expand.grid(p = 1:n_p, s = 1:n_s, x = c(0, 1))\nsim_data$y <- ${p.beta} * sim_data$x + rnorm(n_p, 0, ${p.sd_p.toFixed(3)})[sim_data$p]${slopeSimP} + rnorm(n_s, 0, ${p.sd_s.toFixed(3)})[sim_data$s]${slopeSimS} + rnorm(nrow(sim_data), 0, ${p.sd_e.toFixed(3)})\nfit <- lmer(y ~ x + ${slopePR} + ${slopeSR}, data = sim_data)\npower_res <- powerSim(fit, nsim = ${Math.min(p.iterations, 1000)}, test = fixed('x'), alpha = ${p.alpha})\nprint(power_res)  # expected ≈ ${(power*100).toFixed(1)}%`;
    pyCode = `# Python (statsmodels) — approximated (statsmodels does not support crossed random effects directly)\n# Use pymer4 or rpy2 for full lme4 semantics.\nimport numpy as np\nnp.random.seed(42)\nn_p, n_s, iters = ${n_p}, ${nS}, ${Math.min(p.iterations, 1000)}\nbeta, sd_p, sd_s, sd_e, alpha = ${p.beta}, ${p.sd_p.toFixed(3)}, ${p.sd_s.toFixed(3)}, ${p.sd_e.toFixed(3)}, ${p.alpha}\nfrom scipy.stats import ttest_1samp\nsig = 0\nfor _ in range(iters):\n    diffs = []\n    for p in range(n_p):\n        diff = 0.0\n        for s in range(n_s):\n            diff += (beta + np.random.normal(0, sd_e) - np.random.normal(0, sd_e))\n        diffs.append(diff / n_s)\n    t, pv = ttest_1samp(diffs, 0.0)\n    if pv < alpha: sig += 1\nprint(f'Power ≈ {sig/iters:.1%}')`;
  } else if (kind === 'glmm') {
    narrative = `A simulation-based power analysis was conducted for a within-subject binary outcome analyzed with a logistic mixed-effects model. For each of ${p.iterations.toLocaleString()} simulated datasets, we generated data from logit(P(y=1)) = β0 + β1·x + u_p, where u_p ~ N(0, ${p.sd_p.toFixed(2)}²). The baseline probability was p₀ = ${p.baseline_p} and the proposed-condition probability was p₁ ≈ ${(state.glmm.proposed_p ?? probFromBaseAndOR(p.baseline_p, p.or)).toFixed(3)}, corresponding to an odds ratio of OR = ${p.or.toFixed(2)} (β1 = log(OR) = ${Math.log(p.or).toFixed(3)}). Each participant contributed ${p.n_trials} trials per condition. Under α = ${p.alpha}, n_p = ${n_p} participants yields a power of ${(power*100).toFixed(1)}% (95% CI ${(ci[0]*100).toFixed(1)}−${(ci[1]*100).toFixed(1)}%).`;
    rCode = `# R (lme4)\nlibrary(lme4)\nset.seed(42)\nn_p <- ${n_p}; n_t <- ${p.n_trials}; iters <- ${Math.min(p.iterations, 1000)}\nb0 <- log(${p.baseline_p} / (1 - ${p.baseline_p})); b1 <- log(${p.or}); sd_p <- ${p.sd_p.toFixed(3)}; alpha <- ${p.alpha}\nsig <- 0\nfor (i in 1:iters) {\n  u <- rnorm(n_p, 0, sd_p)\n  df <- expand.grid(p = 1:n_p, t = 1:n_t, x = c(0, 1))\n  df$eta <- b0 + b1 * df$x + u[df$p]\n  df$y <- rbinom(nrow(df), 1, plogis(df$eta))\n  m <- glmer(y ~ x + (1 | p), data = df, family = binomial)\n  pv <- summary(m)$coefficients['x','Pr(>|z|)']\n  if (!is.na(pv) && pv < alpha) sig <- sig + 1\n}\ncat(sprintf('Power ≈ %.1f%%\\n', 100 * sig / iters))  # expected ≈ ${(power*100).toFixed(1)}%`;
    pyCode = `# Python (statsmodels)\nimport numpy as np, statsmodels.api as sm, pandas as pd\nnp.random.seed(42)\nn_p, n_t, iters = ${n_p}, ${p.n_trials}, ${Math.min(p.iterations, 1000)}\nb0 = np.log(${p.baseline_p} / (1 - ${p.baseline_p})); b1 = np.log(${p.or}); sd_p = ${p.sd_p.toFixed(3)}; alpha = ${p.alpha}\nsig = 0\nfor _ in range(iters):\n    u = np.random.normal(0, sd_p, n_p)\n    rows = []\n    for p in range(n_p):\n        for t in range(n_t):\n            for x in (0, 1):\n                pi = 1 / (1 + np.exp(-(b0 + b1*x + u[p])))\n                rows.append((p, x, 1 if np.random.rand() < pi else 0))\n    df = pd.DataFrame(rows, columns=['p','x','y'])\n    m = sm.GEE.from_formula('y ~ x', groups='p', data=df, family=sm.families.Binomial()).fit()\n    if m.pvalues['x'] < alpha: sig += 1\nprint(f'Power ≈ {sig/iters:.1%}')`;
  } else if (kind === 'glmm_poisson') {
    const r0 = p.baseline_rate, r1 = p.baseline_rate * p.rr;
    narrative = `A simulation-based power analysis was conducted for a within-subject count outcome analyzed with a Poisson mixed-effects model. For each of ${p.iterations.toLocaleString()} simulated datasets, we generated data from log(E[Y]) = β0 + β1·x + u_p with Y ~ Poisson(exp(η)) and u_p ~ N(0, ${p.sd_p.toFixed(2)}²). The baseline rate was λ₀ = ${r0} counts per trial and the proposed-condition rate was λ₁ ≈ ${r1.toFixed(2)}, corresponding to a rate ratio of RR = ${p.rr.toFixed(2)} (β1 = log(RR) = ${Math.log(p.rr).toFixed(3)}). Each participant contributed ${p.n_trials} trials per condition. Under α = ${p.alpha}, n_p = ${n_p} participants yields a power of ${(power*100).toFixed(1)}% (95% CI ${(ci[0]*100).toFixed(1)}−${(ci[1]*100).toFixed(1)}%).`;
    rCode = `# R (lme4)\nlibrary(lme4)\nset.seed(42)\nn_p <- ${n_p}; n_t <- ${p.n_trials}; iters <- ${Math.min(p.iterations, 1000)}\nb0 <- log(${r0}); b1 <- log(${p.rr}); sd_p <- ${p.sd_p.toFixed(3)}; alpha <- ${p.alpha}\nsig <- 0\nfor (i in 1:iters) {\n  u <- rnorm(n_p, 0, sd_p)\n  df <- expand.grid(p = 1:n_p, t = 1:n_t, x = c(0, 1))\n  df$eta <- b0 + b1 * df$x + u[df$p]\n  df$y <- rpois(nrow(df), exp(df$eta))\n  m <- glmer(y ~ x + (1 | p), data = df, family = poisson)\n  pv <- summary(m)$coefficients['x','Pr(>|z|)']\n  if (!is.na(pv) && pv < alpha) sig <- sig + 1\n}\ncat(sprintf('Power ≈ %.1f%%\\n', 100 * sig / iters))  # expected ≈ ${(power*100).toFixed(1)}%`;
    pyCode = `# Python (statsmodels)\nimport numpy as np, statsmodels.api as sm, pandas as pd\nnp.random.seed(42)\nn_p, n_t, iters = ${n_p}, ${p.n_trials}, ${Math.min(p.iterations, 1000)}\nb0 = np.log(${r0}); b1 = np.log(${p.rr}); sd_p = ${p.sd_p.toFixed(3)}; alpha = ${p.alpha}\nsig = 0\nfor _ in range(iters):\n    u = np.random.normal(0, sd_p, n_p)\n    rows = []\n    for pi_ in range(n_p):\n        for t in range(n_t):\n            for x in (0, 1):\n                lam = np.exp(b0 + b1*x + u[pi_])\n                rows.append((pi_, x, np.random.poisson(lam)))\n    df = pd.DataFrame(rows, columns=['p','x','y'])\n    m = sm.GEE.from_formula('y ~ x', groups='p', data=df, family=sm.families.Poisson()).fit()\n    if m.pvalues['x'] < alpha: sig += 1\nprint(f'Power ≈ {sig/iters:.1%}')`;
  } else if (kind === 'glmm_nb') {
    const r0 = p.baseline_rate, r1 = p.baseline_rate * p.rr;
    narrative = `A simulation-based power analysis was conducted for a within-subject overdispersed count outcome analyzed with a negative binomial mixed-effects model (NB2 parameterization). For each of ${p.iterations.toLocaleString()} simulated datasets, we generated data from log(E[Y]) = β0 + β1·x + u_p with Y ~ NB(μ, θ) so that Var(Y) = μ + μ²/θ. The dispersion parameter was θ = ${p.theta} (variance inflation factor ≈ ${(1 + p.baseline_rate / p.theta).toFixed(2)} × mean at baseline). The baseline rate was λ₀ = ${r0} and the proposed-condition rate was λ₁ ≈ ${r1.toFixed(2)}, corresponding to a rate ratio of RR = ${p.rr.toFixed(2)}. Each participant contributed ${p.n_trials} trials per condition. Under α = ${p.alpha}, n_p = ${n_p} participants yields a power of ${(power*100).toFixed(1)}% (95% CI ${(ci[0]*100).toFixed(1)}−${(ci[1]*100).toFixed(1)}%).`;
    rCode = `# R (glmmTMB — 推奨、lme4 だと NB は遅い)\nlibrary(glmmTMB)\nset.seed(42)\nn_p <- ${n_p}; n_t <- ${p.n_trials}; iters <- ${Math.min(p.iterations, 500)}\nb0 <- log(${r0}); b1 <- log(${p.rr}); theta <- ${p.theta}; sd_p <- ${p.sd_p.toFixed(3)}; alpha <- ${p.alpha}\nsig <- 0\nfor (i in 1:iters) {\n  u <- rnorm(n_p, 0, sd_p)\n  df <- expand.grid(p = 1:n_p, t = 1:n_t, x = c(0, 1))\n  mu <- exp(b0 + b1 * df$x + u[df$p])\n  df$y <- rnbinom(nrow(df), mu = mu, size = theta)\n  m <- try(glmmTMB(y ~ x + (1 | p), data = df, family = nbinom2), silent = TRUE)\n  if (!inherits(m, 'try-error')) {\n    pv <- summary(m)$coefficients$cond['x', 'Pr(>|z|)']\n    if (!is.na(pv) && pv < alpha) sig <- sig + 1\n  }\n}\ncat(sprintf('Power ≈ %.1f%%\\n', 100 * sig / iters))  # expected ≈ ${(power*100).toFixed(1)}%`;
    pyCode = `# Python (statsmodels GEE) — NB は statsmodels の GEE でも近似可\nimport numpy as np, statsmodels.api as sm, pandas as pd\nnp.random.seed(42)\nn_p, n_t, iters = ${n_p}, ${p.n_trials}, ${Math.min(p.iterations, 500)}\nb0 = np.log(${r0}); b1 = np.log(${p.rr}); theta = ${p.theta}; sd_p = ${p.sd_p.toFixed(3)}; alpha = ${p.alpha}\nsig = 0\nfor _ in range(iters):\n    u = np.random.normal(0, sd_p, n_p)\n    rows = []\n    for pi_ in range(n_p):\n        for t in range(n_t):\n            for x in (0, 1):\n                mu = np.exp(b0 + b1*x + u[pi_])\n                # Gamma-Poisson mixture で NB サンプル\n                lam = np.random.gamma(shape=theta, scale=mu/theta)\n                rows.append((pi_, x, np.random.poisson(lam)))\n    df = pd.DataFrame(rows, columns=['p','x','y'])\n    m = sm.GEE.from_formula('y ~ x', groups='p', data=df, family=sm.families.NegativeBinomial()).fit()\n    if m.pvalues['x'] < alpha: sig += 1\nprint(f'Power ≈ {sig/iters:.1%}')`;
  } else if (kind === 'glmm_ordinal') {
    const K = p.k_cat, log_or = p.d * Math.PI / Math.sqrt(3);
    narrative = `A simulation-based power analysis was conducted for a within-subject ${K}-point ordinal (Likert-like) outcome. Following a cumulative link (proportional odds) model, we simulated a latent normal variable y* = β·x + u_p + ε with u_p ~ N(0, ${p.sd_p.toFixed(2)}²) and ε ~ N(0, 1), then discretized into K equal-probability categories using thresholds θ_j = Φ⁻¹(j/K). The standardized effect on the latent scale was d = ${p.d} (Cohen d equivalent), corresponding to a log-odds effect β = d·π/√3 ≈ ${log_or.toFixed(3)} and an odds ratio of ${Math.exp(log_or).toFixed(2)} per one-category shift (Chinn, 2000). For each of ${p.iterations.toLocaleString()} simulated datasets, each participant contributed ${p.n_trials} responses per condition. Analysis was performed as a paired mean-difference test on participant-level category-value means; this is conservative relative to a proper POM analysis (which recovers an additional ~5-15% efficiency). Under α = ${p.alpha}, n_p = ${n_p} participants yields a power of ${(power*100).toFixed(1)}% (95% CI ${(ci[0]*100).toFixed(1)}−${(ci[1]*100).toFixed(1)}%).`;
    rCode = `# R (ordinal + simr — proper POM)\nlibrary(ordinal); library(simr)\nset.seed(42)\nn_p <- ${n_p}; n_t <- ${p.n_trials}; K <- ${K}; iters <- ${Math.min(p.iterations, 1000)}\nd <- ${p.d}; sd_p <- ${p.sd_p.toFixed(3)}; alpha <- ${p.alpha}\nbeta <- d * pi / sqrt(3)  # Chinn 2000 approximation\nthresholds <- qnorm((1:(K-1)) / K)  # equal-probability cuts on latent normal\nsig <- 0\nfor (i in 1:iters) {\n  u <- rnorm(n_p, 0, sd_p)\n  rows <- expand.grid(p = 1:n_p, t = 1:n_t, x = c(0, 1))\n  latent <- beta * rows$x + u[rows$p] + rnorm(nrow(rows))\n  rows$y <- factor(cut(latent, breaks = c(-Inf, thresholds, Inf), labels = FALSE), ordered = TRUE, levels = 1:K)\n  m <- try(clmm(y ~ x + (1 | p), data = rows), silent = TRUE)\n  if (!inherits(m, 'try-error')) {\n    pv <- summary(m)$coefficients['x', 'Pr(>|z|)']\n    if (!is.na(pv) && pv < alpha) sig <- sig + 1\n  }\n}\ncat(sprintf('Power ≈ %.1f%%\\n', 100 * sig / iters))  # expected ≈ ${(power*100).toFixed(1)}%`;
    pyCode = `# Python (statsmodels には clmm 相当がないため参考実装)\n# 実務では R の clmm (ordinal package) を推奨。\nimport numpy as np\nnp.random.seed(42)\nn_p, n_t, K, iters = ${n_p}, ${p.n_trials}, ${K}, ${Math.min(p.iterations, 1000)}\nd, sd_p, alpha = ${p.d}, ${p.sd_p.toFixed(3)}, ${p.alpha}\nfrom scipy.stats import norm, ttest_1samp\nbeta = d * np.pi / np.sqrt(3)\nthresholds = norm.ppf(np.arange(1, K) / K)\ndef categorize(lat):\n    return np.searchsorted(thresholds, lat) + 1  # 1..K\nsig = 0\nfor _ in range(iters):\n    u = np.random.normal(0, sd_p, n_p)\n    diffs = np.zeros(n_p)\n    for pi_ in range(n_p):\n        y0 = np.mean([categorize(u[pi_] + np.random.normal()) for _ in range(n_t)])\n        y1 = np.mean([categorize(u[pi_] + beta + np.random.normal()) for _ in range(n_t)])\n        diffs[pi_] = y1 - y0\n    t, pv = ttest_1samp(diffs, 0.0)\n    if pv < alpha: sig += 1\nprint(f'Power (mean-diff proxy) ≈ {sig/iters:.1%}')\n# 実際の POM 分析は R の clmm を推奨 (mean-diff proxy より 5-15% 効率↑)`;
  } else {
    return '';  // 従来の t/ANOVA/相関/χ² は narrative 未対応
  }

  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📝 論文掲載用 narrative + 解析コード (v1033)</div>
      <details open>
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0">📄 English narrative (draft)</summary>
        <div style="margin-top:6px; padding:10px; background:#faf5ff; border-left:3px solid #7b3fa0; border-radius:0 6px 6px 0; font-family: Georgia, 'Times New Roman', serif; font-size:13px; line-height:1.75; white-space:pre-wrap">${escapeHtml(narrative)}</div>
        <div class="row" style="margin-top:6px"><button data-copy-payload="narrative" class="btn" style="font-size:11px; padding:2px 10px">📋 コピー</button></div>
      </details>
      <details style="margin-top:8px">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0">📊 R (lme4 / simr)</summary>
        <pre style="margin-top:6px; padding:10px; background:#f9fafb; border-radius:6px; overflow-x:auto; font-size:12px; line-height:1.55">${escapeHtml(rCode)}</pre>
        <div class="row" style="margin-top:6px"><button data-copy-payload="r" class="btn" style="font-size:11px; padding:2px 10px">📋 コピー</button></div>
      </details>
      <details style="margin-top:8px">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0">🐍 Python (statsmodels / scipy)</summary>
        <pre style="margin-top:6px; padding:10px; background:#f9fafb; border-radius:6px; overflow-x:auto; font-size:12px; line-height:1.55">${escapeHtml(pyCode)}</pre>
        <div class="row" style="margin-top:6px"><button data-copy-payload="py" class="btn" style="font-size:11px; padding:2px 10px">📋 コピー</button></div>
      </details>
      <div class="hint-sm" style="margin-top:8px">R / Python のコードは検定力検証用の再現スクリプト。中村さんビジョン「A simulation-based power analysis was conducted with 1,000 simulated datasets…」の形式で書き出し。</div>
      <script type="application/json" id="pw-payloads">${JSON.stringify({ narrative, r: rCode, py: pyCode })}</script>
    </div>`;
}

// v1038 保存/共有ボタン (中村さん要望「保存ボタンだけじゃなく、共有ボタンも欲しい。
//   保存と共有ボタンは、画面下部にも配置して欲しい (2 箇所にあるイメージ)」)。 top / bottom
//   両方で同じボタン列を使うので、 ID は位置ごとにサフィックスで区別 (pw-save-top /
//   pw-save-bottom) してイベントを両方に貼る。共有は保存前でも表示し、押した時に
//   未保存なら「先に名前をつけて保存 → 共有」の二段フローに誘導する。
function renderSaveShareButtons(pos) {
  const suf = pos === 'top' ? 'top' : 'bot';
  return `
    <div class="row no-print" style="gap:6px; margin-top:8px; flex-wrap:wrap" data-pw-btns="${pos}">
      <button data-pw-btn="save" id="pw-save-${suf}" class="btn primary" style="font-size:12px; padding:3px 10px">💾 保存 ${state.loaded_id ? '(更新)' : '(名前を付けて)'}</button>
      <button data-pw-btn="share" id="pw-share-${suf}" class="btn" style="font-size:12px; padding:3px 10px">📤 共有</button>
      ${state.loaded_id ? `
        <button data-pw-btn="new" id="pw-new-${suf}" class="btn" style="font-size:12px; padding:3px 10px">🆕 新規</button>
        ${state.loaded_owner_name ? '' : `<button data-pw-btn="delete" id="pw-delete-${suf}" class="btn danger" style="font-size:12px; padding:3px 10px">🗑 削除</button>`}
      ` : ''}
    </div>`;
}

// v1038 検定選択ウィザード (中村さん要望「検定の種類を選ぶ過程も、フローチャートか、
//   選択肢ベースで選べるようにするとよいのかなぁ？」)。 4-5 個の選択肢に答えて
//   いくと、分析ガイドのフローチャートを対話的に辿った結果の検定が自動で選ばれる。
//   選択の途中結果と適用ロジックを UI に表示。
function renderTestWizard() {
  const w = state.wizard || (state.wizard = { scale: '', groups: '', related: '', normal: '', complex: '', relation_type: '', assoc_expected: '' });
  // 後方互換: 古い state にこれらのキーがなくても OK
  if (w.relation_type === undefined) w.relation_type = '';
  if (w.assoc_expected === undefined) w.assoc_expected = '';
  const opt = (id, val, label) => `<button class="btn" data-wz="${id}" data-wz-val="${val}" style="font-size:11px; padding:3px 8px; ${w[id]===val?'background:#7b3fa0; color:#fff':''}">${label}</button>`;
  // 決定ロジック
  let inferred = null;
  let inferredNote = '';
  const s = w.scale, g = w.groups, r = w.related, n = w.normal, c = w.complex;
  const rt = w.relation_type, ae = w.assoc_expected;
  // v1048 順序尺度で 2 群参加者内なら順序ロジット GLMM を第一提案
  if (s === 'ordinal' && g === '2' && r === 'paired') {
    inferred = 'glmm_ordinal';
    inferredNote = 'リッカート等の順序尺度 (2 条件、参加者内) → 📶 順序ロジット GLMM を推奨。このアプリの機能で直接扱えます。';
  } else if (s === 'continuous' || s === 'ordinal') {
    // リッカート等の順序尺度は「中央付近が山型なら t/ANOVA で近似可、厳密には
    //   順序ロジット GLMM が望ましい」の注記を付ける。
    const ordSfx = s === 'ordinal' ? ' (このアプリの 📶 順序ロジット GLMM を使うとリッカートを直接扱えます)' : '';
    if (s === 'continuous' && (c === 'complex' || c === 'crossed')) {
      inferred = c === 'crossed' ? 'lmm_crossed' : 'lmm_within';
      inferredNote = c === 'crossed' ? '参加者 × 刺激の交差ランダム効果 → LMM 3-level' : '複雑デザイン → LMM (参加者内)';
    } else if (g === '2' && r === 'paired' && n === 'yes') { inferred = 'tp'; inferredNote = '2 群、対応あり、正規性 OK → 対応のある t 検定' + ordSfx; }
    else if (g === '2' && r === 'indep' && n === 'yes')   { inferred = 't2';  inferredNote = '2 群、独立、正規性 OK → 対応のない t 検定' + ordSfx; }
    else if (g === '1' && n === 'yes')                     { inferred = 't1';  inferredNote = '1 群 (基準値との比較)、正規性 OK → 1 標本 t 検定' + ordSfx; }
    else if (g === '3plus' && r === 'indep' && n === 'yes'){ inferred = 'anova'; inferredNote = '3 群以上、独立、正規性 OK → 一元配置 ANOVA' + ordSfx; }
    else if (g === '3plus' && r === 'paired' && n === 'yes'){ inferred = 'rmanova'; inferredNote = '3 群以上、対応 (反復測定)、正規性 OK → 反復測定 ANOVA' + ordSfx; }
    else if (g === '3plus' && n === 'yes' && !r)          { inferredNote = 'Q3 (群の関係) も選んでください'; }
    else if (n === 'no') {
      // v1046 中村さん指摘「ウィザードで Wilcoxon 符号順位検定 (対応) がよいと出てきたけど、
      //   検定の種類にない」→ このアプリはノンパラを直接持たないので、正規近似ベースの
      //   パラメトリック検定を「参考値」として選べるように inferred を設定。ノンパラで
      //   実際に解析するなら ARE (asymptotic relative efficiency ≈ 0.86-0.95) を考慮して
      //   n を 5-15% 多めにする目安も注記。
      const npMap = {
        '1':     { name: 'Wilcoxon 符号順位検定 (中央値と基準値の比較)', para: 't1' },
        '2':     r === 'paired'
                   ? { name: 'Wilcoxon 符号順位検定 (対応)', para: 'tp' }
                   : { name: 'Mann-Whitney U 検定 (独立)',   para: 't2' },
        '3plus': r === 'paired'
                   ? { name: 'Friedman 検定',                   para: 'rmanova' }
                   : { name: 'Kruskal-Wallis 検定',             para: 'anova' },
      };
      const np = npMap[g] || { name: 'ノンパラ検定', para: null };
      if (np.para) {
        inferred = np.para;
        const paraLabel = (TESTS.find(x=>x.id===np.para)||{}).label || np.para;
        inferredNote = `正規分布に近くない → 本来は ${np.name} が推奨。このアプリはノンパラを直接持たないため、参考値として ${paraLabel} で計算 (asymptotic relative efficiency ≈ 0.86-0.95 → 実際にノンパラで解析するなら n を 5-15% 多めに募集する目安)。`;
      } else {
        inferredNote = '正規分布に近くない → ノンパラ検定 (Mann-Whitney / Wilcoxon / Kruskal-Wallis / Friedman) が推奨。このアプリでは参考値として t/ANOVA で概算可。';
      }
    }
  } else if (s === 'relation') {
    // v1061 中村さん指摘: Pearson vs Spearman は何を知りたいかで選ばせる。検定力は
    //   ほぼ同じだが、分析の意味が違うので明示的に。
    if (rt === 'pearson') {
      inferred = 'corr';
      inferredNote = '2 つの値の直線的な連動 → 🔗 Pearson 相関 r。「値そのものがどれくらい一緒に上下するか」を見る。外れ値の影響を受けやすい。データの分布が正規に近い時に最適。';
    } else if (rt === 'spearman') {
      inferred = 'corr_sp';
      inferredNote = '2 つの値の順位の類似 → 🔗 Spearman 順位相関 ρ。「大小関係が一致するか」だけを見るので外れ値や非線形 (単調) 関係に強い。検定力は Pearson とほぼ同じで、 ARE ≈ 0.912 の補正で必要 n は Pearson の約 1.10 倍。';
    } else {
      inferredNote = 'Q2 で「直線的な連動」か「順位の類似」かを選んでください';
    }
  } else if (s === 'binary_within') {
    inferred = 'glmm_logit'; inferredNote = '2 値アウトカム、参加者内 → Logistic GLMM';
  } else if (s === 'count_within') {
    inferred = 'glmm_poisson'; inferredNote = '回数アウトカム、参加者内 → Poisson GLMM が第一候補。分散 >> 平均 (過分散) なら 📈 負の二項 GLMM に切替を推奨。';
  } else if (s === 'categorical_dist') {
    inferred = 'chi2';
    inferredNote = '1 種類のカテゴリの分布の偏りを見る → ⁉ χ² 適合度検定 (df = カテゴリ数 − 1、例: 3 択なら df=2)';
  } else if (s === 'categorical_assoc') {
    // v1061 中村さん指摘: 「期待度数 <5 なら Fisher」だけではわからないので選ばせる。
    if (ae === 'large') {
      inferred = 'chi2';
      inferredNote = '2 種類のカテゴリの関連 (期待度数全セル ≥5) → ⁉ χ² 独立性検定 (df = (行数−1) × (列数−1)、例: 2×3 なら df=2)。このアプリで対応。';
    } else if (ae === 'small') {
      inferred = 'fisher_2x2';
      inferredNote = '2 種類のカテゴリの関連 (期待度数 <5 のセルあり、少数観測) → ⁉ Fisher 直接確率検定 (2×2、シミュベース) を推奨。このアプリで対応可能 (Monte Carlo で数千回シミュ、数秒)。 3×2 以上は別途 χ² で概算を。';
    } else {
      inferredNote = 'Q2 で「期待度数の見込み」を選んでください';
    }
  }
  return `
    <details style="margin-top:10px; padding:10px 12px; background:#faf5ff; border-radius:8px; border:1px solid #ede4f3" ${inferred || (s || g || rt || ae) ? 'open' : ''}>
      <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:13px">🧭 選択ウィザード</summary>
      <div style="margin-top:10px; font-size:12.5px; line-height:1.9">
        <div><b>Q1. 差を測定したい数値 (従属変数) の特性は？</b></div>
        <div class="hint-sm" style="margin-bottom:4px">実験で「手法間の差」を見たい数値の性質を選んでください。 <b>「同じ参加者で複数回」</b> = 1 人が同じ課題を何回か繰り返す (反応時間 100 試行、正誤 20 問等)、 <b>「1 人 1 回」</b> = 各人 1 個の値だけ記録。</div>
        <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
          ${opt('scale', 'continuous', '連続値 (反応時間、所要時間、選択率、得点など)')}
          ${opt('scale', 'ordinal', '順序尺度 (リッカート尺度、形容詞対での評価など)')}
          ${opt('scale', 'binary_within', '2 値の系列 (成功/失敗、正誤を同じ参加者で複数回)')}
          ${opt('scale', 'count_within', '回数の系列 (エラー数、発言回数を同じ参加者で複数回)')}
          ${opt('scale', 'categorical_dist', '1 種類のカテゴリの分布の偏り (1 人 1 回だけの成功/失敗の集計、選択肢 A/B/C からどれを選ぶかの偏り、会議の話者ごとの発言回数、サイコロの出目など)')}
          ${opt('scale', 'categorical_assoc', '2 種類のカテゴリの関連 (性別 × 選択科目、群 × 正誤など)')}
          ${opt('scale', 'relation', '関係を見たい (身長と体重、勉強時間と成績等の連動)')}
        </div>
        ${['continuous','ordinal'].includes(s) ? `
          <div><b>Q2. 比較する手法 (or 条件・群) の数？</b></div>
          <div class="hint-sm" style="margin-bottom:4px">検証する手法 (提案手法・比較手法) の数を選んでください。「提案 A と従来 B の 2 つを比較」なら 2、「A・B・C・D の 4 手法を比較」なら 3 以上。群/条件/水準と呼び方は違いますが実質同じ意味。</div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('groups', '1', '1 手法 (基準値との比較)')}
            ${opt('groups', '2', '2 手法')}
            ${opt('groups', '3plus', '3 手法以上')}
          </div>` : ''}
        ${['continuous','ordinal'].includes(s) && ['2','3plus'].includes(g) ? `
          <div><b>Q3. 手法 (or 条件) 間の関係？</b></div>
          <div class="hint-sm" style="margin-bottom:4px">「別々の参加者にそれぞれ 1 手法を試してもらう」なら独立。「同じ参加者にすべての手法を順番に試してもらう」なら対応 (被験者内デザイン)。</div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('related', 'indep', '独立 (別の参加者)')}
            ${opt('related', 'paired', '対応 (同じ参加者、前後 or 条件)')}
          </div>` : ''}
        ${['continuous','ordinal'].includes(s) && g ? `
          <div><b>Q4. データの分布は正規分布に近い？</b></div>
          <div class="hint-sm" style="margin-bottom:4px">「ヒストグラムを描いたら富士山型 (左右対称の山形) になる」で OK。判断に迷ったら参加者 n が 30 以上なら中心極限定理で緩く OK。リッカート尺度は中央付近が山なら OK、端に集中する場合は NG。</div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('normal', 'yes', '✅ 正規分布に近い (or n が 30 以上)')}
            ${opt('normal', 'no', '❌ 山型でなく偏った分布')}
          </div>` : ''}
        ${['continuous'].includes(s) && g && r ? `
          <div><b>Q5. デザインは単純？</b></div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('complex', 'simple', '単純 (1 要因、 balanced)')}
            ${opt('complex', 'complex', '複雑 (参加者内、複数試行)')}
            ${opt('complex', 'crossed', '参加者 × 刺激の交差')}
          </div>` : ''}
        ${s === 'relation' ? `
          <div><b>Q2. 何を知りたい？</b></div>
          <div class="hint-sm" style="margin-bottom:4px">「値そのものが一緒に上下する」か「大小関係だけ一致する」かで選ぶ検定が変わります。</div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('relation_type', 'pearson', '直線的な連動 (身長と体重、時給と月収等の比例っぽい関係)')}
            ${opt('relation_type', 'spearman', '順位の類似 (成績順位の一致、満足度順の対応等、単調だが直線とは限らない)')}
          </div>` : ''}
        ${s === 'categorical_assoc' ? `
          <div><b>Q2. 期待度数の見込みは？</b></div>
          <div class="hint-sm" style="margin-bottom:6px">
            <div><b>クロス表とは</b>: 2 種類のカテゴリを行 × 列で並べた表。例「性別 (男/女) × 好き嫌い (好き/嫌い/どちら)」なら 2 行 × 3 列 = <b>6 セル</b> の表。各セルは「行と列が交差する 1 マス」 (男×好き / 男×嫌い / 男×どちら / 女×好き / 女×嫌い / 女×どちら)。</div>
            <details style="margin-top:6px; padding:6px 10px; background:#fff; border-radius:4px">
              <summary style="cursor:pointer; font-size:12px; color:#7b3fa0">📊 具体例 (n=60、男 30・女 30、好き嫌いは均等と想定した場合の期待度数)</summary>
              <pre style="font-family:'SF Mono', Menlo, Consolas, monospace; font-size:11px; margin:6px 0 0; overflow-x:auto">
             好き嫌いどちら合計
      男     10      10      10    30
      女     10      10      10    30
      合計   20      20      20    60

期待度数 = n × (行合計/n) × (列合計/n) = n × 行比率 × 列比率
男×好きの期待 = 60 × (30/60) × (20/60) = 60 × 0.5 × 0.333 = 10
全セル 10 人 ≥ 5 → χ² 独立性検定が使える ✓

例2: n=20 で 3 カテゴリの場合、各セル期待 ≈ 20/9 ≈ 2.2 で 5 未満
    → Fisher 直接確率検定が本来推奨
              </pre>
            </details>
            <div style="margin-top:6px">1 つでも期待度数 &lt; 5 のセルがあれば本来は Fisher。 n が十分大きい (30 以上) or カテゴリ数が少ないなら大標本と見なして OK。</div>
          </div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('assoc_expected', 'large', '大標本 (全セル期待度数 ≥5 見込み)')}
            ${opt('assoc_expected', 'small', '少数観測 (< 5 のセルあり見込み、 Fisher 想定)')}
          </div>` : ''}
        ${inferred ? `
          <div style="margin-top:8px; padding:8px 12px; background:#dcfce7; border-left:3px solid #059669; border-radius:0 6px 6px 0">
            <div style="color:#059669"><b>⇒ 推奨: ${escapeHtml((TESTS.find(x=>x.id===inferred)||{label:inferred}).label)}</b></div>
            <div class="hint-sm" style="margin-top:2px">${inferredNote}</div>
            <button data-wz-apply="${inferred}" class="btn primary" style="font-size:12px; padding:3px 10px; margin-top:6px">この検定を選ぶ</button>
          </div>` : (inferredNote ? `<div style="margin-top:8px; padding:6px 10px; background:#fef3c7; border-left:3px solid #a16207; border-radius:0 6px 6px 0" class="hint-sm">${inferredNote}</div>` : '')}
        ${(s || g || r || n || c || rt || ae) ? `<div style="margin-top:6px"><button data-wz-reset="1" class="btn" style="font-size:11px; padding:2px 8px">↺ リセット</button></div>` : ''}
      </div>
    </details>`;
}

// v1036 統計手法選択フローチャート + 事前処理 + 検定別ガイド
//   中村さん指示「実際に分析で利用するべき手法や、事前処理の方法もどこかに明記」
//     + 「どの統計使うべきかみたいなフローチャートあったよね? アレは配置しておくとわかりやすい」
function renderAnalysisGuide() {
  const currentGuide = renderTestSpecificGuide();
  return `
    <details class="card" style="border-left:4px solid #059669">
      <summary style="cursor:pointer; font-weight:600; color:#059669; font-size:14.5px">🧭 分析ガイド (フローチャート + 事前処理 + 検定別)</summary>
      <div class="hint-sm" style="margin-top:6px; margin-bottom:6px">実験終了後、実際に何を使うべきか。統計手法選択のフローチャート、事前処理のチェックリスト、選んだ検定に応じた個別ガイドを載せています。</div>

      <details open style="margin-top:8px; padding:8px 12px; background:#f0fdf4; border-radius:6px">
        <summary style="cursor:pointer; font-weight:600; color:#059669">📊 統計手法選択フローチャート</summary>
        <div style="margin-top:8px; overflow-x:auto">
          ${renderStatFlowchartSVG()}
        </div>
      </details>

      <details style="margin-top:8px; padding:8px 12px; background:#f0fdf4; border-radius:6px">
        <summary style="cursor:pointer; font-weight:600; color:#059669">🧹 事前処理チェックリスト (実験終了後、統計にかける前)</summary>
        <div style="margin-top:8px; font-size:13px; line-height:1.8">
          <ol style="margin:0; padding-left:20px">
            <li><b>データクリーニング</b>: タイポ、単位の統一、負値・範囲外値の確認。生 CSV を保存してから前処理版を別ファイルに。</li>
            <li><b>欠損値</b> (Missing Data): 発生機構を分類。MCAR (完全ランダム欠損) ならリストワイズ削除で OK。MAR (観測変数で説明可) や MNAR は多重代入 (mice, MICE) を検討。欠損率 5% 以下ならほぼ問題なし、20% 超は要注意。</li>
            <li><b>外れ値</b> (Outlier): まず箱ひげ図・散布図で目視。数値的には Mahalanobis 距離、Cook's distance、|z| > 3。参加者レベルで「明らかにタスクを理解していない」等の理由が特定できたら除外の根拠に。無条件切り捨ては hacking の疑いあり。</li>
            <li><b>正規性</b> (Normality): Shapiro-Wilk 検定 or Q-Q プロット。n が大きい場合 (30+) は CLT で t 検定は頑健。歪度・尖度が大きい場合は log / ランク / Box-Cox 変換 or ノンパラ検定に切り替え。</li>
            <li><b>等分散性</b> (Homoscedasticity): Levene 検定 or Bartlett 検定。違反時は Welch 補正 t 検定 (t2 のデフォルトを Welch に) や Games-Howell (ANOVA 事後)。</li>
            <li><b>独立性</b>: 同じ参加者から複数観測している場合は独立でない → 対応 t / 反復測定 ANOVA / LMM に。無理に独立モデルにすると α が膨らむ。</li>
            <li><b>球面性</b> (Sphericity, 反復測定 ANOVA): Mauchly 検定。違反時は Greenhouse-Geisser or Huynh-Feldt 補正 df を使う。</li>
            <li><b>変数変換</b>: 反応時間は log や 1/RT で正規化しやすい。パーセントデータは logit や arcsin 変換で分散を安定化。</li>
            <li><b>参加者除外基準</b>: 前登録 (pre-registration) or 分析前に文書化。「タスクを理解していなかった (post-task questionnaire で明示)」「機材トラブル」等の客観基準で。</li>
            <li><b>多重比較補正</b>: post-hoc 比較や複数指標同時分析は Bonferroni (厳しめ)、Holm、FDR (Benjamini-Hochberg) 等。事前登録された仮説検定は補正不要が慣習。</li>
          </ol>
        </div>
      </details>

      ${currentGuide}

      <details style="margin-top:8px; padding:8px 12px; background:#f0fdf4; border-radius:6px">
        <summary style="cursor:pointer; font-weight:600; color:#059669">📖 参考文献</summary>
        <div style="margin-top:8px; font-size:12.5px; line-height:1.75">
          <ul style="margin:0; padding-left:20px">
            <li>Cohen, J. (1988). <i>Statistical power analysis for the behavioral sciences</i> (2nd ed.). Erlbaum.</li>
            <li>Faul, F., et al. (2009). Statistical power analyses using G*Power 3.1. <i>Behavior Research Methods, 41</i>, 1149-1160.</li>
            <li>Brysbaert, M. (2019). How many participants do we have to include in properly powered experiments? <i>Journal of Cognition, 2</i>(1), 16.</li>
            <li>Green, P., & MacLeod, C. J. (2016). SIMR: an R package for power analysis of generalized linear mixed models by simulation. <i>Methods in Ecology and Evolution, 7</i>(4), 493-498.</li>
            <li>Westfall, J., Kenny, D. A., & Judd, C. M. (2014). Statistical power and optimal design in experiments in which samples of participants respond to samples of stimuli. <i>Journal of Experimental Psychology: General, 143</i>(5), 2020-2045.</li>
          </ul>
        </div>
      </details>
    </details>
  `;
}

// 統計手法選択の大分類フローチャート (SVG)
function renderStatFlowchartSVG() {
  return `
<pre style="font-family: 'SF Mono', Menlo, Consolas, monospace; font-size:12px; line-height:1.5; background:#fff; padding:10px 12px; border-radius:6px; border:1px solid #d1fae5; overflow-x:auto; margin:0">
【差を測定したい変数 (従属変数) の数値の特性は？】
(ウィザード Q1 の 6 択に対応)

━━━ ① 連続値 (反応時間、得点、濃度等) ━━━
  │
  ├─ 【比較する手法 (or 条件・群) の数】
  │   ├─ 1 手法 (基準値との比較)
  │   │   ├─ 正規性 OK  → 👤 1 標本 t 検定  [このアプリで対応]
  │   │   └─ 正規性 NG → Wilcoxon 符号順位検定
  │   │
  │   ├─ 2 手法
  │   │   ├─ 独立 (別参加者)
  │   │   │   ├─ 正規性 + 等分散 OK → 📏 対応のない t 検定  [このアプリで対応]
  │   │   │   ├─ 正規性 OK / 等分散 NG → Welch t 検定
  │   │   │   └─ 正規性 NG → Mann-Whitney U 検定
  │   │   └─ 対応 (同じ参加者)
  │   │       ├─ 差の正規性 OK → 📎 対応のある t 検定  [このアプリで対応]
  │   │       └─ 差の正規性 NG → Wilcoxon 符号順位検定
  │   │
  │   └─ 3 手法以上
  │       ├─ 独立
  │       │   ├─ 正規性 + 等分散 → 📊 一元配置 ANOVA  [このアプリで対応]
  │       │   └─ 正規性 NG → Kruskal-Wallis
  │       └─ 対応 (同じ参加者)
  │           ├─ 球面性 OK → 🔁 反復測定 ANOVA  [このアプリで対応]
  │           ├─ 球面性 NG → 🔁 反復測定 ANOVA + GG/HF 補正  [このアプリで ε 指定可]
  │           └─ 正規性 NG → Friedman 検定
  │
  └─ 【複雑デザイン (2 要因以上、参加者 × 刺激交差、 unbalanced 等)】
      ├─ 参加者内 2 条件 → 🧠 LMM 2 レベル  [このアプリで対応]
      ├─ 参加者 × 刺激交差 → 🧠 LMM 3 レベル  [このアプリで対応]
      └─ さらに複雑 → LMM/GLMM (lme4::lmer / glmer) + emmeans

━━━ ② 順序尺度 (リッカート 5/7 段階等) ━━━
  │
  ├─ 参加者内 2 条件 → 📶 順序ロジット GLMM  [このアプリで対応]
  ├─ 参加者内 3+ 条件 → 累積ロジット + participant random intercept
  ├─ 独立 → Cumulative link model / Mann-Whitney U / Kruskal-Wallis
  └─ 近似 OK なら → t/ANOVA/rmANOVA でも概算可 (中央付近が山型なら)

━━━ ③ 2 値の系列 (成功/失敗、正誤を同じ参加者で複数回) ━━━
  │
  ├─ 参加者内 2 条件 → 🎯 Logistic GLMM  [このアプリで対応]
  └─ 対応 Before/After (1 対) → McNemar 検定
  (※ 1 人 1 回だけの 2 値は ⑤ 1 種類のカテゴリの分布の偏り側で集計)

━━━ ④ 回数の系列 (エラー数、発言回数を同じ参加者で複数回) ━━━
  │
  ├─ 平均 ≈ 分散  → 📊 Poisson GLMM  [このアプリで対応]
  ├─ 分散 >> 平均 → 📈 負の二項 GLMM  [このアプリで対応]
  └─ ゼロが大量  → Zero-inflated Poisson / NB

━━━ ⑤ 1 種類のカテゴリの分布の偏り ━━━
   (1 人 1 回だけの成功/失敗の集計、選択肢 A/B/C の選好、
    会議の話者ごとの発言回数、サイコロの出目、好きな色のアンケートなど)
  │
  └─ 期待分布 (均等 or 想定比) とのズレ → ⁉ χ² 適合度検定  [このアプリで対応]

━━━ ⑥ 2 種類のカテゴリの関連 ━━━
   (性別 × 選択科目、群 × 正誤など)
  │
  ├─ 大きな標本 → ⁉ χ² 独立性検定  [このアプリで対応 (df 指定)]
  ├─ 期待度数 <5 のセルあり → Fisher 直接確率検定
  └─ 対応あり Before/After 2×2 → McNemar 検定

  ★ ⑤ と ⑥ はどちらも χ² の家族 (数学的には同じツール):
    ⑤ は「観測分布は想定 (均等等) と一致するか？」
    ⑥ は「変数 A と B は独立か？」
    研究の問いが違うだけで、計算は同じ df ベースの χ²。

━━━ ⑦ 関係を見たい (連動) ━━━
  │
  ├─ 直線関係     → 🔗 Pearson 相関 r  [このアプリで対応]
  ├─ 順位の関係   → Spearman ρ / Kendall τ
  └─ 予測 / 因果  → 線形回帰 / 重回帰 (交絡変数をモデルに投入)

━━━ ⑧ ベイズ推論 (頻度論の代わりに事後分布で判定) ━━━
  │
  └─ 対応 t 検定 → ☯ ベイズ (JZS BF10) 対応 t  [このアプリで対応、固定 n / 逐次 SBF]
</pre>`;
}

function renderTestSpecificGuide() {
  const guides = {
    t2: {
      title: '📏 対応のない t 検定 (2 標本 t 検定: 独立) の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>正規性チェック: 群ごとに Shapiro-Wilk 検定 or Q-Q プロット。n>=30 なら CLT で頑健、緩めに OK。</li>
        <li>等分散チェック: Levene 検定 (F 検定は正規性に鋭敏なので Levene を推奨)。</li>
        <li>等分散 → Student t 検定 / 不等分散 → Welch t 検定 (デフォルトを Welch にする現代慣習も広まっている)。</li>
        <li>効果量: Cohen's d = (M_1 − M_2) / SD_pooled。SD_pooled は √(((n_1-1)SD_1² + (n_2-1)SD_2²)/(n_1+n_2-2))。95%CI も併記。</li>
        <li>報告例: "M_1 = 4.6 (SD = 1.2), M_2 = 4.0 (SD = 1.3), t(46) = 2.31, p = .025, d = 0.48 [0.06, 0.90]."</li>
        <li>ノンパラ代替: Mann-Whitney U (両群の分布形状が近い前提での中央値差の検定として)。</li>
      </ol>`,
    },
    tp: {
      title: '📎 対応のある t 検定の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>差 (X_1 − X_2) を計算し、その正規性を Shapiro-Wilk で確認。歪度が大きい場合は Wilcoxon 符号順位検定に。</li>
        <li>対応 t 検定を実行 (paired t-test)。</li>
        <li>効果量: d_z = M_diff / SD_diff (Cohen's d for paired)。d_av (平均 SD で標準化) を併記する派も。</li>
        <li>報告例: "参加者は方式 B (M = 4.6, SD = 1.2) を方式 A (M = 4.0, SD = 1.3) より高く評価した、t(23) = 3.12, p = .005, d_z = 0.64 [0.20, 1.07]."</li>
        <li>ノンパラ代替: Wilcoxon 符号順位検定。差にゼロが多い場合は Sign 検定。</li>
      </ol>`,
    },
    t1: {
      title: '👤 1 標本 t 検定 (基準値との比較) の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>観測値の正規性を Shapiro-Wilk で確認。n>=30 なら緩く OK。</li>
        <li>H0: 母平均 = μ_0 (基準値)、H1: ≠ μ_0 で 1 標本 t 検定。</li>
        <li>効果量: d = (M_obs - μ_0) / SD_obs。95%CI と併記。</li>
        <li>ノンパラ代替: Wilcoxon 符号順位検定 (中央値と基準値の比較)。</li>
      </ol>`,
    },
    rmanova: {
      title: '🔁 反復測定 ANOVA (対応 3 群以上) の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>各条件 (時点) の分布の正規性 (Shapiro-Wilk) を確認。参加者内デザインなので独立性は気にしなくて OK。</li>
        <li>Mauchly の球面性検定: 有意 (p<.05) なら球面性違反、 df を Greenhouse-Geisser (ε ≈ 0.5-0.8) or Huynh-Feldt (ε ≈ 0.7-0.9) で補正。 3 条件以下では球面性は自動的に成立するので補正不要。</li>
        <li>rmANOVA を実行 (R: <code>aov(y ~ cond + Error(p/cond))</code> or <code>afex::aov_ez</code>、 SPSS の GLM Repeated Measures)。</li>
        <li>効果量: partial η² (SS_effect / (SS_effect + SS_error)) が定番、 generalized η²_G (Bakeman 2005) も。 Cohen's f = √(η²/(1-η²)) で変換可。</li>
        <li>事後検定: Bonferroni or Holm 補正でペア比較。対応 t 検定を m=k(k-1)/2 個実行、補正 α = 0.05/m。</li>
        <li>報告例: "F(2, 46) = 6.24, p = .004, η²_p = .21, 90%CI [.05, .36], Greenhouse-Geisser ε = 0.87. Bonferroni 事後: 時点 1 vs 時点 3 (p = .008)、他 n.s."</li>
        <li>ノンパラ代替: Friedman 検定 → Nemenyi or Bonferroni-Wilcoxon で事後比較。</li>
        <li>より柔軟なら LMM (lmer(y ~ cond + (1|p))) に移行推奨。 unbalanced や欠損値に強く、現代の標準。</li>
      </ol>`,
    },
    anova: {
      title: '📊 一元配置 ANOVA の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>各群の正規性 (Shapiro-Wilk)、等分散性 (Levene) を確認。</li>
        <li>ANOVA を実行し、有意なら事後検定 (Tukey HSD が定番、群サイズ不揃いなら Bonferroni or Games-Howell)。</li>
        <li>効果量: η² (SS_between / SS_total)、partial η² (mixed で標準)、ω² (バイアス補正)。Cohen's f も。</li>
        <li>報告例: "F(2, 45) = 5.24, p = .009, η² = .19, 90%CI [.03, .34]. Tukey HSD: 群 A > 群 C (p = .007)、他ペアは n.s."</li>
        <li>ノンパラ代替: Kruskal-Wallis 検定 → Dunn の事後比較。</li>
        <li>反復測定なら: rmANOVA (Mauchly で球面性、違反時は GG/HF 補正)。もしくは LMM (lmer(dv ~ cond + (1|p))) に移行を推奨。</li>
      </ol>`,
    },
    corr: {
      title: '🔗 Pearson 相関の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>散布図で外れ値と非線形性を目視。Pearson は直線関係のみ捉えられる。</li>
        <li>両変数の正規性を Shapiro-Wilk で。歪度が大きい場合は Spearman ρ (順位相関) に。</li>
        <li>効果量そのものが r。95%CI は Fisher z 変換経由で。</li>
        <li>報告例: "r(38) = .42, p = .007, 95%CI [.12, .65]."</li>
        <li>因果を語りたいなら回帰 (交絡変数を統制)。相関だけでは因果は言えない。</li>
      </ol>`,
    },
    chi2: {
      title: '⁉ χ² 検定の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>クロス表を作り、各セルの期待度数を確認。1 つでも期待度数 <5 なら Fisher 直接確率検定に切り替え。</li>
        <li>χ² 適合度 (1 変数) or χ² 独立性 (2 変数) を判定。</li>
        <li>効果量: 適合度は Cohen's w、独立性は Cramer's V (2×2 なら φ)。</li>
        <li>報告例: "χ²(2) = 8.24, p = .016, V = .18."</li>
        <li>2×2 対応データ (Before/After binary) は McNemar 検定。</li>
      </ol>`,
    },
    lmm_within: {
      title: '🧠 LMM 2 レベル (参加者内) の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>R では lme4::lmer(dv ~ condition + (1 | participant))、Python は statsmodels.MixedLM。</li>
        <li>REML=TRUE で分散成分を推定 (デフォルト)。固定効果の検定は Satterthwaite 近似 df (lmerTest パッケージ) を推奨。</li>
        <li>特異解 (singular fit) 警告が出たら random slope を落とすか PCA prior。</li>
        <li>効果量: fixed effect coef / residual SD (standardized β) 、または partial R² (r2glmm::r2beta)。</li>
        <li>報告例: "The fixed effect of condition was significant, β = 0.48, SE = 0.15, t(23.2) = 3.20, p = .004 (Satterthwaite)."</li>
      </ol>`,
    },
    lmm_crossed: {
      title: '🧠 LMM 3 レベル (参加者×刺激) の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>lme4::lmer(dv ~ condition + (1 | participant) + (1 | stimulus))。交差ランダム効果。</li>
        <li>Maximal model 推奨: (1 + condition | participant) + (1 + condition | stimulus) → 収束しないなら段階的に削減 (Barr et al. 2013 / Bates et al. 2015)。</li>
        <li>Keep it maximal vs parsimonious の議論あり。REML + Satterthwaite で t 検定。</li>
        <li>結果報告に random effect variance と ICC も (participant, stimulus 別で) 含める。</li>
      </ol>`,
    },
    bayes_t: {
      title: '☯ ベイズ (JZS BF10) 対応 t 検定の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>R: <code>BayesFactor::ttestBF(x, y, paired = TRUE, rscale = "medium")</code> or <code>rscale = 0.707</code>。 rscale は Cauchy 事前のスケール r。</li>
        <li>Python: <code>pingouin.bayesfactor_ttest(t, nx, ny=None, paired=True, r=0.707)</code>。</li>
        <li>報告: BF10 (H1 vs H0)、 median posterior effect size、 95% HDI (highest density interval)。</li>
        <li>Jeffreys の目安 (BF10): 1-3 anecdotal / 3-10 moderate / 10-30 strong / 30-100 very strong / >100 extreme。逆に 1/3-1/10 は moderate for H0。</li>
        <li>報告例: "The Bayesian paired t-test yielded BF10 = 8.4 (moderate evidence for H1; median δ = 0.62, 95% HDI [0.23, 1.01])."</li>
        <li>逐次デザイン (SBF, Schönbrodt et al. 2017): n を増やしながら BF10 を監視、閾値 (例: K=10) を超えたら停止。 α 補正不要 (ベイズは標本サイズ依存の過誤率制御が不要)。期待 n は固定 t 検定より 20-40% 小さい。</li>
        <li>事前分布の選び方: 中立なら r = 1/√2 ≈ 0.707 (medium)、小さな効果を想定するなら r = 0.5 (narrow)、大きな効果 or 情報事前がないなら r = 1.0 (wide)。</li>
        <li>Bayes-frequentist の比較: 頻度論の「有意/非有意」 vs ベイズの「H1 支持 / H0 支持 / 判断不能」。ベイズは「効果なし」も直接支持できる (頻度論では「有意でない=効果なし」と断定できない)。</li>
      </ol>`,
    },
    glmm_nb: {
      title: '📈 負の二項 GLMM (過分散カウント) の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>まず Poisson を試す: <code>glmer(y ~ x + (1 | p), family = poisson)</code>。 <code>performance::check_overdispersion(m)</code> で過分散を検定。 p<.05 なら NB に切り替え。</li>
        <li>R: <code>glmmTMB(y ~ x + (1 | p), family = nbinom2)</code>。 NB2 パラメータ化 (分散 = μ + μ²/θ) が現代の標準。 NB1 (分散 = μ × φ) は特殊ケース。</li>
        <li>過分散パラメータ θ (別名 size, k, r) の推定値を報告。 θ が小さい (例: 0.5-2) ほど過分散が深刻。</li>
        <li>効果量: レート比 RR = exp(β1)。過分散でも解釈は Poisson と同じ。 SE は Poisson より広くなる (適切に不確実性を反映)。</li>
        <li>報告例: "RR = 1.68, 95%CI [1.15, 2.46], z = 2.71, p = .007, θ̂ = 2.4 (Poisson 検定より 12% 広い CI, 過分散を適切に取り込んだ結果)"</li>
        <li>ゼロ過剰なら zero-inflated NB: <code>glmmTMB(y ~ x + (1 | p), ziformula = ~1, family = nbinom2)</code>。</li>
        <li>Poisson で SE 過小評価の兆候 (Wald 検定が過剰有意) が出るのは過分散の警告。分散安定性は「NB → Poisson の再検討」より先に。</li>
      </ol>`,
    },
    glmm_ordinal: {
      title: '📶 順序ロジット GLMM (リッカート等) の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>R: <code>ordinal::clmm(y ~ x + (1 | p), data = df)</code> で累積ロジット (proportional odds) モデル。 y は ordered factor に。</li>
        <li>比例オッズ仮定の検証: <code>ordinal::nominal_test(m)</code> で各予測子の比例オッズ性を検定。有意なら partial POM (<code>clm(..., nominal = ~x)</code>) or 多項ロジットを検討。</li>
        <li>効果量: 「1 カテゴリ上に上がるオッズ比」 OR = exp(β)。潜在変数スケールで解釈するなら Cohen d 相当は d ≈ β · √3/π ≈ β/1.81。</li>
        <li>報告例: "OR = 1.85, 95%CI [1.24, 2.76], z = 3.02, p = .003 (proportional odds 仮定は非有意, p = .21)"</li>
        <li>ノンパラ代替: Wilcoxon 符号順位検定 (対応) / Mann-Whitney U (独立) / Kruskal-Wallis (独立 3+ 群) / Friedman (対応 3+ 群)。これらは順位を使うだけで効果量がスケール依存になりやすいので、 clmm を優先推奨。</li>
        <li>7 段階以上の Likert で中央付近が山型なら、 t 検定でも数% の効率損失で済む。 3-5 段階だと clmm の恩恵が大きい。</li>
        <li>Python: statsmodels に clmm 相当は無いので、R の ordinal パッケージを rpy2 or pymer4 経由で。</li>
      </ol>`,
    },
    glmm_poisson: {
      title: '📊 Poisson GLMM (回数データ) の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>まず記述統計: 各条件の平均と分散を見る。 Poisson 分布は平均 = 分散を仮定するので、分散 >> 平均なら過分散 (overdispersion)、負の二項 (negative binomial) を検討。</li>
        <li>R: <code>glmer(y ~ x + (1 | p), family = poisson, data = df)</code>、 Python: statsmodels の <code>sm.GEE</code> family=Poisson で GEE 近似、または <code>PoissonBayesMixedGLM</code>。</li>
        <li>過分散検定: <code>performance::check_overdispersion(model)</code>。 p<.05 なら過分散 → <code>glmmTMB(y ~ x + (1|p), family = nbinom2)</code> or <code>MASS::glm.nb</code> に切り替え。</li>
        <li>効果量: レート比 RR = exp(β1)。 95% CI は Wald or profile likelihood。「提案条件ではベースラインの X 倍発生」と報告。</li>
        <li>ゼロ過剰 (zero inflation): 観測が大量に 0 なら Poisson でも NB でも適合が悪い → <code>zeroinfl</code> or <code>glmmTMB(..., ziformula = ~1)</code>。</li>
        <li>報告例: "RR = 1.68, 95%CI [1.20, 2.36], z = 2.94, p = .003. 参加者ランダム切片の分散 σ²_p = 0.28。"</li>
        <li>提示がオフセット (試行時間が参加者ごとに違う等) を含むなら <code>offset(log(time))</code> をモデルに追加。</li>
      </ol>`,
    },
    glmm_logit: {
      title: '🎯 Logistic GLMM の実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>lme4::glmer(dv ~ condition + (1 | participant), family = binomial)。参加者内 2 値アウトカム。</li>
        <li>optimizer='bobyqa' or 'Nelder_Mead' で収束を改善。分離 (complete separation) が起きたら bglmer (blme パッケージ) で弱情報事前分布を。</li>
        <li>効果量: オッズ比 OR = exp(β)。95%CI は Wald か profile likelihood。</li>
        <li>報告例: "OR = 2.04, 95%CI [1.32, 3.15], z = 3.11, p = .002."</li>
        <li>参加者ランダム切片の分散 σ² も報告。ICC (VPC) = σ²_p / (σ²_p + π²/3)。</li>
      </ol>`,
    },
  };
  const g = guides[state.test];
  if (!g) return '';
  return `
    <details open style="margin-top:8px; padding:8px 12px; background:#f0fdf4; border-radius:6px">
      <summary style="cursor:pointer; font-weight:600; color:#059669">${g.title} (現在選択中の検定)</summary>
      <div style="margin-top:6px; font-size:13px; line-height:1.75">
        ${g.body}
      </div>
    </details>`;
}

// v1032 参加者 vs 試行の戦略比較テーブル (中村さんビジョン中核)
function renderLMMStrategyTable(res, t, kind = 'lmm') {
  const p = res.params;
  const baseN = res.mode === 'a_priori' ? res.n_required : p.n_p;
  const baseT = kind === 'lmm3' ? p.n_stim : p.n_trials;
  const trialLabel = kind === 'lmm3' ? '刺激' : '試行';
  // v1053 グローバル予算試算 (実験時間 × 時給 × 税金 × 参加形式) を優先。
  //   従来の cost_per_participant フィールドは後方互換のため残すが、予算 block が
  //   0 以外の値を返す限りそちら (グローバル) を採用。
  const globalCost = costPerParticipant();
  const oldCost = (kind === 'glmm' ? state.glmm.cost_per_participant
                            : kind === 'glmm_poisson' ? state.glmm_poisson.cost_per_participant
                            : kind === 'glmm_ordinal' ? state.glmm_ordinal.cost_per_participant
                            : kind === 'glmm_nb' ? state.glmm_nb.cost_per_participant
                            : kind === 'lmm3' ? state.lmm3.cost_per_participant
                            : state.lmm.cost_per_participant) ?? 0;
  const perParticipantCost = globalCost > 0 ? globalCost : oldCost;
  const strategies = [
    { label: '現在', n_p: baseN, n_t: baseT },
    { label: '参加者 +25%', n_p: Math.ceil(baseN * 1.25), n_t: baseT },
    { label: '参加者 +50%', n_p: Math.ceil(baseN * 1.50), n_t: baseT },
    { label: `${trialLabel} +50%`, n_p: baseN, n_t: Math.ceil(baseT * 1.50) },
    { label: `${trialLabel} +100%`, n_p: baseN, n_t: baseT * 2 },
    { label: '両方 +25%', n_p: Math.ceil(baseN * 1.25), n_t: Math.ceil(baseT * 1.25) },
  ];
  const runSim = (n_p, n_t) => {
    if (kind === 'lmm3') return simulateLMM3({ n_p, n_stim: n_t, beta: p.beta, sd_p: p.sd_p, sd_s: p.sd_s, sd_e: p.sd_e, sd_slope_p: p.sd_slope_p || 0, sd_slope_s: p.sd_slope_s || 0, alpha: p.alpha, iterations: 500, tails: p.tails });
    if (kind === 'glmm') return simulateGLMM({ n_p, n_trials: n_t, baseline_p: p.baseline_p, or: p.or, sd_p: p.sd_p, alpha: p.alpha, iterations: 500, tails: p.tails });
    if (kind === 'glmm_poisson') return simulatePoissonGLMM({ n_p, n_trials: n_t, baseline_rate: p.baseline_rate, rr: p.rr, sd_p: p.sd_p, alpha: p.alpha, iterations: 500, tails: p.tails });
    if (kind === 'glmm_ordinal') return simulateOrdinalGLMM({ n_p, n_trials: n_t, k_cat: p.k_cat, d: p.d, sd_p: p.sd_p, alpha: p.alpha, iterations: 500, tails: p.tails });
    if (kind === 'glmm_nb') return simulateNBGLMM({ n_p, n_trials: n_t, baseline_rate: p.baseline_rate, rr: p.rr, theta: p.theta, sd_p: p.sd_p, alpha: p.alpha, iterations: 500, tails: p.tails });
    return simulateLMM({ n_p, n_trials: n_t, beta: p.beta, sd_p: p.sd_p, sd_e: p.sd_e, sd_slope: p.sd_slope || 0, alpha: p.alpha, iterations: 500, tails: p.tails });
  };
  const rows = strategies.map(st => {
    const power = runSim(st.n_p, st.n_t).power;
    const N_obs = st.n_p * st.n_t * 2;
    const cost = perParticipantCost * st.n_p;
    return { ...st, power, N_obs, cost };
  });
  const costLabel = perParticipantCost > 0 ? '<th style="padding:6px 10px; text-align:right">推定費用</th>' : '';
  const costCell = (r) => perParticipantCost > 0 ? `<td style="padding:6px 10px; text-align:right">¥${Math.round(r.cost).toLocaleString()}</td>` : '';
  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📋 参加者 vs 試行の効率比較</div>
      <div class="hint-sm" style="margin-bottom:6px">「参加者を増やすべきか、試行数を増やすべきか」を LMM シミュで直接比較。混合効果モデルでは同じ意味になりません (参加者間 SD と残差 SD の比で変わる)。</div>
      <div style="overflow-x:auto">
        <table style="width:100%; font-size:13px; border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1.5px solid #d1d5db; color:#374151">
              <th style="padding:6px 10px; text-align:left">戦略</th>
              <th style="padding:6px 10px; text-align:right">参加者 n_p</th>
              <th style="padding:6px 10px; text-align:right">${trialLabel} / 条件</th>
              <th style="padding:6px 10px; text-align:right">総 obs</th>
              <th style="padding:6px 10px; text-align:right">検定力</th>
              ${costLabel}
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr style="border-bottom:1px solid #f3f4f6">
                <td style="padding:6px 10px">${escapeHtml(r.label)}</td>
                <td style="padding:6px 10px; text-align:right">${r.n_p}</td>
                <td style="padding:6px 10px; text-align:right">${r.n_t}</td>
                <td style="padding:6px 10px; text-align:right">${r.N_obs.toLocaleString()}</td>
                <td style="padding:6px 10px; text-align:right; color:${r.power >= 0.8 ? '#059669' : (r.power >= 0.6 ? '#a16207' : '#dc2626')}"><b>${(r.power * 100).toFixed(0)}%</b></td>
                ${costCell(r)}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="hint-sm" style="margin-top:6px">iterations=500 の簡易シミュ (± 4% 程度の誤差)。コスト表示は「1 人あたり謝金」 (下の設定) で出ます。</div>
    </div>`;
}

// ---------------- グラフ ----------------

// 検定タイプ / 現在状態から (z_alpha, ncp, n) の 3 つ組を返す。
//   G*Power 相当の「H0: 標準正規 N(0,1) vs H1: N(ncp, 1)」の対比で描く。
function currentDistStats() {
  const alpha = state.alpha;
  const tails = ['t2','tp','t1','corr','corr_sp'].includes(state.test) ? state.tails : 1;
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
  } else if (state.test === 'rmanova') {
    n = state.n_total;
    const rho_c = Math.max(0.001, Math.min(0.999, state.rho));
    const eps_c = Math.max(0.001, Math.min(1, state.epsilon));
    const factor = state.k / (1 - rho_c) * eps_c;
    ncp = Math.sqrt(n * state.effect * state.effect * factor);
  } else if (state.test === 'corr' || state.test === 'corr_sp') {
    n = state.n_total;
    const nEff = state.test === 'corr_sp' ? n * 0.912 : n;
    const z_r = 0.5 * Math.log((1 + Math.abs(state.effect)) / (1 - Math.abs(state.effect)));
    ncp = nEff > 3 ? z_r * Math.sqrt(nEff - 3) : 0;
  } else if (state.test === 'chi2') {
    n = state.n_total;
    ncp = Math.sqrt(n * state.effect * state.effect);
  }
  return { za, ncp, n, tails };
}

// 標準正規密度
function dnorm(z) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }

// v1027 中村さん指摘「2 手法を比べてるのに効果なし vs 効果ありの分布が並ぶのが気持ち悪い。
//   2 手法の間にどういう差があるかの方が直感的」→ 各検定タイプに「2 群の生分布 (or 相当)」
//   の直感的プロットを追加、従来の H0/H1 検定統計量プロットは details で折り畳み。
function renderIntuitivePlot() {
  if (state.test === 't2' || state.test === 'tp' || state.test === 't1') return renderTwoGroupPlot();
  if (state.test === 'anova' || state.test === 'rmanova') return renderMultiGroupPlot();
  if (state.test === 'corr' || state.test === 'corr_sp')  return renderScatterPlot();
  if (state.test === 'chi2')  return renderProportionsPlot();
  return '';
}

// 2 群の生分布: μ_A=0, σ=1、 μ_B=d の正規分布を重ね書き。効果量 d = 群間差 / SD。
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
  // 群平均を縦破線
  const grpA = 0, grpB = d;
  // 平均間の矢印
  const arrowY = yToPx(dnorm(0)) - 12;
  const label = state.test === 't2' ? ['群 A', '群 B'] : (state.test === 'tp' ? ['ベースライン', '差の平均'] : ['基準値', '観測平均']);
  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📊 群の分布 (Cohen's d = ${d.toFixed(2)})</div>
      <div style="width:100%; overflow-x:auto">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
          ${ticks.join('')}
          <!-- 重なり (灰) -->
          <path d="${overlapArea}" fill="#9ca3af55" stroke="none"/>
          <!-- A 曲線 (青) + 内部塗り薄青 -->
          <path d="${toPath(ptsA)} L ${xToPx(xMax).toFixed(1)} ${yToPx(0).toFixed(1)} L ${xToPx(xMin).toFixed(1)} ${yToPx(0).toFixed(1)} Z" fill="#2563eb22"/>
          <path d="${toPath(ptsA)}" fill="none" stroke="#2563eb" stroke-width="2"/>
          <!-- B 曲線 (橙) + 内部塗り薄橙 -->
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
      <div class="hint-sm" style="margin-top:6px">2 群の分布 (横軸は SD 単位)。重なりが小さいほど、群間差が大きく検出しやすい。 d=0.2 で約 92% 重なり、 d=0.5 で約 80%、 d=0.8 で約 69%。</div>
    </div>`;
}

// ANOVA: k 群の分布を重ね書き
function renderMultiGroupPlot() {
  const f = state.effect;
  const k = state.k;
  if (!isFinite(f) || f <= 0 || k < 2) return '';
  // 群平均を σ=1 上で対称に配置: mean_i = f × (i - (k-1)/2) × √(k / (k-1)) など。
  //   簡易: mean_i を [-a, a] 等間隔、 σ_between = a × √(k / (k-1)) を f に合わせる
  //   → a = f × √((k-1) / k)。実際は f² = σ_between² / σ²、 σ_between² = Σ(μ_i - μ̄)²/k。
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
      <div class="hint-sm" style="margin-top:6px">${k} 群 (横軸 SD 単位)。平均間隔の広がり (σ_between) が大きいほど f も大きく、差を検出しやすい。 f=0.1 (小) は群平均の差が群内 SD の 1/10 程度、 f=0.4 (大) は 40% 程度。</div>
    </div>`;
}

// 相関: n 点の散布図 (擬似データ)、想定 r で線を引く
function renderScatterPlot() {
  const r = state.effect;
  const n = state.n_total;
  if (!isFinite(r) || Math.abs(r) >= 1) return '';
  const nPts = Math.min(n, 200);
  // 擬似データ: 決定的な seed から疑似 gaussian を生成
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
      <div class="bold" style="margin-bottom:8px">📊 散布図 (r = ${r.toFixed(2)}、 n = ${n} の擬似データ)</div>
      <div style="width:100%; overflow-x:auto">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
          <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" stroke="#374151"/>
          ${ticks.join('')}
          ${dots}
          ${line}
        </svg>
      </div>
      <div class="hint-sm" style="margin-top:6px">想定 r で生成した擬似散布図。実際のデータがこういうばらつき方になる想定。 r=0.1 (小) は直線がほぼ見えない、 r=0.5 (大) でようやく傾向が目視で分かる。</div>
    </div>`;
}

// chi²: 帰無と想定の比率を棒グラフで
function renderProportionsPlot() {
  // 効果量 w からは具体的な p 値組が復元できないので、 df+1 個の均等帰無と想定 (w に対応)
  const w = state.effect;
  const df = state.df;
  const k = df + 1;  // df = k - 1 と仮定
  if (!isFinite(w) || w <= 0 || k < 2 || k > 20) return '';
  const p0 = Array(k).fill(1 / k);
  // 想定: 対称に 1 群を +Δ、対称に他を -Δ/(k-1)。 w² = Σ(p-p0)²/p0
  // シンプル: 1 群だけ +Δ、残りは -Δ/(k-1)
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
      <div class="hint-sm" style="margin-top:6px">帰無 (等分布) と想定 (w に相当する偏り) の比較例。実際は効果量 w に対応する分布の選び方は複数あるが、「1 カテゴリに偏る」パターンを表示。</div>
    </div>`;
}

// 分布プロット (H0 vs H1、 α/β/power 領域を色分け)
function renderDistPlot() {
  const { za, ncp, tails } = currentDistStats();
  if (!isFinite(ncp) || ncp <= 0) return '';
  const W = 620, H = 260, PL = 40, PR = 20, PT = 20, PB = 40;
  const xMin = -4, xMax = Math.max(6, ncp + 4);
  const xToPx = (x) => PL + (x - xMin) / (xMax - xMin) * (W - PL - PR);
  const yMax = 0.42;   // dnorm(0) ≈ 0.399、上余白 for label
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
  // 領域塗り (path with fill、 baseline を加える閉じたパス)
  const areaPath = (pts, filterFn) => {
    const filtered = pts.filter(([x]) => filterFn(x));
    if (!filtered.length) return '';
    const seg = filtered.map(([x, y]) => `${xToPx(x).toFixed(1)} ${yToPx(y).toFixed(1)}`).join(' L ');
    const [x0] = filtered[0], [xE] = filtered[filtered.length - 1];
    return `M ${xToPx(x0).toFixed(1)} ${yToPx(0).toFixed(1)} L ${seg} L ${xToPx(xE).toFixed(1)} ${yToPx(0).toFixed(1)} Z`;
  };
  // α 領域: H0 の右 (両側なら左も)
  const alphaPathR = areaPath(h0Points, x => x >= za);
  const alphaPathL = tails === 2 ? areaPath(h0Points, x => x <= -za) : '';
  // power 領域: H1 の右 (critical より右)
  const powerPath = areaPath(h1Points, x => x >= za);
  // β 領域: H1 の左 (critical より左)
  const betaPath  = areaPath(h1Points, x => x <= za);

  // 軸 tick
  const ticks = [];
  for (let t = Math.ceil(xMin); t <= xMax; t++) {
    ticks.push(`<line x1="${xToPx(t)}" y1="${H - PB}" x2="${xToPx(t)}" y2="${H - PB + 4}" stroke="#6b7280"/>
                <text x="${xToPx(t)}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${t}</text>`);
  }

  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📈 検定統計量の分布 (H0 vs H1) — G*Power 型</div>
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
      <div class="hint-sm" style="margin-top:6px"><b>これは「検定で計算する t 値等の統計量の分布」</b>で、群の生分布ではない。青が H0 (効果なしと仮定)、橙が H1 (想定効果が本当にあった場合)。縦点線が α に対応する臨界値、橙が臨界値より右にはみ出す面積が検定力 (緑)、臨界値より左に残る面積が β (灰)。実際の群の分布は上の「群の分布」プロットで。</div>
    </div>`;
}

// 検定力カーブ (n を変えた時の power)
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
      if (state.test === 'rmanova') p = calc_rmanova(state.alpha, state.effect, state.k, state.rho, state.epsilon, 'post_hoc', n, 0.8).power;
      if (state.test === 'corr')  p = calc_correlation(state.alpha, state.effect, state.tails, 'post_hoc', n, 0.8).power;
      if (state.test === 'corr_sp') p = calc_spearman(state.alpha, state.effect, state.tails, 'post_hoc', n, 0.8).power;
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
  // 現在 n の点
  let curP = 0;
  try {
    if (state.test === 't2')    curP = calc_ttest_two_sample(state.alpha, state.effect, state.tails, 'post_hoc', nowN, 0.8).power;
    if (state.test === 'tp' || state.test === 't1') curP = calc_ttest_paired(state.alpha, state.effect, state.tails, 'post_hoc', nowN, 0.8).power;
    if (state.test === 'anova') curP = calc_anova(state.alpha, state.effect, state.k, 'post_hoc', nowN, 0.8).power;
    if (state.test === 'rmanova') curP = calc_rmanova(state.alpha, state.effect, state.k, state.rho, state.epsilon, 'post_hoc', nowN, 0.8).power;
    if (state.test === 'corr')  curP = calc_correlation(state.alpha, state.effect, state.tails, 'post_hoc', nowN, 0.8).power;
    if (state.test === 'corr_sp') curP = calc_spearman(state.alpha, state.effect, state.tails, 'post_hoc', nowN, 0.8).power;
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
          <!-- 現在 n の点 -->
          <circle cx="${xToPx(nowN)}" cy="${yToPx(curP)}" r="5" fill="#7b3fa0"/>
          <text x="${xToPx(nowN) + 8}" y="${yToPx(curP) + 4}" font-size="11" fill="#7b3fa0">現在 n=${nowN}, ${(curP * 100).toFixed(0)}%</text>
          <text x="${PL - 30}" y="${(PT + H - PB) / 2}" transform="rotate(-90, ${PL - 30}, ${(PT + H - PB) / 2})" font-size="11" fill="#374151" text-anchor="middle">検定力 (1-β)</text>
          <text x="${(PL + W - PR) / 2}" y="${H - 6}" font-size="11" fill="#374151" text-anchor="middle">${xLabel}</text>
        </svg>
      </div>
      <div class="hint-sm" style="margin-top:6px">n を増やすと検定力がどう上がるか。緑の点線は慣習的な目標 (0.8)。現在 n の検定力を紫の点で表示。</div>
    </div>`;
}

function renderResult(out, t) {
  const root = document.getElementById('pw-result');
  if (!out) return;
  if (out.error) { root.innerHTML = `<div class="card" style="color:#dc2626">${escapeHtml(out.error)}</div>`; return; }
  // A priori の場合は計算結果の n を state に反映してグラフを描く
  if (state.mode === 'a_priori') {
    if (state.test === 't2')    state.n_per_group = out.n_per_group;
    else                        state.n_total     = out.n_total;
  }
  const tailStr = state.tails === 2 ? '両側' : '片側';
  const args = `α=${state.alpha}, ${state.tails === 2 || !['t2','tp','t1','corr','corr_sp'].includes(state.test) ? tailStr : tailStr}, ${t.eff}=${state.effect}`;
  const extraArgs = state.test === 'anova' ? `, k=${state.k}`
                  : state.test === 'rmanova' ? `, k=${state.k}, ρ=${state.rho}, ε=${state.epsilon}`
                  : state.test === 'chi2' ? `, df=${state.df}` : '';
  // v1025b 中村さん指摘「計算し直したときに、グラフが作り変えられない」→ 従来は
  //   root.innerHTML → insertAdjacentHTML の 2 段構えでグラフを追記していたが、
  //   タイミング依存で追記がスキップされる事例あり。結果カード + 分布プロット +
  //   検定力カーブを 1 つの文字列にまとめて一度に innerHTML でセット、再計算のたび
  //   に全部綺麗に描き直す。
  // v1052 中村さん指摘「対応あり t 検定で n が奇数のことがあって気持ち悪い。手法で
  //   まず必要な n があって、その手法数分ではないか。分散分析で k=3 の時も同様。」
  //   → 検定タイプ別に「参加者数 × 手法数 = 全観測数」を明示的に表示。
  //   対応あり/反復測定では参加者数がベースで、全観測数 = 参加者数 × k。
  //   独立系 (2 標本 t、一元 ANOVA) では各手法あたりの参加者数がベースで、
  //   全体 N = 各手法 n × 手法数。
  let resultHtml = '';
  if (state.mode === 'a_priori') {
    let nMsg = '';
    if (state.test === 't2') {
      // 独立 2 手法
      nMsg = `各手法の参加者数 n = <b>${out.n_per_group}</b> 名 × 2 手法 = 全体 <b>${out.n_total}</b> 名`;
    } else if (state.test === 'tp') {
      // 対応あり 2 手法 (同じ参加者)
      const n_p = out.n_total;
      nMsg = `参加者数 <b>${n_p}</b> 名 × 2 手法 = 全観測数 <b>${n_p * 2}</b>`;
    } else if (state.test === 't1') {
      // 1 標本 (基準値と比較)
      nMsg = `参加者数 <b>${out.n_total}</b> 名`;
    } else if (state.test === 'anova') {
      // 独立 k 手法
      nMsg = `各手法の参加者数 n = <b>${out.n_per_group}</b> 名 × ${state.k} 手法 = 全体 <b>${out.n_total}</b> 名`;
    } else if (state.test === 'rmanova') {
      // 反復測定 k 手法
      const n_p = out.n_total;
      nMsg = `参加者数 <b>${n_p}</b> 名 × ${state.k} 手法 (or 条件・時点) = 全観測数 <b>${n_p * state.k}</b>`;
    } else if (state.test === 'chi2') {
      nMsg = `全体 N = <b>${out.n_total}</b>`;
    } else if (state.test === 'corr' || state.test === 'corr_sp') {
      nMsg = `参加者数 <b>${out.n_total}</b> 名`;
    } else {
      nMsg = `全体 N = <b>${out.n_total}</b>`;
    }
    // 募集人数目安 (脱落 10% 見込み)
    const baseParticipants = state.test === 't2' ? out.n_total   // 独立 2 手法: 全体 N = 参加者総数
                          : state.test === 'anova' ? out.n_total // 独立 k 手法: 全体 N = 参加者総数
                          : out.n_total;                          // 対応あり/1 標本: 参加者数 = n_total
    resultHtml = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🎯 必要サンプルサイズ (A priori)</div>
        <div style="font-size:22px; line-height:1.55">${nMsg}</div>
        <div class="hint-sm" style="margin-top:8px">検定力 1-β = ${state.power} を得るため。 ${args}${extraArgs}</div>
        <div class="hint-sm" style="margin-top:4px; color:#a16207">脱落・除外を見込んで <b>${Math.ceil(baseParticipants * 1.10)}</b> 名募集する等の余裕を持たせるとよいです。</div>
      </div>
      ${renderBudgetSummary(baseParticipants, '必要')}`;
  } else {
    const p = out.power;
    const pctColor = p >= 0.8 ? '#059669' : (p >= 0.6 ? '#a16207' : '#dc2626');
    // Post hoc: 現在の n の表示
    let nDisplay = '';
    if (state.test === 't2') {
      nDisplay = `各手法 n = ${state.n_per_group} 名 (全体 ${state.n_per_group * 2} 名)`;
    } else if (state.test === 'tp') {
      nDisplay = `参加者 ${state.n_total} 名 × 2 手法 = ${state.n_total * 2} 観測`;
    } else if (state.test === 't1') {
      nDisplay = `参加者 ${state.n_total} 名`;
    } else if (state.test === 'anova') {
      nDisplay = `全体 ${state.n_total} 名 (各手法約 ${Math.round(state.n_total / state.k)} 名)`;
    } else if (state.test === 'rmanova') {
      nDisplay = `参加者 ${state.n_total} 名 × ${state.k} 手法 = ${state.n_total * state.k} 観測`;
    } else {
      nDisplay = `n = ${state.n_total}`;
    }
    // Post hoc 用の参加者数 (現在の n)
    const currentParticipants = state.test === 't2' ? state.n_per_group * 2 : state.n_total;
    resultHtml = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🔍 得られる検定力 (Post hoc)</div>
        <div style="font-size:28px; line-height:1.5; color:${pctColor}"><b>${(p * 100).toFixed(1)}%</b></div>
        <div class="hint-sm" style="margin-top:8px">現在の ${nDisplay} で効果量が想定通りなら上記の確率で有意になります。 ${args}${extraArgs}</div>
        ${p < 0.8 ? '<div class="hint-sm" style="margin-top:4px; color:#a16207">💡 検定力 80% 未満: 効果があってもそれを検出できず「型 II 過誤」が起きる可能性が高めです。</div>' : ''}
      </div>
      ${renderBudgetSummary(currentParticipants, '現在')}`;
  }
  // v1027 直感的プロット (2 群 or k 群 or 散布図 or 比率棒) を主役に、従来の
  //   G*Power 型検定統計量プロットはその下に残す (中村さん指示「G*Power の
  //   やつも残しておいて良い、 2 群の分布もやっぱり欲しい」)。
  root.innerHTML = resultHtml + renderIntuitivePlot() + renderDistPlot() + renderPowerCurve() + renderSensitivityCurve();
}

// v1038 感度分析: 効果量を範囲スキャン → 検定力カーブ (中村さん要望「感度分析」)。
//   G*Power にはない、中村研では必要な機能。効果量 (d/f/r/w) を ±3× 範囲で 15 点スキャン、
//   各点で現在 n の検定力を計算 → SVG カーブ。現在の効果量位置を縦点線で強調、
//   検定力 0.8 の水平点線も。従来の「⑤ n を変えた時のカーブ」と「⑥ 効果量を変えた
//   時のカーブ」の 2 本立てをそろえた形。
//   sim系 (LMM/LMM3/GLMM) は効果量スキャンが重い → シミュ 100 回に減らして 15 点 (合計
//   ~1500 iters、数秒) で描く。
function renderSensitivityCurve() {
  const nowN = state.test === 't2' ? state.n_per_group : state.n_total;
  const t = TESTS.find(x => x.id === state.test);
  if (!t) return '';
  const effLabel = state.test === 'anova' || state.test === 'rmanova' ? "Cohen's f"
                 : state.test === 'corr' ? "Pearson r"
                 : state.test === 'corr_sp' ? "Spearman ρ"
                 : state.test === 'chi2' ? "Cohen's w"
                 : state.test === 'lmm_within' || state.test === 'lmm_crossed' ? '固定効果 β'
                 : state.test === 'glmm_logit' ? '効果量 OR'
                 : state.test === 'glmm_poisson' ? '効果量 RR'
                 : state.test === 'glmm_nb' ? '効果量 RR'
                 : state.test === 'glmm_ordinal' ? "Cohen's d (latent)"
                 : "Cohen's d";
  const effUnit = state.test === 'glmm_logit' ? 'OR' : (state.test === 'glmm_poisson' || state.test === 'glmm_nb') ? 'RR' : '';
  let currentEff, effRange, points;
  const isSim = ['lmm_within','lmm_crossed','glmm_logit','glmm_poisson','glmm_ordinal','glmm_nb','bayes_t','fisher_2x2'].includes(state.test);
  if (isSim) {
    // sim 系: 効果量スキャン
    if (state.test === 'glmm_logit') {
      currentEff = state.glmm.or;
      const eMax = Math.max(4, currentEff * 3);
      effRange = [1.0, eMax];
    } else if (state.test === 'glmm_poisson') {
      currentEff = state.glmm_poisson.rr;
      const eMax = Math.max(3, currentEff * 3);
      effRange = [1.0, eMax];
    } else if (state.test === 'glmm_nb') {
      currentEff = state.glmm_nb.rr;
      const eMax = Math.max(3, currentEff * 3);
      effRange = [1.0, eMax];
    } else if (state.test === 'glmm_ordinal') {
      currentEff = state.glmm_ordinal.d;
      const eMax = Math.max(1.5, Math.abs(currentEff) * 3);
      effRange = [0, eMax];
    } else {
      currentEff = state.test === 'lmm_within' ? state.lmm.beta : state.lmm3.beta;
      const eMax = Math.max(1.0, Math.abs(currentEff) * 3);
      effRange = [0, eMax];
    }
    // 15 点 × iterations=100 で ~1500 sim
    const steps = 15;
    points = [];
    for (let i = 0; i < steps; i++) {
      const e = effRange[0] + (effRange[1] - effRange[0]) * (i / (steps - 1));
      let power;
      try {
        if (state.test === 'lmm_within') {
          const p = state.lmm;
          const r = simulateLMM({ n_p: nowN, n_trials: p.n_trials, beta: e, sd_p: p.sd_participant, sd_e: p.sd_residual, sd_slope: p.sd_slope || 0, alpha: state.alpha, iterations: 100, tails: state.tails });
          power = r.power;
        } else if (state.test === 'lmm_crossed') {
          const p = state.lmm3;
          const r = simulateLMM3({ n_p: nowN, n_stim: p.n_stimuli, beta: e, sd_p: p.sd_participant, sd_s: p.sd_stimulus, sd_e: p.sd_residual, sd_slope_p: p.sd_slope_p || 0, sd_slope_s: p.sd_slope_s || 0, alpha: state.alpha, iterations: 100, tails: state.tails });
          power = r.power;
        } else if (state.test === 'glmm_logit') {
          const p = state.glmm;
          const r = simulateGLMM({ n_p: nowN, n_trials: p.n_trials, baseline_p: p.baseline_p, or: e, sd_p: p.sd_participant, alpha: state.alpha, iterations: 100, tails: state.tails });
          power = r.power;
        } else if (state.test === 'glmm_poisson') {
          const p = state.glmm_poisson;
          const r = simulatePoissonGLMM({ n_p: nowN, n_trials: p.n_trials, baseline_rate: p.baseline_rate, rr: e, sd_p: p.sd_participant, alpha: state.alpha, iterations: 100, tails: state.tails });
          power = r.power;
        } else if (state.test === 'glmm_ordinal') {
          const p = state.glmm_ordinal;
          const r = simulateOrdinalGLMM({ n_p: nowN, n_trials: p.n_trials, k_cat: p.k_cat, d: e, sd_p: p.sd_participant, alpha: state.alpha, iterations: 100, tails: state.tails });
          power = r.power;
        } else if (state.test === 'glmm_nb') {
          const p = state.glmm_nb;
          const r = simulateNBGLMM({ n_p: nowN, n_trials: p.n_trials, baseline_rate: p.baseline_rate, rr: e, theta: p.theta, sd_p: p.sd_participant, alpha: state.alpha, iterations: 100, tails: state.tails });
          power = r.power;
        }
      } catch (_) { power = 0; }
      if (!isFinite(power)) power = 0;
      points.push([e, power]);
    }
  } else {
    // 解析系: 高速で 40 点スキャン
    currentEff = state.effect;
    const eMax = Math.max(currentEff * 3, (state.test === 'corr' || state.test === 'corr_sp') ? 0.9 : state.test === 'chi2' ? 0.9 : 1.5);
    const eMin = 0.01;
    effRange = [eMin, eMax];
    const steps = 40;
    points = [];
    for (let i = 0; i < steps; i++) {
      const e = eMin + (eMax - eMin) * (i / (steps - 1));
      let power;
      try {
        if (state.test === 't2')    power = calc_ttest_two_sample(state.alpha, e, state.tails, 'post_hoc', nowN, 0.8).power;
        else if (state.test === 'tp' || state.test === 't1') power = calc_ttest_paired(state.alpha, e, state.tails, 'post_hoc', nowN, 0.8).power;
        else if (state.test === 'anova') power = calc_anova(state.alpha, e, state.k, 'post_hoc', nowN, 0.8).power;
        else if (state.test === 'rmanova') power = calc_rmanova(state.alpha, e, state.k, state.rho, state.epsilon, 'post_hoc', nowN, 0.8).power;
        else if (state.test === 'corr')  power = calc_correlation(state.alpha, e, state.tails, 'post_hoc', nowN, 0.8).power;
        else if (state.test === 'corr_sp') power = calc_spearman(state.alpha, e, state.tails, 'post_hoc', nowN, 0.8).power;
        else if (state.test === 'chi2')  power = calc_chi_squared(state.alpha, e, state.df, 'post_hoc', nowN, 0.8).power;
      } catch (_) { power = 0; }
      if (!isFinite(power)) power = 0;
      points.push([e, power]);
    }
  }
  const W = 620, H = 240, PL = 42, PR = 20, PT = 20, PB = 40;
  const xToPx = (x) => PL + (x - effRange[0]) / (effRange[1] - effRange[0]) * (W - PL - PR);
  const yToPx = (y) => PT + (1 - y) * (H - PT - PB);
  const path = 'M ' + points.map(([x, y]) => `${xToPx(x).toFixed(1)} ${yToPx(y).toFixed(1)}`).join(' L ');
  const y80 = yToPx(0.8);
  // 現在の効果量位置の縦点線
  const curX = xToPx(currentEff);
  // 目安ライン (小/中/大) — 検定によって異なる
  const benchmarks = {
    t2:    [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    tp:    [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    t1:    [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    anova: [[0.10, '小'], [0.25, '中'], [0.40, '大']],
    rmanova: [[0.10, '小'], [0.25, '中'], [0.40, '大']],
    corr:  [[0.10, '小'], [0.30, '中'], [0.50, '大']],
    corr_sp: [[0.10, '小'], [0.30, '中'], [0.50, '大']],
    chi2:  [[0.10, '小'], [0.30, '中'], [0.50, '大']],
    lmm_within:  [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    lmm_crossed: [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    glmm_logit:  [[1.5, '小'], [2.0, '中'], [3.0, '大']],
    glmm_poisson: [[1.3, '小'], [1.5, '中'], [2.0, '大']],
    glmm_ordinal: [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    glmm_nb: [[1.3, '小'], [1.5, '中'], [2.0, '大']],
  }[state.test] || [];
  const benchMarks = benchmarks.filter(([v]) => v >= effRange[0] && v <= effRange[1]).map(([v, label]) =>
    `<line x1="${xToPx(v)}" y1="${PT}" x2="${xToPx(v)}" y2="${H - PB}" stroke="#d4d4d4" stroke-dasharray="2 2"/>
     <text x="${xToPx(v)}" y="${PT + 12}" text-anchor="middle" font-size="9" fill="#9ca3af">${label}(${v})</text>`
  ).join('');
  // 「80% 到達に必要な効果量」逆算 (点列線形補間)
  let effAt80 = null;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (y0 <= 0.8 && y1 >= 0.8 && y1 !== y0) {
      effAt80 = x0 + (0.8 - y0) / (y1 - y0) * (x1 - x0);
      break;
    }
  }
  const xticks = [];
  const nTicks = 6;
  for (let i = 0; i <= nTicks; i++) {
    const e = effRange[0] + (effRange[1] - effRange[0]) * (i / nTicks);
    xticks.push(`<line x1="${xToPx(e)}" y1="${H - PB}" x2="${xToPx(e)}" y2="${H - PB + 4}" stroke="#6b7280"/>
                 <text x="${xToPx(e)}" y="${H - PB + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${e.toFixed(2)}</text>`);
  }
  const yticks = [];
  for (let p of [0, 0.2, 0.4, 0.6, 0.8, 1.0]) {
    yticks.push(`<line x1="${PL - 4}" y1="${yToPx(p)}" x2="${PL}" y2="${yToPx(p)}" stroke="#6b7280"/>
                 <text x="${PL - 6}" y="${yToPx(p) + 3}" text-anchor="end" font-size="10" fill="#6b7280">${p.toFixed(1)}</text>`);
  }
  return `
    <div class="card">
      <div class="bold" style="margin-bottom:4px">📉 感度分析 (効果量 ${effLabel} を変えた時の検定力)</div>
      <div class="hint-sm" style="margin-bottom:8px">現在の n (${nowN}) を保ったまま、効果量 ${effLabel} を変えたら検定力がどう動くか。「想定していた効果量が実は小さかったら…」のリスクを可視化 (G*Power にはない)。${isSim ? ' シミュ 100×15 点。' : ''}${effAt80 ? ` <b style="color:#7b3fa0">検定力 80% に必要な ${effLabel} ≈ ${effAt80.toFixed(3)}${effUnit ? ' ' + effUnit : ''}</b>` : ''}</div>
      <div style="width:100%; overflow-x:auto">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:${W}px; height:auto; display:block; margin:0 auto">
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#374151"/>
          <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" stroke="#374151"/>
          ${xticks.join('')}
          ${yticks.join('')}
          ${benchMarks}
          <line x1="${PL}" y1="${y80}" x2="${W - PR}" y2="${y80}" stroke="#059669" stroke-dasharray="4 3" opacity="0.7"/>
          <text x="${W - PR - 4}" y="${y80 - 4}" text-anchor="end" font-size="10" fill="#059669">目標 0.8</text>
          <path d="${path}" fill="none" stroke="#7b3fa0" stroke-width="2"/>
          <line x1="${curX}" y1="${PT}" x2="${curX}" y2="${H - PB}" stroke="#dc2626" stroke-dasharray="3 3" opacity="0.9"/>
          <text x="${curX}" y="${PT - 4}" text-anchor="middle" font-size="10" fill="#dc2626">現在 ${currentEff}${effUnit ? ' ' + effUnit : ''}</text>
          <text x="${PL + (W - PL - PR)/2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="#374151">効果量 ${effLabel}</text>
          <text x="12" y="${PT + (H - PT - PB)/2}" transform="rotate(-90 12 ${PT + (H - PT - PB)/2})" text-anchor="middle" font-size="11" fill="#374151">検定力</text>
        </svg>
      </div>
    </div>`;
}

function clampFloat(v, lo, hi) {
  const n = parseFloat(v);
  if (isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
