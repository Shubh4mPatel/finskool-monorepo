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

# Opt-in demo data (communities, welcome kits, services, demo members). Off unless the server's .env
# sets RUN_DEMO_SEED=true. Runs once (own flag file) and only from the API container, so the worker and
# cron containers sharing this entrypoint never race it. To run it again, delete the flag file in the
# finskool-seed-flag volume. It creates accounts with well-known passwords: never enable it on a server
# with real members.
DEMO_FLAG=/data/seed/.demo-seeded
if [ "$RUN_DEMO_SEED" = "true" ] && [ "$*" = "node dist/index.js" ] && [ ! -f "$DEMO_FLAG" ]; then
  echo "[entrypoint] RUN_DEMO_SEED=true: running demo seed (once)..."
  SEED_DEMO_ALLOW_PRODUCTION=true npm run db:seed:demo
  mkdir -p /data/seed
  touch "$DEMO_FLAG"
  echo "[entrypoint] Demo seed complete."
fi

echo "[entrypoint] Starting backend..."
exec "$@"
