-- ルーレット (くじ引き) 履歴。
-- タイトル + 候補メンバーを並べて、サーバが一様乱数で 1 人選ぶ。結果と参加メンバーは
-- そのまま保存しておくので、後で「今日のゴミ捨て当番ルーレット 誰だったっけ」を
-- 確認できる。member_ids は JSON 配列 (user_id の整数リスト)。
CREATE TABLE IF NOT EXISTS roulettes (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  winner_user_id  BIGINT NOT NULL,
  member_ids      JSON   NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rl_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  CONSTRAINT fk_rl_winner  FOREIGN KEY (winner_user_id)  REFERENCES users(id),
  INDEX ix_rl_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
