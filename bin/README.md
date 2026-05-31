# LabPay scanner

各部屋に1台ずつ常時起動マシンを置き、1分毎にローカルサブネットをスキャンして
LabPay (`/api/presence/scan`) に MAC アドレスのリストを POST します。

## セットアップ (1部屋分)

1. 管理者画面 `https://pay.nkmr.io/#/admin` → 「部屋」セクション → 「部屋を追加」
   - `id` (例: `10F`)、`表示名` (例: `10階研究室`) を入れて作成
   - 表示される `scanner_token` を控える (一度しか出ない)
2. 常時起動マシンに `bin/` 一式をコピー
3. `scanner.config.sample.json` を `scanner.config.json` にコピーし、`scanner_token` を貼る
4. 手動で1回テスト:

   ```powershell
   # Windows
   python C:\path\to\labpay\bin\scanner.py
   ```
   ```bash
   # Linux/Mac
   python3 /path/to/labpay/bin/scanner.py
   ```

   `[scanner] room=10F subnet=192.168.50.0/24 observed=N -> HTTP 200` と出れば OK。

5. 定期実行を仕掛ける。

### Windows: Task Scheduler 登録 (PowerShell・管理者)

```powershell
$action  = New-ScheduledTaskAction -Execute 'python' -Argument 'C:\path\to\labpay\bin\scanner.py'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -RestartInterval (New-TimeSpan -Minutes 5) -RestartCount 3
Register-ScheduledTask -TaskName 'LabPay Scanner' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest
```

### Linux/Mac: cron (1分毎)

```cron
* * * * * /usr/bin/python3 /path/to/labpay/bin/scanner.py >> /var/log/labpay-scanner.log 2>&1
```

## 7階用の追加

同じ手順で `id: 7F` の部屋を作り、別マシンに置く scanner の config だけ書き換えれば OK。
スキャナ同士の通信は不要なので部屋間の経路は気にしなくてよい。

## トラブル

- `observed=0` が続く → 同じ WiFi に繋がっていないか、Windows ファイアウォールが
  ICMP を遮断している。`ping <gateway>` を試して、通らなければ ICMP 許可を確認
- HTTP 401 → `scanner_token` が間違い。admin で `token 再発行` をしてやり直し
- HTTP 404 unknown_room → `room_id` が typo / admin で部屋が消えている
- HTTPS 検証で落ちる → 通常起こらないが、社内 proxy 等があれば `LABPAY_URL` に
  プロキシ経由 URL を入れる等で対応

## 設定の上書き

`scanner.config.json` の値は環境変数 `LABPAY_*` で上書きできます (例: `LABPAY_ROOM_ID`)。
1台のマシンで複数部屋をスキャンする用途には対応していません (混在しないでください)。
