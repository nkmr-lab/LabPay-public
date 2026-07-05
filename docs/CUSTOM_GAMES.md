# 自作ゲームフレームワーク v1 (custom_games)

> **v667 で v2 (cg2) framework も追加されました**。リアルタイム系が欲しい場合は [CUSTOM_GAMES_V2.md](CUSTOM_GAMES_V2.md) を参照。 v1 は **turn-based の 2 人対戦** (マルバツ系) に特化。両方とも並走しています。

LabPay に **2 人対戦のターン制ゲームを設定画面 + JS だけで追加できる** 仕組み。 v619 で DB 管理化、 v620 で各ユーザが自由に登録 + JS を DB にアップロード可能に。 v621 で課金モデルを **場代 (= プレイ毎の課金、 90% 提供者 / 10% SYSTEM)** に簡素化。掛け金 / pot / 勝者 payout は廃止。

## 何を書くか

| | 内容 | 量 |
|---|---|---|
| 設定画面 | `/#/my-games` で kind を登録 (kind / 表示名 / 説明 / icon / fee / JS ファイル) | フォーム 1 件 |
| JS | **Processing 風** の `sketch({ setup, draw, action, players })` で書く。 setup = 開始時 / draw = 画面描画 / action = ボタン押された時。ロビー / 待ち / 参加 / 終了 / 状態取得 / polling / submit は cg_ui が全部引き受ける。 **🪙 ニム ~55 行 (コメント込) / 🟦 ライツアウト ~55 行 / 🎲 すごろく ~55 行** | 1 ファイル |
| PHP | **触らない** | 0 行 |
| SQL | 不要 (新規ゲームでも `custom_games` テーブルを共有) | 0 行 |
| サーバ作業 | **不要** (JS は DB に格納、配信は `/api/custom-games/kinds/:kind/script.js`) | 0 |

新しい 2 人対戦ゲームを追加するときの修正量はこれだけ。 ssh / scp なし、管理者でなくても自分で登録できる。

## アーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│  /api/custom-games/list   ← 登録ゲーム一覧 (UI 用)         │
│  /api/custom-games/:kind/games            一覧 / 起案 (無料) │
│  /api/custom-games/:kind/games/:id        詳細            │
│  /api/custom-games/:kind/games/:id/join   参加 (両者から場代徴収) │
│  /api/custom-games/:kind/games/:id/move   手を打つ        │
│  /api/custom-games/:kind/games/:id/cancel  キャンセル (無料) │
│  /api/custom-games/kinds/:kind/script.js  JS module 配信  │
└─────────────────┬─────────────────────────────────────────┘
                  │ 全ゲーム共通 / PHP
                  ▼
┌──────────────────────────────────────────────────────────┐
│  src/handlers/custom_games.php                            │
│  - custom_game_kinds (DB 管理、ユーザ自身が登録可能)        │
│  - 共通 API (list / create / join / move / cancel)         │
│  - Ledger: join 時に場代を提供者 90% / SYSTEM 10% へ      │
│  - turn_user_id を厳密に enforce (= 不正手のサーバ側ガード)   │
│  - state_json は不透明 (= 中身は触らない)                  │
└─────────────────┬────────────────────────────────────────┘
                  │ 中身は state_json (JSON blob) で自由
                  ▼
