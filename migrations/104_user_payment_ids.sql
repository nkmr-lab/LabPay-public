-- v477 ユーザ プロフィール に 送金 用 ID を 設定 できる ように。
--  paypay_id     = PayPay の 自分の ID (= 送金 用)
--  bank_info     = 自由 テキスト の 口座情報 (銀行 / 支店 / 番号 / 名義)
-- いずれも 任意。 設定 された ユーザ は プロフィール 画面 で 表示 + 即時 送金 ボタン。
ALTER TABLE users
  ADD COLUMN paypay_id  VARCHAR(100) NULL,
  ADD COLUMN bank_info  VARCHAR(500) NULL;
