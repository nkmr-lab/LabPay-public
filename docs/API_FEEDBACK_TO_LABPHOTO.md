# LabPay → LabPhoto API フィードバック (P1/P2/P4 実装後)

**発信元**: pay.nkmr.io (LabPay, v1234〜v1239)
**発信先**: photo.nkmr.io (LabPhoto)
**対象**: v109 で 提供 された APIs (`labpay/docs/API_RESPONSE_FROM_LABPHOTO.md` に 対する 実装後 の フィードバック)
**日付**: 2026-07-26

---

## まず: 素晴らしかった 点

- **CORS**: `.nkmr.io` 一括許可 + `credentials:'include'` で 何 の 問題 も なく 通った。 preflight 204 対応 も 完璧。
- **401 契約**: 302 で なく **JSON 401 + login URL** の 契約 は 大 正解。 fetch が HTML を 掴む 事故 ゼロ。
- **`random_photos` の seed 決定論**: 60s ホーム poll で チカチカ 抑止 が 期待通り 効いた。 `seed=YYYYMMDD` で 「今日 の 1 枚」ウィジェット が スムーズ に 動く。
- **`timeline&album=` の 古い順**: アルバム 先頭 から 読める 前提 と 一致、 pagination cursor (`next.before / next.before_id`) も シンプル で 使いやすい。
- **`albums` の 撮影日 新順**: LabPay 側 で 追加 sort ほぼ 不要 (念のため 明示化 済 v1239)。

---

## 🔴 最優先: 派生 (derivative) 欠損 で サムネ が 大量 に 404

**症状**: `#/photo/album/<slug>` の タイル 表示 で、 部分的 (体感 2〜3 割) の アセット で サムネ が 出ない。 原因 は `media.php` が 該当 kind の derivative row が 無い と 404 を 返す 仕様。

**根本原因 の 内訳** (LabPay v1236 で 状態 可視化 追加、 目視 で 分類 可能):
1. `thumb256` 未生成 だ が `view2048` は ある → LabPay 側 で fallback 描画 済 (v1235)
2. `thumb256` も `view2048` も 両方 無い → 完全 表示不可
3. 動画 の `poster` 未生成 → 動画 サムネ が 抜ける (これ が 一番 多い 感触)
4. `derive_state='pending'` (生成待ち) / `'failed'` (失敗) → LabPay 側 で 「⏳ 生成中」 / 「⚠ 生成失敗」の ラベル 表示 済

**依頼**:
### 1a. 派生 補完 バッチ を 走らせて ほしい
- 全 asset (`assets.deleted_at IS NULL`) に 対して 以下 を **強制 再生成 or 欠損分 のみ 追加生成**:
  - 画像: `thumb256`, `view2048`
  - 動画: `poster`, `video720`
- `derive_state='failed'` の 原因 別 集計 (壊れ ファイル / 巨大 動画 / ffmpeg エラー 等) が 出ると 移設 判断 に も 使える
- 時間 かかる もの (巨大 動画) は 後回し で 良い の で、 まず **画像 の thumb256** を 全体 に 揃える と UX 改善 が 一番 大きい

### 1b. `media.php` に 「あれば 何 か 返す」フォールバック モード
- `?fallback=1` (or 既定 で ON) で、 要求 kind が 無い 場合 に:
  - `size=thumb` → `thumb256` → `view2048` → 404
  - `size=medium` → `view2048` → `thumb256` → 404
  - 動画 `k=poster` → 存在する 静止画 派生 → 404
- 現状 は 単一 kind fixed 判定 の 404 で、 LabPay 側 で `<img onerror>` の 2 段 fallback を 書いて いる が、 サーバ側 で やって もらえる と 全 消費者 で 使い回せる

### 1c. `albums` レスポンス で `cover` が 派生 を 持って いる か を 明示
- 現状 `cover: 33210` (asset_id) の みで、 派生 の 有無 は 別 request しない と 分からない
- `cover_has_thumb: true` フラグ を 添えて くれると、 未 生成 の 場合 は 別 アセット (アルバム内 の thumb 済み 1 枚目) を 代替 表紙 に できる

---

## 🟡 中優先: `albums` の サーバ側 絞り込み

**現状**: 全件返却 (数百件 で 軽量 と 説明 あり)、 LabPay 側 で client-side filter で 対応済。

**将来 の 要望**:
- アルバム が 1000+ に 育った 時 に `?year=2025` / `?tag=合宿` / `?q=<部分一致>` を サーバ 側 で サポート
- **URL パラメータ を そのまま bookmark** できる の で 深リンク も 便利 (`#/photo?year=2025`)
- 実装 コスト 高ければ 500件 まで は 現状 の 全件 で 十分

優先度 低。

---

## 🟡 中優先: `random_photos` の フィルタ 拡張

**フォトフレーム (`#/photo/frame`) を 実装 して 気づいた こと**:

### 2a. `min_faces=1` フィルタ が 欲しい
- ラボ の フォトフレーム 用途 だ と 「人 が 写ってる 写真」 を 流したい 気持ち が 強い
- 現状 の random_photos は 風景 / 資料写真 も 均等 に 混じる
- `?min_faces=1` (1 人以上 顔検出) が あると 「ラボメン フォト フレーム」が 実現 できる

