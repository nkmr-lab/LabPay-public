-- v1110 中村さん指示「Miro を、グループ専用、自分専用にする機能が欲しい」
--   → miro_rooms に可視スコープを追加。既存の部屋は全部 'lab' (全員) 扱い。
--   * 'lab'     = ラボ全員 (既定、これまでの挙動)
--   * 'group'   = 指定 adhoc_groups のメンバーだけ見える
--   * 'private' = 作成者本人だけ見える

ALTER TABLE miro_rooms
  ADD COLUMN visibility ENUM('lab','group','private') NOT NULL DEFAULT 'lab' AFTER bg_color,
  ADD COLUMN owner_group_id BIGINT NULL AFTER visibility,
  ADD CONSTRAINT fk_miro_room_group FOREIGN KEY (owner_group_id) REFERENCES adhoc_groups(id) ON DELETE SET NULL,
  ADD INDEX ix_mr_visibility (visibility, owner_group_id);
