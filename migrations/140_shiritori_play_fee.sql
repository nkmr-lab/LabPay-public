-- v623 絵しりとり に プレイフィー 2pt/人 を 追加。
--   各プレイヤーが 初めて 自分のターンを 投稿した タイミングで 2pt を SYSTEM に 払う。
--   paid_at が NULL = 未払い → 次の turn submit で 徴収。
ALTER TABLE shiritori_players
  ADD COLUMN paid_at DATETIME NULL DEFAULT NULL AFTER turn_order;
