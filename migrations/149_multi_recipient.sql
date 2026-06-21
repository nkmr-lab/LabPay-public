-- v742 #353 ファイル送受信 / 画像共有を 複数人対応に。
--   ・file_transfers に batch_id: 同じ送信アクションで N 人に送った行を まとめて UI で
--     1 つにグルーピング 表示するため。 旧 1 受信者送信は batch_id NULL のままで互換。
--   ・screen_shares に target_user_ids JSON: 個人 (複数) 宛 を 表現。 NULL なら 既存通り
--     group_id / ラボ全体 に依存。

ALTER TABLE file_transfers
    ADD COLUMN batch_id BIGINT UNSIGNED DEFAULT NULL,
    ADD KEY idx_batch (batch_id);

ALTER TABLE screen_shares
    ADD COLUMN target_user_ids TEXT DEFAULT NULL;
