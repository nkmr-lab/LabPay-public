# LabPay → fund.nkmr.io API 修正 依頼

**発信元**: pay.nkmr.io (LabPay, v1250)
**発信先**: fund.nkmr.io
**日付**: 2026-07-27
**背景**: 中村さん報告「LabPay で fund.nkmr.io の アルバイト代 を 申請 しよう と すると 予算 の ロード に 失敗 します」

---

## 症状

LabPay 内 の アルバイト代 申請 (bait) や ドクター 支払い 追加 (my_fund) から
`fund.nkmr.io/api.php?action=budgets` を 叩く と、 「予算取得失敗: Unexpected token '<' ...」
と 出て 予算 プルダウン が 埋まらない。

**LabPay v1250 で workaround 済**: HTML 応答 を 検出 して 「fund.nkmr.io に 未 ログイン
です」 + 「🔓 fund を 別 タブ で 開く」 ボタン を 出す。 これ で ユーザ は fund を 開いて
ログイン → LabPay に 戻って リトライ、 で 動く ように なった。

## 根本原因

未認証 リクエスト に 対して **302 リダイレクト** で `auth.nkmr.io` へ 飛ばして いる。

```
GET /api.php?action=budgets
→ HTTP/1.1 302 Found
  Location: https://auth.nkmr.io/?action=sso&return=...
```

ブラウザ の `fetch({credentials:'include'})` は 302 を **透過的 に 追跡** し、 最終的 に
Google 認証 の HTML を 掴む。 それ を `r.json()` に 渡す と Syntax Error で 落ちる。

**CORS 自体 は 正しく 設定 済** (`Access-Control-Allow-Origin: https://pay.nkmr.io`
+ `Access-Control-Allow-Credentials: true` + `Vary: Origin`)。 問題 は 認証 応答 の 形式 だけ。

## お願い したい 修正

**photo.nkmr.io v109 が やった の と 同じ**、 API 経路 (`api.php`) に アクセス した
未認証 リクエスト に は **302 で なく 401 JSON** を 返して ください。

### 現状
```
HTTP/1.1 302 Found
Location: https://auth.nkmr.io/?action=sso&return=<...>
```

### 期待
```
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Access-Control-Allow-Origin: https://pay.nkmr.io
Access-Control-Allow-Credentials: true

{
  "ok": false,
  "error": "ログイン の 期限 が 切れました",
  "login": "https://auth.nkmr.io/?action=sso&return=<...>"
}
```

### 判定 の 目安
- リクエスト path が `/api.php` (または 明示的 に `?action=` を 含む) の 場合 に API モード
- または `Accept: application/json` を 見て も 良い

### PHP 実装 例
```php
// api.php 冒頭 (認証 check の 直前)
if (!is_logged_in()) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(401);
    echo json_encode([
        'ok' => false,
        'error' => 'ログイン の 期限 が 切れました',
        'login' => 'https://auth.nkmr.io/?action=sso&return=' . urlencode(current_url()),
    ]);
    exit;
}
```

## LabPay 側 の 対応 (実施済)

修正 後 は LabPay 側 で 401 JSON の `login` フィールド を 拾って、 confirm ダイアログ
「fund.nkmr.io に 未 ログイン です。 ログイン 画面 に 移動 しますか?」 を 出す 実装 に 変える
予定 (photo.nkmr.io の handler と 同じ パターン)。

## 参考

- 同 修正 を photo.nkmr.io v109 で 完了 (`labphotos/docs/API.md` 参照)
- 同 チーム 管理 だ と 思う ので 短時間 で 済む はず

以上、 お手隙 の 時 に お願い できれば。
