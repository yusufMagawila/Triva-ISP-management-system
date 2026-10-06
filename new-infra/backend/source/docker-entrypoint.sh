#!/bin/sh
set -e

# For isolated test environments only: reset any previously failed baseline
# migration state so a clean baseline migration can be applied.
if [ "$MIGRATION_RESET" = "1" ]; then
  echo "Resetting failed baseline migration state..."
  npx prisma db execute --file /dev/stdin <<'SQL' || true
DELETE FROM _prisma_migrations WHERE migration_name = '20241006000000_baseline';
SQL
fi

# Apply database migrations before starting the application.
npx prisma migrate deploy || {
  echo "Database migration failed; refusing to start." >&2
  exit 1
}

exec "$@"
