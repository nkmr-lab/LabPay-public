-- v625 地雷オセロ コンピュータ対戦 (AI モード)。
--   is_ai=1: opponent_user_id は AI bot (kind='bot' の users)、 払い出しなし、
--           AI が 中央付近に 1 マス 地雷を 自動配置、 user の 手番 が 終わったら
--           AI が 自動で 着手 (greedy + corner bonus)。
ALTER TABLE othello_games
  ADD COLUMN is_ai TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER opponent_user_id;
