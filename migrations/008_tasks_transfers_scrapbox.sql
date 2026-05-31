-- Tasks (依頼) + peer transfers + Scrapbox sync + grade column + bulk allowlist for 35 students.

SET NAMES utf8mb4;

-- ----- Grade (B3/B4/M1/M2/D) for audience targeting on tasks -----
ALTER TABLE users      ADD COLUMN IF NOT EXISTS grade VARCHAR(10) NULL AFTER kind;
ALTER TABLE allowlist  ADD COLUMN IF NOT EXISTS grade VARCHAR(10) NULL AFTER role;
ALTER TABLE users      ADD COLUMN IF NOT EXISTS scrapbox_username VARCHAR(60) NULL AFTER grade;

-- ----- Tasks (replacing the FUTURE placeholder schema) -----
DROP TABLE IF EXISTS task_submissions;
DROP TABLE IF EXISTS task_claims;
DROP TABLE IF EXISTS tasks;

CREATE TABLE tasks (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  requester_user_id BIGINT NOT NULL,
  title             VARCHAR(200) NOT NULL,
  description       TEXT NULL,
  reward            INT NOT NULL,                -- pt per completion
  capacity          INT NOT NULL,                -- how many slots
  per_user_limit    INT NOT NULL DEFAULT 1,      -- 0 = unlimited
  audience_grades   VARCHAR(200) NULL,           -- CSV of grades (e.g. "B3,B4"); NULL = all
  status            ENUM('open','closed','cancelled') NOT NULL DEFAULT 'open',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at         DATETIME NULL,
  CONSTRAINT fk_task_req FOREIGN KEY (requester_user_id) REFERENCES users(id),
  CONSTRAINT chk_task_reward   CHECK (reward > 0),
  CONSTRAINT chk_task_capacity CHECK (capacity > 0),
  INDEX idx_task_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE task_claims (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id             BIGINT NOT NULL,
  user_id             BIGINT NOT NULL,
  status              ENUM('claimed','reported','approved','rejected','cancelled') NOT NULL DEFAULT 'claimed',
  notes               TEXT NULL,
  reported_at         DATETIME NULL,
  approved_at         DATETIME NULL,
  approved_by_user_id BIGINT NULL,
  ledger_id           BIGINT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_claim_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_claim_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_task_user_status (task_id, user_id, status),
  INDEX idx_claim_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----- Scrapbox sync state -----
CREATE TABLE IF NOT EXISTS scrapbox_credits (
  user_id        BIGINT NOT NULL,
  credit_date    DATE NOT NULL,             -- the day being credited (typically yesterday)
  page_count     INT NOT NULL,              -- distinct pages edited
  points_awarded INT NOT NULL,
  ledger_id      BIGINT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, credit_date),
  CONSTRAINT fk_sb_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----- Config defaults -----
INSERT IGNORE INTO config (k, v) VALUES
 ('scrapbox_project',      ''),
 ('scrapbox_pt_per_page',  '3'),
 ('scrapbox_pt_daily_cap', '20');

-- ----- Bulk allowlist: 35 nkmr-lab members -----
INSERT IGNORE INTO allowlist (email, display_name, role, grade, active) VALUES
-- Doctor
('member34@example.com',      'メンバー34',   'member', 'D',  1),
('member33@example.com',          'メンバー33',   'member', 'D',  1),
('member35@example.com',          'メンバー35', 'member', 'D',  1),
('member04@example.com',       'メンバー04',   'member', 'D',  1),
-- Master 2nd
('member08@example.com',        'メンバー08',   'member', 'M2', 1),
('member32@example.com',          'メンバー32',   'member', 'M2', 1),
('member14@example.com',       'メンバー14',   'member', 'M2', 1),
('member22@example.com',         'メンバー22',   'member', 'M2', 1),
('member25@example.com',              'メンバー25',   'member', 'M2', 1),
('member26@example.com',        'メンバー26',     'member', 'M2', 1),
('member27@example.com',            'メンバー27', 'member', 'M2', 1),
('member31@example.com',              'メンバー31',   'member', 'M2', 1),
-- Master 1st
('member17@example.com',      'メンバー17', 'member', 'M1', 1),
('member09@example.com', 'メンバー09',   'member', 'M1', 1),
('member16@example.com',    'メンバー16',   'member', 'M1', 1),
('member03@example.com',    'メンバー03',   'member', 'M1', 1),
('member29@example.com',        'メンバー29', 'member', 'M1', 1),
('member06@example.com',       'メンバー06',     'member', 'M1', 1),
('member01@example.com',           'メンバー01',   'member', 'M1', 1),
-- Bachelor 4th
('member13@example.com',          'メンバー13', 'member', 'B4', 1),
('member07@example.com',  'メンバー07',   'member', 'B4', 1),
('member20@example.com',            'メンバー20',     'member', 'B4', 1),
('member28@example.com',          'メンバー28',   'member', 'B4', 1),
('member19@example.com',         'メンバー19',     'member', 'B4', 1),
('member15@example.com',          'メンバー15',   'member', 'B4', 1),
('member05@example.com',       'メンバー05',   'member', 'B4', 1),
('member11@example.com',          'メンバー11',   'member', 'B4', 1),
-- Bachelor 3rd
('member23@example.com',        'メンバー23',   'member', 'B3', 1),
('member12@example.com',            'メンバー12',   'member', 'B3', 1),
('member30@example.com',      'メンバー30',   'member', 'B3', 1),
('member10@example.com',         'メンバー10',   'member', 'B3', 1),
('member18@example.com',      'メンバー18',   'member', 'B3', 1),
('member21@example.com',        'メンバー21',   'member', 'B3', 1),
('member24@example.com',           'メンバー24',   'member', 'B3', 1),
('member02@example.com',           'メンバー02',   'member', 'B3', 1);
