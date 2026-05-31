-- Admin-tagged "this MAC is the printer / lab PC / router" entries.
-- Listed MACs are excluded from the user-facing unregistered list in settings.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS presence_infrastructure (
  mac                VARCHAR(17) PRIMARY KEY,
  label              VARCHAR(100) NOT NULL,
  kind               VARCHAR(40) NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id BIGINT NULL,
  CONSTRAINT fk_inf_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
