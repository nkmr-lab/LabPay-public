<?php
// v617 #236 マルバツ (Tic-Tac-Toe) サンプル実装。 3x3 グリッド、 1pt プレイフィー。
//   勝者は pot 総取り、 引分は双方に半額返金。
//   state: ['board' => 9 マス、 0=空 / 1=○ / 2=×、 'creator_mark' => 1, 'opponent_mark' => 2,
//           'turn_user_id' => 現手番ユーザ]
declare(strict_types=1);

require_once __DIR__ . '/GameInterface.php';

final class TicTacToe implements CustomGameInterface {
    public function kind(): string        { return 'tictactoe'; }
    public function displayName(): string { return '⭕❌ マルバツ'; }
    public function description(): string { return '3x3 のマルバツ。 起案者=⭕、 参加者=❌。 縦/横/斜め 3 つ並べたら勝ち。 1pt プレイフィー、 勝者が pot 総取り (引分は半額返金)。'; }
    public function icon(): string        { return '⭕'; }
    public function fee(): int            { return 1; }

    public function initialState(int $creatorUid, int $opponentUid): array {
        return [
            'board' => array_fill(0, 9, 0),
            'creator_uid'  => $creatorUid,
            'opponent_uid' => $opponentUid,
            'turn_user_id' => $creatorUid, // ⭕ から
        ];
    }

    public function playMove(array $state, int $userId, array $move): array {
        if ((int)($state['turn_user_id'] ?? 0) !== $userId) {
            throw new ApiException('bad_request', 'あなたの手番ではありません', 400);
        }
        $idx = (int)($move['idx'] ?? -1);
        if ($idx < 0 || $idx > 8) throw new ApiException('bad_request', 'idx は 0-8', 400);
        if ((int)$state['board'][$idx] !== 0) {
            throw new ApiException('bad_request', 'そのマスには 既に置かれています', 400);
        }
        $mark = $userId === (int)$state['creator_uid'] ? 1 : 2;
        $state['board'][$idx] = $mark;

        // 勝敗判定
        $lines = [
            [0,1,2],[3,4,5],[6,7,8],  // 横
            [0,3,6],[1,4,7],[2,5,8],  // 縦
            [0,4,8],[2,4,6],          // 斜め
        ];
        $winner = null;
        foreach ($lines as $line) {
            $a = (int)$state['board'][$line[0]];
            if ($a === 0) continue;
            if ($a === (int)$state['board'][$line[1]] && $a === (int)$state['board'][$line[2]]) {
                $winner = $a === 1 ? (int)$state['creator_uid'] : (int)$state['opponent_uid'];
                break;
            }
        }
        $finished = $winner !== null;
        // 全マス埋まったら 引分 (winner_user_id = null)
        if (!$finished && !in_array(0, $state['board'], true)) {
            $finished = true;
            $winner = null;
        }
        // 次のターン
        $oppUid = $userId === (int)$state['creator_uid'] ? (int)$state['opponent_uid'] : (int)$state['creator_uid'];
        $state['turn_user_id'] = $finished ? null : $oppUid;

        return [
            'state'          => $state,
            'finished'       => $finished,
            'winner_user_id' => $winner,
            'turn_user_id'   => $state['turn_user_id'],
        ];
    }

    public function viewForUser(array $state, int $userId): array {
        // マルバツは 情報の隠匿なし (両者見える)。 そのまま返す。
        return $state;
    }
}
