// Screen Wake Lock helper. タイマー / ストップウォッチ 実行中に スクリーンが
// スリープしないように 取得し、 終了 / 一時停止 / ページ離脱 で 解放する。
//
// 仕様:
//  - navigator.wakeLock.request('screen') を 持続中 acquire
//  - ページが visibilityhidden で OS が 自動解放するため、 visible に戻ったら 再取得
//  - 「持続中フラグ」 を 内部で 持って、 release() が 来たら 取らない
//
// 単一インスタンス。 acquire(key) で 同じ key 同士 は ノーオプ、 別 key も 重複呼びは
// 直近の key だけ 有効 (旧 key の sentinel は そっと release)。
//
// 失敗 (未対応 / NotAllowedError / フォーカス なし) は silently swallow。

let _sentinel = null;
let _activeKey = null;
let _visListener = null;

async function _request() {
  if (!('wakeLock' in navigator)) return null;
  if (_sentinel && !_sentinel.released) return _sentinel;
  try {
    _sentinel = await navigator.wakeLock.request('screen');
    _sentinel.addEventListener('release', () => {
      // OS / ブラウザ が 解放した。 _activeKey が セットなら 後で 再取得 試みる。
    });
    return _sentinel;
  } catch (_) {
    _sentinel = null;
    return null;
  }
}

function _ensureVisListener() {
  if (_visListener) return;
  _visListener = () => {
    if (document.visibilityState === 'visible' && _activeKey) {
      _request();
    }
  };
  document.addEventListener('visibilitychange', _visListener);
}

// acquire('timer-123' など key) で 「この対象が 動いている間 ON」 を 表現。
// 同じ key で 連続呼んでも 重複取得 しない。 別 key で 呼んだら 旧 key は 上書き。
export async function acquireWakeLock(key) {
  _activeKey = key;
  _ensureVisListener();
  await _request();
}

export async function releaseWakeLock(key) {
  // 別 key で acquire されている場合は 黙って 無視 (まだ 別ターゲットが 動いている)
  if (key !== null && _activeKey !== key) return;
  _activeKey = null;
  if (_sentinel && !_sentinel.released) {
    try { await _sentinel.release(); } catch (_) {}
  }
  _sentinel = null;
}

export function isWakeLockSupported() {
  return 'wakeLock' in navigator;
}
