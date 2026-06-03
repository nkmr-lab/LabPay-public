#!/usr/bin/env python3
"""
05. 自分の最近の取引履歴 (50 件) を見やすく表示する。

signed_amount は 「自分の口座から見た符号付き」 (正: 受取、 負: 支払)。
type は initial / checkin / purchase / fee / reversal / transfer /
task_reward / deposit / refund / burn / scrapbox_reward / app_open_reward。
"""
import os, requests

BASE  = os.environ.get("LABPAY_BASE", "https://pay.nkmr.io/api")
EMAIL = os.environ["LABPAY_EMAIL"]

s = requests.Session()
s.post(f"{BASE}/auth/dev-login",
       headers={"X-Requested-With": "labpay"},
       json={"email": EMAIL}).raise_for_status()

d = s.get(f"{BASE}/me/transactions", params={"limit": 50}).json()
total_in  = sum(t["signed_amount"] for t in d["items"] if t["signed_amount"] > 0)
total_out = sum(-t["signed_amount"] for t in d["items"] if t["signed_amount"] < 0)
print(f"=== 直近 {len(d['items'])} 件: 入 +{total_in} / 出 -{total_out} ===\n")

for t in d["items"][:20]:
    sign = "+" if t["signed_amount"] > 0 else ""
    who  = t.get("counterparty") or "—"
    prod = f" · {t['product_name']}" if t.get("product_name") else ""
    print(f"  {t['created_at'][:16]}  {sign}{t['signed_amount']:>5} pt"
          f"  [{t['type']}]  {who}{prod}")
