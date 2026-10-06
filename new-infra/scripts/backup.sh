#!/bin/bash
# Triva WiFi — PostgreSQL backup script
#
# Environment variables:
#   DB_HOST          database host (default: postgres)
#   DB_USER          database user
#   DB_NAME          database name (default: triva_db)
#   DB_PASSWORD      database password
#   BACKUP_DIR       local backup directory (default: /var/backups/triva)
#   BACKUP_REMOTE    optional remote destination (s3://..., rsync target, scp host:path)
#   RETENTION_DAYS   local retention (default: 14)
#   GPG_RECIPIENT    optional GPG recipient for encryption
#
# Example cron entry (run as root or backup user):
#   0 */6 * * * /opt/triva/scripts/backup.sh >> /var/log/triva-backup.log 2>&1

set -euo pipefail

DB_HOST="${DB_HOST:-postgres}"
DB_USER="${DB_USER:-triva_user}"
DB_NAME="${DB_NAME:-triva_db}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/triva}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"

DATE=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

DUMP_FILE="${BACKUP_DIR}/triva-db-${DATE}.sql.gz"
SUMMARY_FILE="${BACKUP_DIR}/triva-db-${DATE}.summary"

export PGPASSWORD="$DB_PASSWORD"

# pg_dump already runs inside a consistent snapshot transaction; it does not
# accept --single-transaction (that flag belongs to pg_restore).
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
  --no-owner \
  --no-privileges \
  --no-comments \
  | gzip > "$DUMP_FILE"

# Generate checksum.
sha256sum "$DUMP_FILE" > "${DUMP_FILE}.sha256"

# Optional GPG encryption.
if [ -n "$GPG_RECIPIENT" ]; then
  gpg --batch --yes --recipient "$GPG_RECIPIENT" --encrypt "$DUMP_FILE"
  rm -f "$DUMP_FILE"
  DUMP_FILE="${DUMP_FILE}.gpg"
fi

# Summary metadata.
SIZE=$(du -sh "$DUMP_FILE" | cut -f1)
{
  echo "backup_file=$DUMP_FILE"
  echo "size=$SIZE"
  echo "sha256=$(sha256sum "$DUMP_FILE" | cut -d' ' -f1)"
  echo "finished_at=$(date -Iseconds)"
} > "$SUMMARY_FILE"

# Off-server copy if configured.
if [ -n "$BACKUP_REMOTE" ]; then
  if [[ "$BACKUP_REMOTE" == s3://* ]]; then
    aws s3 cp "$DUMP_FILE" "$BACKUP_REMOTE"
    aws s3 cp "${DUMP_FILE}.sha256" "$BACKUP_REMOTE"
  elif [[ "$BACKUP_REMOTE" == *:* ]]; then
    scp "$DUMP_FILE" "${DUMP_FILE}.sha256" "$BACKUP_REMOTE"
  else
    rclone copy "$DUMP_FILE" "$BACKUP_REMOTE"
  fi
fi

# Retention cleanup.
find "$BACKUP_DIR" -type f \( -name 'triva-db-*.sql.gz' -o -name 'triva-db-*.sql.gz.gpg' -o -name 'triva-db-*.sha256' -o -name 'triva-db-*.summary' \) \
  -mtime +"$RETENTION_DAYS" -delete

echo "Backup completed: $DUMP_FILE ($SIZE)"
