// v456 ユーザ設定をサーバと同期する軽量ヘルパ。
// 既存コードは localStorage.getItem / setItem を使い続けている (大改造を
// 避けるため)。 このモジュールは:
//  - ログイン直後にサーバの設定を一括取得 → localStorage に反映
//    (= 別デバイスで設定した内容が自端末に即効く)
//  - localStorage.setItem の横で 100ms debounce でサーバにも上げる
//    (= 自端末で設定変更 → サーバ → 他端末で次回ログイン時に反映)
//
// 同期対象は 「labpay-」 で始まるキー (= LabPay 内設定)。 他のキー
// (= 外部ライブラリ等) は触らない。
//
// 起動順: app.js の init で boot() を呼ぶ → fetch → localStorage 上書き →
// その後各 view が localStorage を読み込む。 「初回 fetch が終わる前に
// view が描画され、 設定が反映されない」 race を避けるため、 boot は
// await 可能 (Promise を返す)。

import { get, put } from './api.js';

const PREFIX = 'labpay-';
let booted = false;
const pendingWrites = new Map();
let flushTimer = null;
const FLUSH_MS = 400;

function shouldSync(key) {
  return typeof key === 'string' && key.startsWith(PREFIX);
}

function parseStored(raw) {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch (_) { return raw; }
}

// サーバから全件取得 → localStorage を上書き。 既に localStorage にある
// キーもサーバ値で上書きする (=サーバが ground truth)。 自端末で直近
// 変更を失わないため、 boot 前に書かれた pending は flush してから適用。
export async function bootSettingsSync() {
  if (booted) return;
  booted = true;
  try {
    const r = await get('/api/me/settings');
    const items = r.items || {};
    for (const k in items) {
      try {
        // value が object/array なら JSON.stringify、 文字列/数値/bool はそのまま保存。
        const v = items[k];
        const stored = (typeof v === 'string') ? v : JSON.stringify(v);
        localStorage.setItem(k, stored);
      } catch (_) {}
    }
  } catch (_) { /* swallow — offline / 未ログイン等 */ }
  // localStorage.setItem をフックして以後の変更をサーバに送る
  installSetItemHook();
}

function installSetItemHook() {
  const orig = Storage.prototype.setItem;
  if (Storage.prototype._labpaySynced) return;
  Storage.prototype._labpaySynced = true;
  Storage.prototype.setItem = function (key, value) {
    orig.call(this, key, value);
    if (this === window.localStorage && shouldSync(key)) {
      schedulePut(key, value);
    }
  };
  const origRemove = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (key) {
    origRemove.call(this, key);
    if (this === window.localStorage && shouldSync(key)) {
      // pending 中だった場合は一旦取り消し、 サーバには null を上げる
      pendingWrites.set(key, null);
      scheduleFlush();
    }
  };
}

function schedulePut(key, value) {
  pendingWrites.set(key, value);
  scheduleFlush();
}
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushPending, FLUSH_MS);
}
async function flushPending() {
  flushTimer = null;
  if (!pendingWrites.size) return;
  const batch = {};
  for (const [k, v] of pendingWrites) {
    if (v === null) { batch[k] = null; continue; }
    // 文字列を受け取っているが、 サーバには parse した形で送る (= 再度
    // 読み出すときに object/array のまま受け取れる)。 parse 失敗なら生文字列。
    let parsed;
    try { parsed = JSON.parse(v); } catch (_) { parsed = v; }
    batch[k] = parsed;
  }
  pendingWrites.clear();
  try { await put('/api/me/settings', batch); }
  catch (_) { /* swallow — 次回 fluction で再試行されないが、 ローカルには既に反映済み */ }
}
