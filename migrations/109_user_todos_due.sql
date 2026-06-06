-- v482 #72 TODO に 締切。
ALTER TABLE user_todos ADD COLUMN IF NOT EXISTS due_at DATETIME NULL DEFAULT NULL;
ALTER TABLE user_todos ADD INDEX IF NOT EXISTS idx_user_due (user_id, due_at);
