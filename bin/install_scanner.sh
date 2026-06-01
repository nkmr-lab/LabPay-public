#!/usr/bin/env bash
# LabPay scanner one-shot setup (Linux / macOS).
#
# Usage (from any directory):
#     bash install_scanner.sh
#
# What it does:
#   1. Verifies python3 (>=3.10) is available
#   2. Prompts for room_id / scanner_token / labpay_url
#      — set LABPAY_SCANNER_TOKEN in the environment to avoid the prompt
#   3. Writes scanner.config.json next to this script
#   4. Runs scanner.py once to verify
#   5. Installs a crontab entry "* * * * *" for the current user
#
# Re-run safe: existing crontab line is replaced, existing config is overwritten only
# after explicit confirmation.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
scanner="$here/scanner.py"
config="$here/scanner.config.json"

# 1) sanity
[[ -f "$scanner" ]] || { echo "scanner.py not found at $scanner — copy bin/ to this host first." >&2; exit 1; }

# 2) python
if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 が見つかりません。3.10+ をインストールしてください。" >&2
    exit 1
fi
pyver=$(python3 --version 2>&1 | awk '{print $2}')
pymajor=$(echo "$pyver" | cut -d. -f1)
pyminor=$(echo "$pyver" | cut -d. -f2)
if [[ "$pymajor" -lt 3 || ( "$pymajor" -eq 3 && "$pyminor" -lt 10 ) ]]; then
    echo "Python 3.10+ が必要です。検出: $pyver" >&2
    exit 1
fi
echo "OK Python $pyver"

# 3) interactive config
echo
echo '=== LabPay scanner config ==='

# Read existing values for defaults (best-effort).
existing_url=$(grep -Eo '"labpay_url"\s*:\s*"[^"]+"' "$config" 2>/dev/null | sed -E 's/.*"([^"]+)"$/\1/' || true)
existing_room=$(grep -Eo '"room_id"\s*:\s*"[^"]+"' "$config" 2>/dev/null | sed -E 's/.*"([^"]+)"$/\1/' || true)

prompt() {  # prompt VAR "label" "default"
    local __var=$1 label=$2 def=${3:-}
    local val
    while :; do
        if [[ -n "$def" ]]; then
            read -rp "$label [$def]: " val
            val="${val:-$def}"
        else
            read -rp "$label: " val
        fi
        val="${val#"${val%%[![:space:]]*}"}"
        val="${val%"${val##*[![:space:]]}"}"
        if [[ -n "$val" ]]; then
            printf -v "$__var" '%s' "$val"
            return
        fi
        echo '  (空欄不可)' >&2
    done
}

prompt labpay_url 'labpay_url' "${existing_url:-https://pay.nkmr.io}"
prompt room_id   'room_id (例: 7F)' "$existing_room"

token="${LABPAY_SCANNER_TOKEN:-}"
if [[ -z "$token" ]]; then
    read -rsp 'scanner_token (admin 画面で部屋作成時に表示されたもの): ' token; echo
fi
[[ -n "$token" ]] || { echo "scanner_token が空です。中止します。" >&2; exit 1; }

read -rp 'subnet (例: 192.168.50.0/24 — 空欄なら自動検出): ' subnet || subnet=''
subnet="${subnet#"${subnet%%[![:space:]]*}"}"
subnet="${subnet%"${subnet##*[![:space:]]}"}"

# 4) write config (JSON via python so escaping is correct)
python3 - "$config" <<EOF
import json, sys
cfg = {"labpay_url": "${labpay_url%/}", "room_id": "$room_id", "scanner_token": "$token"}
sub = "$subnet"
if sub:
    cfg["subnet"] = sub
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
EOF
echo
echo "wrote $config"

# 5) test run
echo
echo '=== Testing scanner ==='
if ! python3 "$scanner"; then
    echo 'scanner.py が失敗しました。config か token を確認してください。' >&2
    exit 1
fi

# 6) crontab — replace any prior LabPay Scanner entry.
echo
echo '=== Installing crontab entry (current user) ==='
cron_line="* * * * * /usr/bin/env python3 $scanner >> $here/scanner.log 2>&1  # LabPay scanner"
existing_cron=$(crontab -l 2>/dev/null | grep -v '# LabPay scanner' || true)
(printf '%s\n%s\n' "$existing_cron" "$cron_line") | sed '/^$/d' | crontab -

echo
echo '=== Done ==='
echo "Cron: $(crontab -l | grep 'LabPay scanner')"
echo "Log:  $here/scanner.log"
echo
echo '1 分後に管理画面で last_scan_at が更新されているか確認してください:'
echo "  $labpay_url/#/admin → 詳細管理 → 部屋"
