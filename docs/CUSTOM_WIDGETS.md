# 自作 ウィジェット (custom_widgets) 開発 ガイド

LabPay の ホーム に 自分 専用 の 小さな ウィジェット を 追加 できる 仕組み。 v666 から。
JS を 1 ファイル 書いて DB に 登録 する だけ で、 ホーム に カード として 表示 されます。

> **API endpoint**: `/api/custom-widgets` 系。 詳細 は [api.md](api.md) を 参照。 全 API endpoint 一覧 も 同 doc。

```
ユーザ が 設定 → 🧩 ウィジェット センター (/#/widgets) で 新規 登録
   │
   ▼ 名前 / アイコン / 説明 / JS コード を 入力
   ▼ 登録 → custom_widgets テーブル に 保存
   │
   ▼ ホーム を 開く と loadCustomWidgets() が 有効化 された widget を 全部 取得
   ▼ 各 widget の JS を 動的 import + meta + render(root) を 取得
   ▼ render(root) を refreshSec 秒 ごと に 呼ぶ (default 60)
```

PHP / SQL / サーバ 作業 は 不要。 ssh も 不要。 JS を コピペ するだけ で 動きます。

## サンプル を 動かす

LabPay → 設定 → 🧩 ウィジェット センター → **「＋ 新規 ウィジェット」**:

1. 「サンプル から 取り込む」 で `🕐 時計` を 選択 → JS コード 欄 に 中身 が 入る
2. 名前 / アイコン が 推測 で 埋まる (= `🕐 時計` / `🕐`)
3. **登録** → ホーム を 開く と 1 秒 おき に 時刻 が 更新 される カード が 出る

その まま 自分で 編集 して 自由 に 改造 できます。

## 開発者 が 書く 1 ファイル

```js
import { me, get, post, html } from '/js/widgets_api.js';

// 必須: ウィジェット の メタ 情報
export const meta = {
  name: '🕐 時計',                  // 表示名
  description: '現在 時刻 を 表示',  // 説明 (任意)
  refreshSec: 1,                    // 何 秒 おき に render を 呼ぶ か (default 60)
};

// 必須: 描画。 root は ホーム の カード 内 の div。 中身 を 自由 に mutate して OK。
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

書く のは **`meta` (export const) と `render(root)` (export function)** の 2 つ だけ。

## import で 使える もの (`/js/widgets_api.js`)

| 名前 | 内容 |
|---|---|
| `me`        | 自分 の 情報。 `me.id` / `me.name` / `me.role` |
| `get(path)` | LabPay API を GET (例: `await get('/api/me/recruiting')`) |
| `post(path, body)` | POST |
| `patch(path, body)` / `del(path)` | PATCH / DELETE |
| `html(text)` | XSS 防止 用 escape。 文字列 を テンプレ に 埋める なら 必ず 通す |

## render(root) の 約束 事

- **同期** か **async** か どちら でも OK。 async なら API を 呼んで 描画 する 形 に できる
- **root を mutate** する (= `root.innerHTML = '...'` で 自由 に 書く)
- **エラー を throw** したら framework が `エラー: ...` を 表示 して 次回 リトライ
- **`refreshSec` 秒 おき に 自動 で 呼ばれる**。 1 = 1 秒 (時計 等)、 60 = 1 分 (default、 残高 等)、 600 = 10 分 (ニュース 系)

## meta の 中身

```js
export const meta = {
  name: '...',           // 必須。 表示名 (絵文字 込み で OK)
  description: '...',    // 任意。 ウィジェット センター 一覧 で 表示
  refreshSec: 60,        // 任意。 default 60
};
```

## サンプル (もう ひとつ): 💰 残高

```js
import { get, html } from '/js/widgets_api.js';

export const meta = {
  name: '💰 残高',
  description: 'あなた の 残高 を 表示',
  refreshSec: 60,
};

export async function render(root) {
  try {
    const me = await get('/api/auth/me');
    const bal = me.balance ?? 0;
    root.innerHTML = `
      <div style="text-align:center; padding:12px">
        <div class="hint-sm">あなた の 残高</div>
        <div style="font-size:32px; font-weight:700; color:#7c3aed">${bal.toLocaleString()} pt</div>
      </div>
    `;
  } catch (e) {
    root.innerHTML = `<div class="hint">取得 失敗: ${html(e.message)}</div>`;
  }
}
```

## アイデア (= こんな ウィジェット 作れる)

### 定番
- **今 ラボ に いる 人** — `/api/presence` を 呼んで アバター で 並べる
- **直近 の SNS 投稿** — `/api/posts?limit=3` を 呼んで 3 件 表示
- **誕生日 カウントダウン** — `me.birthday_md` + 残 日 数
- **進行中 の タスク** — `/api/me/asking` で 自分 起案 タスク
- **天気** — 外部 API (取得 元 が CORS 許可 して いれば)
- **ToDo の 残り** — `/api/me/todos` の 未完 件数 だけ
- **OB の 誕生日** — 別ユーザ の メタ を 集計

### v615 以降 で 新登場 の API を 活用
- **📚 refs 読中 一覧** — `/api/refs?status=reading&limit=5` で 今 読んで る 論文 の カード
- **🔬 SS の おすすめ 論文** — 「今日 の 論文」 として `/api/refs/ss_recommend` を 週 1 実行 → 結果 の 上位 1 件 を 表示
- **📖 Overleaf 執筆 進捗** — `/api/overleaf/projects` の 24h delta を 「今日 の 執筆量」 として グラフ で
- **📄 論文要約 の 新着** — `/api/ai/paper_recent` で 全員 の 公開要約 を stream
- **🎯 habit 今日 の 達成 率** — `/api/habits` の 未達成 だけ 出して チェック UI
- **🔎 Deep Research 進捗** — `/api/ai/deep_research/{id}/r/{token}` を polling で 「まだ 走ってる 分」 の 進捗
- **📅 学会 締切** — `/api/conf-deadlines/upcoming` を 残 日数 順 に
- **🏁 conquest 制覇 率** — `/api/conquest/lists` の 自分 の 進行率 を バー で
- **⏱ タイマー 一覧** — `/api/timers` で 今 動いてる やつ を 大きく 表示

何 を 作って も OK。 自分 専用 なので 完成度 は 問われ ない、 雑 で 良い。

## API パス の 注意

ユーザ JS は **`/api/custom-widgets/{id}/script.js`** から 配信 されます。
LabPay の helper を 取り込む 時 は 必ず **絶対 パス** で:

```js
// ✅
import { me, get } from '/js/widgets_api.js';

// ❌ (404)
import { me, get } from '../widgets_api.js';
```

## DB / 制限

- 1 ウィジェット の JS 上限: 100KB
- 「自分専用」 = owner_user_id で 紐付け。 他 ユーザ から 見え ない
- 有効化 / 無効化 を トグル できる (= 一時 的 に ホーム から 消したい とき)
- 削除 は ウィジェット センター から

## トラブル シューティング

- **ホーム に 出ない**: ウィジェット センター で 「有効化」 に なって いる か 確認
- **エラー: ...**: render(root) で throw して いる か、 `import` 先 が 違う か
- **更新 が 反映 されない**: ウィジェット センター で 編集 して 保存 し直す (updated_at で cache busting されて 次回 ホーム アクセス 時 に 新版 が 読まれる)
- **画像 が 出ない**: HTTPS 必須 (mixed content)、 外部 ドメイン は CORS / CSP 制限 が ある