### 2b. `only_landscape=1` (or `min_width=1200`) フィルタ
- 横長 の 写真 だけ 流す と フォトフレーム が 綺麗
- 縦長 スマホ 写真 が 混じる と 左右 の 余白 が 大きく なる
- 実装 コスト 高ければ 後回し 可 (LabPay 側 の CSS で ある 程度 対処 可能)

### 2c. `type=image` (明示)
- 現状 「対象 は 画像・サムネ生成済みのみ」と 契約 で 動画 除外 されて いる が、 明示 パラメータ で 保証 して くれると 変更 検知 しやすい

---

## 🟢 P3 (人物検索) 実装 前 の 事前 相談

**LabPay 側 の P3 (`#/photo/person` 検索 + プロフィール) は まだ 未着手** ですが、 実装前 に 教えて ほしい 点:

### 3a. `person_profile` の `top_expressions` と `top_places` は 追加 して もらえる?
- 前回 「省略可」で 受けて もらった が、 実際 に UI 作る と 「この人 の 笑顔率」「よく 写る 場所」の 表示 は 目玉 機能
- FER+ データ が ある なら 表情 の 円グラフ 出したい
- 場所 は「クラスタ体系 が 要る」との こと だ が、 単に GPS 座標 の median と 半径 で ざっくり 「よく 撮影 される エリア」を 3〜5 個 返す だけ でも OK
- LabPhoto 側 の 実装コスト を 教えて もらえたら 優先度 相談 したい

### 3b. `people?q=` の 大小無視 は fullwidth/hiragana/katakana も 対応?
- 「なかむら」/「ナカムラ」/「中村」/「Nakamura」で 引ける か 事前 に 確認 したい
- 未対応 なら、 LabPay 側 で 各 表記 を 展開 して 複数 clause で OR 検索 する 実装 に なる (面倒)

### 3c. `person_photos` の cursor 挙動
- 「撮影日 新しい 順 + カーソル」で 分かった が、 「初回 の request」で before/before_id を 省略 すると 一番 新しい ところ から 返る 理解 で OK?
- (念のため 確認)

---

## 追加 の 小さな 気づき

### 4a. `person_profile.sample_photos[].thumb_url` が 相対 パス
- 他 の response 例 (albums, random_photos) と 同じ く 相対 パス で 返す 前提 か、 絶対 URL で 返す か を **統一** して 欲しい
- 現状 LabPay 側 で どちら でも 動く よう ヘルパ `absolutePhotoUrl()` を 用意 したが、 統一 されて いる と 消費者 が 楽

### 4b. `docs/API.md` の 完成度
- 依頼 に 対して きちんと 全 action の Request/Response を 文書化 して くれた の、 素晴らしい (毎回 grep しに 行かなくて 良い)。 感謝。
- 追記 して 欲しい 点: 各 action の **必要 権限** (認証済 で OK / admin only / 特定 kind の visibility) を 一覧 で 分かる 形 に

### 4c. `stats` エンドポイント
- `?action=stats` で `derive_state` の 集計 (pending / failed / done の 数)、 `has_thumb256=1` の 割合、 `has_view2048=1` の 割合 を 返して くれると、 LabPay 側 の 管理画面 で 見える化 できる
- 中村さん の 「移設 進捗 モニタ」に も なる

---

## LabPay 側 で 対応中/対応済 の こと (参考)

- P1 (`#/photo` アルバム 一覧 + 詳細) v1234〜v1239 実装済
- P2 (ホーム ウィジェット 「今日 の ラボ フォト」) v1237 実装済
- P4 (フォトフレーム、 Wake Lock、 スライド) v1237 実装済
- P3 (人物検索 + プロフィール) 未着手 — 上記 3a/3b/3c の 回答 を 受けて 着手
- LabPhoto v109 の CORS + fallback 401 契約 は 完璧、 追加要望なし

---

## 優先度 サマリ

| 優先度 | 内容 | 期待効果 |
|:------|:-----|:---------|
| 🔴 高 | 派生 補完 バッチ (thumb256 全揃え) | サムネ 未表示 の 大半 が 消える |
| 🔴 高 | `media.php` fallback (thumb ↔ view2048 自動) | 消費者 側 の workaround コード が 消える |
| 🟡 中 | `random_photos?min_faces=1` | フォトフレーム が 「ラボメン フォト」に 特化可 |
| 🟡 中 | `albums?cover_has_thumb` | 表紙 抜け の 代替 が 選べる |
| 🟡 中 | P3 `top_expressions` / `top_places` 復活 検討 | 人物 プロフィール が リッチ に |
| 🟢 低 | `albums` サーバ側 絞り込み (year/tag/q) | 1000件超 に なった 時 |
| 🟢 低 | `stats` の 派生 集計 | 移設 進捗 見える化 |

---

叩いてみて **とても スムーズ** に 統合 できた 一方 で、 派生 の 網羅性 が UX に 直撃 して いる 印象 です。 まず 1a/1b が 手 に 入る と 世界 が 変わり ます。 相談 & 議論 歓迎。
