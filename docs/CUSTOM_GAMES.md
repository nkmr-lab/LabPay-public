# 自作ゲーム フレームワーク (custom_games)

LabPay に **2 人対戦のターン制ゲームを 管理画面 + JS だけ で 追加できる** 仕組み。 v619 で DB 管理化、 PHP ソースに 手を入れる必要なし。

## 何を書くか

| | 内容 | 量 |
|---|---|---|
| 管理画面 | `/#/admin/custom-games` で kind を 登録 (kind / 表示名 / 説明 / icon / fee / JS module URL) | フォーム 1 件 |
| JS | `public/js/views/{kind}.js` を 1 ファイル 追加 (ゲームロジック + UI、 マルバツは 230 行) | 1 ファイル |
| PHP | **触らない** | 0 行 |
| SQL | 不要 (新規 ゲームでも `custom_games` テーブルを 共有) | 0 行 |

新しい 2 人対戦ゲームを 追加するときの 修正量はこれだけ。

## アーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│  /api/custom-games/list   ← 登録ゲーム一覧 (UI 用)         │
│  /api/custom-games/:kind/games            一覧 / 起案     │
│  /api/custom-games/:kind/games/:id        詳細            │
│  /api/custom-games/:kind/games/:id/join   参加 (1pt)     │
│  /api/custom-games/:kind/games/:id/move   手を打つ        │
│  /api/custom-games/:kind/games/:id/cancel  キャンセル      │
└─────────────────┬─────────────────────────────────────────┘
                  │ 全 ゲーム共通 / PHP
                  ▼
┌──────────────────────────────────────────────────────────┐
│  src/handlers/custom_games.php                            │
│  - CG_REGISTRY (kind → display_name / fee / icon / description) │
│  - 共通 API (list / create / join / move / cancel)         │
│  - Ledger 操作 (buy-in / payout / refund)                 │
│  - turn_user_id を 厳密に enforce (= 不正手 のサーバ側 ガード)   │
│  - state_json は 不透明 (= 中身は 触らない)                  │
└─────────────────┬────────────────────────────────────────┘
                  │ 中身は state_json (JSON blob) で 自由
                  ▼
┌──────────────────────────────────────────────────────────┐
│  public/js/views/{kind}.js (JS)                           │
│  - initialState(creatorUid)                               │
│  - applyMove(state, userId, move) → 新 state + 勝敗      │
│  - renderBoard (盤面 + 手番 polling + クリックハンドラ)        │
│  - POST 時に new_state / finished / winner_user_id / turn_user_id │
│    を サーバに 送る (サーバは state_json を 保存するだけ)        │
└──────────────────────────────────────────────────────────┘
```

サーバ ([handlers/custom_games.php](../src/handlers/custom_games.php)) は state の中身に 触らない。
turn_user_id の遷移と Ledger 操作だけが PHP の役目。

## セキュリティ モデル

1pt 程度の低額対戦 を 想定:

- **手番 enforce**: サーバが `turn_user_id == 現在のアクター` を チェック。 違ったら 400
- **勝者の妥当性**: クライアントが `winner_user_id` を 申告。 サーバは creator/opponent のどちらかであることを チェック
- **state の整合性**: クライアント任せ。 「対戦相手の クライアントも 同じ JS ロジックで 動いている」 ので 不正な遷移は 相手の画面で 即破綻する
- **金銭的 上限**: 1pt buy-in × 2 = 2pt pot。 上限は CG_REGISTRY で 制御 (fee = 1)

高額にしたい場合は ゲーム固有の サーバ側 validation (例: PHP で `applyMove` も書く) を 追加できますが、 マルバツ程度 なら 上記で OK です。

## 新ゲームを 追加する 手順

### 1. 管理画面 から kind を 登録

`/#/admin/custom-games` (admin 専用) から フォーム入力:

- **kind**: URL slug (例: `mygame`)。 小文字 + 数字 + `-` `_`、 3-40 文字
- **表示名**: 例: `🎲 マイゲーム`
- **説明**: 1-2 文
- **icon**: 絵文字 1 文字
- **fee**: プレイフィー (0-100pt)
- **JS module URL**: 任意。 デフォルトは `/js/views/{kind}.js`

登録すると `custom_game_kinds` テーブルに 1 行入る。 API (`/api/custom-games/list`) に 即座に 反映。 無効化したい場合は 「無効化」 ボタン (既存卓は そのまま残る)。

または API 直叩き:

```bash
curl -X POST https://pay.nkmr.io/api/custom-games/kinds \
  -H "X-Requested-With: labpay" -H "Content-Type: application/json" \
  -b "labpay_sid=..." \
  -d '{
    "kind": "mygame",
    "display_name": "🎲 マイゲーム",
    "description": "説明",
    "icon": "🎲",
    "fee": 1,
    "js_module_url": "/js/views/mygame.js"
  }'
```

### 2. JS で ゲーム本体を 書く

`public/js/views/mygame.js` を 作る (マルバツ をコピー → 改造 が最速):

