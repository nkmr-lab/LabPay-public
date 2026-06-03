#!/usr/bin/env python3
"""
07. 誰か (TARGET_USER_ID) に 1pt を 「ありがとう」 メモ付きで送る。

唯一の 「副作用あり」 サンプル。 idempotency_key 必須 (UUID 推奨)。
同じ key で再送すると保存済みレスポンスが返って 二重送金されない仕様。

実行前に TARGET_USER_ID を環境変数で指定:
  export LABPAY_TARGET_USER_ID=7
  python3 samples/07_send_thanks.py
"""
import os, uuid, requests

BASE   = os.environ.get("LABPAY_BASE", "https://pay.nkmr.io/api")
EMAIL  = os.environ["LABPAY_EMAIL"]
TARGET = int(os.environ["LABPAY_TARGET_USER_ID"])

s = requests.Session()
s.post(f"{BASE}/auth/dev-login",
       headers={"X-Requested-With": "labpay"},
       json={"email": EMAIL}).raise_for_status()

r = s.post(f"{BASE}/transfers",
    headers={"X-Requested-With": "labpay"},
    json={
        "to_user_id": TARGET,
        "amount": 1,
        "memo": "🙏 ありがとう",
        "idempotency_key": str(uuid.uuid4()),
    })
r.raise_for_status()
d = r.json()
print(f"OK — ledger #{d['ledger_id']}, 残高 {d['new_balance']} pt")
