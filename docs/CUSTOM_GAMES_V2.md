# 自作ゲーム v2 framework (cg2) 設計

> **ステータス**: 設計 確定 / 実装 未着手 (2026-06-17 時点)。 サンプル 4 件 は docs/cg2_sample_*.js に 用意 済。

LabPay の v1 自作ゲーム framework (cg_ui / custom_games) を 全面 再設計 した もの。
**p5.js で 描画**、 **共有 state を 自動 同期** する 「准 リアルタイム」 multiplayer の 仕組み。

## v1 と v2 の 違い

| | v1 (cg_ui) | v2 (cg2) |
|---|---|---|
| 描画 | HTML を 返す `draw(state, ctx)` | p5.js instance mode の `sketch(p)` |
| state | `applyMove(state, uid, move)` の 純 関数 で 遷移 | `sharedValues` を 直接 mutate (auto-sync) |
| 引数 | reduce / draw に 4 引数 ずつ | ほぼ なし (state は ambient) |
| 同期 | turn-based、 1 手 = POST + polling | 准 リアルタイム (500ms 差分 polling) |
| 終了 | action の return で `finished: true, winner: ...` | `sharedValues.ended = true` → host.stop |
| ライフサイクル | setup / action / draw | host.start / host.stop + p5 setup / draw / event |
| AI | turn-based の `aiMove` | 唯一 の 人間 が ローカル で 動かす (mixed なし) |
| 観戦者 | あり | なし |

## 開発者 が 書く 1 ファイル (最小)

```js
import { players, myID, isHost, sharedValues, localValues, notifyResult, host } from '/js/cg2.js';

// host だけ で 1 回 (起案者 の ブラウザ で)。 sharedValues 初期化。
host.start = () => {
  sharedValues.cells = Array(9).fill(null);
  sharedValues.order = [...players].map(p => p.uid).sort(() => Math.random() - 0.5);  // 先手 後攻 ランダム
  sharedValues.turnUid = sharedValues.order[0];
  sharedValues.ended = false;
};

// host だけ で 1 回 (sharedValues.ended = true で 呼ばれる)。 結果 を 1 回 notify。
host.stop = () => {
  if (sharedValues.winnerUid) {
    const w = players.find(p => p.uid === sharedValues.winnerUid);
    notifyResult(`${w.name} の 勝ち`, { winnerUid: w.uid });
  } else {
    notifyResult('引き分け');
  }
};

// 全 client で p5 sketch。 framework が hostStart 完了 + 同期 完了 を 待って から new p5(sketch) する。
export default function sketch(p) {
  p.setup = () => p.createCanvas(300, 300);
  p.draw = () => {
    // sharedValues / localValues / players / myID を 自由 に 読む
  };
  p.mousePressed = () => {
    if (sharedValues.turnUid !== myID) return;
    // sharedValues を mutate → 自動 同期
    sharedValues.cells[clickedCell] = myID;
    if (didWin()) {
      sharedValues.winnerUid = myID;
      sharedValues.ended = true;     // ← framework が 検知 して host.stop へ
    }
  };
}
```

書く 関数 は **`host.start` + `host.stop` + `sketch` (p5 instance) の 3 つ**。

## framework が 提供 する もの (`/js/cg2.js`)

| 名前 | 内容 |
|---|---|
| `players` | 参加者 配列 `[{uid, name, is_ai}, ...]` (= system 管理) |
| `myID`    | 自分 の uid (数値)。 名前 等 は `players.find(p => p.uid === myID).name` で 引く |
| `isHost`  | 自分 が 起案者 か どうか (boolean) |
| `sharedValues` | 共有 state。 mutate する と auto-sync (deep Proxy)、 ロック なし 最終 書き込み 勝ち |
| `localValues`  | 個人 state。 sync しない、 揮発 (リロード で 消える) |
| `notifyResult(text, opts?)` | 結果 通知。 `host.stop` の 中 でのみ 呼ぶ |
| `host` | `host.start = ...`, `host.stop = ...` を 代入 する 受け皿 |

## ライフサイクル

```
host が ページ を 開く
  ↓
framework が host.start() を 呼ぶ        ← sharedValues 初期化
  ↓
framework が server に sharedValues を POST
  ↓
host で new p5(sketch, container)         ← setup() → draw() ループ
  ↓
他 の player が ページ を 開く
  ↓
framework が server から sharedValues を pull
  ↓
sharedValues が 揃う まで 「待機中…」 表示
  ↓
non-host で new p5(sketch, container)     ← setup() → draw() ループ

(プレイ 中: 各 client で sharedValues mutate → 500ms 差分 同期)

sharedValues.ended = true を 立てる
  ↓
framework が 検知 → host で host.stop() を 呼ぶ
  ↓
host.stop の 中 で notifyResult を 1 回 呼ぶ
  ↓
framework が 場代 配分 / 通知 / 履歴 記録 を 実行
```

