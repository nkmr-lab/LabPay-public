-- v1143 中村さん要望「らぼったーに投稿できる画像の枚数を増やして欲しい。
--   あと、枚数が増えると、ちょっとおしゃれレイアウトで提示して欲しい」
--
--   posts.image_url は 1 枚固定だったので、 posts_images を新設して 最大 10 枚に。
--   既存 image_url は「1 枚目」として下位互換 (読出時に posts_images と合成)。

CREATE TABLE IF NOT EXISTS post_images (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  post_id     BIGINT NOT NULL,
  position    INT NOT NULL COMMENT '0-based 順番',
  image_url   VARCHAR(500) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_images_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  INDEX ix_post_images (post_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
