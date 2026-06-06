// v456 ユーザ設定 を サーバ と 同期 する 軽量ヘルパ。
// 既存 コード は localStorage.getItem / setItem を 使い続け ている (大改造 を
// 避ける ため)。 この モジュール は:
//  - ログイン直後 に サーバの 設定 を 一括取得 → localStorage に 反映
//    (= 別デバイス で 設定した 内容が 自端末 に 即 効く)
//  - localStorage.setItem の 横で 100ms debounce で サーバ にも 上げる
//    (= 自端末 で 設定 変更 → サーバ → 他端末 で 次回ログイン時 に 反映)
//
// 同期 対象 は 「labpay-」 で 始まる キー (= LabPay 内 設定)。 他の キー
// (= 外部ライブラリ 等) は 触らない。
//
// 起動 順: app.js の init で boot() を 呼ぶ → fetch → localStorage 上書き →
// その後 各 view が localStorage を 読み込む。 「初回 fetch が 終わる 前 に
// view が 描画 され、 設定が 反映 されない」 race を 避ける ため、 boot は
// await 可能 (Promise を 返す)。

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

// サーバから 全件 取得 → localStorage を 上書き。 既に localStorage に ある
// キー も サーバ値 で 上書き する (=サーバ が ground truth)。 自端末 で 直近
// 変更 を 失わ ない ため、 boot 前 に 書かれた pending は flush してから 適用。
export async function bootSettingsSync() {
  if (booted) return;
  booted = true;
  try {
    const r = await get('/api/me/settings');
    const items = r.items || {};
    for (const k in items) {
      try {
        // value が object/array なら JSON.stringify、 文字列/数値/bool は そのまま 保存。
        const v = items[k];
        const stored = (typeof v === 'string') ? v : JSON.stringify(v);
        localStorage.setItem(k, stored);
      } catch (_) {}
    }
  } catch (_) { /* swallow — offline / 未ログイン 等 */ }
  // localStorage.setItem を フック して 以後 の 変更 を サーバ に 送る
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
      // pending 中 だった 場合 は 一旦 取り消し、 サーバ には null を 上げる
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
    // 文字列を 受け取って いる が、 サーバには parse した 形 で 送る (= 再度
    // 読み出す とき に object/array の まま 受け取れる)。 parse 失敗 なら 生 文字列。
    let parsed;
    try { parsed = JSON.parse(v); } catch (_) { parsed = v; }
    batch[k] = parsed;
  }
  pendingWrites.clear();
  try { await put('/api/me/settings', batch); }
  catch (_) { /* swallow — 次回 fluction で 再試行 されない が、 ローカル には 既に 反映 済み */ }
}
