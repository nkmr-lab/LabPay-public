-- v626 地雷オセロ 専用 AI bot ユーザ。 麻雀の 東家 / 南家 / 西家 を 使い回すと
--   名前 (「🀄 AI 東家」) が オセロ画面で 違和感が ある ので、 専用に 1 体 用意。
--   account も 一緒に作っておく (Ledger 操作の 都合上)。
INSERT INTO users (kind, email, display_name, role, created_at)
VALUES ('bot', 'ai-othello@labpay.local', '💣 オセロ AI', 'member', NOW())
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

-- accounts に 1 行 (owner_user_id = 上で作った user.id)。 既にあれば 無視。
INSERT IGNORE INTO accounts (owner_user_id)
  SELECT id FROM users WHERE email='ai-othello@labpay.local';
