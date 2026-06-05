#!/usr/bin/env python3
"""
LabPay queue watcher — Claude Code 駆動用 外部ポーラ。

機構:
  1. https://pay.nkmr.io/api/feedback/claude_queue を 60 秒 ごとに 取得
  2. has_work が false → true に 変わったら Claude Code の 入力欄を クリック → "start"
     を タイプ → Enter
  3. has_work が true → false に 変わったら 同様に "stop" + Enter

前提:
  - 日本語 IME は OFF (start/stop を ASCII で 直接 入力するため)
  - Claude Code が フォアグラウンド or 既知の 入力欄 座標を 知っている
  - pip install pyautogui requests

使い方:
  # 1) Claude Code 入力欄の 中央 座標を 控える (画面下部の prompt 部分)
  python3 -c "import pyautogui; print('mouse:', pyautogui.position())"
  # マウスを 入力欄に 置いて 数秒以内に 上記 実行 → 表示された 座標を 下の INPUT_XY に セット
  #
  # 2) この スクリプトを 走らせる
  python3 queue_watcher.py

  止めるときは Ctrl+C。

挙動:
  - Claude Code は "start" を 受けると "巡回" モードに 入り、 approved を 全件 処理
  - "stop" は no-op (ウォッチャ の 状態 リセット 用 マーカー / Claude 側は 黙って 受け流す)

注意:
  - 同マシン で 動かす (リモート から の キー注入は SSH+xdotool/AppleScript 等が 必要)
  - 入力欄を 移動 したら INPUT_XY を 再計測
  - キー入力中 に 画面 操作 すると 暴発する ので 放置 推奨
"""

import sys
import json
import time
import urllib.request

# ───── 設定 ─────
URL            = "https://pay.nkmr.io/api/feedback/claude_queue"
POLL_INTERVAL  = 60       # 秒
INPUT_XY       = (800, 950)  # ← Claude Code 入力欄 の (x, y) 画面座標 に セット
TYPE_INTERVAL  = 0.05     # キー入力 間 遅延
CLICK_DELAY    = 0.3      # クリック 後 待ち
ENTER_DELAY    = 0.2      # 入力後 Enter までの 待ち
# ─────────────────

try:
    import pyautogui
    pyautogui.PAUSE  = 0.1
    pyautogui.FAILSAFE = True  # マウスを 画面左上 隅に 動かすと 中断 (緊急停止)
except ImportError:
    print("pip install pyautogui requests")
    sys.exit(1)


def fetch_has_work() -> bool | None:
    try:
        with urllib.request.urlopen(URL, timeout=10) as resp:
            data = json.load(resp)
            return bool(data.get("has_work"))
    except Exception as e:
        print(f"[watcher] poll error: {e}")
        return None


def type_command(text: str) -> None:
    """Click input area + type text + Enter."""
    x, y = INPUT_XY
    print(f"[watcher] click ({x}, {y}) → type {text!r} → Enter")
    pyautogui.click(x, y)
    time.sleep(CLICK_DELAY)
    pyautogui.typewrite(text, interval=TYPE_INTERVAL)
    time.sleep(ENTER_DELAY)
    pyautogui.press("enter")


def main() -> None:
    print(f"[watcher] started — polling {URL} every {POLL_INTERVAL}s")
    print(f"[watcher] input at {INPUT_XY} (mouse-failsafe: 左上 隅 で 中断)")
    last = None
    while True:
        cur = fetch_has_work()
        if cur is None:
            time.sleep(POLL_INTERVAL)
            continue
        if last is None:
            print(f"[watcher] initial state: has_work={cur}")
            last = cur
        elif cur != last:
            print(f"[watcher] transition: {last} → {cur}")
            type_command("start" if cur else "stop")
            last = cur
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[watcher] stopped by user")
