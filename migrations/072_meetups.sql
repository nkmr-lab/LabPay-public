-- 「次の待ち合わせ」 機能。 タイマーより 「集合場所 + 集合時刻 + メンバー」
-- に振った軽量機能。 通知で 「○時に △で集合!」 が飛ぶ。 短時間 (24h まで)。
CREATE TABLE IF NOT EXISTS meetups (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NULL,
  location VARCHAR(500) NULL,
  meetup_at DATETIME NOT NULL,
  creator_user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at DATETIME NULL,
  CONSTRAINT fk_mu_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  INDEX idx_mu_when (meetup_at)
);

CREATE TABLE IF NOT EXISTS meetup_participants (
  meetup_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  PRIMARY KEY (meetup_id, user_id),
  CONSTRAINT fk_mp_mu   FOREIGN KEY (meetup_id) REFERENCES meetups(id) ON DELETE CASCADE,
  CONSTRAINT fk_mp_user FOREIGN KEY (user_id)   REFERENCES users(id)
);
