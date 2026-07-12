-- v1009 中村さん要望「私が飲み会 とか で まとめて 支払い、 それ を 請求する ときに
--   500pt LabPay 送金 + 現金 の 分割 支払 を 選べる ように したい。 ただし 請求者が
--   opt-in した ときだけ 出す」。
--
--   money_requests.allow_labpay_pt: 請求者が この 請求 に LabPay 部分支払 を 許可した
--     ときの pt 額。 0 = 無効 (デフォルト、 従来通り 現金のみ)。 有効化 時 は 現状 500 固定。
--   money_request_recipients.labpay_pt: 実際 に 部分支払 された pt (0 = 未実施)
--   money_request_recipients.labpay_at: 部分支払 された タイムスタンプ

ALTER TABLE money_requests
    ADD COLUMN allow_labpay_pt INT NOT NULL DEFAULT 0 AFTER memo;

ALTER TABLE money_request_recipients
    ADD COLUMN labpay_pt INT NOT NULL DEFAULT 0 AFTER paid_note,
    ADD COLUMN labpay_at DATETIME NULL AFTER labpay_pt;
