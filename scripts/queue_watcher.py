#!/usr/bin/env python3
"""
LabPay queue watcher — Claude Code 駆動用外部ポーラ。

機構:
  1. https://pay.nkmr.io/api/feedback/claude_queue を 60 秒ごとに取得
  2. has_work が false → true に変わったら Claude Code の入力欄をクリック → "start"
     をタイプ → Enter
  3. has_work が true → false に変わったら同様に "stop" + Enter

前提:
  - 日本語 IME は OFF (start/stop を ASCII で直接入力するため)
  - Claude Code がフォアグラウンド or 既知の入力欄座標を知っている
  - pip install pyautogui requests

使い方:
  # 1) Claude Code 入力欄の中央座標を控える (画面下部の prompt 部分)
  python3 -c "import pyautogui; print('mouse:', pyautogui.position())"
  # マウスを入力欄に置いて数秒以内に上記実行 → 表示された座標を下の INPUT_XY にセット
  #
  # 2) このスクリプトを走らせる
  python3 queue_watcher.py

  止めるときは Ctrl+C。

挙動:
  - Claude Code は "start" を受けると "巡回" モードに入り、 approved を全件処理
  - "stop" は no-op (ウォッチャの状態リセット用マーカー / Claude 側は黙って受け流す)

注意:
  - 同マシンで動かす (リモートからのキー注入は SSH+xdotool/AppleScript 等が必要)
  - 入力欄を移動したら INPUT_XY を再計測
  - キー入力中に画面操作すると暴発するので放置推奨
"""

import sys
import json
import time
import urllib.request

# ───── 設定 ─────
URL            = "https://pay.nkmr.io/api/feedback/claude_queue"
POLL_INTERVAL  = 60       # 秒
INPUT_XY       = (800, 950)  # ← Claude Code 入力欄の (x, y) 画面座標にセット
TYPE_INTERVAL  = 0.05     # キー入力間遅延
CLICK_DELAY    = 0.3      # クリック後待ち
ENTER_DELAY    = 0.2      # 入力後 Enter までの待ち
# ─────────────────

try:
    import pyautogui
    pyautogui.PAUSE  = 0.1
    pyautogui.FAILSAFE = True  # マウスを画面左上隅に動かすと中断 (緊急停止)
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
    print(f"[watcher] input at {INPUT_XY} (mouse-failsafe: 左上隅で中断)")
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
