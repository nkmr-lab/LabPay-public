-- v630 自作ゲーム を 1 人 / 2 人 / 4 人 対応 に。
--   max_players: 同時プレイ可能 人数。 1 (ソロ) / 2 (既定) / 4 (4 人対戦)
--   players_json: 参加者 uid 配列 (= 着席順)。 NULL = 旧 2 人式 (creator/opponent slot を使う)
--
--   起案時:
--     max_players=1 → players_json=[creator]、 status='playing' 即時 (waiting なし)
--     max_players=2 → players_json=[creator]、 status='waiting'
--     max_players=4 → players_json=[creator]、 status='waiting'
--   join:
--     players_json に append。 len == max_players で status='playing' に 遷移、 全員から fee 徴収
ALTER TABLE custom_game_kinds
  ADD COLUMN max_players TINYINT UNSIGNED NOT NULL DEFAULT 2 AFTER fee;

ALTER TABLE custom_games
  ADD COLUMN players_json TEXT NULL AFTER opponent_user_id;
