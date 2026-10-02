# CI/CD & Production Deployment

How the finskool stack is deployed to the production server, the problems we hit while setting it up, and how each was solved.

## Overview

Pushing to `main` deploys automatically:

```
git push main
   └─► GitHub Actions (.github/workflows/deploy.yml)
          └─► SSH into the server
                 └─► git reset --hard <pushed commit>
                 └─► bash docker/deploy.sh
                        ├─ diff against last SUCCESSFULLY deployed commit
                        ├─ docker compose build (only changed images)
                        └─ docker compose up -d (only changed services)
```

Production traffic path (the server is shared with the EqLion stack):

```
Browser ─HTTPS─► eqlion-nginx (owns host :80/:443, TLS, Let's Encrypt)
                    └─► finskool-nginx :80  (over the shared eqlion-network)
                           ├─ /api/, /ws/ ─► finskool-backend :3001
                           ├─ /assets/    ─► minio :9000
                           └─ /           ─► finskool-frontend :3000
```

## What was built

| File | Purpose |
|---|---|
| `.github/workflows/deploy.yml` | Workflow: runs on push to `main` (and manually via *Run workflow*, with a *force_all* option). Checks secrets exist, then SSHes in. |
| `docker/deploy.sh` | Server-side script. Detects what changed, builds, recreates only affected services, waits for the backend health check, records the deployed commit in `.git/last-deployed-sha`. |

### Change detection

| Changed path | Redeployed |
|---|---|
| `apps/backend/**`, root `package.json` / `package-lock.json`, `.dockerignore` | backend image rebuilt; backend + worker + cron recreated (they share one image) |
| `apps/frontend/**` | frontend rebuilt and recreated |
| `docker/nginx.conf` | nginx restarted |
| `docker/docker-compose.production.yml` | whole stack reconciled (`up -d --remove-orphans`) |

Builds happen **before** any container is replaced, so a failed build never takes the running site down. Changes are diffed against the last *successful* deploy, so a failed deploy is retried in full on the next run.

### Required GitHub secrets

Settings → Secrets and variables → Actions → **Secrets** tab (repository secrets):

| Secret | Value |
|---|---|
| `SSH_HOST` | server hostname / IP |
| `SSH_USER` | `root` (the repo lives in `/root`) |
| `SSH_KEY` | **private** key; its public half is in the server's `~/.ssh/authorized_keys` |
| `DEPLOY_PATH` | `/root/finskool-monorepo` |
| `SSH_PORT` | optional, defaults to 22 |

## Issues we hit and how they were solved

### 1. `can't connect without a private SSH key or password`

- **Symptom:** the SSH step failed immediately; `INPUT_KEY` and `DEPLOY_PATH` were empty in the log.
- **Cause:** the workflow read `secrets.SSH_PRIVATE_KEY`, but the secret was saved as `SSH_KEY`, and `DEPLOY_PATH` hadn't been created yet. GitHub passes a missing secret as an empty string rather than failing.
- **Fix:** the workflow now uses `SSH_KEY`; `DEPLOY_PATH` was added. A **"Check required secrets"** step at the start of the job now fails with a clear message naming any missing secret.

### 2. `pull access denied for minio/minio`

- **Symptom:** images built fine, then `docker compose up` failed pulling `minio/minio`; the other pulls showed "Interrupted".
- **Cause:** MinIO removed `minio/minio` and `minio/mc` from Docker Hub (both return 404), and the `quay.io` copies now require authentication. The other images (nginx, mailhog) were only interrupted by that one failure.
- **Fix:** switched to the community-maintained build `pgsty/minio` and `pgsty/mc` in both `docker/docker-compose.production.yml` and `apps/backend/docker-compose.dev.yml`. We verified from the registry that the images contain `minio`, `mc`, `curl` and `sh`, so the `mc ready local` health check and the bucket-init script work unchanged.
- **Follow-up to consider:** pin a version (e.g. `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`) instead of `latest` so production doesn't change unexpectedly. This is a third-party build holding all uploaded files, so the trade-off is worth a deliberate decision.

