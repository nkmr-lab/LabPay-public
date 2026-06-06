-- v483 #75 TODO に URL / 相手 / 詳細 (notes) を 追加。
-- partner_user_id は ラボメンバー の id (FK 無し: 用済み TODO の 残骸 を 触ら ない ため)。
-- partner_label は フリー テキスト (ラボ 外 の 相手 名 等)。
ALTER TABLE user_todos
  ADD COLUMN IF NOT EXISTS url             VARCHAR(500) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS notes           TEXT         NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS partner_user_id BIGINT       NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS partner_label   VARCHAR(120) NULL DEFAULT NULL;