## host の 定義

- **host = 起案者 で 確定** (= ゲーム を 作った 人)
- host が 途中 で 抜けたら **ゲーム 終了** (= host.stop で 強制 終了)

## CPU 戦 の 扱い

- 「Player x 2 + CPU x 2」 みたい な ミックス は **不可**
- CPU が いる 場合 は **人間 は 1 人** だけ (= host)
- AI は **唯一 の 人間 = host の ブラウザ** で ローカル に 計算 する
- 例 (マルバツ):
  ```js
  // sketch の draw 内 で:
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

## 順番 の ランダム 化

`host.start` で `sharedValues.order` に シャッフル した uid 配列 を 入れる。 これ で 「先手 が 起案者 と は 限ら ない」 が 全 ゲーム で 統一 的 に 実現:

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

## sharedValues の 同期 方式

- **polling 500ms + 差分**
- POST `/api/cg2/games/{id}/shared` body: `{changes: {key: value, ...}}` (差分 のみ)
- GET `/api/cg2/games/{id}/shared?since={seq}` → 200 (変更) / 304 (なし)
- **ロック なし**、 最終 書き込み 勝ち
- ゲーム ロジック 側 で 「同じ key を 2 人 が 同時 に 書か ない」 設計 (= セル 別 key で 分ける 等) で 回避

## 「結果 通知」 = `notifyResult(text, opts?)`

```js
notifyResult('時間切れ - 引き分け');
notifyResult(`${winner.name} の 勝ち`, { winnerUid: 42 });
notifyResult('全員 完走', { ranking: [{uid: 42, rank: 1}, ...] });
```

- `text` (必須): Slack / 通知 / 履歴 で 表示 する 文字列
- `opts.winnerUid` (任意): 集計 用 単一 勝者
- `opts.ranking` (任意): 集計 用 順位 表

## サンプル (docs/cg2_sample_*.js)

| ファイル | ゲーム | プレイヤー | 確認 ポイント |
|---|---|---|---|
| [cg2_sample_tictactoe.js](cg2_sample_tictactoe.js) | マルバツ | 2 人 (CPU 戦 対応) | order shuffle、 myID、 isHost で AI 駆動 |
| [cg2_sample_nim.js](cg2_sample_nim.js) | ニム (misère) | 2 人 (CPU 戦 対応) | 必勝 戦略 AI、 ボタン UI |
| [cg2_sample_lights_out.js](cg2_sample_lights_out.js) | ライツアウト | 1 人 (ソロ) | order / turnUid 不要、 sharedValues は 「自分専用 だが 持続」 |
| [cg2_sample_sugoroku.js](cg2_sample_sugoroku.js) | すごろく | 4 人 (CPU 戦 対応) | 着席 順 shuffle、 トラック 描画 |

## 既存 4 ゲーム の 移植

実装 着手 時 に v1 の 既存 サンプル (マルバツ / ニム / ライツアウト / すごろく) を v2 で **差し替え**。 v1 cg_ui は しばらく 並走 → 全部 v2 移行 で 撤去。

## 設定 (= JS の 外 に 持つ もの)

JS で **書か ない** もの = `custom_game_kinds` 行 で 設定 する:
- 人数 上限 / 下限
- 募集 方法 (公開 / 招待 / 部屋番号 等)
- 場代 金額
- 場代 配分 比率 (提供者 / SYSTEM)

開発者 は 「参加者 / 共有 情報 / 結果」 の 3 点 だけ JS で 書く。 募集 や 課金 は framework 側 に 寄せる。

## なぜ こう なった か (経緯 メモ)

- v1 cg_ui の `sketch({setup, draw, action, players})` で 引数 が 多い / 複雑 という 不満
- 「他 の ゲーム 基盤 (boardgame.io / Colyseus 等) は どう してる?」 という 議論 から
- → 関数 を 4 必須 + 2 optional → さらに 「state は ambient で 良い」 → 引数 を ほぼ 消す
- → reduce / render が 浮く 名前 → p5 そのまま 使えば 良い (= setup / draw)
- → host だけ で 違う のは 初期化 と 終了 だけ → host.start / host.stop の 2 つ
- → state も global 的 に 扱える から 引数 不要

最終 確定 API は 「host だけ 2 + 全員 で p5 sketch」 の シンプル な 形 に 落ち着いた。

## 関連

- v1 framework: [CUSTOM_GAMES.md](CUSTOM_GAMES.md) (= 現行 動作 中)
- v1 サンプル: `examples/custom-games/`
- v2 サンプル: `docs/cg2_sample_*.js`
