#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "Add your PostgreSQL connection string to the deployment environment."
  echo "Example: postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public"
  exit 1
fi

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting API..."
exec "$@"
