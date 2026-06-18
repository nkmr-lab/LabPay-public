# 研究費 執行 管理 設計 案 (draft)

ステータス: **保留** (2026-06-17 起案、 ユーザ が 慎重 に 検討 中)。 着手 前 に 設計 を 再確認 する こと。

スプレッドシート `2026年度 研究費.xlsx` から の 移行 を 想定。

## 既存 シート 構成 (調査 結果)

| シート | 役割 | 列 (主要) |
|---|---|---|
| 予算 | 外部 研究費 マスタ (Wacom / Yahoo / パイロット 等) | 予算名 / 年度 / 金額 / プロジェクト名 / 作業内容 (1250円帯) / 作業内容 (1600円帯) |
| 全体 | 年度 サマリ | 研究費目 / ID / 今年度予算 / 繰越 / 総額 / 支出 / 残額 / 使用率 |
| Log | 物品 購入 | 研究費 / 状況 / 項目 / 金額 / 日時 / 備考 |
| LogTravel | 出張 | + 自費 / 実費 / 大学院 補助 / 出張申請 / 領収書 / 出張報告 (フラグ) |
| LogHuman | アルバイト | + 月 / 人 / 時給 / 時間 |
| LogHumanAmagift | Amazon ギフト 等 | + 1人辺り / 人数 / 購入 / 提出 / 終了 |
| LogSubsc | サブスク | (Log と 同形) |
| LogDoctor | 博士 関連 | + 支出者 |
| 実験実習費（共通） | 共通費 | 予算 / 合計 / 残額 |
| 出張のお金支払い | 個人 立替 戻し | 振込先 / 振込日時 / サイン |
| 合宿のお金支払い | 合宿 集金 | 同上 |
| 研究予算推移 / アドバイザ推移 | 過去 集計 | (移行 後 は read-only / 履歴) |
| 編集ログ | audit | timestamp / シート / メール / 値 |
| App Metadata | 自動 refresh 用 | — |

共通 パターン: 「研究費 (FK) / 状況 (0=未確定 / 1=確定) / 項目 / 金額 / 日時」 が 全 Log で 同じ → 1 テーブル + kind 別 メタ で 一本化 可能。

## DB スキーマ 案 (5 テーブル)

### `grants` — 予算 マスタ
- id, name (Wacom 等), fiscal_year, sponsor, project_title, budget_yen, carry_over_yen, work_short_desc, work_long_desc, archived_at

### `expenditures` — 汎用 支出 log
- id, grant_id (FK), kind (`item` | `travel` | `human` | `subsc` | `doctor` | `amagift` | `exp_fee`), title, amount_yen, status (`draft` | `confirmed`), occurred_at, note, created_by_user_id, updated_at

### `expenditure_travel_meta` — 出張 固有
- expenditure_id (FK), self_paid_yen, univ_subsidy_yen, application_submitted, receipt_submitted, report_submitted

### `expenditure_human_meta` — 人件費 固有
- expenditure_id (FK), worker_user_id, hourly_yen, hours, period (YYYY-MM)

### `expenditure_amagift_meta` — ギフト 固有
- expenditure_id (FK), per_person_yen, n_people, purchased, distributed, completed

### `repayments` — 立替 戻し
- id, expenditure_id (nullable), recipient_user_id, amount_yen, method (`mufg` | `paypay`), paid_at, signed_by_text

### `grants_audit_log`
- id, target_kind, target_id, user_id, action, before_json, after_json, created_at

## UI 案

- `/grants` — 予算 一覧 + 進捗 バー (使用率)
- `/grants/{id}` — 予算 詳細 + 全 支出 list (kind フィルタ)
- `/grants/spend/new` — 支出 登録 (kind 別 で form を 切り替え)
- `/grants/dashboard` — 「全体」 相当 サマリ
- `/grants/repayments` — 立替 戻し 管理 (出張 / 合宿 集金 用)
- `/my-bait` — 学生 用 簡易 画面 (自分 の アルバイト 報告 を draft 登録 + 自分 へ の 立替 戻し 確認)

## 権限

- 中村 (admin): 全操作
- 学生: 自分 の `human` 支出 を draft 登録 + 自分 への 立替 戻し 確認 のみ
- 閲覧: 全員 (透明性 維持)

## Slack 連携

- 支出 confirm (status 0→1) 時 に channel 通知
- 学生 アルバイト報告 が draft で 上がったら 中村 へ DM

## 段階 実装 案

- **Phase 1** (1〜2 日): grants + expenditures + 出張 / 人件費 form + サマリ
- **Phase 2** (1 日): repayments + 学生 用 簡易 画面 + xlsx → CSV import
- **Phase 3** (任意): 推移 グラフ + 編集 audit log

## 注意 / 検討 ポイント (慎重 に なる 観点)

- 「状況 = 確定」 後 の 編集 制限 を どこまで 厳密 に やる か (大学 監査 対応)
- 立替 戻し と 既存 の `money_requests` (請求) の 棲み分け — 統合 すべき か 別 機構 に する か
- 過去 年度 データ の 扱い (推移 シート の マイグレーション 範囲)
- 個人情報 (振込先 / 口座) を DB に 載せて 良い か → admin only 暗号化 or 載せ ない (Slack の DM で 管理 継続) の どちら か
- 学生 が 「自分 の バイト 履歴」 を 見れる 範囲 (全部 / 自分 だけ)
