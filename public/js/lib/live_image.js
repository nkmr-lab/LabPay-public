// v1341 cast (cast.nkmr.io/shot/<token>.jpg) の 「最新の1枚」 URL を img に 自動 更新 反映 する 共通 lib。
// docs/CAST_INTEGRATION.md #2 の 通り:
//   - cast URL の 時 だけ 5秒 間隔 で refresh
//   - 直接 imgEl.src を書き換えない (裏 の Image で 読み終えてから 差し替え → プロジェクタ ちらつき 防止)
//   - 404 (配信終了) は 「消す」 扱い せず 最後 の 絵 を そのまま 残す
// public_timer.js / timers.js 両方 から 使う。

const CAST_SHOT_RE = /^https:\/\/cast\.nkmr\.io\/shot\/[A-Za-z0-9_-]{16,64}\.jpg$/;
const REFRESH_MS = 5000;

export function isCastShotUrl(url) {
  return !!url && CAST_SHOT_RE.test(String(url));
}

/**
 * imgEl に url を セット する。 cast の URL なら 5秒 毎 に 裏 で fetch して 差し替え、
 * それ以外 の URL は 単純 に src を セット する。
 * 呼び出し 元 は view 破棄 時 に 返り値 の stop() を 必ず 呼ぶ こと (二重 setInterval 防止)。
 *
 * @param {HTMLImageElement} imgEl
 * @param {string|null} url
 * @returns {{stop: () => void}}
 */
export function attachLiveImage(imgEl, url) {
  let timer = null;
  let base = '';

  const refresh = () => {
    if (!base) return;
    const next = new Image();
    next.onload  = () => { imgEl.src = next.src; };
    next.onerror = () => { /* 404 (配信終了) → 最後 の 絵 を そのまま 残す */ };
    next.src = base + (base.includes('?') ? '&' : '?') + 't=' + Date.now();
  };

  const stop = () => {
    if (timer !== null) { clearInterval(timer); timer = null; }
    base = '';
  };

  if (!url) {
    imgEl.removeAttribute('src');
    return { stop };
  }
  if (isCastShotUrl(url)) {
    base = url;
    refresh();                                // 初回 は 即
    timer = setInterval(refresh, REFRESH_MS); // 以降 5秒毎
  } else {
    // 通常 の 静止画 (uploads / 自 origin) は そのまま
    if (imgEl.src !== url) imgEl.src = url;
  }
  return { stop };
}