┌──────────────────────────────────────────────────────────┐
│  public/js/views/{kind}.js (JS)                           │
│  - initialState(creatorUid)                               │
│  - applyMove(state, userId, move) → 新 state + 勝敗      │
│  - renderBoard (盤面 + 手番 polling + クリックハンドラ)        │
│  - POST 時に new_state / finished / winner_user_id / turn_user_id │
│    をサーバに送る (サーバは state_json を保存するだけ)        │
└──────────────────────────────────────────────────────────┘
```

サーバ ([handlers/custom_games.php](../src/handlers/custom_games.php)) は state の中身に触らない。
turn_user_id の遷移と Ledger 操作だけが PHP の役目。

## セキュリティモデル

1pt 程度の低額対戦を想定:

- **手番 enforce**: サーバが `turn_user_id == 現在のアクター` をチェック。違ったら 400
- **勝者の妥当性**: クライアントが `winner_user_id` を申告。サーバは creator/opponent のどちらかであることをチェック (= 集計のためのメモ、課金には関与しない)
- **state の整合性**: クライアント任せ。「対戦相手のクライアントも同じ JS ロジックで動いている」ので不正な遷移は相手の画面で即破綻する
- **金銭的上限**: 1 ゲームあたり各プレイヤー fee pt の 1 回ぽっきり。提供者は fee×0.9 / SYSTEM は fee×0.1 (round down)

高額にしたい場合はゲーム固有のサーバ側 validation (例: PHP で `applyMove` も書く) を追加できますが、マルバツ程度なら上記で OK です。

## 新ゲームを追加する手順

### 1. 設定画面から kind を登録 (v620 から各ユーザ可能)

`設定` → `🎮 自作ゲーム管理` (= `/#/my-games`) からフォーム入力:

- **kind**: URL slug (例: `mygame`)。小文字 + 数字 + `-` `_`、 3-40 文字
- **表示名**: 例: `🎲 マイゲーム`
- **説明**: 1-2 文
- **icon**: 絵文字 1 文字
- **fee (場代)**: プレイ毎の課金 (0-100pt)。 0 なら無料。各プレイヤーが払う
- **JS ファイル**: ローカルで書いた `.js` をそのままアップロード (最大 500KB)

登録すると `custom_game_kinds` テーブルに 1 行入り、 JS はそのまま DB の `js_source` カラムに格納される。サーバのファイル書き込み権限は必要なし。配信は `/api/custom-games/kinds/:kind/script.js` (no-cache、更新が即時反映)。

API (`/api/custom-games/list`) に即座に反映。編集 / 無効化は **自分が登録した kind** か **admin** のみ。

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

### 2. JS でゲーム本体を書く

`public/js/views/mygame.js` を作る (マルバツをコピー → 改造が最速):

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

