-- v874 #455 (続報) タスク の 参加料 (escrow) を LabPay system user から 持ち出せる ように
-- する admin 専用 フラグ。 起案者 が admin で かつ funded_by_system=1 の とき、
-- ESCROW へ の 入金 元 を 起案者 個人 ではなく system user (kind='system') に 切り替える。
-- 取り消し時 の 返金 先 は 「起案者 (admin) 側」 に 戻る 仕様 (簡素化)。

ALTER TABLE tasks
  ADD COLUMN funded_by_system TINYINT(1) NOT NULL DEFAULT 0 AFTER per_user_limit;
