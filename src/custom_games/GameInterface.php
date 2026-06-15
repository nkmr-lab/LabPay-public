<?php
// v617 #236 自作ゲーム フレームワーク。
//   新しい 2 人対戦ゲームを 追加するときは、 この interface を実装して 1 つの PHP クラス を
//   src/custom_games/ に置き、 CUSTOM_GAME_REGISTRY (custom_games.php) に登録するだけで OK。
//
// 必要な実装 (5 メソッド):
//   - kind()        : ゲーム種別の文字列 ID (URL の :kind に使う、 alphanumeric + 短い)
//   - displayName() : UI 表示名 (例: 「マルバツ」)
//   - description() : 1-2 文の説明文
//   - icon()        : 絵文字 1 文字
//   - fee()         : プレイフィー (整数 pt)
//   - initialState(int $creatorUid, int $opponentUid) : 開始時の state 配列
//   - playMove(array $state, int $userId, array $move) : 手を打って 新 state を返す
//                                                       戻り値: ['state' => ..., 'finished' => bool, 'winner_user_id' => ?int]
//                                                       不正手は throw ApiException
//   - viewForUser(array $state, int $userId)          : クライアントに 公開する state (相手の手札を 隠す等)

declare(strict_types=1);

interface CustomGameInterface {
    public function kind(): string;
    public function displayName(): string;
    public function description(): string;
    public function icon(): string;
    public function fee(): int;
    public function initialState(int $creatorUid, int $opponentUid): array;
    /**
     * @return array{state: array, finished: bool, winner_user_id: ?int, turn_user_id: ?int}
     */
    public function playMove(array $state, int $userId, array $move): array;
    public function viewForUser(array $state, int $userId): array;
}
