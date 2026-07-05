# 自作ゲームサンプル

LabPay の **自作ゲーム framework** (v619 〜) で使えるサンプル。ここの `.js` を
ローカルに落として、自分の LabPay の `設定 → 🎮 自作ゲーム管理` (= `/#/my-games`) から
そのままアップロードすれば動きます。 PHP / SQL の変更は不要、サーバへの ssh も
必要なし (JS は DB に格納されて `/api/custom-games/kinds/:kind/script.js` で配信)。

詳細な仕組みは [docs/CUSTOM_GAMES.md](../../docs/CUSTOM_GAMES.md)。

## サンプル一覧 — プレイヤー数別

`sketch({ players: 1 | 2 | 4, ... })` で 1 人 / 2 人 / 4 人用を切替。
登録時のフォームで「プレイヤー数」を揃えて選択。

### 1 人用 (ソロ)
| ファイル | 内容 | 推奨 kind | 行数 |
|---|---|---|---|
| [lights_out.js](lights_out.js) | 🟦 ライツアウト 3×3。タップでマス + 上下左右が反転。全部 OFF でクリア。起案直後から playing 開始、 join 不要 | `lights-out` | ~55 |

### 2 人用 (対戦)
| ファイル | 内容 | 推奨 kind | 行数 |
|---|---|---|---|
| [nim.js](nim.js) | 🪙 ニム (石取り、 misère)。盤面ナシ、 21 個から 1〜3 個取り、最後を取った人が負け。 **2 人用の最小例** | `nim` | ~55 |
| [connect_four.js](connect_four.js) | 🟦 四目並べ。 6×7 盤、縦/横/斜めに 4 つ並べたら勝ち | `connect-four` | ~75 |
| (built-in) ⭕❌ [tictactoe.js](../../public/js/views/tictactoe.js) | 3×3 マルバツ。 `/#/tictactoe` で動作 | `tictactoe` | ~55 |

### 4 人用 (順番回し)
| ファイル | 内容 | 推奨 kind | 行数 |
|---|---|---|---|
| [sugoroku.js](sugoroku.js) | 🎲 すごろく。順番にサイコロを振り、 30 マス目に一番乗りで勝ち。 4 人揃ったら自動で playing | `sugoroku` | ~55 |

## 登録の手順 (例: 四目並べ)

1. このリポジトリの [connect_four.js](connect_four.js) をローカルに保存
2. LabPay → 設定 → 🎮 自作ゲーム管理 → 新規 kind 登録で入力:
   - **kind**: `connect-four` (← この slug はコード中の `const KIND = 'connect-four'` と一致させる)
   - **表示名**: 🟦 四目並べ
   - **説明**: 6×7 盤、縦/横/斜めに 4 つ並べたら勝ち
   - **icon**: 🟦
   - **プレイフィー**: 1 (pt)
   - **JS ファイル**: 保存した `connect_four.js` を選択
3. 登録ボタン → `/#/cg/connect-four` で一覧、 `/#/cg/connect-four/:id` で詳細
4. 他の人を誘って対戦 (場代 90% が提供者 = あなたに入る)

## 新ゲームを自分で書く

LabPay → 設定 → 🎮 自作ゲーム管理 (`/#/my-games`) で:
1. フォーム上部で kind / 表示名 / icon / フィーを入力
2. 「テンプレート読み込み」ドロップダウンから **🪙 ニム** や **⭕❌ マルバツ** を選ぶ → textarea に既存サンプルの JS が入る
3. その場で編集 (盤面や applyMove を自分のゲームに書き換える)
4. 「登録」ボタン → DB に入って即動作

ローカルにエディタを開かなくても、ファイルをアップロードしなくても OK。
ファイル添付や「空テンプレート」も同じ場所から選べます。

### 押さえるポイント — 3 関数だけで足ります

```js
import { sketch } from '/js/cg_ui.js';

export const { renderList, renderDetail } = sketch({
  kind:    'mygame',                  // 登録時の kind と同じ
  title:   '🎲 マイゲーム',
  hint:    'ルールの 1 行説明',
  players: 2,                          // 1 (ソロ) / 2 / 4

  // ① 開始時に 1 回だけ → 初期 state
  setup() { return { /* 自由 */ }; },

  // ② 画面を描く → HTML を return
  //    自分の番で <button data-move="X"> を入れれば、タップで ③ が呼ばれる
  draw(state, ctx) { return '<div>...</div>'; },

  // ③ 自分がボタンを押した時 → 新しい state
  //    winner: 'me' / 'opponent' / null (引分) / uid。未終了なら省略 OK。
  //    手番は LabPay が自動で相手に移します。
  action(state, me, move) {
    return { state: /* 新state */, finished: true, winner: 'me' };
  },
});
```

### 呼び出しの流れ

```
[起案者が ＋新規卓]
   │
   ▼ setup(me)            ←  1 回だけ
 state ──→ DB
                         [自分の画面] (2.5 秒ごと polling)    [相手の画面]
                              │                                    │
                              ▼ draw(state, ctx)                   ▼ draw(state, ctx)
                              │  画面を描く
                              ▼ ボタンタップ
                       action(state, me, move)
                              │
                              ▼ サーバに送信 → 新 state
                                            ↑___________________相手側にも反映
```

### ctx (draw の第2引数) に渡るもの

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

v626 から、ロビー / 待ち / 参加 / 終了のカードや一覧一行は LabPay 側で用意した
ヘルパーが引き受けます。 v628 ではさらに `defineGame()` で全部ラップできる
ようになって、サンプルが **~45-75 行** に収まります。

```js
import {
  state, toast, escapeHtml,
  renderLobby,       // ＋ 新規卓 + 卓一覧
  startGame,         // 起案 + 詳細へ navigate
  fetchDetail,       // 詳細 GET + エラー時の戻りリンク
  statusCardHtml,    // waiting / playing / finished のカード HTML
  wireStatusCard,    // 上の join / cancel ボタン配線
  startPolling,      // 詳細ページの自動 polling (DOM が消えたら自動停止)
  submitMove,        // applyMove の結果を POST
} from '/js/cg_ui.js';
```

つまり kind 側は

```js
const KIND = 'mygame';
function initialState(uid)         { /* 盤面 + uid */ }
function applyMove(s, userId, move) { /* 純 JS で次の state */ }

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
  // 盤面のクリックで applyMove → submitMove
}
```

これだけ。共通カードの見た目を揃えたければそのまま、凝りたければ `statusCardHtml` を使わずに自分で書いても OK。

## import パスの注意

ユーザアップロード JS は `/api/custom-games/kinds/:kind/script.js` から配信されます。
LabPay の helper を取り込む時は **絶対パス** を使ってください (相対パスは 404 になります):

```js
// ✅
import { get, post } from '/js/api.js';
import { state, toast } from '/js/app.js';
import { navigate, escapeHtml } from '/js/router.js';

// ❌ (Cannot resolve)
import { get, post } from '../api.js';
```
