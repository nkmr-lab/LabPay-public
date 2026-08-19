# cast 連携 — LabPay 側の実装引き継ぎ

発表者のPC画面を LabPay のタイマー上に出すための、**LabPay 側で必要な作業**をまとめる。
cast 側 (cast.nkmr.io) は既に稼働していて、必要な口は全部空いている。

- cast の実体: `C:\Dropbox\Programs\Claude\cast\`（GitHub: nkmr-lab/cast）
- cast 本番: https://cast.nkmr.io/ （nkmr-dev, APP_VERSION 8, 2026-08-19時点）
- 作業対象: LabPay（`C:\Dropbox\Programs\Claude\labpay\`）

---

## 0. 最初に踏む地雷（必読）

**`timers_validate_image_url()` が cast のURLを弾く。** ここを直さないと何も始まらない。

`src/handlers/timers.php:35` の検証は「`/uploads/<file>.<ext>` か 自オリジンの HTTP」しか通さない。
cast の画像URL (`https://cast.nkmr.io/shot/<token>.jpg`) は 400 `bad_request` になる。

対応方針（**全面開放はしないこと**。任意のURLを許すと SSRF まがいの踏み台や外部トラッキングに使われる）:

```php
// v1335 の判定に「明示的に許した外部オリジン」を1本足す。
// cast の画像URL だけを、パス形まで固定して通す。
$isCast = (bool)preg_match(
    '#^https://cast\.nkmr\.io/shot/[A-Za-z0-9_\-]{16,64}\.jpg$#', $url
);
if (!$isHttp && !$isLocal && !$isCast) {
    throw new ApiException('bad_request', 'image_url は /uploads/<file>.<ext>、自 origin の HTTP、cast の画像URL のみ', 400);
}
```

ホスト名をベタ書きにせず `$cfg['app']['image_allow_hosts']` のような設定に逃がしてもよいが、
**パスの形まで固定する**のは変えないこと（`https://cast.nkmr.io/<なんでも>` を通すと意味が薄れる）。

---

## 1. cast 側が既に提供しているもの（LabPay から使える口）

### (a) 画像URL — 最新の1枚

```
GET https://cast.nkmr.io/shot/<token>.jpg
```

| 性質 | 内容 |
|---|---|
| 中身 | 配信中の画面の最新の1枚（JPEG, 送信側の原寸, 品質0.82） |
| 更新 | 画面が変わった時だけ。最短3秒間隔。止まっていれば更新なし |
| URL | **固定**。中身だけが入れ替わる |
| ヘッダ | `Cache-Control: no-store, max-age=0` |
| 終了時 | 送信者が切る / 1時間更新なし → **404** |
| トークン | 推測不能な長い文字列。6桁の視聴コードとは別物 |

発行手順（発表者の操作）: cast で配信開始 → 「最新の1枚を画像URLでも出す」をON → URLが表示される。

### (b) 受信ページ（iframe 用）

```
https://cast.nkmr.io/v?code=<6桁>
```

認証不要。ただし現在 cast 側が `Content-Security-Policy: frame-ancestors 'self'` を返すため、
**LabPay から iframe すると表示されない**。→ 下の「3. iframe」参照（cast 側の作業が必要）。

---

## 2. 実装その1: タイマーの画像を自動更新する（本命）

### いまの挙動

`public/js/views/public_timer.js:136-145`

```js
const imgWrap = document.getElementById('pt-image-wrap');
const imgEl   = document.getElementById('pt-image');
if (t.image_url) {
  if (imgEl.src !== t.image_url) imgEl.src = t.image_url;   // ← src が同じなら何もしない
  imgWrap.hidden = false;
  document.body.classList.add('pt-has-image');
}
```

`src` が変わらない限り再取得しないので、cast のURLを入れても**最初の1枚のまま固まる**。

### 必要な変更

cast の画像URLの時だけ、一定間隔でキャッシュバスターを付けて貼り直す。

```js
const CAST_SHOT = /^https:\/\/cast\.nkmr\.io\/shot\/[A-Za-z0-9_-]{16,64}\.jpg$/;
let _shotTimer = null, _shotBase = '';

function syncLiveImage(url) {
  if (url && CAST_SHOT.test(url)) {
    if (_shotBase !== url) { _shotBase = url; refreshShot(); }
    if (!_shotTimer) _shotTimer = setInterval(refreshShot, 5000);
  } else {
    clearInterval(_shotTimer); _shotTimer = null; _shotBase = '';
  }
}

function refreshShot() {
  if (!_shotBase) return;
  // 裏で読み終えてから差し替える。imgEl.src を直接書き換えると
  // 読み込み中に絵が消えて、プロジェクタ上でちらつく。
  const next = new Image();
  next.onload  = () => { document.getElementById('pt-image').src = next.src; };
  next.onerror = () => { /* 404(配信終了)。最後の絵をそのまま残す */ };
  next.src = _shotBase + '?t=' + Date.now();
}
```

