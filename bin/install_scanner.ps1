# LabPay scanner one-shot setup (Windows).
#
# Usage (from the directory containing scanner.py):
#     powershell -ExecutionPolicy Bypass -File install_scanner.ps1
#
# What it does:
#   1. Verifies Python 3.10+ is on PATH
#   2. Prompts for room_id, scanner_token, labpay_url
#      (env var LABPAY_SCANNER_TOKEN can pre-fill the token)
#   3. Writes scanner.config.json next to this script
#   4. Runs scanner.py once and shows the result
#   5. Registers a Scheduled Task "LabPay Scanner" that re-runs every 1 minute
#
# Re-run safe: the existing task is replaced. The script is intentionally
# ASCII-only so it parses under Windows PowerShell 5.1 without a UTF-8 BOM.

$ErrorActionPreference = 'Stop'

function Read-NonEmpty([string]$prompt, [string]$default = '') {
    while ($true) {
        $suffix = if ($default) { " [$default]" } else { '' }
        $val = Read-Host ($prompt + $suffix)
        if ([string]::IsNullOrWhiteSpace($val) -and $default) { return $default }
        if (-not [string]::IsNullOrWhiteSpace($val)) { return $val.Trim() }
        Write-Host '  (cannot be blank)' -ForegroundColor Yellow
    }
}

function Get-OrDefault($value, $default) {
    if ($null -eq $value -or "$value" -eq '') { return $default } else { return $value }
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$scanner = Join-Path $here 'scanner.py'
$config  = Join-Path $here 'scanner.config.json'

# 1) sanity: scanner.py present
if (-not (Test-Path $scanner)) { throw "scanner.py not found at $scanner - copy bin/ to this PC first." }

# 2) sanity: python
try {
    $pyver = & python --version 2>&1
    if ($pyver -notmatch '^Python\s+3\.(1[0-9]|[2-9][0-9])') {
        throw "Python 3.10+ required. Found: $pyver"
    }
    Write-Host "OK $pyver" -ForegroundColor Green
} catch {
    throw "Python not found or too old. Install Python 3.10+ from python.org or Microsoft Store. Inner: $_"
}

# 3) collect config
Write-Host ""
Write-Host '=== LabPay scanner config ===' -ForegroundColor Cyan

$existing = $null
if (Test-Path $config) {
    try { $existing = Get-Content $config -Raw | ConvertFrom-Json } catch {}
}

$labpayUrl = Read-NonEmpty 'labpay_url' (Get-OrDefault $existing.labpay_url 'https://pay.nkmr.io')
$roomId    = Read-NonEmpty 'room_id (e.g. 7F)' (Get-OrDefault $existing.room_id '')

# Token: prefer env var; otherwise reuse the one in the existing config (if any);
# otherwise prompt. This is the bit that bites people on re-runs: the admin UI shows
# the token only once, so prompting again would force a token rotation.
$token = $env:LABPAY_SCANNER_TOKEN
if ([string]::IsNullOrWhiteSpace($token) -and $existing -and $existing.scanner_token) {
    Write-Host ''
    Write-Host "An existing scanner_token was found in $config." -ForegroundColor Green
    $reuse = Read-Host 'Reuse it? [Y/n]'
    if ($reuse -eq '' -or $reuse -match '^[Yy]') {
        $token = $existing.scanner_token
        Write-Host '  (reusing existing token)' -ForegroundColor Green
    }
}
if ([string]::IsNullOrWhiteSpace($token)) {
    $secure = Read-Host 'scanner_token (one-shot value shown when the room was created in admin)' -AsSecureString
    $token  = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
              [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if ([string]::IsNullOrWhiteSpace($token)) { throw 'scanner_token is empty. Aborting.' }

$subnet = Read-Host 'subnet (e.g. 192.168.50.0/24, blank = auto-detect)'

$cfgObj = [ordered]@{
    labpay_url    = $labpayUrl.TrimEnd('/')
    room_id       = $roomId
    scanner_token = $token
}
if (-not [string]::IsNullOrWhiteSpace($subnet)) { $cfgObj.subnet = $subnet.Trim() }

# 4) write config (utf-8 without BOM)
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
        throw "scanner.py exited $LASTEXITCODE - check config or token."
    }
    if ($out -notmatch 'HTTP 200') {
        Write-Host '  (warning) HTTP 200 not seen. Check the log later.' -ForegroundColor Yellow
    }
} finally { Pop-Location }

# 6) register Scheduled Task - current user, AtLogOn + 1-min repeat
# Use pythonw.exe (windowless variant) so the task does not flash a console window
# every minute. scanner.py writes its own scanner.log.
$pythonExe = (Get-Command python).Source
$pythonDir = Split-Path -Parent $pythonExe
$pythonw   = Join-Path $pythonDir 'pythonw.exe'
if (-not (Test-Path $pythonw)) {
    Write-Host "WARNING: pythonw.exe not found next to python.exe at $pythonDir." -ForegroundColor Yellow
    Write-Host "Falling back to python.exe (a brief console window will appear each minute)." -ForegroundColor Yellow
    $pythonw = $pythonExe
}

$taskName = 'LabPay Scanner'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$scanner`"" -WorkingDirectory $here
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
Write-Host "Verify in admin: https://pay.nkmr.io/#/admin -> rooms -> last_scan_at should refresh within a minute."
