# 自作ゲーム v2 framework (cg2) 設計

> **ステータス**: **実装完了 (v667 で稼働)**。 `/api/cg2` 系 endpoint + `public/js/cg2.js` framework + `/#/cg2/{slug}` 動線が動いています。サンプル 4 件は `docs/cg2_sample_*.js` に用意済で、実装チームが各 kind に登録可能。
> **エンドポイント一覧**: [api.md#apicg2-自作ゲーム-v2](api.md) を参照。

LabPay の v1 自作ゲーム framework (cg_ui / custom_games) を全面再設計したもの。
**p5.js で描画**、 **共有 state を自動同期** する「准リアルタイム」 multiplayer の仕組み。

## v1 と v2 の違い

| | v1 (cg_ui) | v2 (cg2) |
|---|---|---|
| 描画 | HTML を返す `draw(state, ctx)` | p5.js instance mode の `sketch(p)` |
| state | `applyMove(state, uid, move)` の純関数で遷移 | `sharedValues` を直接 mutate (auto-sync) |
| 引数 | reduce / draw に 4 引数ずつ | ほぼなし (state は ambient) |
| 同期 | turn-based、 1 手 = POST + polling | 准リアルタイム (500ms 差分 polling) |
| 終了 | action の return で `finished: true, winner: ...` | `sharedValues.ended = true` → host.stop |
| ライフサイクル | setup / action / draw | host.start / host.stop + p5 setup / draw / event |
| AI | turn-based の `aiMove` | 唯一の人間がローカルで動かす (mixed なし) |
| 観戦者 | あり | なし |

## 開発者が書く 1 ファイル (最小)

```js
import { players, myID, isHost, sharedValues, localValues, notifyResult, host } from '/js/cg2.js';

// host だけで 1 回 (起案者のブラウザで)。 sharedValues 初期化。
host.start = () => {
  sharedValues.cells = Array(9).fill(null);
  sharedValues.order = [...players].map(p => p.uid).sort(() => Math.random() - 0.5);  // 先手後攻ランダム
  sharedValues.turnUid = sharedValues.order[0];
  sharedValues.ended = false;
};

// host だけで 1 回 (sharedValues.ended = true で呼ばれる)。結果を 1 回 notify。
host.stop = () => {
  if (sharedValues.winnerUid) {
    const w = players.find(p => p.uid === sharedValues.winnerUid);
    notifyResult(`${w.name} の勝ち`, { winnerUid: w.uid });
  } else {
    notifyResult('引き分け');
  }
};

// 全 client で p5 sketch。 framework が hostStart 完了 + 同期完了を待ってから new p5(sketch) する。
export default function sketch(p) {
  p.setup = () => p.createCanvas(300, 300);
  p.draw = () => {
    // sharedValues / localValues / players / myID を自由に読む
  };
  p.mousePressed = () => {
    if (sharedValues.turnUid !== myID) return;
    // sharedValues を mutate → 自動同期
    sharedValues.cells[clickedCell] = myID;
    if (didWin()) {
      sharedValues.winnerUid = myID;
      sharedValues.ended = true;     // ← framework が検知して host.stop へ
    }
  };
}
```

書く関数は **`host.start` + `host.stop` + `sketch` (p5 instance) の 3 つ**。

## framework が提供するもの (`/js/cg2.js`)

| 名前 | 内容 |
|---|---|
| `players` | 参加者配列 `[{uid, name, is_ai}, ...]` (= system 管理) |
| `myID`    | 自分の uid (数値)。名前等は `players.find(p => p.uid === myID).name` で引く |
| `isHost`  | 自分が起案者かどうか (boolean) |
| `sharedValues` | 共有 state。 mutate すると auto-sync (deep Proxy)、ロックなし最終書き込み勝ち |
| `localValues`  | 個人 state。 sync しない、揮発 (リロードで消える) |
| `notifyResult(text, opts?)` | 結果通知。 `host.stop` の中でのみ呼ぶ |
| `host` | `host.start = ...`, `host.stop = ...` を代入する受け皿 |

## ライフサイクル

```
host がページを開く
  ↓
framework が host.start() を呼ぶ        ← sharedValues 初期化
  ↓
framework が server に sharedValues を POST
  ↓
host で new p5(sketch, container)         ← setup() → draw() ループ
  ↓
他の player がページを開く
  ↓
framework が server から sharedValues を pull
  ↓
sharedValues が揃うまで「待機中…」表示
  ↓
non-host で new p5(sketch, container)     ← setup() → draw() ループ

(プレイ中: 各 client で sharedValues mutate → 500ms 差分同期)

sharedValues.ended = true を立てる
  ↓
framework が検知 → host で host.stop() を呼ぶ
  ↓
host.stop の中で notifyResult を 1 回呼ぶ
  ↓
framework が場代配分 / 通知 / 履歴記録を実行
```

## host の定義

- **host = 起案者で確定** (= ゲームを作った人)
- host が途中で抜けたら **ゲーム終了** (= host.stop で強制終了)

## CPU 戦の扱い

- 「Player x 2 + CPU x 2」みたいなミックスは **不可**
- CPU がいる場合は **人間は 1 人** だけ (= host)
- AI は **唯一の人間 = host のブラウザ** でローカルに計算する
- 例 (マルバツ):
  ```js
  // sketch の draw 内で:
  const cur = players.find(p => p.uid === sharedValues.turnUid);
  if (cur && cur.is_ai && isHost && !localValues.aiThinking) {
    localValues.aiThinking = true;
    setTimeout(() => {
      const cell = pickRandomEmpty();
      sharedValues.cells[cell] = cur.uid;
      sharedValues.turnUid = nextPlayer();
      localValues.aiThinking = false;
    }, 800);
  }
  ```

## 順番のランダム化

`host.start` で `sharedValues.order` にシャッフルした uid 配列を入れる。これで「先手が起案者とは限らない」が全ゲームで統一的に実現:

```js
host.start = () => {
  sharedValues.order = [...players].map(p => p.uid).sort(() => Math.random() - 0.5);
  sharedValues.turnUid = sharedValues.order[0];
  ...
};

const nextTurn = () => {
  const idx = sharedValues.order.indexOf(sharedValues.turnUid);
  return sharedValues.order[(idx + 1) % sharedValues.order.length];
};
```

## sharedValues の同期方式

- **polling 500ms + 差分**
- POST `/api/cg2/games/{id}/shared` body: `{changes: {key: value, ...}}` (差分のみ)
- GET `/api/cg2/games/{id}/shared?since={seq}` → 200 (変更) / 304 (なし)
- **ロックなし**、最終書き込み勝ち
- ゲームロジック側で「同じ key を 2 人が同時に書かない」設計 (= セル別 key で分ける等) で回避

## 「結果通知」 = `notifyResult(text, opts?)`

```js
notifyResult('時間切れ - 引き分け');
notifyResult(`${winner.name} の勝ち`, { winnerUid: 42 });
notifyResult('全員完走', { ranking: [{uid: 42, rank: 1}, ...] });
```

- `text` (必須): Slack / 通知 / 履歴で表示する文字列
- `opts.winnerUid` (任意): 集計用単一勝者
- `opts.ranking` (任意): 集計用順位表

## サンプル (docs/cg2_sample_*.js)

| ファイル | ゲーム | プレイヤー | 確認ポイント |
|---|---|---|---|
| [cg2_sample_tictactoe.js](cg2_sample_tictactoe.js) | マルバツ | 2 人 (CPU 戦対応) | order shuffle、 myID、 isHost で AI 駆動 |
| [cg2_sample_nim.js](cg2_sample_nim.js) | ニム (misère) | 2 人 (CPU 戦対応) | 必勝戦略 AI、ボタン UI |
| [cg2_sample_lights_out.js](cg2_sample_lights_out.js) | ライツアウト | 1 人 (ソロ) | order / turnUid 不要、 sharedValues は「自分専用だが持続」 |
| [cg2_sample_sugoroku.js](cg2_sample_sugoroku.js) | すごろく | 4 人 (CPU 戦対応) | 着席順 shuffle、トラック描画 |

## 既存 4 ゲームの移植

実装着手時に v1 の既存サンプル (マルバツ / ニム / ライツアウト / すごろく) を v2 で **差し替え**。 v1 cg_ui はしばらく並走 → 全部 v2 移行で撤去。

## 設定 (= JS の外に持つもの)

JS で **書かない** もの = `custom_game_kinds` 行で設定する:
- 人数上限 / 下限
- 募集方法 (公開 / 招待 / 部屋番号等)
- 場代金額
- 場代配分比率 (提供者 / SYSTEM)

開発者は「参加者 / 共有情報 / 結果」の 3 点だけ JS で書く。募集や課金は framework 側に寄せる。

## なぜこうなったか (経緯メモ)

- v1 cg_ui の `sketch({setup, draw, action, players})` で引数が多い / 複雑という不満
- 「他のゲーム基盤 (boardgame.io / Colyseus 等) はどうしてる?」という議論から
- → 関数を 4 必須 + 2 optional → さらに「state は ambient で良い」 → 引数をほぼ消す
- → reduce / render が浮く名前 → p5 そのまま使えば良い (= setup / draw)
- → host だけで違うのは初期化と終了だけ → host.start / host.stop の 2 つ
- → state も global 的に扱えるから引数不要

最終確定 API は「host だけ 2 + 全員で p5 sketch」のシンプルな形に落ち着いた。

## API endpoint 一覧 (v667 実装)

| Method | Path | 用途 |
|---|---|---|
| GET  | `/api/cg2/kinds`                         | kind (ゲーム種類) 一覧 |
| POST | `/api/cg2/kinds`                         | 新規 kind 登録 (JS + 設定) |
| GET  | `/api/cg2/kinds/{slug}/script.js`        | JS module 配信 (認証不要、 dynamic import 用) |
| PATCH| `/api/cg2/kinds/{slug}`                  | 更新 (登録者 / admin) |
| DELETE | `/api/cg2/kinds/{slug}`                | 削除 (登録者 / admin) |
| GET  | `/api/cg2/kinds/{slug}/games`            | その kind の卓一覧 |
| POST | `/api/cg2/kinds/{slug}/games`            | 卓起案 |
| GET  | `/api/cg2/games/{id}`                    | 卓詳細 |
| POST | `/api/cg2/games/{id}/join`               | 参加 |
| POST | `/api/cg2/games/{id}/add-ai`             | AI プレイヤー追加 |
| POST | `/api/cg2/games/{id}/start`              | 開始 (= host.start() をキックする合図) |
| POST | `/api/cg2/games/{id}/cancel`             | ロビーキャンセル |
| POST | `/api/cg2/games/{id}/finalize`           | 終了通知 (`{winner_user_id?, notify_text}`) |
| GET  | `/api/cg2/games/{id}/shared?since={seq}` | 共有 state 差分取得 (500ms polling) |
| POST | `/api/cg2/games/{id}/shared`             | 共有 state 差分更新 (`{changes: {...}}`) |

## 関連

- v1 framework: [CUSTOM_GAMES.md](CUSTOM_GAMES.md) (現行動作中、 turn-based)
- v1 サンプル: `examples/custom-games/`
- v2 サンプル: `docs/cg2_sample_*.js`
