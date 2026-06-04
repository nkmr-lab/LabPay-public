-- v343 効果音 (決済 / ルーレット回転) の基盤。
--   * sound_clips: admin が upload した 音源ファイル (mp3/ogg/wav) を登録
--   * sound_event_defaults: イベントごとの 規定 clip + 音量 (admin が設定)
--   * sound_user_prefs: 各自の上書き (規定使用 / 自分で選ぶ / ミュート)
-- event_key は コード側で 列挙 (現時点で 'payment' と 'roulette_spin')。
-- 後で増やしても 既存行は壊さない。

CREATE TABLE IF NOT EXISTS sound_clips (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(120) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  mime VARCHAR(64) NOT NULL,
  file_size INT NULL,
  uploaded_by_user_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sc_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sound_event_defaults (
  event_key VARCHAR(64) NOT NULL PRIMARY KEY,
  clip_id BIGINT NULL,
  volume TINYINT NOT NULL DEFAULT 70,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sed_clip FOREIGN KEY (clip_id) REFERENCES sound_clips(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sound_user_prefs (
  user_id BIGINT NOT NULL,
  event_key VARCHAR(64) NOT NULL,
  mode ENUM('default','custom','mute') NOT NULL DEFAULT 'default',
  clip_id BIGINT NULL,
  volume TINYINT NULL,
  PRIMARY KEY (user_id, event_key),
  CONSTRAINT fk_sup_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sup_clip FOREIGN KEY (clip_id) REFERENCES sound_clips(id) ON DELETE SET NULL
);

-- 既知 event の規定 (clip 未指定 = 無音、 音量は 70)。
INSERT IGNORE INTO sound_event_defaults (event_key, clip_id, volume)
VALUES ('payment', NULL, 70), ('roulette_spin', NULL, 70);
