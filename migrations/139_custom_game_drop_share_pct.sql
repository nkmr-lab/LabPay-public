-- v621 場代 の 配分を 固定 (提供者 90% / SYSTEM 10%) に 変更したので
-- v620 で 追加した provider_share_pct を drop。 同セッションで 追加 → drop なので
-- データ損失なし (新規 column、 既存 row は全部 default の 0)。
ALTER TABLE custom_game_kinds DROP COLUMN provider_share_pct;
