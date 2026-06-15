# 自作ゲーム サンプル

LabPay の **自作ゲーム framework** (v619 〜) で 使える サンプル。 ここの `.js` を
ローカルに 落として、 自分の LabPay の `設定 → 🎮 自作ゲーム 管理` (= `/#/my-games`) から
そのまま アップロード すれば 動きます。 PHP / SQL の 変更は 不要、 サーバ への ssh も
必要なし (JS は DB に 格納されて `/api/custom-games/kinds/:kind/script.js` で 配信)。

詳細な 仕組み は [docs/CUSTOM_GAMES.md](../../docs/CUSTOM_GAMES.md)。

## サンプル一覧

| ファイル | 内容 | 推奨 kind / 表示名 | 行数 | プレイフィー |
|---|---|---|---|---|
| [nim.js](nim.js) | 🪙 ニム (石取り、 misère)。 盤面ナシ、 21 個から 1〜3 個取り、 最後を取った人が 負け。 **最小例 — 1 ファイル コピーで 動く** | `nim` / 🪙 ニム | ~45 | 1pt |
| [connect_four.js](connect_four.js) | 🟦 四目並べ。 6×7 盤、 重力で 下から積む、 縦/横/斜め に 4 つ並べたら 勝ち | `connect-four` / 🟦 四目並べ | ~75 | 1pt |

ビルトインの ⭕❌ マルバツ ([public/js/views/tictactoe.js](../../public/js/views/tictactoe.js))
も 同じ framework の 実装例 (こちらは ビルトインなので `/#/tictactoe` で 動く)。 ~50 行。

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

LabPay → 設定 → 🎮 自作ゲーム 管理 (`/#/my-games`) で:
1. フォーム上部 で kind / 表示名 / icon / フィー を 入力
2. 「テンプレート 読み込み」 ドロップダウン から **🪙 ニム** や **⭕❌ マルバツ** を 選ぶ → textarea に 既存サンプル の JS が 入る
3. その場で 編集 (盤面 や applyMove を 自分の ゲーム に 書き換える)
4. 「登録」 ボタン → DB に 入って 即動作

ローカル に エディタを 開かなくても、 ファイルを アップロード しなくても OK。
ファイル添付 や 「空テンプレート」 も 同じ場所 から 選べます。

### 押さえる ポイント

`defineGame()` 経由 だと 4 行 で 終わり (=ロビー / 待ち / 終了 などは 全部 LabPay が 用意):

```js
import { defineGame } from '/js/cg_ui.js';
export const { renderList, renderDetail } = defineGame({
  kind: 'mygame',               // 登録時の kind と 一致
  title: '🎲 マイゲーム',
  initialState: (uid) => ({ /* creator_uid / opponent_uid / turn_user_id 必須 */ }),
  applyMove: (s, uid, move) => ({ state, finished, winner_user_id, turn_user_id }),
  renderBoard: (s, { d, myTurn, status }) => `<div>... <button data-move="0">↓</button> ...</div>`,
});
```

サーバは `state_json` の中身を 触らず、 `turn_user_id` の チェック + 課金 だけ enforce します。
`data-move="..."` 属性の値が そのまま applyMove の `move` に 渡る (整数なら 数値、 JSON は パース、 それ以外は 文字列)。

### 共通 UI ヘルパー: `/js/cg_ui.js`

v626 から、 ロビー / 待ち / 参加 / 終了 の カードや 一覧 一行 は LabPay 側で 用意した
ヘルパー が 引き受けます。 v628 では さらに `defineGame()` で 全部 ラップ できる
ように なって、 サンプルが **~45-75 行** に 収まります。

```js
import {
  state, toast, escapeHtml,
  renderLobby,       // ＋ 新規卓 + 卓一覧
  startGame,         // 起案 + 詳細へ navigate
  fetchDetail,       // 詳細 GET + エラー時の戻りリンク
  statusCardHtml,    // waiting / playing / finished の カード HTML
  wireStatusCard,    // 上の join / cancel ボタン 配線
  startPolling,      // 詳細ページ の 自動 polling (DOM が 消えたら 自動停止)
  submitMove,        // applyMove の 結果を POST
} from '/js/cg_ui.js';
```

つまり kind 側 は

```js
const KIND = 'mygame';
function initialState(uid)         { /* 盤面 + uid */ }
function applyMove(s, userId, move) { /* 純 JS で 次の state */ }

export function renderList() {
  return renderLobby({ kind: KIND, title: '🎲 マイゲーム', onNew: ... });
}
export function renderDetail({ params }) {
  startPolling({ paint: () => paint(params.id), guardSelector: `[data-mygame-gid="${params.id}"]` });
}
async function paint(gid) {
  const d = await fetchDetail({ kind: KIND, gid });
  if (!d) return;
  document.getElementById('app').innerHTML = `
    <div class="card" data-mygame-gid="${gid}">…盤面…</div>
    ${statusCardHtml(d, Number(state.me?.id))}
  `;
  wireStatusCard({ kind: KIND, gid, d, meId, onAfter: () => paint(gid) });
  // 盤面の クリックで applyMove → submitMove
}
```

これだけ。 共通カードの 見た目を 揃えたければ そのまま、 凝りたければ `statusCardHtml` を 使わずに 自分で 書いても OK。

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
