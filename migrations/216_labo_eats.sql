-- v1123 中村さん要望「ラーボーイーツ 研究室版 UBER EATS。研究室にいる人が外にいる人に
--   ご飯を "ついで" に買ってきてもらう。料金体系: 基本料 50p + 距離ポイント 10p/100m
--   (例: 700m のお店に依頼 → 50 + 70 = 120p)。フロー: 依頼作成 → 引き受ける人が
--   見つかる → 購入・受け取り → 完了・ポイント支払い」

CREATE TABLE IF NOT EXISTS labo_eats_orders (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  requester_user_id   BIGINT NOT NULL,
  acceptor_user_id    BIGINT NULL,                       -- 引き受け人 (accepted 以降)
  food_desc           VARCHAR(400) NOT NULL,             -- 食べたいもの (例: 牛丼 (並盛))
  shop_hint           VARCHAR(200) NULL,                 -- お店ヒント (例: 松屋、コンビニ何でも可)
  receive_location    VARCHAR(200) NULL,                 -- 受け取り場所 (例: 研究室 123 号室)
  memo                VARCHAR(500) NULL,                 -- その他メモ
  distance_m          INT NOT NULL,                      -- お店までの推定距離 (m)
  base_fee            INT NOT NULL DEFAULT 50,
  distance_fee        INT NOT NULL,                      -- ceil(distance_m / 100) * 10
  item_cost           INT NOT NULL DEFAULT 0,            -- 商品代 (完了時に引受人が実費入力)
  total_fee           INT NOT NULL,                      -- base + distance (依頼時点)、後で item_cost 合わせて確定
  status              ENUM('open','accepted','delivered','completed','cancelled') NOT NULL DEFAULT 'open',
  accepted_at         DATETIME NULL,
  delivered_at        DATETIME NULL,
  completed_at        DATETIME NULL,
  cancelled_at        DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_le_req FOREIGN KEY (requester_user_id) REFERENCES users(id),
  CONSTRAINT fk_le_acc FOREIGN KEY (acceptor_user_id) REFERENCES users(id),
  INDEX ix_le_status (status, created_at),
  INDEX ix_le_req    (requester_user_id, created_at),
  INDEX ix_le_acc    (acceptor_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
