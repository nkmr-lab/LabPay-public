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

// ---------------- 効果量 ヘルパー ----------------
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
  // v1024b 効果量ヘルパー (先行研究 の 値 から 効果量 を 逆算)
  document.querySelectorAll('[data-eh-calc]').forEach(b => {
    b.addEventListener('click', () => computeEffectFromHelper(b.dataset.ehCalc));
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
      <div class="bold" style="margin-bottom:8px">📊 分布プロット (H0 vs H1)</div>
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
      <div class="hint-sm" style="margin-top:6px">青が H0 (効果なし)、 橙が H1 (想定効果あり) の分布。 縦点線 が 有意水準 α に対応する 臨界値。 橙が 臨界値より右に はみ出す 面積 が 検定力 (緑)、 臨界値より左に 残る 面積 が β (灰)。</div>
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
  // v1024b グラフ (G*Power 相当): 分布プロット + 検定力カーブ
  root.insertAdjacentHTML('beforeend', renderDistPlot() + renderPowerCurve());
}

function clampFloat(v, lo, hi) {
  const n = parseFloat(v);
  if (isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
