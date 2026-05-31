#!/usr/bin/env bash
# Daily backup. Cron suggestion:
#   30 3 * * * LABPAY_DB_PASS='...' /var/www/labpay/bin/backup.sh
# Keeps 30 days of dumps. Stores plain SQL (gzip-compressed).

set -euo pipefail

DB="${LABPAY_DB:-labpay}"
USER="${LABPAY_DB_USER:-labpay}"
DEST="${LABPAY_BACKUP_DIR:-/var/backups/labpay}"
KEEP_DAYS="${LABPAY_BACKUP_KEEP_DAYS:-30}"

if [[ -z "${LABPAY_DB_PASS:-}" ]]; then
  echo "LABPAY_DB_PASS env var is required" >&2
  exit 1
fi

mkdir -p "$DEST"
OUT="$DEST/labpay-$(date +%F).sql.gz"

mysqldump --single-transaction --routines --triggers \
  -u "$USER" -p"$LABPAY_DB_PASS" "$DB" | gzip > "$OUT"

# Restrict perms
chmod 600 "$OUT" || true

find "$DEST" -name 'labpay-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "backup written: $OUT"
