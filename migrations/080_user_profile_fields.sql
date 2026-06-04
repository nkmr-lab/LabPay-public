-- v360 ユーザのプロフィール充実: 趣味 + 推し。
-- 1000 文字までの 自由記述。 改行で複数項目 想定だが フォーマットは任意。
ALTER TABLE users
  ADD COLUMN hobbies   VARCHAR(1000) NULL AFTER slack_member_id,
  ADD COLUMN favorites VARCHAR(1000) NULL AFTER hobbies;
