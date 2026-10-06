#!/bin/sh
set -e

# Apply database migrations before starting the application.
npx prisma migrate deploy || {
  echo "Database migration failed; refusing to start." >&2
  exit 1
}

exec "$@"
