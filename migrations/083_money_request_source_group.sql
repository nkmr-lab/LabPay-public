-- adhoc_groups の 精算サマリ から 「請求一括生成」 で money_request を 作った
-- とき、 後でその請求が どのグループの どの送金プラン由来かを 辿れるように
-- source_group_id を 持たせる。 これがあると 精算モーダルで 「このプランは
-- もう 支払い済」 を 反映できる (creator + recipient で マッチング)。
-- 既存の請求 (手動作成 / オークション 落札) は NULL のまま。

ALTER TABLE money_requests
  ADD COLUMN source_group_id BIGINT NULL AFTER created_by_user_id,
  ADD CONSTRAINT fk_mr_source_group FOREIGN KEY (source_group_id)
      REFERENCES adhoc_groups(id) ON DELETE SET NULL,
  ADD INDEX ix_mr_source_group (source_group_id);
