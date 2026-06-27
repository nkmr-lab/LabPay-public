-- v855 ゼミ動画 に YouTube の 動画 長 (秒) を 保持。
-- 取り込み時に YouTube watch ページから lengthSeconds を スクレイプして保存。
-- 既存レコードは backfill スクリプトで埋める。

ALTER TABLE zemi_videos ADD COLUMN youtube_duration_sec INT NULL;
