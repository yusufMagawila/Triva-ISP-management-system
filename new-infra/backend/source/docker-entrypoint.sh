#!/bin/sh
set -e

# Apply database migrations before starting the application.
# For isolated test environments, MIGRATION_RESET=1 drops the public schema
# (not the whole database, so no superuser is required) and reapplies migrations.
if [ "$MIGRATION_RESET" = "1" ]; then
  echo "Dropping public schema for isolated test reset (MIGRATION_RESET=1)..."
  npx prisma db execute --file /dev/stdin <<'SQL' || {
    echo "Failed to drop public schema; refusing to start." >&2
    exit 1
  }
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO CURRENT_USER;
SQL
fi

npx prisma migrate deploy || {
  echo "Database migration failed; refusing to start." >&2
  exit 1
}

exec "$@"