### 3. `Bind for 0.0.0.0:80 failed: port is already allocated`

- **Symptom:** every service started except `finskool-nginx`.
- **Cause:** the server also runs the EqLion stack, whose `eqlion-nginx` container owns host ports 80 and 443. Two nginx containers cannot share a host port.
- **Fix:** keep `eqlion-nginx` as the single public entrypoint and put finskool behind it:
  1. `finskool-nginx` no longer takes public port 80. It publishes only on loopback (`127.0.0.1:8080`, overridable with `NGINX_BIND`) and also joins `eqlion-network`.
  2. `docker/nginx.conf` now forwards the outer proxy's `X-Forwarded-Proto` (via a `map` to `$fwd_proto`) instead of overwriting it with `http`, so the backend knows requests arrived over HTTPS.
  3. `docker/deploy.sh` creates `eqlion-network` if it doesn't exist, so the external network never blocks `docker compose up`.
  4. In the **EqLion-Backend** repo, `docker/nginx/templates/finskool-{http,https}.conf.template` and `finskool-locations.inc.template` were added, and `40-select-ssl.sh` was changed to choose HTTP vs HTTPS **per domain**. `docker-compose.yml` got a `FINSKOOL_DOMAIN` variable. Upstreams are resolved per request, so EqLion's nginx still starts even when the finskool stack is down.

### 4. `failed to bind host port 172.17.0.1:8080: cannot assign requested address`

- **Symptom:** first attempt at a non-public port failed.
- **Cause:** the compose default bound to `172.17.0.1` (assumed Docker bridge IP), which doesn't exist on this server.
- **Fix:** changed the default to `127.0.0.1:8080`. The host port isn't what EqLion's nginx uses anyway — it reaches `finskool-nginx` by name over `eqlion-network`.

### 5. HTTPS for the new domain

- A Let's Encrypt certificate for `community.finskool21.in` was issued with EqLion's existing certbot container:
  ```bash
  cd /root/EqLion-Backend
  docker compose run --rm --entrypoint certbot certbot certonly --webroot \
    -w /var/www/certbot -d community.finskool21.in -m <email> --agree-tos --no-eff-email
  docker compose restart nginx
  ```
- `eqlion-certbot` renews every certificate in the shared volume, and `eqlion-nginx` reloads every 12h, so renewal is automatic.

## Operations cheat sheet

```bash
# Status
docker ps --format "table {{.Names}}\t{{.Status}}" | grep finskool

# Which commit is deployed
cat /root/finskool-monorepo/.git/last-deployed-sha

# Deploy by hand (same script CI runs)
cd /root/finskool-monorepo && bash docker/deploy.sh

# Rebuild and recreate everything
FORCE_ALL=1 bash docker/deploy.sh

# Logs
docker logs --tail 100 finskool-backend
docker logs --tail 100 eqlion-nginx

# Health
curl -I https://community.finskool21.in
curl -s http://127.0.0.1:8080/ -H "Host: community.finskool21.in" -I   # bypass eqlion-nginx
```

The backend health route is `/health` (not `/api/health`).

## Cross-repo dependencies

The two stacks now depend on each other. Changing any of these requires matching changes in **both** repos:

- the container name `finskool-nginx` (referenced in EqLion's `finskool-locations.inc.template`)
- the network name `eqlion-network` (defined by EqLion, joined by finskool as `external`)
- the domain `community.finskool21.in` (`FINSKOOL_DOMAIN` in EqLion's compose, `server_name` in `docker/nginx.conf`)

If `eqlion-nginx` ever fails to start after an EqLion change, EqLion **and** finskool are both offline — check `docker logs eqlion-nginx` first.

## Remaining to-dos

- Set a real email on the Let's Encrypt account (`certbot update_account -m <email>`); it was registered with a placeholder.
- Confirm `apps/backend/.env` uses `https://community.finskool21.in` for the frontend URL, `CORS_ORIGIN` and `MINIO_PUBLIC_ENDPOINT`.
- Consider pinning the `pgsty/*` MinIO image versions.
- The server reports "System restart required" — reboot in a quiet window; all containers use `restart: unless-stopped`.
