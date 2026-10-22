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

# Demo data (communities, welcome kits, services, demo members). Runs once (own flag file) and only from
# the API container, so the worker and cron containers sharing this entrypoint never race it. A failure is
# logged and ignored: demo data must never stop the backend from starting. To run it again, delete the flag
# file in the finskool-seed-flag volume. It creates accounts with well-known passwords.
#
# TEMPORARY: this default turns the demo seed on for the next deploy without touching the server's .env.
# Delete the next line in a following push (or set RUN_DEMO_SEED=false in .env) to switch it off.
RUN_DEMO_SEED="${RUN_DEMO_SEED:-true}"

DEMO_FLAG=/data/seed/.demo-seeded
if [ "$RUN_DEMO_SEED" = "true" ] && [ "$*" = "node dist/index.js" ] && [ ! -f "$DEMO_FLAG" ]; then
  echo "[entrypoint] Running demo seed (once)..."
  if SEED_DEMO_ALLOW_PRODUCTION=true npm run db:seed:demo; then
    mkdir -p /data/seed
    touch "$DEMO_FLAG"
    echo "[entrypoint] Demo seed complete."
  else
    echo "[entrypoint] WARNING: demo seed failed; continuing without it (it will retry on the next start)."
  fi
fi

echo "[entrypoint] Starting backend..."
exec "$@"
