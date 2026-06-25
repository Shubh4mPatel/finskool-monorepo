#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

SEED_FLAG=/data/seed/.seeded
if [ ! -f "$SEED_FLAG" ]; then
  echo "[entrypoint] Running seed (first boot)..."
  npm run db:seed
  mkdir -p /data/seed
  touch "$SEED_FLAG"
  echo "[entrypoint] Seed complete."
fi

echo "[entrypoint] Starting backend..."
exec "$@"
