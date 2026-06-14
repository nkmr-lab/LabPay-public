-- v570 #223 人狼 Phase 1。 役職: 村人 / 人狼 / 占い師 / 騎士。 シンプル夜投票 → 昼投票。
CREATE TABLE IF NOT EXISTS jinrou_games (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  buy_in          INT UNSIGNED NOT NULL DEFAULT 1,
  pot_total       INT UNSIGNED NOT NULL DEFAULT 0,
  status          ENUM('lobby','night','day','finished','cancelled') NOT NULL DEFAULT 'lobby',
  round_no        INT UNSIGNED NOT NULL DEFAULT 0,
  config_json     MEDIUMTEXT NULL, -- {wolf_count, seer, knight}
  log_json        MEDIUMTEXT NULL, -- [{round, phase, event, ...}]
  winner          ENUM('village','wolves') NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at      DATETIME NULL,
  finished_at     DATETIME NULL,
  KEY idx_jg_status (status, id),
  CONSTRAINT fk_jng_creator FOREIGN KEY (creator_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jinrou_players (
  game_id   BIGINT NOT NULL,
  user_id   BIGINT NOT NULL,
  role      ENUM('villager','wolf','seer','knight') NULL,
  alive     TINYINT(1) NOT NULL DEFAULT 1,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  KEY idx_jp_game (game_id),
  CONSTRAINT fk_jnp_game FOREIGN KEY (game_id) REFERENCES jinrou_games(id) ON DELETE CASCADE,
  CONSTRAINT fk_jnp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jinrou_actions (
  id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id         BIGINT NOT NULL,
  round_no        INT UNSIGNED NOT NULL,
  phase           ENUM('night','day') NOT NULL,
  actor_user_id   BIGINT NOT NULL,
  action_type     ENUM('attack','inspect','protect','vote') NOT NULL,
  target_user_id  BIGINT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ja_game (game_id, round_no, phase),
  UNIQUE KEY uq_ja_one (game_id, round_no, phase, actor_user_id, action_type),
  CONSTRAINT fk_jna_game FOREIGN KEY (game_id) REFERENCES jinrou_games(id) ON DELETE CASCADE,
  CONSTRAINT fk_jna_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
