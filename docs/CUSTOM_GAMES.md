# 自作ゲーム フレームワーク v1 (custom_games)

> **v667 で v2 (cg2) framework も 追加 されました**。 リアルタイム 系 が 欲しい 場合 は [CUSTOM_GAMES_V2.md](CUSTOM_GAMES_V2.md) を 参照。 v1 は **turn-based の 2 人対戦** (マルバツ 系) に 特化。 両方 とも 並走 して います。

LabPay に **2 人対戦のターン制ゲームを 設定画面 + JS だけ で 追加できる** 仕組み。 v619 で DB 管理化、 v620 で 各ユーザが 自由に登録 + JS を DB に アップロード可能に。 v621 で 課金モデルを **場代 (= プレイ毎の 課金、 90% 提供者 / 10% SYSTEM)** に 簡素化。 掛け金 / pot / 勝者 payout は 廃止。

## 何を書くか

| | 内容 | 量 |
|---|---|---|
| 設定画面 | `/#/my-games` で kind を 登録 (kind / 表示名 / 説明 / icon / fee / JS ファイル) | フォーム 1 件 |
| JS | **Processing 風** の `sketch({ setup, draw, action, players })` で 書く。 setup = 開始時 / draw = 画面描画 / action = ボタン押された時。 ロビー / 待ち / 参加 / 終了 / 状態取得 / polling / submit は cg_ui が 全部 引き受ける。 **🪙 ニム ~55 行 (コメント込) / 🟦 ライツアウト ~55 行 / 🎲 すごろく ~55 行** | 1 ファイル |
| PHP | **触らない** | 0 行 |
| SQL | 不要 (新規 ゲームでも `custom_games` テーブルを 共有) | 0 行 |
| サーバ作業 | **不要** (JS は DB に格納、 配信は `/api/custom-games/kinds/:kind/script.js`) | 0 |

新しい 2 人対戦ゲームを 追加するときの 修正量はこれだけ。 ssh / scp なし、 管理者でなくても 自分で 登録できる。

## アーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│  /api/custom-games/list   ← 登録ゲーム一覧 (UI 用)         │
│  /api/custom-games/:kind/games            一覧 / 起案 (無料) │
│  /api/custom-games/:kind/games/:id        詳細            │
│  /api/custom-games/:kind/games/:id/join   参加 (両者から 場代 徴収) │
│  /api/custom-games/:kind/games/:id/move   手を打つ        │
│  /api/custom-games/:kind/games/:id/cancel  キャンセル (無料) │
│  /api/custom-games/kinds/:kind/script.js  JS module 配信  │
└─────────────────┬─────────────────────────────────────────┘
                  │ 全 ゲーム共通 / PHP
                  ▼
┌──────────────────────────────────────────────────────────┐
│  src/handlers/custom_games.php                            │
│  - custom_game_kinds (DB 管理、 ユーザ自身が登録可能)        │
│  - 共通 API (list / create / join / move / cancel)         │
│  - Ledger: join 時に 場代 を 提供者 90% / SYSTEM 10% へ      │
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
- **勝者の妥当性**: クライアントが `winner_user_id` を 申告。 サーバは creator/opponent のどちらかであることを チェック (= 集計のための メモ、 課金には 関与しない)
- **state の整合性**: クライアント任せ。 「対戦相手の クライアントも 同じ JS ロジックで 動いている」 ので 不正な遷移は 相手の画面で 即破綻する
- **金銭的 上限**: 1 ゲームあたり 各プレイヤー fee pt の 1 回ぽっきり。 提供者は fee×0.9 / SYSTEM は fee×0.1 (round down)

高額にしたい場合は ゲーム固有の サーバ側 validation (例: PHP で `applyMove` も書く) を 追加できますが、 マルバツ程度 なら 上記で OK です。

## 新ゲームを 追加する 手順

### 1. 設定画面 から kind を 登録 (v620 から 各ユーザ 可能)

`設定` → `🎮 自作ゲーム 管理` (= `/#/my-games`) から フォーム入力:

- **kind**: URL slug (例: `mygame`)。 小文字 + 数字 + `-` `_`、 3-40 文字
- **表示名**: 例: `🎲 マイゲーム`
- **説明**: 1-2 文
- **icon**: 絵文字 1 文字
- **fee (場代)**: プレイ毎の 課金 (0-100pt)。 0 なら 無料。 各プレイヤーが 払う
- **JS ファイル**: ローカルで 書いた `.js` を そのまま アップロード (最大 500KB)

登録すると `custom_game_kinds` テーブルに 1 行 入り、 JS は そのまま DB の `js_source` カラムに 格納される。 サーバの ファイル書き込み権限 は 必要なし。 配信は `/api/custom-games/kinds/:kind/script.js` (no-cache、 更新が 即時反映)。

API (`/api/custom-games/list`) に 即座に 反映。 編集 / 無効化 は **自分が登録した kind** か **admin** のみ。

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
    "js_source": "import { get, post } from \"../api.js\"; ... (JS 全文)"
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

### 3. ルートは 自動

v620 から **汎用ディスパッチャ** が `/cg/:kind` と `/cg/:kind/:id` を 自動で 処理する:

- ディスパッチャ (`public/js/views/customgame.js`) が `/api/custom-games/list` を 引いて、
  `has_js_source` が true なら `/api/custom-games/kinds/:kind/script.js` を `import()`
