#!/bin/bash
# Triva WiFi — PostgreSQL restore script for isolated testing / new VPS setup.
#
# Usage:
#   restore.sh /var/backups/triva/triva-db-YYYYMMDD-HHMMSS.sql.gz
#
# Environment variables:
#   DB_HOST       database host (default: postgres)
#   DB_USER       database user
#   DB_NAME       database name (default: triva_db)
#   DB_PASSWORD   database password

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-file.sql.gz[.gpg]>"
  exit 1
fi

BACKUP_FILE="$1"
DB_HOST="${DB_HOST:-postgres}"
DB_USER="${DB_USER:-triva_user}"
DB_NAME="${DB_NAME:-triva_db}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD is required}"

export PGPASSWORD="$DB_PASSWORD"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Verify checksum if present.
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [ -f "$CHECKSUM_FILE" ]; then
  echo "Verifying checksum..."
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$CHECKSUM_FILE")")
else
  echo "Warning: checksum file not found."
fi

# Decrypt if needed.
INPUT="$BACKUP_FILE"
if [[ "$BACKUP_FILE" == *.gpg ]]; then
  echo "Decrypting backup..."
  INPUT="${BACKUP_FILE%.gpg}.sql.gz"
  gpg --batch --yes --decrypt "$BACKUP_FILE" > "$INPUT"
fi

# Recreate database.
echo "Recreating database ${DB_NAME}..."
psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" || true
psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};"
psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "CREATE DATABASE ${DB_NAME};"

# Restore schema and data.
echo "Restoring backup..."
gunzip -c "$INPUT" | psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME"

# Resolve baseline Prisma migration so future migrate deploy is a no-op.
# The baseline migration file must exist in prisma/migrations/20241006000000_baseline.
if command -v npx >/dev/null 2>&1; then
  echo "Resolving baseline Prisma migration..."
  npx prisma migrate resolve --applied 20241006000000_baseline || true
fi

# Verification.
echo "Row counts after restore:"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "
  SELECT 'tenants' AS t, COUNT(*) FROM tenants UNION ALL
  SELECT 'users', COUNT(*) FROM users UNION ALL
  SELECT 'sessions', COUNT(*) FROM sessions UNION ALL
  SELECT 'payments', COUNT(*) FROM payments UNION ALL
  SELECT 'routers', COUNT(*) FROM routers UNION ALL
  SELECT 'tplink_routers', COUNT(*) FROM tplink_routers UNION ALL
  SELECT 'omada_sites', COUNT(*) FROM omada_sites;
"

echo "Restore completed successfully."
