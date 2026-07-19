-- v1164 実験協力者募集 — 中村さん要望
--   「どんな実験か、枠は何枠か、上限人数は何人かを書いておいて募集をかけ、
--    希望者はあいている枠を早いもの順で埋めていく」
--   + 「実施者が埋めても良い」 (creator が代理で参加者を入れられる)
--   + 「本人も確認できるようにする」 (参加者は自分の枠を確認できる)
--
-- ドメインは tasks とは 分離: tasks は 報酬 と 承認 フロー が絡む が、
-- 実験募集 は 純粋 に 「枠 の 早い者勝ち」 + 「実施者 が 自由 に アサイン」。
-- 報酬 は 別途 個別 送金 で 対応 する 想定。

CREATE TABLE IF NOT EXISTS exp_recruits (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_user_id   BIGINT NOT NULL,
  title             VARCHAR(200) NOT NULL,
  description       TEXT NULL,
  status            ENUM('open','closed') NOT NULL DEFAULT 'open',
  deadline_at       DATETIME NULL COMMENT '締切 (NULL = 無期限)',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at         DATETIME NULL,
  deleted_at        DATETIME NULL,
  CONSTRAINT fk_exp_recruit_creator FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_exp_recruit_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS exp_recruit_slots (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  recruit_id        BIGINT NOT NULL,
  name              VARCHAR(100) NOT NULL COMMENT '枠名 例: 月曜 10-11 時 / 枠 A',
  capacity          INT NOT NULL DEFAULT 1 COMMENT '定員',
  sort_order        INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_exp_recruit_slot_recruit FOREIGN KEY (recruit_id) REFERENCES exp_recruits(id) ON DELETE CASCADE,
  INDEX ix_exp_recruit_slot_recruit (recruit_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS exp_recruit_participations (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  slot_id           BIGINT NOT NULL,
  user_id           BIGINT NOT NULL,
  source            ENUM('self_signup','assigned_by_creator') NOT NULL DEFAULT 'self_signup',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slot_user (slot_id, user_id),
  CONSTRAINT fk_exp_recruit_part_slot FOREIGN KEY (slot_id) REFERENCES exp_recruit_slots(id) ON DELETE CASCADE,
  CONSTRAINT fk_exp_recruit_part_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX ix_exp_recruit_part_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
