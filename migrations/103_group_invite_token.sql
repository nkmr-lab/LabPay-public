-- v475 グループ 招待URL 用 トークン。 起案者 が 発行 / 失効 で きる、 ランダム
-- 32 文字 文字列。 NULL = 招待リンク 機能 オフ。 expires_at で 有効期限 (任意)。
ALTER TABLE adhoc_groups
  ADD COLUMN invite_token        VARCHAR(64) NULL UNIQUE,
  ADD COLUMN invite_expires_at   DATETIME NULL;
