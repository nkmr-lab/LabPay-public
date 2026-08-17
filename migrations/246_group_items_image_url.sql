-- v1336 グループフィード の 投稿 に 画像 添付 (中村さん要望「フィードに画像を貼れるように」)。
-- 全 kind (memo/url/time) 共通 で 1 枚 添付。 timers.image_url と 同 検証 pattern
-- (/uploads/<file>.<ext> or 自 origin HTTP のみ)。
ALTER TABLE adhoc_group_items ADD COLUMN image_url VARCHAR(500) NULL AFTER url;
