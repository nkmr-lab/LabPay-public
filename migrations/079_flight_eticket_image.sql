-- v357 e-ticket は 航空会社が配布する QR 画像を そのまま 保存する形に修正。
-- 元の qr_payload (テキスト → QR 生成) は NULL 許可にして 後方互換のみ、
-- 新たに qr_image_url を追加。
ALTER TABLE adhoc_group_flight_etickets
  MODIFY COLUMN qr_payload VARCHAR(2048) NULL,
  ADD COLUMN qr_image_url VARCHAR(500) NULL AFTER qr_payload,
  ADD COLUMN qr_thumb_url VARCHAR(500) NULL AFTER qr_image_url;
