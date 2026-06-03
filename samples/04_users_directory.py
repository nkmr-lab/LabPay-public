#!/usr/bin/env python3
"""
04. LabPay メンバー一覧 (= 許可リスト上のユーザ)。

学年でグループ分けして出す例。 ID + 表示名 + 学年 が取れる。 avatar_url なども
レスポンスに含まれている。
"""
import os, requests
from collections import defaultdict

BASE  = os.environ.get("LABPAY_BASE", "https://pay.nkmr.io/api")
EMAIL = os.environ["LABPAY_EMAIL"]

s = requests.Session()
s.post(f"{BASE}/auth/dev-login",
       headers={"X-Requested-With": "labpay"},
       json={"email": EMAIL}).raise_for_status()

d = s.get(f"{BASE}/users").json()
by_grade = defaultdict(list)
for u in d["items"]:
    by_grade[u.get("grade") or "(未設定)"].append(u)

# D → M2 → M1 → B4 → B3 → 未設定 の順
order = ["D", "M2", "M1", "B4", "B3", "(未設定)"]
for g in order:
    members = by_grade.get(g) or []
    if not members:
        continue
    print(f"\n[{g}]  {len(members)} 人")
    for u in members:
        print(f"  {u['id']:>3}: {u['display_name']}")
