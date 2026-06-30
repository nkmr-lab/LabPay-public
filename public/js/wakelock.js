// Screen Wake Lock helper. タイマー / ストップウォッチ実行中にスクリーンが
// スリープしないように取得し、 終了 / 一時停止 / ページ離脱で解放する。
//
// 仕様:
//  - navigator.wakeLock.request('screen') を持続中 acquire
//  - ページが visibilityhidden で OS が自動解放するため、 visible に戻ったら再取得
//  - 「持続中フラグ」 を内部で持って、 release() が来たら取らない
//
// 単一インスタンス。 acquire(key) で同じ key 同士はノーオプ、 別 key も重複呼びは
// 直近の key だけ有効 (旧 key の sentinel はそっと release)。
//
// 失敗 (未対応 / NotAllowedError / フォーカスなし) は silently swallow。

let _sentinel = null;
let _activeKey = null;
let _visListener = null;

async function _request() {
  if (!('wakeLock' in navigator)) return null;
  if (_sentinel && !_sentinel.released) return _sentinel;
  try {
    _sentinel = await navigator.wakeLock.request('screen');
    _sentinel.addEventListener('release', () => {
      // OS / ブラウザが解放した。 _activeKey がセットなら後で再取得試みる。
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

// acquire('timer-123' など key) で 「この対象が動いている間 ON」 を表現。
// 同じ key で連続呼んでも重複取得しない。 別 key で呼んだら旧 key は上書き。
export async function acquireWakeLock(key) {
  _activeKey = key;
  _ensureVisListener();
  await _request();
}

export async function releaseWakeLock(key) {
  // 別 key で acquire されている場合は黙って無視 (まだ別ターゲットが動いている)
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
