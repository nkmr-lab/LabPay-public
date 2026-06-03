#!/usr/bin/env python3
"""
02. 今ラボにいる人を部屋別に列挙する。

scanner が直近 数分間 に観測した MAC を、ユーザに紐付けて返してくれる API。
出力例:
  📍 10階研究室 (10F) — 4 人
     - 中村聡史 (滞在 2 時間 13 分)
     - ...
"""
import os, requests

BASE  = os.environ.get("LABPAY_BASE", "https://pay.nkmr.io/api")
EMAIL = os.environ["LABPAY_EMAIL"]

s = requests.Session()
s.post(f"{BASE}/auth/dev-login",
       headers={"X-Requested-With": "labpay"},
       json={"email": EMAIL}).raise_for_status()

pres = s.get(f"{BASE}/presence").json()
for room in pres["rooms"]:
    users = room.get("users", [])
    print(f"📍 {room['display_name']} ({room['id']}) — {len(users)} 人")
    for u in users:
        mins = u.get("stay_minutes") or 0
        if mins >= 60:
            dur = f" (滞在 {mins // 60} 時間 {mins % 60} 分)"
        elif mins > 0:
            dur = f" (滞在 {mins} 分)"
        else:
            dur = ""
        print(f"   - {u['display_name']}{dur}")
