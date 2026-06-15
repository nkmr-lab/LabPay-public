# 自作ゲーム サンプル

LabPay の **自作ゲーム framework** (v619 〜) で 使える サンプル。 ここの `.js` を
ローカルに 落として、 自分の LabPay の `設定 → 🎮 自作ゲーム 管理` (= `/#/my-games`) から
そのまま アップロード すれば 動きます。 PHP / SQL の 変更は 不要、 サーバ への ssh も
必要なし (JS は DB に 格納されて `/api/custom-games/kinds/:kind/script.js` で 配信)。

詳細な 仕組み は [docs/CUSTOM_GAMES.md](../../docs/CUSTOM_GAMES.md)。

## サンプル一覧 — プレイヤー数 別

`sketch({ players: 1 | 2 | 4, ... })` で 1 人 / 2 人 / 4 人 用 を 切替。
登録時の フォーム で 「プレイヤー数」 を 揃えて 選択。

### 1 人用 (ソロ)
| ファイル | 内容 | 推奨 kind | 行数 |
|---|---|---|---|
| [lights_out.js](lights_out.js) | 🟦 ライツアウト 3×3。 タップ で マス + 上下左右 が 反転。 全部 OFF で クリア。 起案 直後 から playing 開始、 join 不要 | `lights-out` | ~55 |

### 2 人用 (対戦)
| ファイル | 内容 | 推奨 kind | 行数 |
|---|---|---|---|
| [nim.js](nim.js) | 🪙 ニム (石取り、 misère)。 盤面ナシ、 21 個から 1〜3 個取り、 最後を取った人が 負け。 **2 人用の 最小例** | `nim` | ~55 |
| [connect_four.js](connect_four.js) | 🟦 四目並べ。 6×7 盤、 縦/横/斜め に 4 つ並べたら 勝ち | `connect-four` | ~75 |
| (built-in) ⭕❌ [tictactoe.js](../../public/js/views/tictactoe.js) | 3×3 マルバツ。 `/#/tictactoe` で 動作 | `tictactoe` | ~55 |

### 4 人用 (順番回し)
| ファイル | 内容 | 推奨 kind | 行数 |
|---|---|---|---|
| [sugoroku.js](sugoroku.js) | 🎲 すごろく。 順番に サイコロ を 振り、 30 マス 目 に 一番乗り で 勝ち。 4 人 揃ったら 自動で playing | `sugoroku` | ~55 |

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

### 押さえる ポイント — Processing 風 の 3 関数 だけ

```js
import { sketch } from '/js/cg_ui.js';

export const { renderList, renderDetail } = sketch({
  kind:  'mygame',                  // 登録時の kind と 同じ
  title: '🎲 マイゲーム',
  hint:  'ルールの 1 行説明',

  // ① 開始時 に 1 回だけ → 初期 state
  setup() { return { /* 自由 */ }; },

  // ② 画面 を 描く → HTML を return
  //    自分の番で <button data-move="X"> を 入れれば、 タップで ③ が 呼ばれる
  draw(state, ctx) { return '<div>...</div>'; },

  // ③ 自分が ボタン を 押した時 → 新しい state
  //    winner: 'me' / 'opponent' / null (引分) / uid。 未終了なら 省略 OK。
  //    手番は LabPay が 自動で 相手に 移します。
  play(state, me, move) {
    return { state: /* 新state */, finished: true, winner: 'me' };
  },
});
```

### 呼び出し の 流れ

```
[起案者が ＋新規卓]
   │
   ▼ setup(me)          ←  1 回だけ
 state ──→ DB
                       [自分の画面] (2.5 秒ごと polling)    [相手の画面]
                            │                                    │
                            ▼ draw(state, ctx)                   ▼ draw(state, ctx)
                            │  画面を 描く
                            ▼ ボタン タップ
                       play(state, me, move)
                            │
                            ▼ サーバに送信 → 新 state
                                          ↑___________________相手側にも 反映
```

### ctx (draw の 第2引数) に 渡るもの

| プロパティ | 内容 |
|---|---|
| `ctx.me` | 自分の uid |
| `ctx.you` | `{uid, name, role: 'creator'|'opponent'}` 自分 |
| `ctx.opponent` | 相手 (waiting 中は null) |
| `ctx.players` | `[you, opponent].filter(Boolean)` |
| `ctx.turn` | 手番の uid (終了時 null) |
| `ctx.myTurn` | 自分の手番か (boolean) |
| `ctx.winner` | 勝者の uid (引分 / 進行中は null) |
| `ctx.status` | `'waiting'` / `'playing'` / `'finished'` / `'cancelled'` |

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
