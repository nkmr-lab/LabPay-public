-- v1335 タイマーに 画像 を 添付 (ハッカソン 等 で 「今 何 を やっている か」 を 参加者 が 目視 で 分かる ように)。
-- 表示 は タイマー詳細 / public-timer の カウントダウン の 下 or 右 (幅 に 応じて レスポンシブ)。
-- image_url は avatar_url と同 pattern で /uploads/<file> の 相対 or 自 origin の HTTP を許可。
ALTER TABLE timers ADD COLUMN image_url VARCHAR(500) NULL AFTER title;
