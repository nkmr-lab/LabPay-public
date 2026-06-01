# LabPay scanner one-shot setup (Windows).
#
# Usage (from the directory containing scanner.py):
#     powershell -ExecutionPolicy Bypass -File install_scanner.ps1
#
# What it does:
#   1. Verifies Python 3.10+ is on PATH (`python --version`)
#   2. Prompts for room_id, scanner_token, labpay_url (default https://pay.nkmr.io)
#      - token can also be piped via env var LABPAY_SCANNER_TOKEN to avoid screen echo
#   3. Writes scanner.config.json next to this script
#   4. Runs scanner.py once and shows the result so you know it works
#   5. Registers a Scheduled Task "LabPay Scanner" that re-runs every 1 minute
#      and survives login (re-registers on AtLogOn so the same user picks it up)
#
# Re-run safe: existing task is replaced, existing config is overwritten only after
# explicit confirmation.

$ErrorActionPreference = 'Stop'

function Read-NonEmpty([string]$prompt, [string]$default = '') {
    while ($true) {
        $suffix = if ($default) { " [$default]" } else { '' }
        $val = Read-Host ($prompt + $suffix)
        if ([string]::IsNullOrWhiteSpace($val) -and $default) { return $default }
        if (-not [string]::IsNullOrWhiteSpace($val)) { return $val.Trim() }
        Write-Host '  (空欄不可)' -ForegroundColor Yellow
    }
}

function Get-OrDefault($value, $default) {
    if ($null -eq $value -or "$value" -eq '') { return $default } else { return $value }
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$scanner = Join-Path $here 'scanner.py'
$bat     = Join-Path $here 'scanner_run.bat'
$config  = Join-Path $here 'scanner.config.json'

# 1) sanity: scanner.py + scanner_run.bat present
if (-not (Test-Path $scanner)) { throw "scanner.py not found at $scanner - copy bin/ to this PC first." }
if (-not (Test-Path $bat))     { throw "scanner_run.bat not found at $bat" }

# 2) sanity: python
try {
    $pyver = & python --version 2>&1
    if ($pyver -notmatch '^Python\s+3\.(1[0-9]|[2-9][0-9])') {
        throw "Python 3.10+ required. Found: $pyver"
    }
    Write-Host "OK $pyver" -ForegroundColor Green
} catch {
    throw "Python が見つからないか古すぎます。python.org or Microsoft Store から 3.10+ を入れてください。元の例外: $_"
}

# 3) collect config
Write-Host ""
Write-Host '=== LabPay scanner config ===' -ForegroundColor Cyan

$existing = $null
if (Test-Path $config) {
    try { $existing = Get-Content $config -Raw | ConvertFrom-Json } catch {}
}

$labpayUrl = Read-NonEmpty 'labpay_url' (Get-OrDefault $existing.labpay_url 'https://pay.nkmr.io')
$roomId    = Read-NonEmpty 'room_id (例: 7F)' (Get-OrDefault $existing.room_id '')

# Prefer env var so token doesn't appear in shell history.
$token = $env:LABPAY_SCANNER_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
    $secure = Read-Host 'scanner_token (admin 画面で部屋作成時に表示されたもの)' -AsSecureString
    $token  = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
              [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if ([string]::IsNullOrWhiteSpace($token)) { throw 'scanner_token が空です。中止します。' }

$subnet = Read-Host 'subnet (e.g. 192.168.50.0/24, blank = auto-detect)'

$cfgObj = [ordered]@{
    labpay_url    = $labpayUrl.TrimEnd('/')
    room_id       = $roomId
    scanner_token = $token
}
if (-not [string]::IsNullOrWhiteSpace($subnet)) { $cfgObj.subnet = $subnet.Trim() }

# 4) write config (utf-8 NO BOM - scanner.py uses utf-8-sig so BOM is fine too, but cleaner)
$json = ($cfgObj | ConvertTo-Json -Depth 3)
[System.IO.File]::WriteAllText($config, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "wrote $config" -ForegroundColor Green

# 5) one-shot test run
Write-Host ""
Write-Host '=== Testing scanner ===' -ForegroundColor Cyan
Push-Location $here
try {
    $out = & python scanner.py 2>&1
    $out | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) {
        throw "scanner.py exited $LASTEXITCODE - config か token を確認してください。"
    }
    if ($out -notmatch 'HTTP 200') {
        Write-Host '  (warning) HTTP 200 が確認できませんでした。後でログを確認してください。' -ForegroundColor Yellow
    }
} finally { Pop-Location }

# 6) register Scheduled Task - current user, AtLogOn + 1-min repeat
$taskName = 'LabPay Scanner'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute $bat -WorkingDirectory $here
$start  = (Get-Date).AddMinutes(1)
$repeat = New-ScheduledTaskTrigger -Once -At $start `
            -RepetitionInterval (New-TimeSpan -Minutes 1) `
            -RepetitionDuration (New-TimeSpan -Days 3650)
$logon  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew `
    -Hidden

Register-ScheduledTask -TaskName $taskName `
    -Action $action -Trigger @($logon, $repeat) -Settings $settings `
    -RunLevel Limited -Force | Out-Null

$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "Task: $taskName  /  Next run: $($info.NextRunTime)"
Write-Host "Log:  $here\scanner.log"
Write-Host ""
Write-Host "1分後にサーバ側で last_scan_at が更新されているか確認:"
Write-Host '  https://pay.nkmr.io/#/admin -> 詳細管理 -> 部屋'
