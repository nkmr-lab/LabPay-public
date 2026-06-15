# 自作ゲーム サンプル

LabPay の **自作ゲーム framework** (v619 〜) で 使える サンプル。 ここの `.js` を
ローカルに 落として、 自分の LabPay の `設定 → 🎮 自作ゲーム 管理` (= `/#/my-games`) から
そのまま アップロード すれば 動きます。 PHP / SQL の 変更は 不要、 サーバ への ssh も
必要なし (JS は DB に 格納されて `/api/custom-games/kinds/:kind/script.js` で 配信)。

詳細な 仕組み は [docs/CUSTOM_GAMES.md](../../docs/CUSTOM_GAMES.md)。

## サンプル一覧

| ファイル | 内容 | 推奨 kind / 表示名 | プレイフィー |
|---|---|---|---|
| [connect_four.js](connect_four.js) | 🟦 四目並べ。 6×7 盤、 重力で 下から積む、 縦/横/斜め に 4 つ並べたら 勝ち。 サーバ側 ロジック ゼロ。 ~210 行 | `connect-four` / 🟦 四目並べ | 1pt |

ビルトインの ⭕❌ マルバツ ([public/js/views/tictactoe.js](../../public/js/views/tictactoe.js))
も 同じ framework の 実装例 (こちらは ビルトインなので `/#/tictactoe` で 動く)。

## 登録の 手順 (例: 四目並べ)

1. このリポジトリの [connect_four.js](connect_four.js) を ローカルに 保存
2. LabPay → 設定 → 🎮 自作ゲーム 管理 → 新規 kind 登録 で 入力:
   - **kind**: `connect-four` (← この slug は コード 中の `const KIND = 'connect-four'` と 一致させる)
   - **表示名**: 🟦 四目並べ
   - **説明**: 6×7 盤、 縦/横/斜め に 4 つ並べたら 勝ち
   - **icon**: 🟦
   - **プレイフィー**: 1 (pt)
   - **JS ファイル**: 保存した `connect_four.js` を選択
3. 登録ボタン → `/#/cg/connect-four` で 一覧、 `/#/cg/connect-four/:id` で 詳細
4. 他の人を 誘って 対戦 (場代 90% が 提供者 = あなた に 入る)

## 新ゲームを 自分で 書く

サンプルを コピー → 改造 が 最速。 押さえる ポイント は 4 つだけ:

1. **`KIND` 定数を 登録時の kind と 一致** させる
2. **`initialState(creatorUid)`** を 純 JS で 用意 (盤面 + creator_uid / opponent_uid / turn_user_id)
3. **`applyMove(state, userId, move)`** で 次の state と 勝敗 を 計算
4. **`renderList(ctx)` と `renderDetail(ctx)` を export** する (= framework が これを 呼ぶ)

サーバは `state_json` の中身を 触らず、 `turn_user_id` の チェック + 課金 だけ enforce します。

## import パス の 注意

ユーザ アップロード JS は `/api/custom-games/kinds/:kind/script.js` から 配信されます。
LabPay の helper を 取り込む 時は **絶対パス** を 使ってください (相対パスは 404 になります):

```js
// ✅
import { get, post } from '/js/api.js';
import { state, toast } from '/js/app.js';
import { navigate, escapeHtml } from '/js/router.js';

// ❌ (Cannot resolve)
import { get, post } from '../api.js';
```
