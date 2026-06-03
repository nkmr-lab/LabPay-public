#!/usr/bin/env python3
"""
06. 開いてるタスク一覧 を見やすく出す。

引き受けたいタスクの 「報酬・締切・残り人数」 を一望するイメージ。
GET /api/tasks は 「自分が関わってる + open な全タスク」 を返してくれるので、
status=open かつ can_claim=true で絞る。
"""
import os, requests

BASE  = os.environ.get("LABPAY_BASE", "https://pay.nkmr.io/api")
EMAIL = os.environ["LABPAY_EMAIL"]

s = requests.Session()
s.post(f"{BASE}/auth/dev-login",
       headers={"X-Requested-With": "labpay"},
       json={"email": EMAIL}).raise_for_status()

d = s.get(f"{BASE}/tasks").json()
claimable = [t for t in d["items"] if t["status"] == "open" and t.get("can_claim")]
claimable.sort(key=lambda t: -t["reward"])  # 高報酬から

if not claimable:
    print("引き受けられるタスクは今ありません")
    raise SystemExit

print(f"=== あなたが引き受けられるタスク {len(claimable)} 件 ===\n")
for t in claimable:
    dl = f"  締切 {t['deadline']}" if t.get("deadline") else ""
    rem = t.get("remaining", "?")
    print(f"  [{t['reward']:>4} pt]  {t['title']}")
    print(f"     依頼: {t['requester_name']}  残 {rem} 人{dl}")
    if t.get("description"):
        print(f"     {t['description'][:80]}")
    print()