**必ず守ること**

- **直接 `imgEl.src` を書き換えない。** 裏の `Image` で読み終えてから差し替える（ちらつき防止）
- 間隔は **5秒**。cast 側が最短3秒でしか更新しないので、それより短くしても無駄に取りに行くだけ
- 画面を離れる時に **`clearInterval`**。SPAなのでビュー破棄フックで確実に
- **404 を「消す」扱いにしない。** 配信が終わっただけなので、最後の絵を残す（`onerror` で何もしない）のが親切

### 同じ処理が要る場所

- `public/js/views/public_timer.js` — public-timer（本命）
- `public/js/views/timers.js:697-698` — ログイン側のタイマー詳細にも同じ `imgEl.src` 直書きがある

共通関数（例: `public/js/lib/live_image.js`）に切り出して両方から呼ぶのが吉。

### UI

タイマー編集の画像欄は既にある（`timers.image_url` / `PATCH /api/timers/<id>/image`）。
**URL を貼れるようにするだけで動く**。今はアップロードUIしかないなら、URL直接入力の口を1つ足す。
「cast の画像URLを貼ると、発表者の画面がここに出ます」と添えると迷わない。

---

## 3. 実装その2: iframe でライブ表示

画像URLは3〜5秒遅れる。デモを見せる場面など、遅延0.3秒で見せたい時用。

**cast 側の作業（依頼が必要）**: `/etc/httpd/conf.d/zz-cast-nkmr.conf` の
`Content-Security-Policy: frame-ancestors 'self'` を
`frame-ancestors 'self' https://pay.nkmr.io` に変更。cast 側で対応する。

**LabPay 側**:

```html
<iframe src="https://cast.nkmr.io/v?code=123456"
        allow="autoplay; fullscreen"
        style="width:100%;aspect-ratio:16/9;border:0;background:#000"></iframe>
```

注意点:

- 受信ページは**最初に1タップ**が要る（自動再生とスリープ抑止の許可を取るため）。iframe 内でも同じ
- 6桁コードを LabPay 側で持つ必要がある。タイマーに `cast_code` 列を足すか、image_url と同じ欄で兼ねるか要検討
- タイマーと並べて常時出すなら**画像URL方式のほうが軽い**（iframe はWebRTC接続を1本張り続ける）

---

## 4. セキュリティ・運用の注意

- **public-timer は認証なし。** 短縮コードを知っていれば誰でも見られる。
  タイマーに画面を貼った時点で「タイマーを見られる人 = 発表者の画面を見られる人」になる
- 画像URLのトークン自体は推測不能。弱いのは**タイマー側の4桁コード**（総当たり可能な幅）
- 発表者は cast 側でいつでも画像URLを切れる（切ると即404）。**外部の場ではこれが最後の砦**
- LabPay 側は画像URLを DB に保存する。**配信が終わっても URL は残る**ので、
  古いタイマーに死んだURLが残り続ける。気になるなら 404 が続いたら image_url を消す運用/バッチを検討

---

## 5. 動作確認の手順

1. PC で https://cast.nkmr.io/ を開き「配信を開始」
2. 「最新の1枚を画像URLでも出す」を ON → 表示されたURLをコピー
3. LabPay でタイマーを作り、image_url にそのURLを設定（**0章の修正が入っていないと400で弾かれる**）
4. public-timer を開く → PC側の画面を変えて **5秒以内に絵が変わる**ことを確認
5. PC側でチェックを外す → 404 になっても**最後の絵が残り、画面が崩れない**ことを確認
6. タイマー画面から離れて戻る → `setInterval` が二重に走っていないことを確認（更新が倍速になっていないか）

---

## 6. 参考

- cast の設計・運用: cast リポジトリの `README.md`
- cast 側の関連ファイル: `public/shot.php`（画像URLの受け口）, `public/send.js` の「最新の1枚を画像URLで出す」節
- cast の版は反映のたびに +1。ヘッダに `vNN` が出る
