-- v458 削除 を 「サーバ側 保持 + UI から 非表示」 (soft-delete) に。
-- 分析 / 学習 用 に 履歴 を 残す。 対象 = タイマー / 待ち合わせ / 〆切 (meetups
-- の deadline kind 含む) / 募集 (invitations) / 点呼 / 投票。
-- 各 テーブル に deleted_at DATETIME NULL を 追加、 DELETE は UPDATE SET
-- deleted_at=NOW() に 変更。 list / detail は WHERE deleted_at IS NULL を 付与。

ALTER TABLE timers       ADD COLUMN deleted_at DATETIME NULL;
ALTER TABLE meetups      ADD COLUMN deleted_at DATETIME NULL;
ALTER TABLE invitations  ADD COLUMN deleted_at DATETIME NULL;
ALTER TABLE roll_calls   ADD COLUMN deleted_at DATETIME NULL;
ALTER TABLE polls        ADD COLUMN deleted_at DATETIME NULL;
