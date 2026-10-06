#!/bin/sh
set -e

# Apply database migrations before starting the application.
# For isolated test environments, MIGRATION_RESET=1 drops and reapplies
# all migrations so a clean baseline can be verified.
if [ "$MIGRATION_RESET" = "1" ]; then
  echo "Resetting database and applying migrations (MIGRATION_RESET=1)..."
  npx prisma migrate reset --force --skip-seed || {
    echo "Database reset failed; refusing to start." >&2
    exit 1
  }
else
  npx prisma migrate deploy || {
    echo "Database migration failed; refusing to start." >&2
    exit 1
  }
fi

exec "$@"
