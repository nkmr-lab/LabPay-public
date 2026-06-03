#!/usr/bin/env python3
"""
01. 自分の残高と連続ラボイン日数を表示する。

これが動けば dev-login + GET /api/me が通っている = 他の API も叩ける状態。
"""
import os, requests

BASE  = os.environ.get("LABPAY_BASE", "https://pay.nkmr.io/api")
EMAIL = os.environ["LABPAY_EMAIL"]  # 環境変数で指定

s = requests.Session()
s.post(f"{BASE}/auth/dev-login",
       headers={"X-Requested-With": "labpay"},
       json={"email": EMAIL}).raise_for_status()

me = s.get(f"{BASE}/me").json()
print(f"こんにちは {me['user']['display_name']} さん")
print(f"  残高:        {me['balance']} pt")
print(f"  連続ラボイン: {me['streak']['current_streak']} 日 "
      f"(最長 {me['streak']['longest_streak']} 日)")
