-- v1068 プレイフィー引き上げ (中村さん指示「ito、人狼、絵しりとり、地雷オセロ、大富豪、
-- マルバツ の プレイフィーを 5pt にしよう。 さすがに 安すぎたので」)。
-- 大富豪 / ito / 地雷オセロ / 絵しりとり / 人狼 は PHP 定数 (2pt or 1pt) を 5pt に直接変更。
-- マルバツ (custom_game_kinds.kind='tictactoe') は DB row の fee を 1pt → 5pt に UPDATE。
UPDATE custom_game_kinds
   SET fee = 5,
       description = REPLACE(description, '1pt プレイフィー', '5pt プレイフィー')
 WHERE kind = 'tictactoe' AND fee = 1;
