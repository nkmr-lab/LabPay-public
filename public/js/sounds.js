// 効果音の再生・設定まわり。 API:
//   await preloadSounds()   ログイン直後 1 回呼ぶ。 /api/sounds/my を fetch し、
//                            event_key → {file_url, volume} を memory に持つ。
//                            ついでに HTMLAudio を warm up (ブラウザによっては
//                            最初の play() で 200ms 遅延するため)。
//   playSound(eventKey)     即時再生。 mute / clip 未設定なら no-op。
//                            ブラウザの autoplay 制限のため必ず「ユーザ操作の
//                            イベントハンドラ内」で呼ぶこと (タップ後の click handler 内 OK)。
//
// event_key の定義はサーバ側 SOUND_EVENTS と一致させる。

import { get } from './api.js';

export const SOUND_EVENTS = ['payment', 'roulette_spin'];

const cache = new Map();   // event_key → { url, volume, audio? }
let loaded = false;

export async function preloadSounds() {
  try {
    const d = await get('/api/sounds/my');
    cache.clear();
    for (const it of (d.items || [])) {
      if (it.resolved) {
        cache.set(it.event_key, {
          url: it.resolved.file_url,
          volume: Math.max(0, Math.min(100, Number(it.resolved.volume) || 70)) / 100,
        });
      }
    }
    loaded = true;
  } catch (_) {
    loaded = true;
  }
}

// 「ユーザ操作」が直近にあったとき (タップなどから連鎖して呼んだとき) 限定で再生。
// 再生中の重複は OK (HTMLAudio を毎回 new。連打しても重ねて鳴る)。
export function playSound(eventKey) {
  const cfg = cache.get(eventKey);
  if (!cfg) return; // 未設定 / mute
  try {
    const audio = new Audio(cfg.url);
    audio.volume = cfg.volume;
    // play() は Promise を返す。 autoplay 拒否で reject されても黙殺。
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  } catch (_) { /* swallow */ }
}

// 任意の URL を試聴用に鳴らす (clip プレビューや試聴ボタンから)。
export function previewSoundUrl(url, volume = 0.7) {
  if (!url) return;
  try {
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume));
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  } catch (_) { /* swallow */ }
}

// 設定変更直後に再 fetch するときの薄ヘルパ。
export async function refreshSoundCache() { await preloadSounds(); }
