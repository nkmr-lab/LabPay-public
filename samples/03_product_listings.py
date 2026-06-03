#!/usr/bin/env python3
"""
03. 出品中の商品を一覧する。

価格安い順 (API のデフォルト) で並ぶ。 安いもの top 10 と無料 (これどうぞ)
だけ抜き出す例。
"""
import os, requests

BASE  = os.environ.get("LABPAY_BASE", "https://pay.nkmr.io/api")
EMAIL = os.environ["LABPAY_EMAIL"]

s = requests.Session()
s.post(f"{BASE}/auth/dev-login",
       headers={"X-Requested-With": "labpay"},
       json={"email": EMAIL}).raise_for_status()

d = s.get(f"{BASE}/listings", params={"limit": 200}).json()
items = d["items"]

print(f"=== 出品中: {len(items)} 件 ===")
gifts  = [x for x in items if x["is_gift"]]
priced = [x for x in items if not x["is_gift"]]

print("\n🎁 これどうぞ (無料):")
for x in gifts:
    print(f"  {x['name']}  @ {x['seller_name']}  在庫 {x['qty']}")

print("\n💰 安いもの top 10:")
for x in priced[:10]:
    print(f"  {x['price']:>5} pt — {x['name']}  @ {x['seller_name']}  在庫 {x['qty']}")