// userId が move を打った結果を返す。不正手は throw。
function applyMove(state, userId, move) {
  if (state.turn_user_id !== userId) throw new Error('あなたの手番ではありません');
  // ... validation ...
  // ... 新 state を作る ...
  // 勝敗判定:
  //   winnerUid = 勝者の user_id (引分は null)
  //   finished  = true なら終了 (引分も含む)
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

### 3. ルートは自動

v620 から **汎用ディスパッチャ** が `/cg/:kind` と `/cg/:kind/:id` を自動で処理する:

- ディスパッチャ (`public/js/views/customgame.js`) が `/api/custom-games/list` を引いて、
  `has_js_source` が true なら `/api/custom-games/kinds/:kind/script.js` を `import()`
- module は **`renderList(ctx)` と `renderDetail(ctx)` を export** すれば自動で呼ばれる
  (フォールバックで `render{KindCamel}` / `render{KindCamel}Detail` も試す)

つまり JS をアップロードしたら `/#/cg/mygame` で一覧、 `/#/cg/mygame/42` で詳細が出る。 `app.js` 修正不要。

`public/js/views/apps.js` の APPS / `public/js/views/games.js` の GAMES に自分の kind を追加すればトップ画面から入り口が出る (admin 作業)。

## API: 詳細

### POST `/api/custom-games/:kind/games`
起案。 **無課金** (waiting で卓を開くだけ)。 Body:
```json
{ "initial_state": { /* 自由 */ } }
```
レスポンス: `{ ok: true, id: 42 }`

### POST `/api/custom-games/:kind/games/:id/join`
参加。ここで初めて場代が動く: **起案者 + 参加者から fee pt ずつ** 徴収、各 fee は提供者 (kind 登録者) 90% / SYSTEM 10% に配分。 fee=0 なら課金なし。 Body:
```json
{ "new_state": { /* opponent_uid を埋めた state */ } }
```

### POST `/api/custom-games/:kind/games/:id/move`
手を打つ。サーバが `turn_user_id == あなた` をチェック。 Body:
```json
{
  "new_state": { /* applyMove の結果 state */ },
  "finished": false,
  "winner_user_id": null,
  "turn_user_id": 5
}
```
終了時 (`finished: true`) は **課金 / 払戻なし** (場代はすでに join で払い済み)。 `winner_user_id` は集計用に記録するだけ。

### GET `/api/custom-games/:kind/games/:id`
詳細を取得。レスポンス例 (pot_total は旧フィールド、 v621 以降常に 0):
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

ゲーム固有のテーブルを持ちたい場合 (履歴ログ等) は migration を追加して OK。基本は `state_json` だけで足りる。

## 課金フロー (v621 〜)

- 起案 (`create`): **課金なし**。 waiting で誰も来なければノーリスク
- 参加 (`join`) で卓が成立 → 起案者 + 参加者から `fee` pt ずつ徴収:
  - **提供者 (kind 登録者) に `floor(fee * 0.9)`** (`custom_game_play_fee`、 to_user = provider)
  - **SYSTEM に残り** (`custom_game_play_fee`、 to_user = SYSTEM)
  - provider が NULL (= 旧 admin 登録、提供者不在) なら **全額 SYSTEM**
- 手 (`move`) / 終了 (`finished=true`) / 引分 / cancel — 課金 / 払戻 **一切なし**。終了時は winner_user_id を記録するだけ (集計用)
- ロビーで `cancel` — 課金前なので返金不要

旧モデル (v620 までの pot / payout / rake) で残った既存卓は finish に到達した時点で何も払い戻されません (waiting のまま放置されたものは cancel で OK)。 ledger types `custom_game_buyin` / `custom_game_payout` / `custom_game_refund` / `custom_game_rake` は v621 以降 emit されません (allowlist には残しています)。

## サンプル

| 名前 | 形態 | 場所 | 行数 | 動作 |
|---|---|---|---|---|
| 🪙 ニム (石取り) | アップロード可能 (最小例、盤面ナシ) | [examples/custom-games/nim.js](../examples/custom-games/nim.js) | ~45 | アップロード後 `/#/cg/nim` |
| ⭕❌ マルバツ | ビルトイン | [public/js/views/tictactoe.js](../public/js/views/tictactoe.js) | ~50 | `/#/tictactoe` |
| 🟦 四目並べ | アップロード可能 | [examples/custom-games/connect_four.js](../examples/custom-games/connect_four.js) | ~75 | アップロード後 `/#/cg/connect-four` |

`/#/my-games` のフォームから **「テンプレート読み込み」** で上記 3 つを直接 textarea に入れて編集 → そのまま登録できます (= ローカルにエディタ + ファイル管理が不要)。

詳細 → [examples/custom-games/README.md](../examples/custom-games/README.md)

## なぜこの構成?

過去 (v553〜v590) に麻雀 / 大富豪 / 地雷オセロ / ito / 人狼 / 絵しりとりを個別のテーブル + 個別のハンドラで作っていた。重複コードが多く、新ゲームの追加に毎回 200-500 行。

v617 で共通 framework (CustomGameInterface) を切り出したが、 PHP クラスを 1 つ増やすコストがあった。 v618 で **PHP 1 行 + JS 1 ファイル** に簡素化。ラボメンバーが JS で自作ゲームを軽く追加できる。

将来的に高額ゲームを増やすなら、ゲーム固有のサーバ側ロジックを Plugin 形式で受け入れる仕組みを追加する想定。

## v1 vs v2 の使い分け

- **v1 (この doc)**: 2 人対戦、 turn-based、 polling 2.5 秒。マルバツ / 四目 / ニム等。 JS 50-100 行。
- **v2 ([CUSTOM_GAMES_V2.md](CUSTOM_GAMES_V2.md))**: N 人対戦可、準リアルタイム (共有 state 500ms 差分同期)、 p5.js 描画。 CPU 戦混在対応。すごろく / ライツアウト等も。

新規開発は用途に合わせて選ぶ:
- ターン制で十分な静的ゲーム → v1
- リアルタイム要素 (押し合い / タイマー / アニメ) が欲しい → v2
