#!/usr/bin/env bash
# Server-side deploy script — run by .github/workflows/deploy.yml over SSH after
# the repo on the server has been reset to origin/main. Can also be run by hand
# from the repo root:
#
#   bash docker/deploy.sh          # rebuild only what changed since last deploy
#   FORCE_ALL=1 bash docker/deploy.sh   # rebuild + recreate everything
#
# Change detection diffs the current HEAD against the last SUCCESSFULLY deployed
# commit (stored in .git/last-deployed-sha), not against the previous HEAD — so a
# deploy that failed halfway is retried in full on the next push instead of
# being silently skipped.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/docker-compose.production.yml"
STATE_FILE="$REPO_ROOT/.git/last-deployed-sha"

# ${POSTGRES_USER} etc. in the compose file are interpolated at compose time,
# so compose needs an env file: prefer docker/.env if one exists, else the
# backend's .env (which env_file: already points every service at).
if [ -f "$REPO_ROOT/docker/.env" ]; then
  ENV_FILE="$REPO_ROOT/docker/.env"
else
  ENV_FILE="$REPO_ROOT/apps/backend/.env"
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "[deploy] ERROR: $ENV_FILE not found — create it from apps/backend/.env.example first." >&2
  exit 1
fi

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# finskool-nginx joins the EqLion stack's network (eqlion-nginx owns host 80/443
# and proxies our domain to it). Create it if EqLion hasn't yet, same as
# EqLion's own deploy does, so `up` never fails on the external network.
docker network inspect eqlion-network >/dev/null 2>&1 || docker network create eqlion-network

NEW_SHA="$(git rev-parse HEAD)"
OLD_SHA="$(cat "$STATE_FILE" 2>/dev/null || true)"

BACKEND=0
FRONTEND=0
NGINX=0
STACK=0

if [ "${FORCE_ALL:-0}" = "1" ] || [ -z "$OLD_SHA" ] || ! git cat-file -e "$OLD_SHA^{commit}" 2>/dev/null; then
  echo "[deploy] Full deploy (forced, first run, or unknown previous commit)."
  BACKEND=1; FRONTEND=1; NGINX=1; STACK=1
elif [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "[deploy] $NEW_SHA is already deployed — nothing to do."
  exit 0
else
  CHANGED="$(git diff --name-only "$OLD_SHA" "$NEW_SHA")"
  echo "[deploy] Changes $OLD_SHA..$NEW_SHA:"
  echo "$CHANGED" | sed 's/^/  /'

  # Root package.json / lock file feed the backend image (built from the repo root).
  echo "$CHANGED" | grep -qE '^(apps/backend/|package\.json$|package-lock\.json$|\.dockerignore$)' && BACKEND=1
  echo "$CHANGED" | grep -qE '^apps/frontend/' && FRONTEND=1
  echo "$CHANGED" | grep -qE '^docker/nginx\.conf$' && NGINX=1
  echo "$CHANGED" | grep -qE '^docker/docker-compose\.production\.yml$' && STACK=1
fi

echo "[deploy] backend=$BACKEND frontend=$FRONTEND nginx=$NGINX stack=$STACK"

# Build first, while the old containers keep serving — a failed build aborts
# here (set -e) without taking the running site down.
BUILD_TARGETS=()
[ "$BACKEND" = "1" ] && BUILD_TARGETS+=(finskool-backend)
[ "$FRONTEND" = "1" ] && BUILD_TARGETS+=(finskool-frontend)
if [ "${#BUILD_TARGETS[@]}" -gt 0 ]; then
  echo "[deploy] Building: ${BUILD_TARGETS[*]}"
  compose build "${BUILD_TARGETS[@]}"
fi

if [ "$STACK" = "1" ]; then
  # Compose file changed (or full deploy) — let compose reconcile everything.
  compose up -d --remove-orphans
else
  UP_TARGETS=()
  # worker + cron run the same finskool-backend:latest image, so they must be
  # recreated alongside the backend to pick up the new build.
  [ "$BACKEND" = "1" ] && UP_TARGETS+=(finskool-backend finskool-worker finskool-cron)
  [ "$FRONTEND" = "1" ] && UP_TARGETS+=(finskool-frontend)
  if [ "${#UP_TARGETS[@]}" -gt 0 ]; then
    echo "[deploy] Recreating: ${UP_TARGETS[*]}"
    compose up -d "${UP_TARGETS[@]}"
  fi
fi

# nginx.conf is bind-mounted, so a restart is enough to load it. Also restart
# after app recreation so nginx re-resolves the new containers' IPs.
if [ "$NGINX" = "1" ] || [ "$BACKEND" = "1" ] || [ "$FRONTEND" = "1" ]; then
  echo "[deploy] Restarting nginx"
  compose up -d nginx
  compose restart nginx
fi

# Wait for the backend healthcheck (migrations run in its entrypoint).
if [ "$BACKEND" = "1" ] || [ "$STACK" = "1" ]; then
  echo "[deploy] Waiting for finskool-backend to become healthy..."
  for i in $(seq 1 40); do
    STATUS="$(docker inspect -f '{{.State.Health.Status}}' finskool-backend 2>/dev/null || echo missing)"
    if [ "$STATUS" = "healthy" ]; then
      echo "[deploy] finskool-backend is healthy."
      break
    fi
    if [ "$i" = "40" ]; then
      echo "[deploy] ERROR: finskool-backend did not become healthy (last status: $STATUS)." >&2
      docker logs --tail 100 finskool-backend >&2 || true
      exit 1
    fi
    sleep 5
  done
fi

echo "$NEW_SHA" > "$STATE_FILE"

# Drop the dangling images left behind by the rebuild.
docker image prune -f >/dev/null || true

echo "[deploy] Deployed $NEW_SHA"
