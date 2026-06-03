-- ルーレットのタイトルに 「ワンタップで # を差し込めるタグ」 を持たせる。
-- カンマ区切りの 1 行として config に保存。 admin で編集可。
-- ユーザは追加分を localStorage に持って、 admin 設定とマージして表示。
INSERT INTO config (k, v) VALUES
  ('roulette_tags', '#男気,#座長,#ファーストペンギン,#荷物')
ON DUPLICATE KEY UPDATE v = v;