- module は **`renderList(ctx)` と `renderDetail(ctx)` を export** すれば 自動で 呼ばれる
  (フォールバックで `render{KindCamel}` / `render{KindCamel}Detail` も 試す)

つまり JS を アップロード したら `/#/cg/mygame` で 一覧、 `/#/cg/mygame/42` で 詳細が 出る。 `app.js` 修正不要。

`public/js/views/apps.js` の APPS / `public/js/views/games.js` の GAMES に 自分の kind を 追加すれば トップ画面 から 入り口 が 出る (admin 作業)。

## API: 詳細

### POST `/api/custom-games/:kind/games`
起案。 **無課金** (waiting で 卓を 開くだけ)。 Body:
```json
{ "initial_state": { /* 自由 */ } }
```
レスポンス: `{ ok: true, id: 42 }`

### POST `/api/custom-games/:kind/games/:id/join`
参加。 ここで 初めて 場代 が 動く: **起案者 + 参加者 から fee pt ずつ** 徴収、 各 fee は 提供者 (kind 登録者) 90% / SYSTEM 10% に 配分。 fee=0 なら 課金なし。 Body:
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
終了時 (`finished: true`) は **課金 / 払戻 なし** (場代は すでに join で 払い済み)。 `winner_user_id` は 集計用に 記録するだけ。

### GET `/api/custom-games/:kind/games/:id`
詳細を取得。 レスポンス例 (pot_total は 旧フィールド、 v621 以降 常に 0):
```json
{
  "id": 42, "game_kind": "tictactoe", "status": "playing",
  "creator_user_id": 3, "creator_name": "...",
  "opponent_user_id": 5, "opponent_name": "...",
  "winner_user_id": null, "winner_name": null,
  "fee": 1, "pot_total": 0,
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

## 課金フロー (v621 〜)

- 起案 (`create`): **課金なし**。 waiting で 誰も 来なければ ノーリスク
- 参加 (`join`) で 卓 が 成立 → 起案者 + 参加者 から `fee` pt ずつ 徴収:
  - **提供者 (kind 登録者) に `floor(fee * 0.9)`** (`custom_game_play_fee`、 to_user = provider)
  - **SYSTEM に 残り** (`custom_game_play_fee`、 to_user = SYSTEM)
  - provider が NULL (= 旧 admin 登録、 提供者不在) なら **全額 SYSTEM**
- 手 (`move`) / 終了 (`finished=true`) / 引分 / cancel — 課金 / 払戻 **一切なし**。 終了時は winner_user_id を 記録するだけ (集計用)
- ロビーで `cancel` — 課金前なので 返金不要

旧モデル (v620 までの pot / payout / rake) で 残った 既存卓 は finish に到達した時点で 何も払い戻されません (waiting のまま放置されたものは cancel で OK)。 ledger types `custom_game_buyin` / `custom_game_payout` / `custom_game_refund` / `custom_game_rake` は v621 以降 emit されません (allowlist には残しています)。

## サンプル

| 名前 | 形態 | 場所 | 行数 | 動作 |
|---|---|---|---|---|
| 🪙 ニム (石取り) | アップロード可能 (最小例、 盤面ナシ) | [examples/custom-games/nim.js](../examples/custom-games/nim.js) | ~45 | アップロード後 `/#/cg/nim` |
| ⭕❌ マルバツ | ビルトイン | [public/js/views/tictactoe.js](../public/js/views/tictactoe.js) | ~50 | `/#/tictactoe` |
| 🟦 四目並べ | アップロード可能 | [examples/custom-games/connect_four.js](../examples/custom-games/connect_four.js) | ~75 | アップロード後 `/#/cg/connect-four` |

`/#/my-games` の フォーム から **「テンプレート 読み込み」** で 上記 3 つを 直接 textarea に 入れて 編集 → そのまま 登録 できます (= ローカル に エディタ + ファイル管理 が 不要)。

詳細 → [examples/custom-games/README.md](../examples/custom-games/README.md)

## なぜこの構成?

過去 (v553〜v590) に 麻雀 / 大富豪 / 地雷オセロ / ito / 人狼 / 絵しりとり を 個別の テーブル + 個別の ハンドラ で 作っていた。 重複コード が 多く、 新ゲームの 追加に 毎回 200-500 行。

v617 で 共通 framework (CustomGameInterface) を 切り出したが、 PHP クラス を 1 つ 増やすコストが あった。 v618 で **PHP 1 行 + JS 1 ファイル** に 簡素化。 ラボメンバー が JS で 自作ゲームを 軽く 追加できる。

将来的に 高額 ゲーム を 増やすなら、 ゲーム固有 の サーバ側 ロジック を Plugin 形式で 受け入れる 仕組みを 追加する想定。

## v1 vs v2 の 使い分け

- **v1 (この doc)**: 2 人 対戦、 turn-based、 polling 2.5 秒。 マルバツ / 四目 / ニム 等。 JS 50-100 行。
- **v2 ([CUSTOM_GAMES_V2.md](CUSTOM_GAMES_V2.md))**: N 人 対戦 可、 準リアルタイム (共有 state 500ms 差分 同期)、 p5.js 描画。 CPU 戦 混在 対応。 すごろく / ライツアウト 等 も。

新規 開発 は 用途 に 合わせ て 選ぶ:
- ターン 制 で 十分 な 静的 ゲーム → v1
- リアルタイム 要素 (押し合い / タイマー / アニメ) が 欲しい → v2
