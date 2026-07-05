# 自作ウィジェット (custom_widgets) 開発ガイド

LabPay のホームに自分専用の小さなウィジェットを追加できる仕組み。 v666 から。
JS を 1 ファイル書いて DB に登録するだけで、ホームにカードとして表示されます。

> **API endpoint**: `/api/custom-widgets` 系。詳細は [api.md](api.md) を参照。全 API endpoint 一覧も同 doc。

```
ユーザが設定 → 🧩 ウィジェットセンター (/#/widgets) で新規登録
   │
   ▼ 名前 / アイコン / 説明 / JS コードを入力
   ▼ 登録 → custom_widgets テーブルに保存
   │
   ▼ ホームを開くと loadCustomWidgets() が有効化された widget を全部取得
   ▼ 各 widget の JS を動的 import + meta + render(root) を取得
   ▼ render(root) を refreshSec 秒ごとに呼ぶ (default 60)
```

PHP / SQL / サーバ作業は不要。 ssh も不要。 JS をコピペするだけで動きます。

## サンプルを動かす

LabPay → 設定 → 🧩 ウィジェットセンター → **「＋ 新規ウィジェット」**:

1. 「サンプルから取り込む」で `🕐 時計` を選択 → JS コード欄に中身が入る
2. 名前 / アイコンが推測で埋まる (= `🕐 時計` / `🕐`)
3. **登録** → ホームを開くと 1 秒おきに時刻が更新されるカードが出る

そのまま自分で編集して自由に改造できます。

## 開発者が書く 1 ファイル

```js
import { me, get, post, html } from '/js/widgets_api.js';

// 必須: ウィジェットのメタ情報
export const meta = {
  name: '🕐 時計',                  // 表示名
  description: '現在時刻を表示',  // 説明 (任意)
  refreshSec: 1,                    // 何秒おきに render を呼ぶか (default 60)
};

// 必須: 描画。 root はホームのカード内の div。中身を自由に mutate して OK。
export function render(root) {
  const now = new Date();
  root.innerHTML = `
    <div style="text-align:center; padding:8px">
      <div style="font-size:36px; font-family:monospace">${now.toLocaleTimeString('ja-JP')}</div>
      <div class="hint-sm">${html(me.name)} さん</div>
    </div>
  `;
}
```

書くのは **`meta` (export const) と `render(root)` (export function)** の 2 つだけ。

## import で使えるもの (`/js/widgets_api.js`)

| 名前 | 内容 |
|---|---|
| `me`        | 自分の情報。 `me.id` / `me.name` / `me.role` |
| `get(path)` | LabPay API を GET (例: `await get('/api/me/recruiting')`) |
| `post(path, body)` | POST |
| `patch(path, body)` / `del(path)` | PATCH / DELETE |
| `html(text)` | XSS 防止用 escape。文字列をテンプレに埋めるなら必ず通す |

## render(root) の約束事

- **同期** か **async** かどちらでも OK。 async なら API を呼んで描画する形にできる
- **root を mutate** する (= `root.innerHTML = '...'` で自由に書く)
- **エラーを throw** したら framework が `エラー: ...` を表示して次回リトライ
- **`refreshSec` 秒おきに自動で呼ばれる**。 1 = 1 秒 (時計等)、 60 = 1 分 (default、残高等)、 600 = 10 分 (ニュース系)

## meta の中身

```js
export const meta = {
  name: '...',           // 必須。表示名 (絵文字込みで OK)
  description: '...',    // 任意。ウィジェットセンター一覧で表示
  refreshSec: 60,        // 任意。 default 60
};
```

## サンプル (もうひとつ): 💰 残高

```js
import { get, html } from '/js/widgets_api.js';

export const meta = {
  name: '💰 残高',
  description: 'あなたの残高を表示',
  refreshSec: 60,
};

export async function render(root) {
  try {
    const me = await get('/api/auth/me');
    const bal = me.balance ?? 0;
    root.innerHTML = `
      <div style="text-align:center; padding:12px">
        <div class="hint-sm">あなたの残高</div>
        <div style="font-size:32px; font-weight:700; color:#7c3aed">${bal.toLocaleString()} pt</div>
      </div>
    `;
  } catch (e) {
    root.innerHTML = `<div class="hint">取得失敗: ${html(e.message)}</div>`;
  }
}
```

## アイデア (= こんなウィジェット作れる)

### 定番
- **今ラボにいる人** — `/api/presence` を呼んでアバターで並べる
- **直近の SNS 投稿** — `/api/posts?limit=3` を呼んで 3 件表示
- **誕生日カウントダウン** — `me.birthday_md` + 残日数
- **進行中のタスク** — `/api/me/asking` で自分起案タスク
- **天気** — 外部 API (取得元が CORS 許可していれば)
- **ToDo の残り** — `/api/me/todos` の未完件数だけ
- **OB の誕生日** — 別ユーザのメタを集計

### v615 以降で新登場の API を活用
- **📚 refs 読中一覧** — `/api/refs?status=reading&limit=5` で今読んでる論文のカード
- **🔬 SS のおすすめ論文** — 「今日の論文」として `/api/refs/ss_recommend` を週 1 実行 → 結果の上位 1 件を表示
- **📖 Overleaf 執筆進捗** — `/api/overleaf/projects` の 24h delta を「今日の執筆量」としてグラフで
- **📄 論文要約の新着** — `/api/ai/paper_recent` で全員の公開要約を stream
- **🎯 habit 今日の達成率** — `/api/habits` の未達成だけ出してチェック UI
- **🔎 Deep Research 進捗** — `/api/ai/deep_research/{id}/r/{token}` を polling で「まだ走ってる分」の進捗
- **📅 学会締切** — `/api/conf-deadlines/upcoming` を残日数順に
- **🏁 conquest 制覇率** — `/api/conquest/lists` の自分の進行率をバーで
- **⏱ タイマー一覧** — `/api/timers` で今動いてるやつを大きく表示

何を作っても OK。自分専用なので完成度は問われない、雑で良い。

## API パスの注意

ユーザ JS は **`/api/custom-widgets/{id}/script.js`** から配信されます。
LabPay の helper を取り込む時は必ず **絶対パス** で:

```js
// ✅
import { me, get } from '/js/widgets_api.js';

// ❌ (404)
import { me, get } from '../widgets_api.js';
```

## DB / 制限

- 1 ウィジェットの JS 上限: 100KB
- 「自分専用」 = owner_user_id で紐付け。他ユーザから見えない
- 有効化 / 無効化をトグルできる (= 一時的にホームから消したいとき)
- 削除はウィジェットセンターから

## トラブルシューティング

- **ホームに出ない**: ウィジェットセンターで「有効化」になっているか確認
- **エラー: ...**: render(root) で throw しているか、 `import` 先が違うか
- **更新が反映されない**: ウィジェットセンターで編集して保存し直す (updated_at で cache busting されて次回ホームアクセス時に新版が読まれる)
- **画像が出ない**: HTTPS 必須 (mixed content)、外部ドメインは CORS / CSP 制限がある
