-- ルーレット: 抽選結果通知を 「ホイール停止後」 に遅延させたいので、
-- spin (POST /api/roulettes) で送る代わりに 別エンドポイントで送る。
-- 多重送信防止のため notified_at で 1 回送ったかを管理。
ALTER TABLE roulettes
  ADD COLUMN IF NOT EXISTS notified_at DATETIME NULL;
