-- v1126 中村さん要望「setlog はそういうアプリがある」→ 調査: 1日を短いクリップ (2秒動画 or
--   写真) で断片的に記録 → 自動で 1 日のまとめ vlog に。 韓国発、K-POP がきっかけで拡散、
--   BeReal 的な立ち位置。 LabPay 版 MVP: 画像 (+短キャプション) を随時記録 → 日別に時系列で
--   まとめて閲覧、みんなの今日のフィードも見られる。

CREATE TABLE IF NOT EXISTS setlog_clips (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  image_url   VARCHAR(500) NOT NULL,
  caption     VARCHAR(80) NULL,
  taken_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- 撮影時刻 (基本 upload 時刻)
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  DATETIME NULL,
  CONSTRAINT fk_setlog_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_setlog_user_day (user_id, taken_at),
  INDEX ix_setlog_day (taken_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
