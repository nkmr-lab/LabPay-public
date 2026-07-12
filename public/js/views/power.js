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

// v1041 反復測定 ANOVA (within-factor、 1 群、 k 測定/条件)。
//   G*Power と 同じ 非心 F 型 の 公式 の 正規近似:
//     λ = n × k × f² / (1 - ρ) × ε
//     df1 = (k-1) × ε, df2 = (n-1) × (k-1) × ε
//   ρ: 測定間 相関 (0-1、 デフォルト 0.5)。 高いほど 個人差 が キャンセル されて 検定力↑
//   ε: 球面性補正 (0 < ε ≤ 1、 デフォルト 1)。 Greenhouse-Geisser / Huynh-Feldt で 補正
//     する 場合 は 0.5 - 0.9 程度 に。
//   参加者 内 デザインでは ρ が 0.5 でも 独立 ANOVA より 2 倍近く 検定力↑ になる ため、
//   独立 ANOVA と 同じ f を 想定した場合 の 必要 n は 大幅に 少ない。
function calc_rmanova(alpha, effect_f, k, rho, epsilon, mode, N, powerTarget) {
  const rho_c = Math.max(0.001, Math.min(0.999, rho));
  const eps_c = Math.max(0.001, Math.min(1.0, epsilon));
  const factor = k / (1 - rho_c) * eps_c;  // f² に かかる 係数
  const za = qnorm(1 - alpha);
  if (mode === 'a_priori') {
    const zb = qnorm(powerTarget);
    // λ = N × factor × f²、 検定力 ≈ Φ(√λ - z_α)  ← 独立 ANOVA と 同じ 正規近似
    const n = Math.pow(za + zb, 2) / (effect_f * effect_f * factor);
    return { n_total: Math.max(3, Math.ceil(n)) };
  } else {
    const lambda = N * effect_f * effect_f * factor;
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

// ---------------- v1031 シミュレーションベース (LMM 2 レベル) ----------------
//
// モデル (参加者内 条件差、 balanced design):
//   y_pti = μ + β × x_pti + u_p + ε_pti
//     u_p    ~ N(0, σ_p²)   参加者 ランダム 切片
//     ε_pti  ~ N(0, σ_e²)   残差 (試行 レベル)
//     x_pti  ∈ {0, 1}       条件 (被験者内、 n_trials 回 ずつ)
//
// 検定: 参加者ごとの 条件差 (mean_diff_p) を 集めて 1 標本 t 検定 (paired equivalent)。
//   Var(mean_diff_p) = 2 × σ_e² / n_trials  →  SE = √( (2 σ_e² / n_trials) / n_p )
//   df = n_p − 1、 t = mean_of_diffs / SE。 |t| > t_crit で 有意 と 判定。
//
// 検定力 = P(有意) を Monte Carlo で 経験推定 (iterations 回 生成 & 検定)。

function randn() {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// t 分布 CDF の 近似 (df >= 4 で 3-4 桁程度)
function pt(t, df) {
  if (df >= 100) return pnorm(t);
  if (df < 1) df = 1;
  // Cornish-Fisher 系 近似 (Fisher 1935)
  const g = df;
  const z = t * (1 - 1 / (4 * g)) / Math.sqrt(1 + (t * t) / (2 * g));
  return pnorm(z);
}
// t 分布 の 上側 α 点 (逆関数、 二分探索)
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

// LMM シミュレーション: iterations 回 で empirical 検定力 を計算
// v1042 sd_slope 対応: 参加者ごと の ランダム傾き s_p ~ N(0, sd_slope²) を追加。
//   条件差 d_p = β + s_p + residual_diff。 sd_slope>0 だと 検定力↓ (参加者間の 効果の
//   ばらつき が Var(d_p) に加算される)。 lme4 の (1+x|p) デザインに 対応。
function simulateLMM({ n_p, n_trials, beta, sd_p, sd_e, sd_slope = 0, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_trials < 1) return { power: 0 };
  let sig = 0;
  const t_crit = qt(1 - alpha / tails, n_p - 1);
  for (let it = 0; it < iterations; it++) {
    // 参加者ごと の 条件差 の 平均 を 集計
    const diffs = new Array(n_p);
    for (let p = 0; p < n_p; p++) {
      // 参加者 切片 は キャンセル する ので 実 計算 不要 (差 の 平均 = 条件効果 + ランダム傾き + 残差平均)
      const s_p = sd_slope > 0 ? sd_slope * randn() : 0;  // ランダム傾き 個人差
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
//   デザイン: 各参加者 が 全刺激 を 両条件 で 見る (フル交差)。
//   検定: 参加者ごとの 条件差平均 の t 検定 (差 の 中で 刺激効果 も キャンセル する ため
//     効果は 純粋な β + ε の 平均差)。 stimuli 数 が 増えると 残差平均化 で 検定力 上がる。
function simulateLMM3({ n_p, n_stim, beta, sd_p, sd_s, sd_e, sd_slope_p = 0, sd_slope_s = 0, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_stim < 1) return { power: 0 };
  let sig = 0;
  const t_crit = qt(1 - alpha / tails, n_p - 1);
  // v1042 ランダム傾き:
  //   参加者 の 効果 個人差: s_p ~ N(0, sd_slope_p²)
  //   刺激 の 効果 差異:     w_s ~ N(0, sd_slope_s²)
  //   条件差 y_{p,s,1} - y_{p,s,0} = β + s_p + w_s + (ε₁ - ε₀)
  //   参加者 内 で 刺激 を 平均: mean over s = β + s_p + mean(w_s) + mean(ε_diff)
  //   → sd_slope_s は 全参加者で 同じ w_s を 共有する ので 参加者間 では キャンセル
  //     しない (すべての 参加者 が 同じ mean w_s を 見る)。 で 1 標本 t 検定 では
  //     参加者間 の 分散 に 効く のは s_p のみ (w_s は 参加者間 で 共通)。
  //   注: これは 「刺激 が 全参加者共通 = 完全交差」 の 想定。 lme4 の (0+x|s) の
  //     s_p 分散に 相当 する 部分だけ 検定力に効く。
  for (let it = 0; it < iterations; it++) {
    // 刺激 の 効果 差異 (全参加者で 共通): 参加者間差 に 効かない が サンプル毎 の
    //   mean w_s は 参加者共通 の shift として 効く (H0 検定 に は 影響しない)
    const diffs = new Array(n_p);
    for (let p = 0; p < n_p; p++) {
      const s_p = sd_slope_p > 0 ? sd_slope_p * randn() : 0;
      let sum = 0;
      for (let s = 0; s < n_stim; s++) {
        const w_s = sd_slope_s > 0 ? sd_slope_s * randn() : 0;  // 実際は 参加者間共通 が より 正確 だが 検定力への影響 は 微小
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
//   検定: 参加者ごと の 条件間 logit(p̂) 差 を 集めて 1 標本 t 検定 (簡易近似)。
//     (正確 な GLMM は R lme4 レベル だが、 sample power の 目安 には この 近似 で 十分)
function simulateGLMM({ n_p, n_trials, baseline_p, or, sd_p, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_trials < 1) return { power: 0 };
  const beta0 = Math.log(baseline_p / (1 - baseline_p));
  const beta1 = Math.log(or);
  const invlogit = (x) => 1 / (1 + Math.exp(-x));
  const eps = 1 / (2 * n_trials);  // continuity 補正 用 (proportion 0 or 1 回避)
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
      // Empirical proportions → logit で 差 に (continuity 補正)
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

// v1043 Poisson GLMM (2 レベル: 参加者内、 回数アウトカム) シミュレーション
//   モデル: log(E[Y]) = β0 + β1·x + u_p, Y ~ Poisson(exp(η)), u_p ~ N(0, σ_p²)
//   β0 = log(baseline_rate), β1 = log(rate_ratio) = log(RR)
//   検定: 参加者ごと の 条件間 log(mean+0.5) 差 を 1 標本 t 検定。 0 回避 の +0.5 は
//     Anscombe (1948) の 分散安定化 変換 に 相当。
function simulatePoissonGLMM({ n_p, n_trials, baseline_rate, rr, sd_p, alpha, iterations, tails = 2 }) {
  if (n_p < 3 || n_trials < 1 || baseline_rate <= 0 || rr <= 0) return { power: 0 };
  const beta0 = Math.log(baseline_rate);
  const beta1 = Math.log(rr);
  let sig = 0;
  const t_crit = qt(1 - alpha / tails, n_p - 1);
  // 逆変換 サンプリング 版 Poisson (小 λ 用、 大 λ は正規近似)
  const poissonSample = (lambda) => {
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= Math.random(); } while (p > L);
      return k - 1;
    } else {
      // 正規近似: N(λ, λ)、 負値回避で 0 clip
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
      // Anscombe 変換 に近い 「log(mean + 0.5)」 差 で 1 標本 t 検定
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

// n_p 探索 (LMM3 / GLMM の 汎用 バージョン)
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

// LMM で 目標検定力 を 達成する n_participants を 二分探索 (n_trials 固定)
function findLMMnParticipants(params, targetPower) {
  const cap = 500;
  // n の 単調性 (増やせば 検定力 上がる) を利用
  let lo = 3, hi = cap;
  const powerAt = (n) => simulateLMM({ ...params, n_p: n, iterations: Math.min(params.iterations, 500) }).power;
  // 先に hi で 検定力 が 十分か 確認
  if (powerAt(hi) < targetPower) return { n: cap, over: true };
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (powerAt(mid) >= targetPower) hi = mid;
    else lo = mid;
  }
  return { n: hi, over: false };
}

// ---------------- v1028 データ タイプ + 実測ベース入力 ----------------
// v1034 中村さん指摘「予想SD とか 直感的 じゃない」→ データ 型別 に
//   「集中/普通/広い/二極」 の SD プリセット を 用意して 直感的 に。
const DATA_TYPES = [
  { id: 'likert7',    label: 'リッカート 7 段階 (1-7)',       meanRange: [1, 7],    sdRange: [0.3, 3],   step: 0.1,
    sdPresets: [['集中 (SD≈0.8)', 0.8], ['普通 (SD≈1.2)', 1.2], ['広め (SD≈1.8)', 1.8], ['二極 (SD≈2.5)', 2.5]] },
  { id: 'likert5',    label: 'リッカート 5 段階 (1-5)',       meanRange: [1, 5],    sdRange: [0.2, 2],   step: 0.1,
    sdPresets: [['集中 (SD≈0.6)', 0.6], ['普通 (SD≈0.9)', 0.9], ['広め (SD≈1.3)', 1.3], ['二極 (SD≈2.0)', 2.0]] },
  { id: 'continuous', label: '連続値 (反応時間 / スコア 等)',  meanRange: [null, null], sdRange: [0.0001, null], step: 0.01,
    sdPresets: null },   // 単位 が 分から ない ので プリセット無し
  { id: 'percentage', label: '割合 (0-100%)',                meanRange: [0, 100],  sdRange: [0.01, 50], step: 0.1,
    sdPresets: [['集中 (SD≈5)', 5], ['普通 (SD≈15)', 15], ['広め (SD≈25)', 25]] },
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
  if (state.test === 'tp') {
    // v1034 対応 t 検定 も 2 手法 の M/SD + 相関 r で 入力。
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
  // v1034 SD プリセット (集中 / 普通 / 広め / 二極) — データ 型別 に
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
        <label class="field" style="margin-bottom:6px"><span class="lbl">予想 平均</span>
          <input type="number" id="raw-mA" step="${dt.step}" value="${state.rawA.mean}">
        </label>
        <label class="field"><span class="lbl">予想 SD (回答 の 散らばり)</span>
          <input type="number" id="raw-sA" step="${dt.step}" min="0.0001" value="${state.rawA.sd}">
        </label>
        ${sdPresetHtml('raw-sA')}
      </div>
      <div style="padding:8px; background:#fff7ed; border-radius:6px; border-left:3px solid #ea580c">
        <div class="bold" style="color:#ea580c; font-size:12px; margin-bottom:4px">👥 手法 B / 群 B</div>
        <label class="field" style="margin-bottom:6px"><span class="lbl">予想 平均</span>
          <input type="number" id="raw-mB" step="${dt.step}" value="${state.rawB.mean}">
        </label>
        <label class="field"><span class="lbl">予想 SD (回答 の 散らばり)</span>
          <input type="number" id="raw-sB" step="${dt.step}" min="0.0001" value="${state.rawB.sd}">
        </label>
        ${sdPresetHtml('raw-sB')}
      </div>
    </div>`;
  // v1034 中村さん指摘「対応 t 検定 も 差分 じゃなく 2 手法 で やった 方が わかりやすい」
  //   → t2 と 同じ 2 カラム の 「手法 A / 手法 B」 UI に + 「同じ 参加者 が やる ので
  //   相関 r」 の 入力 を 追加。 d_paired = |M_A−M_B| / √(SD_A²+SD_B²−2·r·SD_A·SD_B)。
  const pairedInputs = twoGroupInputs + `
    <div style="padding:8px; background:#faf5ff; border-radius:6px; border-left:3px solid #7b3fa0; margin-top:10px">
      <div class="bold" style="color:#7b3fa0; font-size:12px; margin-bottom:4px">🔗 手法 A と B の 相関 r (同じ 参加者 が 両手法 やる ので)</div>
      <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap">
        <input type="number" id="raw-r" step="0.05" min="-0.99" max="0.99" value="${state.pairedR}" style="width:100px">
        <button data-pw-pairedr="0.3" class="btn" style="font-size:10.5px; padding:1px 6px">弱い 0.3</button>
        <button data-pw-pairedr="0.5" class="btn" style="font-size:10.5px; padding:1px 6px">典型 0.5</button>
        <button data-pw-pairedr="0.7" class="btn" style="font-size:10.5px; padding:1px 6px">強い 0.7</button>
      </div>
      <div class="hint-sm" style="margin-top:4px; font-size:11px">高い ほど 差の SD が 小さく なり d が 大きく 出ます (対応 t の 利点)。 反応時間 等 の 客観指標 は 0.6-0.8、 主観評価 は 0.3-0.6 が 目安。</div>
    </div>`;
  const t1Inputs = `
    <div style="padding:8px; background:#faf5ff; border-radius:6px; border-left:3px solid #7b3fa0; margin-top:8px">
      <div class="bold" style="color:#7b3fa0; font-size:12px; margin-bottom:4px">👤 観測 − 基準</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
        <label class="field"><span class="lbl">予想 平均 (観測 − 基準値)</span>
          <input type="number" id="raw-mD" step="${dt.step}" value="${state.rawDiff.mean}">
        </label>
        <label class="field"><span class="lbl">予想 SD (観測 の 散らばり)</span>
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
      <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🎯 予想データ (平均 + SD) から 効果量 を 導く</summary>
      <div class="hint-sm" style="margin-top:6px; margin-bottom:6px">先行研究 or パイロット の 平均 と SD を 入れて、 グラフ で 手ごたえ を 確認 → 「この値で 予想効果量を 求める」 ボタン で 効果量欄 に 反映 します。 SD が 直感的 で ない 場合 は 「集中 / 普通 / 広め」 の 目安 ボタン から。</div>
      ${dtSelect}
      ${inputBlock}
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
  if (state.test === 't2' || state.test === 'tp') {
    // v1034 対応 t 検定 も 2 手法 表示
    curves.push({ mu: state.rawA.mean, sd: state.rawA.sd, color: '#2563eb', label: '手法 A' });
    curves.push({ mu: state.rawB.mean, sd: state.rawB.sd, color: '#ea580c', label: '手法 B' });
  } else {
    curves.push({ mu: state.rawDiff.mean, sd: state.rawDiff.sd, color: '#7b3fa0', label: '(観測 − 基準) の 分布' });
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

// ---------------- 効果量 ヘルパー (旧: 詳しい人向け) ----------------
// 中村さん指摘「効果量は先行研究の平均SDから計算するか、 パイロット、 メタ分析、 分野の
//   慣習で決めるのが望ましい。 ここをなんとか支援できないか」→ 先行研究 / パイロット の
//   値 を 入れて 効果量 を 逆算 する 補助 UI。 検定 タイプ 別 に 現実的 な 入力 セット を 出す。
function renderEffectHelper() {
  if (state.test === 't2') {
    return `
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 先行研究の平均・SD から Cohen's d を計算 (独立 2 群)</summary>
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
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 先行研究 の 平均・SD から Cohen's d を計算 (対応あり / 1 標本)</summary>
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
  if (state.test === 'anova' || state.test === 'rmanova') {
    return `
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 群平均 + 群内 SD から Cohen's f を計算</summary>
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
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 決定係数 R² から r を計算</summary>
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
      <details class="card" style="background:#f9fafb; border-left:4px solid #ede4f3">
        <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:14px">🧮 期待比率 と 想定比率 から Cohen's w を計算</summary>
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

// v1032 3-level LMM (参加者 × 刺激) ステップブロック
function renderLMM3Blocks() {
  const p = state.lmm3;
  const mode = state.mode;
  return `
    ${stepBlock({ title: '⑥ 条件効果 β (raw)', desc: '条件間の 平均差 (outcome 生単位)。', body: `<input type="number" id="lmm3-beta" step="0.05" value="${p.beta}" style="width:120px"> <span class="hint-sm">目安:</span> <button class="btn" data-lmm3-beta="0.2" style="font-size:11px; padding:2px 8px">小 0.2</button> <button class="btn" data-lmm3-beta="0.5" style="font-size:11px; padding:2px 8px">中 0.5</button> <button class="btn" data-lmm3-beta="0.8" style="font-size:11px; padding:2px 8px">大 0.8</button>` })}
    ${stepBlock({ title: '⑦ 参加者間 SD σ_p', desc: '参加者の 平均的 な 高低 の ばらつき。 交差配置 では 条件差 に は 直接効かない が、 参考値 と して。', body: `<input type="number" id="lmm3-sdp" step="0.05" min="0.001" value="${p.sd_participant}" style="width:120px">` })}
    ${stepBlock({ title: '⑧ 刺激間 SD σ_stim', desc: '刺激ごと の 難易度 / 反応性 の ばらつき。 交差配置 では 差分で キャンセル される が、 大きい と 選定 の 分散 を 圧迫。', body: `<input type="number" id="lmm3-sds" step="0.05" min="0.001" value="${p.sd_stimulus}" style="width:120px">` })}
    ${stepBlock({ title: '⑨ 残差 SD σ_e', desc: '同じ 参加者・同じ 刺激・同じ 条件 内 の 試行 ノイズ。', body: `<input type="number" id="lmm3-sde" step="0.05" min="0.001" value="${p.sd_residual}" style="width:120px">` })}
    ${stepBlock({
      title: '⑨-b ランダム傾き SD (σ_slope_p、 0 = 効果 個人共通)',
      desc: '条件効果 β の 参加者間 個人差 (lme4 の (1+x|p))。 大きい ほど 検定力↓。 目安: β の 30-50% (弱)、 β 相当 (中)。 わからなければ 0。',
      body: `<input type="number" id="lmm3-sdslopep" step="0.05" min="0" value="${p.sd_slope_p || 0}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-lmm3-sdslopep="0" style="font-size:11px; padding:2px 8px">なし 0</button>
               <button class="btn" data-lmm3-sdslopep="${(Math.abs(p.beta)*0.4).toFixed(3)}" style="font-size:11px; padding:2px 8px">弱 (β の 40%)</button>
               <button class="btn" data-lmm3-sdslopep="${Math.abs(p.beta).toFixed(3)}" style="font-size:11px; padding:2px 8px">中 (β 相当)</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑨-c ランダム傾き SD (σ_slope_s、 刺激別 効果差)',
      desc: '刺激ごと の 条件効果 の 差 (lme4 の (1+x|s))。 「特定 の 刺激 で だけ 効果 が 出る/出ない」 の 度合い。 わからなければ 0。',
      body: `<input type="number" id="lmm3-sdslopes" step="0.05" min="0" value="${p.sd_slope_s || 0}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-lmm3-sdslopes="0" style="font-size:11px; padding:2px 8px">なし 0</button>
               <button class="btn" data-lmm3-sdslopes="${(Math.abs(p.beta)*0.3).toFixed(3)}" style="font-size:11px; padding:2px 8px">弱 (β の 30%)</button>
             </div>`,
    })}
    ${stepBlock({ title: '⑩ 刺激数 (両条件で 同じ)', desc: '各 参加者 が 見る 刺激 の 数 (両条件で 各 1 回)。 増やすと 残差 平均化 で 検定力 上がる。', body: `<input type="number" id="lmm3-ns" step="1" min="1" value="${p.n_stimuli}" style="width:120px">` })}
    ${mode === 'post_hoc' ? stepBlock({ title: '⑪ 参加者数 n_p', desc: '手元 or 予定の 参加者数。', body: `<input type="number" id="lmm3-np" step="1" min="3" value="${p.n_participants}" style="width:120px">` }) : ''}
    ${stepBlock({ title: '💰 1 人 あたり 謝金 (円)', desc: '0 で コスト非表示。', body: `<input type="number" id="lmm3-cost" step="100" min="0" value="${p.cost_per_participant}" style="width:140px"> 円` })}
    ${stepBlock({ title: '⚙ シミュ 反復数', desc: '目安: 500 で ~5%、 1000 で ~3%、 5000 で ~1.5% 誤差。', body: `<input type="number" id="lmm3-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">` })}
  `;
}

// v1037 GLMM の p₀ ⇔ p₁ ⇔ OR 相互換算 (中村さん指摘「p₁ も 入力させたい、 OR で表現するんだっけ？」)
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

// v1045 fb#482 効果量 の 目安表 を 効果量セクション内 の 目安ボタン の 下 に 配置
//   (中村さん指摘「効果量の目安 という 一番下 に あるやつは、 効果量セクション の ボタン
//   の 下 に 配置して」)。 折り畳み で 検定別 の 早見表 + 選び方 の 一言 を 出す。
function renderCohenGuideInline() {
  return `
    <details style="margin-top:6px; padding:6px 10px; background:#faf5ff; border-radius:6px">
      <summary style="cursor:pointer; font-weight:600; font-size:12px; color:#7b3fa0">📖 効果量の目安 (Cohen) — 検定別 早見表</summary>
      <div style="margin-top:6px; font-size:12.5px; line-height:1.85">
        <div><b>Cohen's d</b> (t 検定): 0.2 (小) / 0.5 (中) / 0.8 (大)</div>
        <div><b>Cohen's f</b> (ANOVA/rmANOVA): 0.10 (小) / 0.25 (中) / 0.40 (大)</div>
        <div><b>Pearson r</b> (相関): 0.10 (小) / 0.30 (中) / 0.50 (大)</div>
        <div><b>Cohen's w</b> (χ²): 0.10 (小) / 0.30 (中) / 0.50 (大)</div>
        <div class="hint-sm" style="margin-top:4px">効果量 は 先行研究 の 平均 SD から 計算するか、 パイロット、 メタ分析、 分野 の 慣習 で 決める のが 望ましい。 「中」 は 決定に 困った時 の 便宜的 な 選択。</div>
      </div>
    </details>`;
}

// v1043 Poisson GLMM ステップブロック
function renderPoissonBlocks() {
  const p = state.glmm_poisson;
  const mode = state.mode;
  const rr = p.proposed_rate / p.baseline_rate;
  const rrSize = rr >= 2.0 ? '大' : rr >= 1.5 ? '中' : rr >= 1.2 ? '小' : rr > 1 ? '極小' : rr === 1 ? 'なし' : '負 (減少)';
  return `
    ${stepBlock({
      title: '⑥ ベースライン条件 (x=0) の 想定 平均回数 λ₀',
      desc: 'ベースライン条件 で 単位期間 (1 試行) あたり 何回 発生するかの 想定平均。 例: 「エラー 5 回 / 課題」、 「発言 8 回 / 分」、 「クリック 12 回 / セッション」。',
      body: `<input type="number" id="pois-r0" step="0.5" min="0.1" value="${p.baseline_rate}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-pois-r0="2" style="font-size:11px; padding:2px 8px">稀 λ=2</button>
               <button class="btn" data-pois-r0="5" style="font-size:11px; padding:2px 8px">中 λ=5</button>
               <button class="btn" data-pois-r0="15" style="font-size:11px; padding:2px 8px">多 λ=15</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑦ 提案条件 (x=1) の 想定 平均回数 λ₁',
      desc: 'λ₀ と セットで RR = λ₁ / λ₀ を 自動計算。 効果量目安のボタンは 現在の λ₀ を基点に RR で換算して λ₁ に反映。',
      body: `<input type="number" id="pois-r1" step="0.5" min="0.01" value="${p.proposed_rate}" style="width:120px">
             <div id="pois-rr-derived" class="hint-sm" style="margin-top:6px; padding:6px 10px; background:#eef2ff; border-radius:6px; display:inline-block">⇒ 導出 RR = ${rr.toFixed(2)} <span style="color:#666">(${rrSize})</span></div>
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">効果量 (RR) 目安:</span>
               <button class="btn" data-pois-rr="1.3" style="font-size:11px; padding:2px 8px">小 RR 1.3</button>
               <button class="btn" data-pois-rr="1.5" style="font-size:11px; padding:2px 8px">中 RR 1.5</button>
               <button class="btn" data-pois-rr="2.0" style="font-size:11px; padding:2px 8px">大 RR 2.0</button>
             </div>`,
    })}
    ${stepBlock({ title: '⑧ 参加者間 SD (log スケール)', desc: '参加者ごと の カウント の 個人差 (log スケール)。 0.5 で 中程度、 1.0 で かなり大きい 個人差。', body: `<input type="number" id="pois-sdp" step="0.05" min="0" value="${p.sd_participant}" style="width:120px">` })}
    ${stepBlock({ title: '⑨ 各条件 の 試行 (期間) 数', desc: '各条件 で 1 参加者 が 繰り返す 試行 or 観測期間 の数 (例: 5 回 セッション = 5)。 増やすと 個々の λ 推定 が 精確 に なり 検定力↑。', body: `<input type="number" id="pois-nt" step="1" min="1" value="${p.n_trials}" style="width:120px">` })}
    ${mode === 'post_hoc' ? stepBlock({ title: '⑩ 参加者数 n_p', desc: '手元 or 予定の 参加者数。', body: `<input type="number" id="pois-np" step="1" min="3" value="${p.n_participants}" style="width:120px">` }) : ''}
    ${stepBlock({ title: '💰 1 人 あたり 謝金 (円)', desc: '0 で コスト非表示。', body: `<input type="number" id="pois-cost" step="100" min="0" value="${p.cost_per_participant}" style="width:140px"> 円` })}
    ${stepBlock({ title: '⚙ シミュ 反復数', desc: '目安: 500 で ~5%、 1000 で ~3%、 5000 で ~1.5% 誤差。', body: `<input type="number" id="pois-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">` })}
  `;
}

// v1032 Logistic GLMM ステップブロック
function renderGLMMBlocks() {
  const p = state.glmm;
  const mode = state.mode;
  return `
    ${stepBlock({
      title: '⑥ ベースライン条件 (x=0) の 想定 正答率 p₀',
      desc: '既存手法 or 対照条件 での 想定 「正答率」 「成功率」 「反応率」 等 (0-1)。',
      body: `<input type="number" id="glmm-p0" step="0.05" min="0.01" max="0.99" value="${p.baseline_p}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-glmm-p0="0.3" style="font-size:11px; padding:2px 8px">難 30%</button>
               <button class="btn" data-glmm-p0="0.5" style="font-size:11px; padding:2px 8px">中 50%</button>
               <button class="btn" data-glmm-p0="0.7" style="font-size:11px; padding:2px 8px">易 70%</button>
             </div>`,
    })}
    ${stepBlock({
      title: '⑦ 提案条件 (x=1) の 想定 正答率 p₁',
      desc: '提案手法 での 想定 正答率。 p₀ と セットで OR = (p₁/(1−p₁)) / (p₀/(1−p₀)) を 自動計算。 効果量目安のボタンは 現在の p₀ を基点に OR で換算して p₁ に反映。',
      body: `<input type="number" id="glmm-p1" step="0.05" min="0.01" max="0.99" value="${p.proposed_p}" style="width:120px">
             <div id="glmm-or-derived" class="hint-sm" style="margin-top:6px; padding:6px 10px; background:#eef2ff; border-radius:6px; display:inline-block">${renderGLMMDerivedOR()}</div>
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">効果量 (OR) 目安:</span>
               <button class="btn" data-glmm-or="1.5" style="font-size:11px; padding:2px 8px">小 OR 1.5</button>
               <button class="btn" data-glmm-or="2.0" style="font-size:11px; padding:2px 8px">中 OR 2.0</button>
               <button class="btn" data-glmm-or="3.0" style="font-size:11px; padding:2px 8px">大 OR 3.0</button>
             </div>`,
    })}
    ${stepBlock({ title: '⑧ 参加者間 SD (log-odds)', desc: '参加者の 個人差 (log-odds スケール)。 0.5 = 中程度、 1.0 で 顕著な 個人差。', body: `<input type="number" id="glmm-sdp" step="0.05" min="0" value="${p.sd_participant}" style="width:120px">` })}
    ${stepBlock({ title: '⑨ 各条件 の 試行数', desc: '各条件 で 1 参加者 が 繰り返す 試行数。 増やすと 個々の 確率推定 が 精確 に なり 検定力 上がる。', body: `<input type="number" id="glmm-nt" step="1" min="1" value="${p.n_trials}" style="width:120px">` })}
    ${mode === 'post_hoc' ? stepBlock({ title: '⑩ 参加者数 n_p', desc: '手元 or 予定の 参加者数。', body: `<input type="number" id="glmm-np" step="1" min="3" value="${p.n_participants}" style="width:120px">` }) : ''}
    ${stepBlock({ title: '💰 1 人 あたり 謝金 (円)', desc: '0 で コスト非表示。', body: `<input type="number" id="glmm-cost" step="100" min="0" value="${p.cost_per_participant}" style="width:140px"> 円` })}
    ${stepBlock({ title: '⚙ シミュ 反復数', desc: '目安: 500 で ~5%、 1000 で ~3%、 5000 で ~1.5% 誤差。', body: `<input type="number" id="glmm-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">` })}
  `;
}

// v1031 LMM-specific ステップブロック
function renderLMMBlocks() {
  const p = state.lmm;
  const mode = state.mode;
  return `
    ${stepBlock({
      title: '⑥ 条件効果 β (raw 単位)',
      desc: '2 条件 の 平均差 の 期待値 (outcome の 生 単位、 例: 反応時間 なら ms、 リッカート なら 点)。 Cohen d と 対応するなら β ≒ d × σ_residual。',
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
      desc: '参加者ごと の 平均的 な 高低 の ばらつき (random intercept SD)。 大きい ほど 「個人差 が 大きく、 条件効果 が 見えにくい」。 通常 σ_residual と 同程度 か やや 小さめ。',
      body: `<input type="number" id="lmm-sdp" step="0.05" min="0.001" value="${p.sd_participant}" style="width:120px">`,
    })}

    ${stepBlock({
      title: '⑧ 残差 SD (σ_residual)',
      desc: '同じ 参加者 の 同じ 条件 内 での 試行間 ばらつき。 大きい ほど 各試行 が noisy で、 検定力 は 下がる。',
      body: `<input type="number" id="lmm-sde" step="0.05" min="0.001" value="${p.sd_residual}" style="width:120px">`,
    })}

    ${stepBlock({
      title: '⑧-b ランダム傾き SD (σ_slope、 0 = 効果は 個人共通)',
      desc: '条件効果 β の 個人差。 「効果 の 出方 が 参加者ごとに 違う」 場合 に 加算 (lme4 の (1+x|p))。 個人差 が 大きい ほど 検定力↓。 目安: β の 30-50% (弱)、 β 相当 (中)、 2β (強)。 わからなければ 0 で スタート。',
      body: `<input type="number" id="lmm-sdslope" step="0.05" min="0" value="${p.sd_slope || 0}" style="width:120px">
             <div class="row" style="gap:4px; margin-top:6px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               <button class="btn" data-lmm-sdslope="0" style="font-size:11px; padding:2px 8px">なし 0</button>
               <button class="btn" data-lmm-sdslope="${(Math.abs(p.beta)*0.4).toFixed(3)}" style="font-size:11px; padding:2px 8px">弱 (β の 40%)</button>
               <button class="btn" data-lmm-sdslope="${Math.abs(p.beta).toFixed(3)}" style="font-size:11px; padding:2px 8px">中 (β 相当)</button>
             </div>`,
    })}

    ${stepBlock({
      title: '⑨ 各参加者・各条件 の 試行数',
      desc: '1 人 が 各条件 で 繰り返す 回数。 増やすと 参加者内 の ばらつき を 平均化 でき、 検定力 が 上がる (残差 が 効いてる 場合)。',
      body: `<input type="number" id="lmm-nt" step="1" min="1" value="${p.n_trials}" style="width:120px">`,
    })}

    ${mode === 'post_hoc' ? stepBlock({
      title: '⑩ 参加者数 n_p (Post hoc)',
      desc: '手元 or 予定 の 参加者数。',
      body: `<input type="number" id="lmm-np" step="1" min="3" value="${p.n_participants}" style="width:120px">`,
    }) : ''}

    ${stepBlock({
      title: '💰 1 人 あたり 謝金 (円、 0 で コスト非表示)',
      desc: '参加者 1 人 あたり の 謝金 or 実験費用。 入れると 戦略比較テーブル に 想定費用 も 表示 されます。',
      body: `<input type="number" id="lmm-cost" step="100" min="0" value="${p.cost_per_participant}" style="width:140px"> 円`,
    })}

    ${stepBlock({
      title: '⚙ シミュレーション 反復数 (iterations)',
      desc: '大きい ほど 精度 が 上がる が 時間 が かかる。 目安: 500 で ~5%、 1000 で ~3%、 5000 で ~1.5% の 誤差。',
      body: `<input type="number" id="lmm-iter" step="100" min="100" max="20000" value="${p.iterations}" style="width:140px">`,
    })}
  `;
}

// ---------------- UI ヘルパー ----------------

// v1030 中村さん指示 「一気に値を設定する 感じ に なってる けど、 ひとつずつ 入力
//   させて いく のが 良い」→ 各パラメータ を 独立した ステップブロック 化。
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
  { id: 'corr',  label: '🔗 Pearson 相関',                eff: 'r',        effGuide: [['小 r=0.10', 0.10], ['中 r=0.30', 0.30], ['大 r=0.50', 0.50]] },
  { id: 'chi2',  label: '⁉ χ² (df 指定)',                eff: 'w',        effGuide: [['小 w=0.10', 0.10], ['中 w=0.30', 0.30], ['大 w=0.50', 0.50]] },
  // v1031 LMM (2 レベル: 参加者内) — シミュレーションベース
  { id: 'lmm_within', label: '🧠 混合効果モデル (LMM) — 参加者内条件差 (2 レベル)', eff: 'beta',
    effGuide: [['小 β=0.2', 0.2], ['中 β=0.5', 0.5], ['大 β=0.8', 0.8]] },
  // v1032 LMM (3 レベル: 参加者 × 刺激) — 交差配置
  { id: 'lmm_crossed', label: '🧠 混合効果モデル (LMM) — 参加者×刺激 (3 レベル)', eff: 'beta',
    effGuide: [['小 β=0.2', 0.2], ['中 β=0.5', 0.5], ['大 β=0.8', 0.8]] },
  // v1032 Logistic GLMM (2 レベル: 参加者内、 2 値アウトカム)
  { id: 'glmm_logit', label: '🎯 Logistic GLMM — 2 値 (正答/誤答等) の 参加者内効果', eff: 'or',
    effGuide: [['小 OR=1.5', 1.5], ['中 OR=2.0', 2.0], ['大 OR=3.0', 3.0]] },
  // v1043 Poisson GLMM (2 レベル: 参加者内、 回数アウトカム)
  { id: 'glmm_poisson', label: '📊 Poisson GLMM — 回数 (エラー数/発言数 等) の 参加者内効果', eff: 'rr',
    effGuide: [['小 RR=1.3', 1.3], ['中 RR=1.5', 1.5], ['大 RR=2.0', 2.0]] },
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
  k: 3,              // ANOVA 群数 / 反復測定 の 測定回数
  df: 1,             // χ² 自由度
  rho: 0.5,          // v1041 反復測定 ANOVA の 測定間 相関
  epsilon: 1.0,      // v1041 反復測定 ANOVA の 球面性補正 (1 = 補正なし)
  // v1028 中村さん提案「実測ベース で 平均 / SD から d を 導く 方が 直感的」
  //   dataType: 'continuous' | 'likert5' | 'likert7' | 'percentage' | 'binary'
  //   rawA, rawB: それぞれ の 群 の { mean, sd }
  //   rawDiff:    対応あり / 1 標本 の 差分 { mean, sd }
  dataType: 'likert7',
  rawA: { mean: 4.0, sd: 1.2 },
  rawB: { mean: 4.6, sd: 1.2 },
  rawDiff: { mean: 0.6, sd: 1.2 },
  // v1034 対応 t 検定 用 の 2 手法 の 相関 (同じ 参加者で 両手法 やる ので 相関 が 出る)
  pairedR: 0.5,
  // v1031 LMM (2 レベル) — 参加者内条件差
  lmm: {
    n_participants: 24,
    n_trials: 20,           // 各参加者、 各条件 の 試行数
    beta: 0.5,              // 条件効果 (outcome の raw 単位)
    sd_participant: 1.0,    // 参加者間 SD (random intercept)
    sd_residual: 1.0,       // 残差 SD (trial-level)
    sd_slope: 0.0,          // v1042 ランダム傾き SD (0 = ランダム傾きなし)
    iterations: 1000,
    cost_per_participant: 1500,  // v1032 1 人 あたり 謝金 (円)、 0 で非表示
    last_power: null,
    last_ci: null,
    last_details: null,
  },
  // v1032 3-level LMM (参加者 × 刺激): 各参加者 が 各刺激を 両条件 で 見る 想定 の
  //   簡易 モデル。 params は lmm と重複するので extend で。
  lmm3: {
    n_participants: 24,
    n_stimuli: 16,
    beta: 0.5,
    sd_participant: 1.0,
    sd_stimulus: 0.5,
    sd_residual: 1.0,
    sd_slope_p: 0.0,        // v1042 参加者 効果 ランダム傾き SD
    sd_slope_s: 0.0,        // v1042 刺激 効果 ランダム傾き SD
    iterations: 1000,
    cost_per_participant: 1500,
  },
  // v1032 Logistic GLMM: 2 値 アウトカム、 参加者内 条件差
  //   モデル: logit(P(y=1)) = β0 + β1·x + u_p、 u_p ~ N(0, σ_p²)
  //   β1 = log(OR) が 条件効果
  glmm: {
    n_participants: 24,
    n_trials: 20,
    baseline_p: 0.5,     // 帰無条件 (x=0) の 正答率
    proposed_p: 0.67,    // v1037 提案条件 (x=1) の 正答率 (OR=2 で 0.5→0.67)
    or: 2.0,             // 効果量 (odds ratio、 β1 = log(or)) — proposed_p/baseline_p から 自動導出も可
    sd_participant: 0.5, // 参加者間 変動 (log-odds スケール)
    iterations: 1000,
    cost_per_participant: 1500,
  },
  // v1043 Poisson GLMM: 回数 アウトカム、 参加者内 条件差
  //   モデル: log(E[Y]) = β0 + β1·x + u_p、 Y ~ Poisson(exp(η))、 u_p ~ N(0, σ_p²)
  //   β0 = log(baseline_rate)、 β1 = log(RR) が 条件効果
  glmm_poisson: {
    n_participants: 24,
    n_trials: 20,
    baseline_rate: 5.0,    // ベースライン条件 の 平均カウント (単位期間あたり)
    proposed_rate: 7.5,    // 提案条件 の 平均カウント (RR = 1.5 で 5.0 → 7.5)
    rr: 1.5,               // rate ratio (proposed_rate / baseline_rate) — 自動導出
    sd_participant: 0.5,   // 参加者間 変動 (log スケール)
    iterations: 1000,
    cost_per_participant: 1500,
  },
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
  ['test','mode','alpha','tails','effect','power','n_per_group','n_total','k','df','dataType'].forEach(k => {
    if (k in cfg) state[k] = cfg[k];
  });
  ['rawA','rawB','rawDiff','lmm','lmm3','glmm','glmm_poisson'].forEach(k => {
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
    // v1031/1032 sim モデル も config に含める
    lmm: state.lmm, lmm3: state.lmm3, glmm: state.glmm, glmm_poisson: state.glmm_poisson,
    dataType: state.dataType, rawA: state.rawA, rawB: state.rawB, rawDiff: state.rawDiff,
  };
}

function render() {
  const app = document.getElementById('app');
  const t = TESTS.find(x => x.id === state.test);
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📐 サンプルサイズ / 検定力 ${state.loaded_name ? `<span class="hint-sm" style="font-size:13px; margin-left:8px; color:#7b3fa0">📁 ${escapeHtml(state.loaded_name)}${state.loaded_owner_name ? ' (by ' + escapeHtml(state.loaded_owner_name) + ')' : ''}</span>` : ''}</h2>
      <div class="hint-sm" style="margin-top:4px">古典的 G*Power 相当の A priori (必要 n) / Post hoc (検定力) を計算します。 正規近似ベース (G*Power の非心分布計算と数%差)。 v1025+ で LMM/GLMM シミュレーション、 参加者/刺激/試行の比較、 コスト直結を予定。</div>
      ${renderSaveShareButtons('top')}
    </div>

    <!-- v1030 中村さん指示 「一気に値を設定する 感じ に なってる けど、 ひとつずつ 入力
         させて いく のが 良い」→ 各パラメータ を 独立した ステップブロック に (title +
         短い 説明 + 入力)。 Post hoc の 場合 は 目標検定力 の 代わりに サンプルサイズ を出す。 -->
    ${stepBlock({
      title: '① モード',
      desc: 'これから 実験する 場合 は A priori、 実験後 で n が 決まっている 場合 は Post hoc。',
      // v1038 中村さん指示「リストボックスから指定する形式が良い」
      // v1040 中村さん指示「検定の種類より前に、モードがあるべき」→ ① モード / ② 検定の種類 に入れ替え
      body: `<select id="pw-mode" style="width:100%">
              <option value="a_priori" ${state.mode==='a_priori'?'selected':''}>🎯 A priori: これから 実験する 場合 (必要 n 数 を 求める)</option>
              <option value="post_hoc" ${state.mode==='post_hoc'?'selected':''}>🔍 Post hoc: 実験後 に n 数 から 検定力 を 求める 場合</option>
             </select>`,
    })}

    ${stepBlock({
      title: '② 検定の種類',
      desc: 'どの 統計検定 を 使う 予定か。 選ぶ ものに 応じて 必要な 入力項目 が 変わります。 迷ったら 下の 「🧭 選択ウィザード」 に答えていくと 自動で 選ばれます。',
      body: `<select id="pw-test" style="width:100%">
              ${TESTS.map(x => `<option value="${x.id}" ${x.id===state.test?'selected':''}>${escapeHtml(x.label)}</option>`).join('')}
             </select>
             ${renderTestWizard()}`,
    })}

    ${stepBlock({
      title: '③ 有意水準 α',
      desc: '本来「差なし」なのに「差あり」と誤判定してしまう上限 (型I過誤)。正規分布でいうと、平均から中心±約2SDより外側に来る確率が5%、±約2.58SDより外側が1%、±約3.29SDより外側が0.1%。慣習的には 0.05 が標準、多重比較や高い信頼性が要る場面では 0.01 や 0.001。',
      // v1035 中村さん指示「プリセットの下に入力欄」で導線を分かりやすく
      body: `<div class="row" style="gap:4px; flex-wrap:wrap">
               <button class="btn" data-pw-alpha="0.05" style="font-size:11px; padding:2px 8px">0.05 (通常、±2SD)</button>
               <button class="btn" data-pw-alpha="0.01" style="font-size:11px; padding:2px 8px">0.01 (厳しめ、±2.58SD)</button>
               <button class="btn" data-pw-alpha="0.001" style="font-size:11px; padding:2px 8px">0.001 (非常に厳しめ、±3.29SD)</button>
             </div>
             <input type="number" id="pw-alpha" step="0.005" min="0.001" max="0.5" value="${state.alpha}" style="width:120px; margin-top:6px">`,
    })}

    ${['t2','tp','t1','corr'].includes(state.test) ? stepBlock({
      title: '④ 仮説の方向',
      desc: '両側: どちらが 大きい かは 決めて いない、 差が あれば 検出。 / 片側: どちらが 大きい か 事前に 決めて いる (逆方向 の 差 は 検出 しない、 その分 必要 n は 少し 少ない)。',
      body: `<select id="pw-tails" style="max-width:280px">
              <option value="2" ${state.tails==2?'selected':''}>両側: 差があるかを判定</option>
              <option value="1" ${state.tails==1?'selected':''}>片側: 想定の大小差を判定</option>
             </select>`,
    }) : ''}

    ${state.mode==='a_priori' ? stepBlock({
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
      desc: state.test === 't2' ? '手元 or 予定の 各群 の サンプルサイズ n。' : '手元 or 予定の 全体 サンプルサイズ N。',
      body: `<input type="number" id="pw-n" step="1" min="2" value="${state.test==='t2' ? state.n_per_group : state.n_total}" style="width:120px">
             <div class="hint-sm" style="margin-top:6px">${state.test === 't2' ? '各群 n の 値 (全体 N は 自動 で 2n)' : '全体 N の 値'}</div>`,
    })}

    ${state.test==='anova' ? stepBlock({
      title: '⑤-a 群 数 k',
      desc: 'ANOVA で 比較する 群 の 数 (例: 3 条件 なら k=3)。',
      body: `<input type="number" id="pw-k" step="1" min="2" max="20" value="${state.k}" style="width:120px">`,
    }) : ''}

    ${state.test==='rmanova' ? stepBlock({
      title: '⑤-a 測定 回数 k',
      desc: '同じ 参加者 で 繰り返す 測定 (条件 or 時点) の 数 (例: 3 条件 なら k=3、 前中後 なら k=3)。',
      body: `<input type="number" id="pw-k" step="1" min="2" max="20" value="${state.k}" style="width:120px">`,
    }) : ''}

    ${state.test==='rmanova' ? stepBlock({
      title: '⑤-b 測定間 相関 ρ',
      desc: '同じ 参加者 の 異なる 測定間 の 想定 相関。 高い ほど 個人差 が キャンセル されて 検定力↑。 反応時間 系 は 0.6-0.8、 主観評価 系 は 0.3-0.6 が 目安。 わからなければ 0.5。',
      body: `<div class="row" style="gap:4px; flex-wrap:wrap">
               <button class="btn" data-pw-rho="0.3" style="font-size:11px; padding:2px 8px">弱 0.3</button>
               <button class="btn" data-pw-rho="0.5" style="font-size:11px; padding:2px 8px">典型 0.5</button>
               <button class="btn" data-pw-rho="0.7" style="font-size:11px; padding:2px 8px">強 0.7</button>
             </div>
             <input type="number" id="pw-rho" step="0.05" min="0" max="0.99" value="${state.rho}" style="width:120px; margin-top:6px">`,
    }) : ''}

    ${state.test==='rmanova' ? stepBlock({
      title: '⑤-c 球面性補正 ε (デフォルト 1.0)',
      desc: '反復測定 の 球面性仮定 が 崩れる 時 の 補正。 Mauchly 検定 で 有意 なら Greenhouse-Geisser (0.5-0.8) or Huynh-Feldt (0.7-0.9) を。 わからなければ 1.0 (補正なし) で。',
      body: `<div class="row" style="gap:4px; flex-wrap:wrap">
               <button class="btn" data-pw-eps="1.0" style="font-size:11px; padding:2px 8px">1.0 (補正なし)</button>
               <button class="btn" data-pw-eps="0.75" style="font-size:11px; padding:2px 8px">0.75 (GG 典型)</button>
               <button class="btn" data-pw-eps="0.5" style="font-size:11px; padding:2px 8px">0.5 (深刻な違反)</button>
             </div>
             <input type="number" id="pw-eps" step="0.05" min="0.01" max="1" value="${state.epsilon}" style="width:120px; margin-top:6px">`,
    }) : ''}

    ${state.test==='chi2' ? stepBlock({
      title: '⑤-a 自由度 df',
      desc: 'χ² 検定 の 自由度 (適合度 検定: カテゴリ数 − 1、 独立性 検定: (行数−1)×(列数−1))。',
      body: `<input type="number" id="pw-df" step="1" min="1" max="200" value="${state.df}" style="width:120px">`,
    }) : ''}

    ${!['lmm_within','lmm_crossed','glmm_logit','glmm_poisson'].includes(state.test) ? stepBlock({
      title: '⑥ 効果量 (' + t.eff + ')',
      desc: '検出したい 効果の 大きさ を 標準化 した 値。 先行研究 / パイロット / 分野の慣習 で 決めます。 目安 で 決め打ち、 実測 データ から 導く、 先行研究 の 値 から 計算する の 3 通り が 使えます。',
      // v1035 中村さん指示「目安 の 下 に、 効果量 の グループ の 中 に、 予想データ から と
      //   先行研究の～ を 配置、 その さらに 下 に 効果量 の 入力欄」
      body: `<div class="row" style="gap:4px; flex-wrap:wrap">
               <span class="hint-sm" style="align-self:center">目安:</span>
               ${t.effGuide.map(([lb, v]) => `<button data-pw-eff="${v}" class="btn" style="font-size:11px; padding:2px 8px">${escapeHtml(lb)}</button>`).join('')}
             </div>
             ${renderCohenGuideInline()}
             ${renderRawInputs()}
             ${renderEffectHelper()}
             <div class="hint-sm" style="font-size:11px; margin-top:8px; color:#7b3fa0; font-weight:600">効果量 (直接 入力 or 上の 補助 で 反映):</div>
             <input type="number" id="pw-effect" step="0.01" min="0.01" value="${state.effect}" style="width:120px; margin-top:2px">`,
    }) : ''}

    ${state.test === 'lmm_within' ? renderLMMBlocks() : ''}
    ${state.test === 'lmm_crossed' ? renderLMM3Blocks() : ''}
    ${state.test === 'glmm_logit'  ? renderGLMMBlocks() : ''}
    ${state.test === 'glmm_poisson' ? renderPoissonBlocks() : ''}

    <div class="card" style="text-align:center">
      <button id="pw-calc" class="btn primary" style="padding:10px 32px; font-size:15px">🧮 計算</button>
    </div>

    <div id="pw-result"></div>

    <div class="card" id="pw-saved-list-card" hidden>
      <div class="bold" style="margin-bottom:6px">📚 保存 済 の 分析</div>
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
      if (b.dataset.wz === 'scale')   state.wizard.groups = state.wizard.related = state.wizard.normal = state.wizard.complex = '';
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
      state.wizard = { scale: '', groups: '', related: '', normal: '', complex: '' };
      render();
    });
  });
  document.querySelectorAll('[data-pw-mode]').forEach(b => {
    b.addEventListener('click', () => { state.mode = b.dataset.pwMode; render(); });
  });
  // v1038 モード を リストボックス化
  document.getElementById('pw-mode')?.addEventListener('change', (e) => {
    state.mode = e.target.value; render();
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

  // v1042 LMM ランダム傾き プリセット
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
  // v1037 p₀ / p₁ の生入力が変わったら 導出 OR ラベルを更新
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
  // v1030 α と 検定力 の プリセットボタン
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
      if (box) { box.textContent = '値を 全部 入れて ください (SD は正の値)'; box.style.color = '#a16207'; }
      return;
    }
    state.effect = Math.round(d * 1000) / 1000;
    const el = document.getElementById('pw-effect');
    if (el) el.value = state.effect;
    if (box) { box.innerHTML = `<b style="color:#7b3fa0">${escapeHtml(renderDerivedLabel(d))}</b> を 効果量欄に 入れました。 「🧮 計算」 で 続きへ`; box.style.color = ''; }
  });
  document.getElementById('pw-calc').addEventListener('click', doCalc);
  // v1038 保存 / 共有 / 削除 / 新規 (top と bottom の 両方 の ボタン に 貼る)
  document.querySelectorAll('[data-pw-btn]').forEach(b => {
    b.addEventListener('click', () => {
      const kind = b.dataset.pwBtn;
      if (kind === 'save') return onSave();
      if (kind === 'share') return onShareOrSaveThenShare();
      if (kind === 'delete') return onDelete();
      if (kind === 'new') {
        if (!confirm('新規の 分析を 開始 します。 現在の 分析設定 は 未保存 なら 失われます。 続けますか?')) return;
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

// v1038 未保存でも 共有 ボタン を 押せる。 未保存 なら 「保存 → 共有」 の 2 段フロー。
async function onShareOrSaveThenShare() {
  if (!state.loaded_id) {
    // 未保存: 名前を促して 保存 → 共有 モーダルへ
    if (!confirm('共有 する には まず 分析を 保存する 必要が あります。 続けて 保存 → 共有 しますか?')) return;
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
      toast('保存 しました。 共有 モーダル を 開きます');
      render(); loadSavedList();
      return onShare();
    } catch (e) {
      alert('保存 に 失敗: ' + (e.message || e));
    }
    return;
  }
  return onShare();
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
    // v1037 OR は p₀ と p₁ から 逆算 (UI の source of truth は 2 つの 確率)。
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
}

function doCalc() {
  const t = TESTS.find(x => x.id === state.test);
  syncFormToState();

  // v1031 LMM は 別 の 計算 パス (シミュレーション)
  if (state.test === 'lmm_within')  return doCalcLMM();
  if (state.test === 'lmm_crossed') return doCalcLMM3();
  if (state.test === 'glmm_logit')  return doCalcGLMM();
  if (state.test === 'glmm_poisson') return doCalcPoissonGLMM();

  let out = null;
  const N = state.test === 't2' ? state.n_per_group : state.n_total;
  try {
    if (state.test === 't2')    out = calc_ttest_two_sample(state.alpha, state.effect, state.tails, state.mode, N, state.power);
    if (state.test === 'tp' || state.test === 't1') out = calc_ttest_paired(state.alpha, state.effect, state.tails, state.mode, N, state.power);
    if (state.test === 'anova') out = calc_anova(state.alpha, state.effect, state.k, state.mode, N, state.power);
    if (state.test === 'rmanova') out = calc_rmanova(state.alpha, state.effect, state.k, state.rho, state.epsilon, state.mode, N, state.power);
    if (state.test === 'corr')  out = calc_correlation(state.alpha, state.effect, state.tails, state.mode, N, state.power);
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
    sd_slope_p: p.sd_slope_p || 0,  // v1042 参加者 ランダム傾き
    sd_slope_s: p.sd_slope_s || 0,  // v1042 刺激 ランダム傾き
    alpha: state.alpha, iterations: p.iterations, tails: state.tails,
  };
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション 実行中… (${p.iterations.toLocaleString()} 回、 3-level)</div></div>`;
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
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション 実行中… (${p.iterations.toLocaleString()} 回、 GLMM)</div></div>`;
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
function doCalcPoissonGLMM() {
  const t = TESTS.find(x => x.id === state.test);
  const root = document.getElementById('pw-result');
  const p = state.glmm_poisson;
  const params = {
    n_p: p.n_participants, n_trials: p.n_trials,
    baseline_rate: p.baseline_rate, rr: p.rr, sd_p: p.sd_participant,
    alpha: state.alpha, iterations: p.iterations, tails: state.tails,
  };
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション 実行中… (${p.iterations.toLocaleString()} 回、 Poisson GLMM)</div></div>`;
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

// v1031 LMM シミュレーション計算 (中村さんビジョンの中核 の 一角)
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
  // 計算前 に プレビュー
  root.innerHTML = `<div class="card"><div class="hint-sm">シミュレーション 実行中… (${p.iterations.toLocaleString()} 回)</div></div>`;
  setTimeout(() => {
    try {
      if (state.mode === 'a_priori') {
        const res = findLMMnParticipants(params, state.power);
        // 見つけた n で 本 シミュ (完全 iterations で 精度確認)
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

// v1031/1032 LMM/GLMM 結果 描画 (kind: 'lmm' | 'lmm3' | 'glmm')
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
        : `α=${p.alpha}, β_effect=${p.beta}, σ_participant=${p.sd_p}, σ_residual=${p.sd_e}${(p.sd_slope||0) > 0 ? ', σ_slope=' + p.sd_slope : ''}, 試行 ${p.n_trials} × 2 条件, iters=${p.iterations.toLocaleString()}`;
  const perParticipantTrials = kind === 'lmm3' ? p.n_stim * 2 : p.n_trials * 2;
  let mainCard;
  if (res.mode === 'a_priori') {
    const N_total = res.n_required * perParticipantTrials;
    mainCard = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🎯 必要な 参加者数 (LMM シミュベース)</div>
        <div style="font-size:26px; line-height:1.5">参加者 n_p = <b>${res.n_required}</b> ${res.over ? '<span style="color:#dc2626">(500 で 頭打ち — 目標到達 せず)</span>' : ''}</div>
        <div class="hint-sm" style="margin-top:8px">検証: この n_p で 検定力 = <b>${(res.verify_power * 100).toFixed(1)}%</b> [95% CI: ${(res.ci[0]*100).toFixed(1)}−${(res.ci[1]*100).toFixed(1)}%]</div>
        <div class="hint-sm" style="margin-top:4px">全観測数: ${res.n_required} 参加者 × ${perParticipantTrials / 2} ${kind === 'lmm3' ? '刺激' : '試行'} × 2 条件 = <b>${N_total}</b> obs</div>
        <div class="hint-sm" style="margin-top:4px; color:#a16207">脱落・除外 10% を見込むなら <b>${Math.ceil(res.n_required * 1.10)}</b> 名 募集 が 目安。</div>
        <div class="hint-sm" style="margin-top:4px">${paramLine}</div>
      </div>`;
  } else {
    const pctColor = res.power >= 0.8 ? '#059669' : (res.power >= 0.6 ? '#a16207' : '#dc2626');
    const label = kind === 'glmm' ? 'Logistic GLMM' : kind === 'glmm_poisson' ? 'Poisson GLMM' : (kind === 'lmm3' ? 'LMM 3-level' : 'LMM');
    mainCard = `
      <div class="card" style="background:linear-gradient(180deg, #ede4f322, #fff); border-left:4px solid #7b3fa0">
        <div class="bold" style="color:#7b3fa0; margin-bottom:8px">🔍 得られる 検定力 (${label} シミュベース)</div>
        <div style="font-size:28px; line-height:1.5; color:${pctColor}"><b>${(res.power * 100).toFixed(1)}%</b> <span style="font-size:14px; color:#6b7280">[95% CI: ${(res.ci[0]*100).toFixed(1)}−${(res.ci[1]*100).toFixed(1)}%]</span></div>
        <div class="hint-sm" style="margin-top:8px">${p.n_p} 参加者 × ${perParticipantTrials / 2} ${kind === 'lmm3' ? '刺激' : '試行'} × 2 条件 = ${p.n_p * perParticipantTrials} obs</div>
        <div class="hint-sm" style="margin-top:4px">${paramLine}</div>
        ${res.power < 0.8 ? '<div class="hint-sm" style="margin-top:4px; color:#a16207">💡 検定力 80% 未満: 参加者・試行/刺激数 の 増強 を 検討。</div>' : ''}
      </div>`;
  }
  const strategyCard = renderLMMStrategyTable(res, t, kind);
  const narrativeCard = renderNarrativeCard(res, t, kind);   // v1033
  root.innerHTML = mainCard + strategyCard + narrativeCard;
  // v1033 コピーボタン wire (data-copy-payload の 参照先 script は 同 root 内)
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

// v1033 論文用 narrative + R/Python コード 自動生成 (中村さん ビジョン)
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
  } else {
    return '';  // 従来 の t/ANOVA/相関/χ² は narrative 未対応
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
      <div class="hint-sm" style="margin-top:8px">R / Python の コード は 検定力 検証用 の 再現 スクリプト。 中村さん ビジョン「A simulation-based power analysis was conducted with 1,000 simulated datasets…」 の 形式 で 書き出し。</div>
      <script type="application/json" id="pw-payloads">${JSON.stringify({ narrative, r: rCode, py: pyCode })}</script>
    </div>`;
}

// v1038 保存/共有 ボタン (中村さん要望「保存ボタンだけじゃなく、共有ボタンも欲しい。
//   保存と共有ボタンは、画面下部にも配置して欲しい (2 箇所にあるイメージ)」)。 top / bottom
//   両方で 同じ ボタン列を使うので、 ID は 位置ごとに サフィックス で 区別 (pw-save-top /
//   pw-save-bottom) して イベントを 両方 に 貼る。 共有 は 保存前 でも 表示 し、 押した時 に
//   未保存 なら 「先に 名前 を つけて 保存 → 共有」 の 二段フローに 誘導する。
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
//   選択肢ベースで選べるようにするとよいのかなぁ？」)。 4-5 個 の 選択肢 に 答えて
//   いくと、 分析ガイド のフローチャートを 対話的に 辿った結果 の 検定 が 自動で 選ばれる。
//   選択の途中結果と 適用ロジック を UI に表示。
function renderTestWizard() {
  const w = state.wizard || (state.wizard = { scale: '', groups: '', related: '', normal: '', complex: '' });
  const opt = (id, val, label) => `<button class="btn" data-wz="${id}" data-wz-val="${val}" style="font-size:11px; padding:3px 8px; ${w[id]===val?'background:#7b3fa0; color:#fff':''}">${label}</button>`;
  // 決定ロジック
  let inferred = null;
  let inferredNote = '';
  const s = w.scale, g = w.groups, r = w.related, n = w.normal, c = w.complex;
  if (s === 'continuous' || s === 'ordinal') {
    // リッカート等 の 順序尺度 は 「中央付近 が 山型 なら t/ANOVA で 近似可、 厳密には
    //   順序ロジット GLMM が 望ましい」 の 注記 を 付ける。
    const ordSfx = s === 'ordinal' ? ' (リッカート等 は 中央付近が 山型 なら これで 近似 OK、 厳密には 順序ロジット GLMM が 望ましい)' : '';
    if (s === 'continuous' && (c === 'complex' || c === 'crossed')) {
      inferred = c === 'crossed' ? 'lmm_crossed' : 'lmm_within';
      inferredNote = c === 'crossed' ? '参加者 × 刺激 の 交差ランダム効果 → LMM 3-level' : '複雑デザイン → LMM (参加者内)';
    } else if (g === '2' && r === 'paired' && n === 'yes') { inferred = 'tp'; inferredNote = '2 群、 対応あり、 正規性 OK → 対応のある t 検定' + ordSfx; }
    else if (g === '2' && r === 'indep' && n === 'yes')   { inferred = 't2';  inferredNote = '2 群、 独立、 正規性 OK → 対応のない t 検定' + ordSfx; }
    else if (g === '1' && n === 'yes')                     { inferred = 't1';  inferredNote = '1 群 (基準値との比較)、 正規性 OK → 1 標本 t 検定' + ordSfx; }
    else if (g === '3plus' && r === 'indep' && n === 'yes'){ inferred = 'anova'; inferredNote = '3 群以上、 独立、 正規性 OK → 一元配置 ANOVA' + ordSfx; }
    else if (g === '3plus' && r === 'paired' && n === 'yes'){ inferred = 'rmanova'; inferredNote = '3 群以上、 対応 (反復測定)、 正規性 OK → 反復測定 ANOVA' + ordSfx; }
    else if (g === '3plus' && n === 'yes' && !r)          { inferredNote = 'Q3 (群 の 関係) も 選んで ください'; }
    else if (n === 'no') {
      const npMap = {
        '1':     'Wilcoxon 符号順位検定 (中央値と 基準値の 比較)',
        '2':     r === 'paired' ? 'Wilcoxon 符号順位検定 (対応)' : 'Mann-Whitney U 検定 (独立)',
        '3plus': r === 'paired' ? 'Friedman 検定' : 'Kruskal-Wallis 検定',
      };
      const npName = npMap[g] || 'ノンパラ検定 (Mann-Whitney / Wilcoxon / Kruskal-Wallis)';
      inferredNote = `正規分布 に 近くない → ${npName} が 推奨。 このアプリ は 正規近似ベース なので 参考値 として ${g === '3plus' ? 'ANOVA' : 't 検定'} で 計算 も 可`;
    }
  } else if (s === 'relation') {
    inferred = 'corr'; inferredNote = '2 変数 の 関係 → Pearson 相関 (順位なら Spearman、 順位も概ね同じ 検定力)';
  } else if (s === 'binary_within') {
    inferred = 'glmm_logit'; inferredNote = '2 値 アウトカム、 参加者内 → Logistic GLMM';
  } else if (s === 'count_within') {
    inferred = 'glmm_poisson'; inferredNote = '回数 アウトカム、 参加者内 → Poisson GLMM (過分散 なら 負の二項 に 切替、 このアプリ は Poisson で 概算)';
  } else if (s === 'categorical') {
    inferred = 'chi2'; inferredNote = 'カテゴリ独立 or 適合度 → χ² 検定 (期待度数 <5 なら Fisher に切替)';
  }
  return `
    <details style="margin-top:10px; padding:10px 12px; background:#faf5ff; border-radius:8px; border:1px solid #ede4f3" ${inferred || (s || g) ? 'open' : ''}>
      <summary style="cursor:pointer; font-weight:600; color:#7b3fa0; font-size:13px">🧭 選択ウィザード (迷ったら)</summary>
      <div style="margin-top:10px; font-size:12.5px; line-height:1.9">
        <div><b>Q1. 従属変数 の スケール は？</b></div>
        <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
          ${opt('scale', 'continuous', '連続値 (RT, 得点, 濃度 等)')}
          ${opt('scale', 'ordinal', '順序尺度 (リッカート)')}
          ${opt('scale', 'binary_within', '2 値 (正答/誤答、 同じ参加者)')}
          ${opt('scale', 'count_within', '回数 (エラー数/発言回数、 同じ参加者)')}
          ${opt('scale', 'categorical', '名義 (カテゴリ、 群 比較)')}
          ${opt('scale', 'relation', '2 変数 の 関係 (相関)')}
        </div>
        ${['continuous','ordinal'].includes(s) ? `
          <div><b>Q2. 比較する 群 の 数？</b></div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('groups', '1', '1 群 (基準値との比較)')}
            ${opt('groups', '2', '2 群')}
            ${opt('groups', '3plus', '3 群以上')}
          </div>` : ''}
        ${['continuous','ordinal'].includes(s) && ['2','3plus'].includes(g) ? `
          <div><b>Q3. 群 の 関係？</b></div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('related', 'indep', '独立 (別の 参加者)')}
            ${opt('related', 'paired', '対応 (同じ 参加者、 前後 or 条件)')}
          </div>` : ''}
        ${['continuous','ordinal'].includes(s) && g ? `
          <div><b>Q4. データ の 分布 は 正規分布 に 近い？</b></div>
          <div class="hint-sm" style="margin-bottom:4px">「ヒストグラムを描いたら 富士山型 (左右対称の山形) に なる」 で OK。 判断に迷ったら 参加者 n が 30 以上 なら 中心極限定理で 緩く OK。 リッカート 尺度 は 中央付近 が 山 なら OK、 端に 集中 する 場合 は NG。</div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('normal', 'yes', '✅ 正規分布 に 近い (or n が 30 以上)')}
            ${opt('normal', 'no', '❌ 山型 でなく 偏った 分布')}
          </div>` : ''}
        ${['continuous'].includes(s) && g && r ? `
          <div><b>Q5. デザイン は 単純？</b></div>
          <div class="row" style="gap:4px; flex-wrap:wrap; margin-bottom:6px">
            ${opt('complex', 'simple', '単純 (1 要因、 balanced)')}
            ${opt('complex', 'complex', '複雑 (参加者内、 複数試行)')}
            ${opt('complex', 'crossed', '参加者 × 刺激 の 交差')}
          </div>` : ''}
        ${inferred ? `
          <div style="margin-top:8px; padding:8px 12px; background:#dcfce7; border-left:3px solid #059669; border-radius:0 6px 6px 0">
            <div style="color:#059669"><b>⇒ 推奨: ${escapeHtml((TESTS.find(x=>x.id===inferred)||{label:inferred}).label)}</b></div>
            <div class="hint-sm" style="margin-top:2px">${inferredNote}</div>
            <button data-wz-apply="${inferred}" class="btn primary" style="font-size:12px; padding:3px 10px; margin-top:6px">この検定を 選ぶ</button>
          </div>` : (inferredNote ? `<div style="margin-top:8px; padding:6px 10px; background:#fef3c7; border-left:3px solid #a16207; border-radius:0 6px 6px 0" class="hint-sm">${inferredNote}</div>` : '')}
        ${(s || g || r || n || c) ? `<div style="margin-top:6px"><button data-wz-reset="1" class="btn" style="font-size:11px; padding:2px 8px">↺ リセット</button></div>` : ''}
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
            <li><b>データクリーニング</b>: タイポ、単位の統一、負値・範囲外値の確認。生 CSV を保存してから 前処理版を別ファイルに。</li>
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

// 統計手法選択の 大分類フローチャート (SVG)
function renderStatFlowchartSVG() {
  return `
<pre style="font-family: 'SF Mono', Menlo, Consolas, monospace; font-size:12px; line-height:1.5; background:#fff; padding:10px 12px; border-radius:6px; border:1px solid #d1fae5; overflow-x:auto; margin:0">
【従属変数のスケールは？】

━━━ 連続 or 順序尺度 ━━━
  │
  ├─ 【比較する群の数】
  │   ├─ 1 群 (基準値 との比較)
  │   │   └─ 正規性 OK  → 1 標本 t 検定
  │   │      正規性 NG → Wilcoxon 符号順位検定
  │   │
  │   ├─ 2 群
  │   │   ├─ 独立 (別 参加者)
  │   │   │   ├─ 正規性 + 等分散 OK → 2 標本 t 検定
  │   │   │   ├─ 正規性 OK / 等分散 NG → Welch t 検定
  │   │   │   └─ 正規性 NG → Mann-Whitney U 検定
  │   │   └─ 対応 (同じ 参加者)
  │   │       ├─ 差の正規性 OK → 対応 t 検定
  │   │       └─ 差の正規性 NG → Wilcoxon 符号順位検定
  │   │
  │   └─ 3 群以上
  │       ├─ 独立
  │       │   ├─ 正規性 + 等分散 → 一元配置 ANOVA
  │       │   └─ 正規性 NG → Kruskal-Wallis
  │       └─ 対応
  │           ├─ 球面性 OK → 反復測定 ANOVA (このアプリで対応)
  │           ├─ 球面性 NG → GG or HF 補正 反復測定 ANOVA (このアプリで ε 指定可)
  │           └─ 正規性 NG → Friedman 検定
  │
  ├─ 【複雑デザイン (2 要因以上、 参加者 × 刺激 交差、 unbalanced 等)】
  │   → LMM (lme4::lmer) / GLMM (lme4::glmer)
  │      + emmeans で 事後 対比
  │
  └─ 【関係の強さ】
      ├─ 2 変数の直線関係    → Pearson 相関 r
      ├─ 順位の関係           → Spearman ρ / Kendall τ
      └─ 予測 / 因果効果      → 線形回帰 / 重回帰 / MLR
                                (交絡変数を モデル に投入)

━━━ 名義尺度 (カテゴリ) ━━━
  │
  ├─ 【1 変数の分布】
  │   └─ カテゴリ観測数 → χ² 適合度検定
  │
  ├─ 【2 変数の連関】
  │   ├─ 大きな標本 → χ² 独立性検定
  │   ├─ 期待度数 <5 のセル あり → Fisher 直接確率検定
  │   └─ 対応あり (Before/After 2値) → McNemar 検定
  │
  └─ 【2 値アウトカム の 予測】
      → ロジスティック回帰 / GLMM (family=binomial)

━━━ 回数 (カウント) ━━━
  │
  ├─ 平均 ≈ 分散  → Poisson GLMM (このアプリで対応)
  ├─ 分散 >> 平均 → 負の二項 GLMM (過分散、 未対応 v1044+)
  └─ ゼロ が 大量  → Zero-inflated Poisson / NB
</pre>`;
}

function renderTestSpecificGuide() {
  const guides = {
    t2: {
      title: '📏 対応のない t 検定 (2 標本 t 検定: 独立) の 実施フロー',
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
      title: '📎 対応のある t 検定 の 実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>差 (X_1 − X_2) を計算し、その正規性を Shapiro-Wilk で確認。歪度が大きい場合は Wilcoxon 符号順位検定に。</li>
        <li>対応 t 検定を実行 (paired t-test)。</li>
        <li>効果量: d_z = M_diff / SD_diff (Cohen's d for paired)。d_av (平均 SD で標準化) を併記する派も。</li>
        <li>報告例: "参加者は方式 B (M = 4.6, SD = 1.2) を方式 A (M = 4.0, SD = 1.3) より高く評価した、t(23) = 3.12, p = .005, d_z = 0.64 [0.20, 1.07]."</li>
        <li>ノンパラ代替: Wilcoxon 符号順位検定。差にゼロが多い場合は Sign 検定。</li>
      </ol>`,
    },
    t1: {
      title: '👤 1 標本 t 検定 (基準値との比較) の 実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>観測値の正規性を Shapiro-Wilk で確認。n>=30 なら緩く OK。</li>
        <li>H0: 母平均 = μ_0 (基準値)、H1: ≠ μ_0 で 1 標本 t 検定。</li>
        <li>効果量: d = (M_obs - μ_0) / SD_obs。95%CI と併記。</li>
        <li>ノンパラ代替: Wilcoxon 符号順位検定 (中央値と基準値の比較)。</li>
      </ol>`,
    },
    rmanova: {
      title: '🔁 反復測定 ANOVA (対応 3 群以上) の 実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>各条件 (時点) の 分布 の 正規性 (Shapiro-Wilk) を 確認。 参加者内 デザインなので 独立性 は 気にしなくて OK。</li>
        <li>Mauchly の 球面性検定: 有意 (p<.05) なら 球面性違反、 df を Greenhouse-Geisser (ε ≈ 0.5-0.8) or Huynh-Feldt (ε ≈ 0.7-0.9) で 補正。 3 条件 以下では 球面性は 自動的に成立するので 補正不要。</li>
        <li>rmANOVA を 実行 (R: <code>aov(y ~ cond + Error(p/cond))</code> or <code>afex::aov_ez</code>、 SPSS の GLM Repeated Measures)。</li>
        <li>効果量: partial η² (SS_effect / (SS_effect + SS_error)) が 定番、 generalized η²_G (Bakeman 2005) も。 Cohen's f = √(η²/(1-η²)) で 変換可。</li>
        <li>事後検定: Bonferroni or Holm 補正で ペア比較。 対応 t 検定 を m=k(k-1)/2 個 実行、 補正 α = 0.05/m。</li>
        <li>報告例: "F(2, 46) = 6.24, p = .004, η²_p = .21, 90%CI [.05, .36], Greenhouse-Geisser ε = 0.87. Bonferroni 事後: 時点 1 vs 時点 3 (p = .008)、 他 n.s."</li>
        <li>ノンパラ代替: Friedman 検定 → Nemenyi or Bonferroni-Wilcoxon で事後比較。</li>
        <li>より柔軟なら LMM (lmer(y ~ cond + (1|p))) に 移行推奨。 unbalanced や 欠損値 に強く、 現代の標準。</li>
      </ol>`,
    },
    anova: {
      title: '📊 一元配置 ANOVA の 実施フロー',
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
      title: '🔗 Pearson 相関 の 実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>散布図で外れ値と非線形性を目視。Pearson は直線関係のみ捉えられる。</li>
        <li>両変数の正規性を Shapiro-Wilk で。歪度が大きい場合は Spearman ρ (順位相関) に。</li>
        <li>効果量そのものが r。95%CI は Fisher z 変換経由で。</li>
        <li>報告例: "r(38) = .42, p = .007, 95%CI [.12, .65]."</li>
        <li>因果を語りたいなら回帰 (交絡変数を統制)。相関だけでは因果は言えない。</li>
      </ol>`,
    },
    chi2: {
      title: '⁉ χ² 検定 の 実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>クロス表を作り、各セルの期待度数を確認。1 つでも期待度数 <5 なら Fisher 直接確率検定に切り替え。</li>
        <li>χ² 適合度 (1 変数) or χ² 独立性 (2 変数) を判定。</li>
        <li>効果量: 適合度は Cohen's w、独立性は Cramer's V (2×2 なら φ)。</li>
        <li>報告例: "χ²(2) = 8.24, p = .016, V = .18."</li>
        <li>2×2 対応データ (Before/After binary) は McNemar 検定。</li>
      </ol>`,
    },
    lmm_within: {
      title: '🧠 LMM 2 レベル (参加者内) の 実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>R では lme4::lmer(dv ~ condition + (1 | participant))、Python は statsmodels.MixedLM。</li>
        <li>REML=TRUE で分散成分を推定 (デフォルト)。固定効果の検定は Satterthwaite 近似 df (lmerTest パッケージ) を推奨。</li>
        <li>特異解 (singular fit) 警告が出たら random slope を落とすか PCA prior。</li>
        <li>効果量: fixed effect coef / residual SD (standardized β) 、または partial R² (r2glmm::r2beta)。</li>
        <li>報告例: "The fixed effect of condition was significant, β = 0.48, SE = 0.15, t(23.2) = 3.20, p = .004 (Satterthwaite)."</li>
      </ol>`,
    },
    lmm_crossed: {
      title: '🧠 LMM 3 レベル (参加者×刺激) の 実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>lme4::lmer(dv ~ condition + (1 | participant) + (1 | stimulus))。交差ランダム効果。</li>
        <li>Maximal model 推奨: (1 + condition | participant) + (1 + condition | stimulus) → 収束しないなら段階的に削減 (Barr et al. 2013 / Bates et al. 2015)。</li>
        <li>Keep it maximal vs parsimonious の議論あり。REML + Satterthwaite で t 検定。</li>
        <li>結果報告に random effect variance と ICC も (participant, stimulus 別で) 含める。</li>
      </ol>`,
    },
    glmm_poisson: {
      title: '📊 Poisson GLMM (回数データ) の 実施フロー',
      body: `<ol style="margin:6px 0; padding-left:20px">
        <li>まず 記述統計: 各条件 の 平均 と 分散 を 見る。 Poisson 分布 は 平均 = 分散 を 仮定 する ので、 分散 >> 平均 なら 過分散 (overdispersion)、 負の二項 (negative binomial) を 検討。</li>
        <li>R: <code>glmer(y ~ x + (1 | p), family = poisson, data = df)</code>、 Python: statsmodels の <code>sm.GEE</code> family=Poisson で GEE 近似、 または <code>PoissonBayesMixedGLM</code>。</li>
        <li>過分散 検定: <code>performance::check_overdispersion(model)</code>。 p<.05 なら 過分散 → <code>glmmTMB(y ~ x + (1|p), family = nbinom2)</code> or <code>MASS::glm.nb</code> に 切り替え。</li>
        <li>効果量: レート比 RR = exp(β1)。 95% CI は Wald or profile likelihood。 「提案条件 では ベースライン の X 倍 発生」 と 報告。</li>
        <li>ゼロ過剰 (zero inflation): 観測 が 大量 に 0 なら Poisson でも NB でも 適合が悪い → <code>zeroinfl</code> or <code>glmmTMB(..., ziformula = ~1)</code>。</li>
        <li>報告例: "RR = 1.68, 95%CI [1.20, 2.36], z = 2.94, p = .003. 参加者 ランダム切片 の 分散 σ²_p = 0.28。"</li>
        <li>提示 が オフセット (試行時間 が 参加者ごとに 違う 等) を含む なら <code>offset(log(time))</code> を モデル に 追加。</li>
      </ol>`,
    },
    glmm_logit: {
      title: '🎯 Logistic GLMM の 実施フロー',
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

// v1032 参加者 vs 試行 の 戦略比較 テーブル (中村さんビジョン中核)
function renderLMMStrategyTable(res, t, kind = 'lmm') {
  const p = res.params;
  const baseN = res.mode === 'a_priori' ? res.n_required : p.n_p;
  const baseT = kind === 'lmm3' ? p.n_stim : p.n_trials;
  const trialLabel = kind === 'lmm3' ? '刺激' : '試行';
  const costPerParticipant = (kind === 'glmm' ? state.glmm.cost_per_participant
                            : kind === 'glmm_poisson' ? state.glmm_poisson.cost_per_participant
                            : kind === 'lmm3' ? state.lmm3.cost_per_participant
                            : state.lmm.cost_per_participant) ?? 0;
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
    return simulateLMM({ n_p, n_trials: n_t, beta: p.beta, sd_p: p.sd_p, sd_e: p.sd_e, sd_slope: p.sd_slope || 0, alpha: p.alpha, iterations: 500, tails: p.tails });
  };
  const rows = strategies.map(st => {
    const power = runSim(st.n_p, st.n_t).power;
    const N_obs = st.n_p * st.n_t * 2;
    const cost = costPerParticipant * st.n_p;
    return { ...st, power, N_obs, cost };
  });
  const costLabel = costPerParticipant > 0 ? '<th style="padding:6px 10px; text-align:right">推定 費用</th>' : '';
  const costCell = (r) => costPerParticipant > 0 ? `<td style="padding:6px 10px; text-align:right">¥${r.cost.toLocaleString()}</td>` : '';
  return `
    <div class="card">
      <div class="bold" style="margin-bottom:8px">📋 参加者 vs 試行 の 効率 比較</div>
      <div class="hint-sm" style="margin-bottom:6px">「参加者を 増やすべきか、 試行数を 増やすべきか」 を LMM シミュ で 直接 比較。 混合効果 モデル では 同じ意味 に なりません (参加者間 SD と 残差 SD の 比 で 変わる)。</div>
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
      <div class="hint-sm" style="margin-top:6px">iterations=500 の 簡易シミュ (± 4% 程度の誤差)。 コスト表示 は 「1 人 あたり 謝金」 (下の 設定) で 出ます。</div>
    </div>`;
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
  } else if (state.test === 'rmanova') {
    n = state.n_total;
    const rho_c = Math.max(0.001, Math.min(0.999, state.rho));
    const eps_c = Math.max(0.001, Math.min(1, state.epsilon));
    const factor = state.k / (1 - rho_c) * eps_c;
    ncp = Math.sqrt(n * state.effect * state.effect * factor);
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
  if (state.test === 'anova' || state.test === 'rmanova') return renderMultiGroupPlot();
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
      if (state.test === 'rmanova') p = calc_rmanova(state.alpha, state.effect, state.k, state.rho, state.epsilon, 'post_hoc', n, 0.8).power;
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
    if (state.test === 'rmanova') curP = calc_rmanova(state.alpha, state.effect, state.k, state.rho, state.epsilon, 'post_hoc', nowN, 0.8).power;
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
  const extraArgs = state.test === 'anova' ? `, k=${state.k}`
                  : state.test === 'rmanova' ? `, k=${state.k}, ρ=${state.rho}, ε=${state.epsilon}`
                  : state.test === 'chi2' ? `, df=${state.df}` : '';
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
  root.innerHTML = resultHtml + renderIntuitivePlot() + renderDistPlot() + renderPowerCurve() + renderSensitivityCurve();
}

// v1038 感度分析: 効果量 を 範囲 スキャン → 検定力 カーブ (中村さん要望「感度分析」)。
//   G*Power にはない、 中村研では 必要な機能。 効果量 (d/f/r/w) を ±3× 範囲で 15 点 スキャン、
//   各点で 現在 n の 検定力 を 計算 → SVG カーブ。 現在 の 効果量位置 を 縦点線 で 強調、
//   検定力 0.8 の 水平点線 も。 従来 の 「⑤ n を 変えた 時の カーブ」 と 「⑥ 効果量 を 変えた
//   時の カーブ」 の 2 本立て を そろえた 形。
//   sim系 (LMM/LMM3/GLMM) は 効果量スキャン が 重い → シミュ 100 回 に 減らして 15 点 (合計
//   ~1500 iters、 数秒) で 描く。
function renderSensitivityCurve() {
  const nowN = state.test === 't2' ? state.n_per_group : state.n_total;
  const t = TESTS.find(x => x.id === state.test);
  if (!t) return '';
  const effLabel = state.test === 'anova' || state.test === 'rmanova' ? "Cohen's f"
                 : state.test === 'corr' ? "Pearson r"
                 : state.test === 'chi2' ? "Cohen's w"
                 : state.test === 'lmm_within' || state.test === 'lmm_crossed' ? '固定効果 β'
                 : state.test === 'glmm_logit' ? '効果量 OR'
                 : state.test === 'glmm_poisson' ? '効果量 RR'
                 : "Cohen's d";
  const effUnit = state.test === 'glmm_logit' ? 'OR' : state.test === 'glmm_poisson' ? 'RR' : '';
  let currentEff, effRange, points;
  const isSim = ['lmm_within','lmm_crossed','glmm_logit','glmm_poisson'].includes(state.test);
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
        }
      } catch (_) { power = 0; }
      if (!isFinite(power)) power = 0;
      points.push([e, power]);
    }
  } else {
    // 解析系: 高速で 40 点 スキャン
    currentEff = state.effect;
    const eMax = Math.max(currentEff * 3, state.test === 'corr' ? 0.9 : state.test === 'chi2' ? 0.9 : 1.5);
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
  // 現在 の 効果量 位置 の 縦点線
  const curX = xToPx(currentEff);
  // 目安ライン (小/中/大) — 検定によって異なる
  const benchmarks = {
    t2:    [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    tp:    [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    t1:    [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    anova: [[0.10, '小'], [0.25, '中'], [0.40, '大']],
    rmanova: [[0.10, '小'], [0.25, '中'], [0.40, '大']],
    corr:  [[0.10, '小'], [0.30, '中'], [0.50, '大']],
    chi2:  [[0.10, '小'], [0.30, '中'], [0.50, '大']],
    lmm_within:  [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    lmm_crossed: [[0.2, '小'], [0.5, '中'], [0.8, '大']],
    glmm_logit:  [[1.5, '小'], [2.0, '中'], [3.0, '大']],
    glmm_poisson: [[1.3, '小'], [1.5, '中'], [2.0, '大']],
  }[state.test] || [];
  const benchMarks = benchmarks.filter(([v]) => v >= effRange[0] && v <= effRange[1]).map(([v, label]) =>
    `<line x1="${xToPx(v)}" y1="${PT}" x2="${xToPx(v)}" y2="${H - PB}" stroke="#d4d4d4" stroke-dasharray="2 2"/>
     <text x="${xToPx(v)}" y="${PT + 12}" text-anchor="middle" font-size="9" fill="#9ca3af">${label}(${v})</text>`
  ).join('');
  // 「80% 到達に必要な 効果量」 逆算 (点列 線形補間)
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
      <div class="bold" style="margin-bottom:4px">📉 感度分析 (効果量 ${effLabel} を 変えた 時の 検定力)</div>
      <div class="hint-sm" style="margin-bottom:8px">現在の n (${nowN}) を保ったまま、 効果量 ${effLabel} を 変えたら 検定力が どう動くか。 「想定していた効果量が 実は 小さかったら…」 のリスクを 可視化 (G*Power にはない)。${isSim ? ' シミュ 100×15 点。' : ''}${effAt80 ? ` <b style="color:#7b3fa0">検定力 80% に必要な ${effLabel} ≈ ${effAt80.toFixed(3)}${effUnit ? ' ' + effUnit : ''}</b>` : ''}</div>
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
