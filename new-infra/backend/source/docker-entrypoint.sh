#!/bin/sh
set -e

# Apply database migrations before starting the application.
# For isolated test environments, MIGRATION_RESET=1 uses prisma db push to create
# the schema from scratch (safe for throwaway validation only).
# For production, MIGRATION_RESET must be unset/0 and prisma migrate deploy is used.
if [ "$MIGRATION_RESET" = "1" ]; then
  echo "Using prisma db push for isolated test reset (MIGRATION_RESET=1)..."
  npx prisma db push --accept-data-loss --skip-generate || {
    echo "Database push failed; refusing to start." >&2
    exit 1
  }
else
  npx prisma migrate deploy || {
    echo "Database migration failed; refusing to start." >&2
    exit 1
  }
fi

exec "$@"
