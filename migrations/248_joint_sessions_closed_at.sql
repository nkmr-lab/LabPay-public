-- fb#524 中村さん要望: 合同研究会投票 で セッションごとに 投票を締め切れるように。
-- joint_sessions.closed_at を追加 (NULL=受付中、値あり=締切)。
ALTER TABLE joint_sessions ADD COLUMN closed_at DATETIME NULL AFTER sort_order;
