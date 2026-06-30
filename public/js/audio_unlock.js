// v448 共有オーディオ unlock。
// iOS Safari / 多くの Mobile ブラウザでは 「ユーザ操作 1 回後」 でないと
//  - Web Audio API: AudioContext が suspended のまま (createOscillator + start
//    しても音は出ない)
//  - HTMLAudio: new Audio(url).play() が NotAllowedError
// となる。 一度 unlock すればそのページに居る間は自動再生 (setInterval からの
// 鳴動含む) が通る。
//
// ストラテジ:
//  - installGlobalAudioUnlock() を起動時に呼ぶ。 次に起きた pointerdown /
//    touchstart / keydown 1 回で unlockAudio() を走らせ、 リスナを外す。
//  - これで送金 / 購入 / 開始 / 一時停止などどのボタンを押しても結果的に
//    unlock 済み。 個別ハンドラに仕込む必要なし。
//  - 明示的に呼びたい場面 (例: ▶ 開始直押しで即鳴らしたい) では
//    unlockAudio() を click ハンドラ内で直接呼ぶのも OK。
//
// 重要: 共有 AudioContext は getAudioCtx() で 1 個だけ作る。 timer のチーン
// / stopwatch のラップ音 / 効果音全部同じ ctx を使う。

let audioCtx = null;
let installed = false;
let unlockedHtml = false;

// 0 ボリュームの 44byte WAV (1サンプル無音)。 HTMLAudio の unlock 用。
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

// ユーザ操作文脈で呼ぶ unlock。 多重呼び出し OK (冪等)。
export function unlockAudio() {
  // 1) Web Audio: resume + 短い無音 osc をスケジュール
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
  // 2) HTMLAudio: 同期的に無音 WAV を play()。 sounds.js (effect sounds) が
  //    setInterval や完了 callback 経由で鳴らす場面でも通るようになる。
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

// 起動時に 1 度だけ呼ぶ。 次の任意のユーザ操作で unlock + リスナ解除。
export function installGlobalAudioUnlock() {
  if (installed) return;
  installed = true;
  const handler = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', handler, true);
    window.removeEventListener('touchstart',  handler, true);
    window.removeEventListener('keydown',     handler, true);
  };
  // capture: true で他の click ハンドラより先に走る (内部で stopPropagation
  // しても unlock は通る)。
  window.addEventListener('pointerdown', handler, true);
  window.addEventListener('touchstart',  handler, true);
  window.addEventListener('keydown',     handler, true);
}

// ─── 合成音 (オシレータ生成、 アセット不要) ────────────────────────────
// ルーレットの境界通過音 / 終了音と同じ。 「学会タイマーのベル」 や
// 「タップフィードバック」 など短い合図にそのまま使える。

// v455 境界通過音 / 終了音は毎回 new AudioContext を作って鳴らす
// (= ルーレットの playSpinSounds と同じパターン)。 共有 ctx を使う方式は
// iOS Safari がバックグラウンド ⇄ フォアグラウンドで ctx を suspended に
// 戻し、 setInterval からの resume() が効かず無音化する事故がある。
// 新 ctx は 「ページにユーザ操作が 1 回でも起きていた状態」 を引き継いで
// 直ちに running で立ち上がるので音が出る。 鳴り終わったら close する。

function makeCtx() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    return new Ctx();
  } catch (_) { return null; }
}

// 境界通過 (= 1 鈴 / 2 鈴 / 3 鈴 / ストップウォッチラップなど)。
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

// 終了 「ターン・ダ」 (= ~B5 + 完全5度上)。 2 音を 180ms ずらして鳴らす。
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
