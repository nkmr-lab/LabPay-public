// v448 共有 オーディオ unlock。
// iOS Safari / 多くの Mobile ブラウザ では 「ユーザ操作 1 回 後」 でないと
//  - Web Audio API: AudioContext が suspended のまま (createOscillator + start
//    しても 音は 出ない)
//  - HTMLAudio: new Audio(url).play() が NotAllowedError
// となる。 一度 unlock すれば そのページに居る間は 自動再生 (setInterval から の
// 鳴動 含む) が 通る。
//
// ストラテジ:
//  - installGlobalAudioUnlock() を 起動時 に 呼ぶ。 次に 起きた pointerdown /
//    touchstart / keydown 1 回 で unlockAudio() を 走らせ、 リスナを 外す。
//  - これで 送金 / 購入 / 開始 / 一時停止 など どの ボタン を 押しても 結果的に
//    unlock 済み。 個別 ハンドラ に 仕込む 必要なし。
//  - 明示的に 呼びたい 場面 (例: ▶ 開始 直押し で 即 鳴らしたい) では
//    unlockAudio() を click ハンドラ 内 で 直接 呼ぶのも OK。
//
// 重要: 共有 AudioContext は getAudioCtx() で 1 個 だけ 作る。 timer のチーン
// / stopwatch のラップ音 / 効果音 全部 同じ ctx を 使う。

let audioCtx = null;
let installed = false;
let unlockedHtml = false;

// 0 ボリューム の 44byte WAV (1サンプル 無音)。 HTMLAudio の unlock 用。
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export function getAudioCtx() {
  if (audioCtx) return audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  } catch (_) { return null; }
  return audioCtx;
}

// ユーザ操作 文脈 で 呼ぶ unlock。 多重呼び出し OK (冪等)。
export function unlockAudio() {
  // 1) Web Audio: resume + 短い 無音 osc を スケジュール
  const ctx = getAudioCtx();
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.01);
    } catch (_) { /* swallow */ }
  }
  // 2) HTMLAudio: 同期的に 無音 WAV を play()。 sounds.js (effect sounds) が
  //    setInterval や 完了 callback 経由で 鳴らす 場面 でも 通るようになる。
  if (!unlockedHtml) {
    try {
      const a = new Audio(SILENT_WAV);
      a.volume = 0;
      const p = a.play();
      if (p && p.then) {
        p.then(() => { unlockedHtml = true; }).catch(() => {});
      } else {
        unlockedHtml = true;
      }
    } catch (_) { /* swallow */ }
  }
}

// 起動時 に 1 度だけ 呼ぶ。 次の 任意の ユーザ操作 で unlock + リスナ 解除。
export function installGlobalAudioUnlock() {
  if (installed) return;
  installed = true;
  const handler = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', handler, true);
    window.removeEventListener('touchstart',  handler, true);
    window.removeEventListener('keydown',     handler, true);
  };
  // capture: true で 他の click ハンドラ より 先に 走る (内部で stopPropagation
  // しても unlock は 通る)。
  window.addEventListener('pointerdown', handler, true);
  window.addEventListener('touchstart',  handler, true);
  window.addEventListener('keydown',     handler, true);
}

// ─── 合成音 (オシレータ生成、 アセット 不要) ────────────────────────────
// ルーレット の 境界通過音 / 終了音 と 同じ。 「学会タイマー の ベル」 や
// 「タップ フィードバック」 など 短い 合図 に そのまま 使える。

// v455 境界通過音 / 終了音 は 毎回 new AudioContext を 作って 鳴らす
// (= ルーレット の playSpinSounds と 同じ パターン)。 共有 ctx を 使う 方式は
// iOS Safari が バックグラウンド ⇄ フォアグラウンド で ctx を suspended に
// 戻し、 setInterval から の resume() が 効か ず 無音化 する 事故 が ある。
// 新 ctx は 「ページに ユーザ操作 が 1 回でも 起きていた 状態」 を 引き継いで
// 直ちに running で 立ち上がる ので 音が 出る。 鳴り終わったら close する。

function makeCtx() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    return new Ctx();
  } catch (_) { return null; }
}

// 境界通過 (= 1 鈴 / 2 鈴 / 3 鈴 / ストップウォッチ ラップ など)。
// 880 Hz / square / 50 ms。 短い 「カチッ」 〜 「キン」。
export function playBoundaryTick() {
  const ctx = makeCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g).connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 880;
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.start(now);
    osc.stop(now + 0.05);
  } catch (_) { /* swallow */ }
  setTimeout(() => { try { ctx.close(); } catch (_) {} }, 200);
}

// 終了 「ターン・ダ」 (= ~B5 + 完全5度上)。 2 音 を 180ms ずらして 鳴らす。
export function playEndDing() {
  const ctx = makeCtx();
  if (!ctx) return;
  const root = 988; // ~B5
  try {
    [root, root * 1.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g).connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.25,   start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
      osc.start(start);
      osc.stop(start + 0.75);
    });
  } catch (_) { /* swallow */ }
  setTimeout(() => { try { ctx.close(); } catch (_) {} }, 1500);
}
