#!/usr/bin/env python3
"""
08. 部屋ごとの 「曜日 × 時間」 ヒートマップを CSV に書き出す。

LabPay 内蔵ビューと同じデータ。 各部屋について
  matrix[day_of_week][hour] = その時間帯の 平均在室人数
が取れる。 day_of_week は 0=日, 1=月, ..., 6=土。

実行例: 直近 30 日のデータを CSV (room.<ID>.csv) に書き出す。
"""
import os, csv, requests

BASE  = os.environ.get("LABPAY_BASE", "https://pay.nkmr.io/api")
EMAIL = os.environ["LABPAY_EMAIL"]
DAYS  = int(os.environ.get("DAYS", "30"))

s = requests.Session()
s.post(f"{BASE}/auth/dev-login",
       headers={"X-Requested-With": "labpay"},
       json={"email": EMAIL}).raise_for_status()

d = s.get(f"{BASE}/presence/heatmap", params={"days": DAYS}).json()
days_jp = ["日", "月", "火", "水", "木", "金", "土"]

for room in d["rooms"]:
    out = f"room.{room['id']}.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["day"] + [f"{h:02d}" for h in range(24)])
        for di, row in enumerate(room["matrix"]):
            w.writerow([days_jp[di]] + [f"{v:.2f}" for v in row])
    peak = max(max(r) for r in room["matrix"])
    print(f"  {room['display_name']} ({room['id']}): peak={peak:.2f} 人 → {out}")
