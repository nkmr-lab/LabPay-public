-- 「請求を一斉に生成」 (ワリカ精算の bulk) の場合、creator_user_id は各
-- creditor になるが、実際に操作した人 (= 一斉生成のボタンを押した人) を
-- created_by_user_id として記録しておく。これがないと、自分が
-- creator でも recipient でもない請求が見えなくなり、生成した本人が
-- 自分が作ったものを見失う。
ALTER TABLE money_requests
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT NULL AFTER creator_user_id;

-- 既存行は creator_user_id をそのまま created_by として埋める (本人作成扱い)
UPDATE money_requests SET created_by_user_id = creator_user_id
 WHERE created_by_user_id IS NULL;