```js
import { get, post } from '../api.js';
import { state, toast } from '../app.js';
import { navigate, escapeHtml } from '../router.js';

const KIND = 'mygame';
const POLL_MS = 2500;
let pollTimer = null;

// ── ゲームロジック (JS) ───────────────────────────
function initialState(creatorUid) {
  return {
    /* 自由な構造 */
    creator_uid: creatorUid,
    opponent_uid: 0, // join 時に上書き
    turn_user_id: creatorUid,
  };
}

function joinTransition(state, opponentUid) {
  return { ...state, opponent_uid: opponentUid };
}

// userId が move を打った 結果を 返す。 不正手は throw。
function applyMove(state, userId, move) {
  if (state.turn_user_id !== userId) throw new Error('あなたの手番ではありません');
  // ... validation ...
  // ... 新 state を作る ...
  // 勝敗判定:
  //   winnerUid = 勝者の user_id (引分は null)
  //   finished  = true なら 終了 (引分も含む)
  return {
    state: newState,
    finished,
    winner_user_id: winnerUid,
    turn_user_id: finished ? null : nextUid,
  };
}

// ── UI ────────────────────────────────────────────
export async function renderMyGame() { /* 一覧 + 新規起案ボタン */ }
export async function renderMyGameDetail({ params }) { /* 盤面 + 手番 polling */ }
```

サンプル: [public/js/views/tictactoe.js](../public/js/views/tictactoe.js) (230 行)。

### 3. ルートと apps/games に登録

`public/js/app.js`:
```js
route('/mygame/:id', lazy(() => import('./views/mygame.js'), 'renderMyGameDetail'));
route('/mygame',     lazy(() => import('./views/mygame.js'), 'renderMyGame'));
```

`public/js/views/apps.js` の APPS と `public/js/views/games.js` の GAMES に エントリ追加で 露出。

## API: 詳細

### POST `/api/custom-games/:kind/games`
起案。 起案者が 1pt 支払う。 Body:
```json
{ "initial_state": { /* 自由 */ } }
```
レスポンス: `{ ok: true, id: 42 }`

### POST `/api/custom-games/:kind/games/:id/join`
参加。 1pt 支払う。 Body:
```json
{ "new_state": { /* opponent_uid を 埋めた state */ } }
```

### POST `/api/custom-games/:kind/games/:id/move`
手を打つ。 サーバが `turn_user_id == あなた` を チェック。 Body:
```json
{
  "new_state": { /* applyMove の 結果 state */ },
  "finished": false,
  "winner_user_id": null,
  "turn_user_id": 5
}
```
終了時 (`finished: true`) は 自動で payout / refund。 `winner_user_id = null` なら 引分 (双方 半額返金)。

### GET `/api/custom-games/:kind/games/:id`
詳細を取得。 レスポンス例:
```json
{
  "id": 42, "game_kind": "tictactoe", "status": "playing",
  "creator_user_id": 3, "creator_name": "...",
  "opponent_user_id": 5, "opponent_name": "...",
  "winner_user_id": null, "winner_name": null,
  "fee": 1, "pot_total": 2,
  "turn_user_id": 3, "my_turn": true,
  "state": { "board": [0,0,0,...], "creator_uid": 3, "opponent_uid": 5, "turn_user_id": 3 },
  "finished_at": null, "created_at": "..."
}
```

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

ゲーム固有 の テーブル を 持ちたい場合 (履歴ログ等) は migration を 追加して OK。 基本は `state_json` だけ で 足りる。

## 課金フロー

- 起案者: 卓を作る時に `fee()` pt を 預ける (`custom_game_buyin`)
- 参加者: `join` で 同額を 預ける (`custom_game_buyin`)
- 終了時:
  - 勝者あり → 勝者に pot 総取り (`custom_game_payout`)
  - 引分 → 双方 半額返金 (`custom_game_refund`)
- ロビーで キャンセル → 起案者に 返金 (`custom_game_refund`)

## サンプル: ⭕❌ マルバツ (TicTacToe)

実装: [public/js/views/tictactoe.js](../public/js/views/tictactoe.js) (230 行 / PHP は 0 行)
動作: `https://pay.nkmr.io/#/tictactoe`

## なぜこの構成?

過去 (v553〜v590) に 麻雀 / 大富豪 / 地雷オセロ / ito / 人狼 / 絵しりとり を 個別の テーブル + 個別の ハンドラ で 作っていた。 重複コード が 多く、 新ゲームの 追加に 毎回 200-500 行。

v617 で 共通 framework (CustomGameInterface) を 切り出したが、 PHP クラス を 1 つ 増やすコストが あった。 v618 で **PHP 1 行 + JS 1 ファイル** に 簡素化。 ラボメンバー が JS で 自作ゲームを 軽く 追加できる。

将来的に 高額 ゲーム を 増やすなら、 ゲーム固有 の サーバ側 ロジック を Plugin 形式で 受け入れる 仕組みを 追加する想定。
