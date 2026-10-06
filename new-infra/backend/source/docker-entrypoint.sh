#!/bin/sh
set -e

# Apply database migrations before starting the application.
echo "Running Prisma migrations..."
npx prisma migrate status || true
npx prisma migrate deploy || {
  echo "Database migration failed; refusing to start." >&2
  exit 1
}
echo "Prisma migrations complete."

exec "$@"
