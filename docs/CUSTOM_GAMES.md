# 自作ゲーム フレームワーク (custom_games)

LabPay に **2 人対戦のターン制ゲームを 100 行 + 1 SQL 行 で 追加できる** 仕組み。 v617 で 導入。

## アーキテクチャ

```
┌───────────────────────────────────────────────────────────┐
│  /api/custom-games/list   ← 登録ゲーム一覧 (UI 用)         │
│  /api/custom-games/:kind/games            一覧 / 起案     │
│  /api/custom-games/:kind/games/:id        詳細            │
│  /api/custom-games/:kind/games/:id/join   参加 (1pt)     │
│  /api/custom-games/:kind/games/:id/move   手を打つ        │
│  /api/custom-games/:kind/games/:id/cancel  キャンセル      │
└─────────────────┬─────────────────────────────────────────┘
                  │ 全 ゲーム共通
                  ▼
┌──────────────────────────────────────────────────────────┐
│  src/handlers/custom_games.php                            │
│  - Ledger 操作 (buy-in / payout / refund)                 │
│  - status 遷移 (waiting → playing → finished)             │
│  - state_json の load / save                              │
└─────────────────┬────────────────────────────────────────┘
                  │ ゲーム種別ごとに dispatch
                  ▼
┌──────────────────────────────────────────────────────────┐
│  CustomGameInterface (src/custom_games/GameInterface.php) │
│  - kind() / displayName() / description() / icon() / fee() │
│  - initialState(creator, opponent)                        │
│  - playMove(state, userId, move) → 新 state + 勝敗        │
│  - viewForUser(state, userId) → 公開部分のみ抽出          │
└──────────────────────────────────────────────────────────┘
```

state_json は MEDIUMTEXT で 完全に 自由。 駒の位置でも 手札でも 何でも 詰め込んでいい。 共通 framework は ハンドリングしない。

## サーバ側 (PHP) で 新ゲームを 追加する

1. **`src/custom_games/MyGame.php`** を作って `CustomGameInterface` を実装:

   ```php
   <?php
   declare(strict_types=1);
   require_once __DIR__ . '/GameInterface.php';

   final class MyGame implements CustomGameInterface {
       public function kind(): string        { return 'mygame'; }
       public function displayName(): string { return '🎲 マイゲーム'; }
       public function description(): string { return '50字以内の説明。 何が起きるか、 何 pt か'; }
       public function icon(): string        { return '🎲'; }
       public function fee(): int            { return 1; }  // プレイフィー (整数 pt)

       public function initialState(int $creatorUid, int $opponentUid): array {
           // join 時に opponent_uid が 0 で渡されるので 後から viewForUser/playMove で 上書きされる
           return ['turn_user_id' => $creatorUid, /* 他 自由 */];
       }

       public function playMove(array $state, int $userId, array $move): array {
           // 手番チェック
           if ((int)$state['turn_user_id'] !== $userId) {
               throw new ApiException('bad_request', 'あなたの手番ではありません', 400);
           }
           // 入力 validation
           // state 更新
           // 勝敗判定
           return [
               'state'          => $state,
               'finished'       => false,    // 終了したら true
               'winner_user_id' => null,     // 勝者がいれば その user_id、 引分は null
               'turn_user_id'   => $nextUid, // 次の手番ユーザ (終了時は null)
           ];
       }

       public function viewForUser(array $state, int $userId): array {
           // 相手の手札を隠したい場合などに ここでフィルタする
           return $state;
       }
   }
   ```

2. **`src/handlers/custom_games.php`** の registry に 1 行追記:

   ```php
   require_once __DIR__ . '/../custom_games/MyGame.php';

   function custom_game_registry(): array {
       return [
           'tictactoe' => new TicTacToe(),
           'mygame'    => new MyGame(),   // ← この 1 行
       ];
   }
   ```

これで サーバ側の API (`/api/custom-games/mygame/...`) が 自動で 生える。

## クライアント側 (JS) を 書く

`public/js/views/tictactoe.js` を コピーして `mygame.js` に。 API の `KIND` 定数を `'mygame'` に変えて、 盤面の描画 + `move` の body を 自ゲームに合わせるだけ。 ルートを `public/js/app.js` に登録:

```js
route('/mygame/:id', lazy(() => import('./views/mygame.js'), 'renderMyGameDetail'));
route('/mygame',     lazy(() => import('./views/mygame.js'), 'renderMyGame'));
```

`apps.js` と `games.js` (娯楽ハブ) に エントリ追加で 露出。

## 課金フロー

- 起案者: 卓を作った瞬間に `fee()` pt を 預ける (`custom_game_buyin`)
- 参加者: `join` で 同額を 預ける (`custom_game_buyin`)
- 終了時:
  - 勝者あり → 勝者に pot 総取り (`custom_game_payout`)
  - 引分 → 双方 半額返金 (`custom_game_refund`)
- ロビーでキャンセル → 起案者に返金 (`custom_game_refund`)

## DB スキーマ (migration 135)

```sql
CREATE TABLE custom_games (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  game_kind VARCHAR(40),          -- 'tictactoe', 'mygame', ...
  creator_user_id BIGINT,
  opponent_user_id BIGINT,
  status ENUM('waiting','playing','finished','cancelled'),
  fee INT, pot_total INT,
  state_json MEDIUMTEXT,          -- 自由
  turn_user_id BIGINT,
  winner_user_id BIGINT,
  ...
);
```

ゲーム固有のテーブルが 欲しい場合 (履歴ログとか) は migration を追加して OK。 ただし基本は `state_json` 1 つで足りる。

## サンプル: マルバツ (TicTacToe)

実装: `src/custom_games/TicTacToe.php` + `public/js/views/tictactoe.js`、 合計 230 行。
動作: `https://pay.nkmr.io/#/tictactoe`

## なぜ汎用化?

過去に 麻雀 / 大富豪 / 地雷オセロ / ito / 人狼 / 絵しりとり をそれぞれ 個別のテーブル + 個別のハンドラで 作ってきた。 重複コードが多く、 新ゲームの 追加に毎回 200-500 行。 自作ゲームを ラボメンバーが軽く作れるように、 共通のフレームワークを切り出した。
