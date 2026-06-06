-- v482 #71 待ち合わせ に メッセージ シェア。 「少し 遅れます」 「もう 入って ます」 など。
CREATE TABLE IF NOT EXISTS meetup_messages (
    id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    meetup_id    BIGINT NOT NULL,
    user_id      BIGINT NOT NULL,
    body         VARCHAR(1000) NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_meetup_created (meetup_id, created_at),
    CONSTRAINT fk_mmsg_meetup FOREIGN KEY (meetup_id) REFERENCES meetups(id) ON DELETE CASCADE,
    CONSTRAINT fk_mmsg_user   FOREIGN KEY (user_id)   REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
