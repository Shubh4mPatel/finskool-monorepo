# Monitoring Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a self-hosted monitoring stack on the production server that shows server and container health (including why a container died), Postgres, Redis, edge and uptime for Finskool, and sends Telegram alerts whose timings are editable in the Grafana UI.

**Architecture:** A standalone compose project in `/opt/monitoring` (same arrangement as `/opt/edge`), authored in a new local git repo `d:\monitoring` and copied to the server. Prometheus scrapes exporters every 30 s, Grafana shows the data and runs the alert rules, Telegram receives the alerts. Each task is deployed to the server on its own and verified before the next starts.

**Tech Stack:** Docker Compose, Prometheus, Grafana (with Grafana Alerting), node-exporter, cAdvisor, a Docker-state exporter behind a read-only Docker socket proxy, blackbox-exporter, postgres-exporter, redis-exporter, Caddy metrics, Telegram Bot API. Pin every image to the current stable tag at implementation time and record the tag in the repo's `VERSIONS.md`.

**Spec:** `docs/server-monitoring-proposal.md` (read it first; this plan implements phase A only). Server facts: `docs/production-server-reference.md`.

## Assumptions to confirm before Task 1

- The stack choice and Grafana Alerting in place of Alertmanager are accepted (the two items still open in the proposal).
- Monitoring files are authored in a new local repo `d:\monitoring` and copied to `/opt/monitoring` with `scp -r` or `git pull`. If you prefer authoring directly on the server, Tasks keep the same steps and skip the copy.

## Global Constraints

- Every monitoring port binds to `127.0.0.1`. Host ports: Prometheus `9091`, Grafana `3003` (EqLion already holds `9090`, `3100`, `3002`). Nothing is published publicly.
- Secrets (Telegram bot token, Grafana admin password, Postgres monitoring password, Redis password) live only in `/opt/monitoring/.env` on the server, mode `600`, never in git. The repo carries `.env.example`.
- Scrape interval 30 s. Prometheus retention `15d` and `10GB`, whichever comes first.
- Phase A does not restart any EqLion or Finskool container, except in Task 12 and Task 13, which are scheduled in a quiet window. Phase A changes Finskool code in one place only: `docker/deploy.sh` (Task 10).
- Monitoring containers carry their own memory limits (values in Task 11) and `restart: unless-stopped`.
- The Docker socket is never mounted directly into an exporter. It goes through a read-only socket proxy with only the endpoints needed.
- EqLion's existing Prometheus, Loki, Grafana and Promtail are left running and untouched.
- Alert rules must stay editable in the Grafana UI. They are not file-provisioned (file-provisioned rules are read-only in the UI).

## Review Focus

1. The monitoring stack misbehaves (memory spike, disk growth) and hurts the apps: limits and retention caps are tested, not assumed (Task 1, Task 11).
2. Telegram is unreachable or the bot token is wrong, so alerts are silently lost: a real test message must arrive, and a failure is visible in Grafana (Task 8).
3. cAdvisor reports containers by ID instead of name on this server's containerd image store: alerts and dashboards would be unreadable (Task 3).
4. The kill reason is lost if events are not captured at the time: the drill in Task 4 kills a container and checks exit code 137 appears.
5. Alert rules loaded from files turn out read-only in the UI, defeating the requirement: Task 9 verifies a rule can be edited in the UI.
6. A broken or stale `.env` (wrong DB password) makes exporters report `up == 1` with no data: Task 6 checks real metric values, not only `up`.

---

## File structure (repo `d:\monitoring`, deployed to `/opt/monitoring`)

| Path | Responsibility |
| --- | --- |
| `docker-compose.yml` | All monitoring services, networks, volumes, limits |
| `.env.example` | Names of every secret, no values |
| `prometheus/prometheus.yml` | Scrape jobs |
| `grafana/provisioning/datasources/prometheus.yml` | Prometheus datasource |
| `grafana/provisioning/dashboards/` | Dashboard provider and dashboard JSON files |
| `blackbox/blackbox.yml` | HTTP probe modules |
| `scripts/disk-usage.sh` | Writes Docker disk-use metrics for node-exporter's textfile collector |
| `scripts/load-alert-rules.sh` | Creates alert rules in Grafana from `alerts/*.json` so they stay UI-editable |
| `scripts/export-alert-rules.sh` | Exports the live alert rules to `alerts/export/` as a backup |
| `scripts/backup-grafana.sh` | Archives the Grafana volume |
| `alerts/*.json` | Alert rule definitions (one file per rule group) |
| `VERSIONS.md` | Pinned image tags |
| `README.md` | Runbook: SSH tunnel, deploy, rollback |

---

### Task 0: Discover the facts the plan depends on (read-only)

**Files:**
- Create: `d:\monitoring\NOTES.md` (facts recorded here, referenced by later tasks)

**Interfaces:**
- Produces: `FINSKOOL_NET` (name of Finskool's Docker network), `PG_CONTAINER=finskool-postgres`, `REDIS_CONTAINER=finskool-redis`, `MINIO_CONTAINER=finskool-minio`, whether Redis has `maxmemory` set, free-port confirmation, Docker and Compose versions.

- [ ] **Step 1: On the server, collect the facts**

```bash
docker --version; docker compose version; uname -sr; cat /etc/os-release | head -3
docker network ls --format '{{.Name}}' | grep -iE 'finskool|docker_default'
docker inspect finskool-postgres --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
ss -tlnp | grep -E ':(9091|3003|9100|8080|9187|9121|9115)\b' || echo "ports free"
docker exec finskool-redis sh -c 'redis-cli -a "$REDIS_PASSWORD" config get maxmemory' 2>/dev/null
docker exec finskool-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'show max_connections;' 2>/dev/null
```

Expected: a network name that contains both `finskool-postgres` and `finskool-redis`, "ports free", and a numeric `max_connections`. If the Redis or Postgres lines print nothing, read the credentials from `/root/finskool-monorepo/apps/backend/.env` instead and note the variable names.

- [ ] **Step 2: Record the values in `NOTES.md`** and commit the file.

```bash
cd d:/monitoring && git init -q && git add NOTES.md && git commit -m "docs: record server facts for monitoring phase A"
```

---

### Task 1: Scaffold the project with Prometheus and Grafana

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `prometheus/prometheus.yml`, `grafana/provisioning/datasources/prometheus.yml`, `VERSIONS.md`, `README.md`

**Interfaces:**
- Produces: compose project `monitoring`; network `monitoring` (internal); Prometheus at `prometheus:9090` (host `127.0.0.1:9091`); Grafana at `grafana:3000` (host `127.0.0.1:3003`); volumes `prometheus_data`, `grafana_data`; a Prometheus datasource with uid `prometheus`.

- [ ] **Step 1: Write the compose file and configs**

`docker-compose.yml` defines `prometheus` (flags `--storage.tsdb.retention.time=15d`, `--storage.tsdb.retention.size=10GB`, `--web.enable-lifecycle`) and `grafana` (admin password from `.env`, anonymous access off, datasource provisioned). Both join network `monitoring`, publish only on `127.0.0.1`, and have `restart: unless-stopped`. `prometheus.yml` has `scrape_interval: 30s` and one job `prometheus` scraping itself.

- [ ] **Step 2: Validate before deploying**

```bash
docker compose -f docker-compose.yml config -q && echo OK
docker run --rm -v "$PWD/prometheus:/p" --entrypoint promtool prom/prometheus check config /p/prometheus.yml
```

Expected: `OK` and `SUCCESS: ... is valid prometheus config file syntax`.

- [ ] **Step 3: Deploy to the server**

```bash
scp -r d:/monitoring root@<server>:/opt/monitoring
ssh root@<server> 'cd /opt/monitoring && cp .env.example .env && chmod 600 .env && nano .env && docker compose up -d'
```

- [ ] **Step 4: Verify through an SSH tunnel**

```bash
ssh -L 9091:127.0.0.1:9091 -L 3003:127.0.0.1:3003 root@<server>
curl -s http://127.0.0.1:9091/-/ready          # Prometheus Server is Ready.
curl -s http://127.0.0.1:3003/api/health        # "database": "ok"
```

Also check from outside the server that neither port answers publicly (`curl http://<server-ip>:3003` must fail).

- [ ] **Step 5: Commit** `git add . && git commit -m "feat: monitoring scaffold with prometheus and grafana"`

Rollback: `cd /opt/monitoring && docker compose down` (volumes are kept).

---

### Task 2: Host metrics with node-exporter

**Files:**
- Modify: `docker-compose.yml`, `prometheus/prometheus.yml`
- Create: `grafana/provisioning/dashboards/dashboards.yml`, `grafana/provisioning/dashboards/node-exporter.json`

**Interfaces:**
- Consumes: Task 1's compose project and Prometheus.
- Produces: job `node` (target `node-exporter:9100`) and a textfile directory `/var/lib/node-exporter/textfile` mounted into the exporter for Task 5.

- [ ] **Step 1: Add `node-exporter`** with read-only mounts of `/proc`, `/sys` and `/`, the flag `--collector.textfile.directory=/textfile`, and the textfile directory as a bind mount. Add job `node` to `prometheus.yml`. Provision a node dashboard (start from the community "Node Exporter Full" dashboard, grafana.com ID 1860, and confirm the ID before importing).
- [ ] **Step 2: Validate** with the same `config -q` and `promtool check config` commands as Task 1.
- [ ] **Step 3: Deploy** (`scp`, then `docker compose up -d` on the server).
- [ ] **Step 4: Verify real values, not only `up`**

```bash
curl -s 'http://127.0.0.1:9091/api/v1/query?query=up%7Bjob%3D%22node%22%7D'          # value "1"
curl -s 'http://127.0.0.1:9091/api/v1/query?query=node_memory_MemAvailable_bytes'   # about 29e9 on this server
```

Open the dashboard in Grafana through the tunnel; memory and disk panels must show data matching `free -m` and `df -h /`.
- [ ] **Step 5: Commit** `git commit -am "feat: add node-exporter and host dashboard"`

---

### Task 3: Container metrics with cAdvisor (and the containerd naming check)

**Files:**
- Modify: `docker-compose.yml`, `prometheus/prometheus.yml`
- Create: `grafana/provisioning/dashboards/containers.json`

**Interfaces:**
- Consumes: Task 1.
- Produces: job `cadvisor` (target `cadvisor:8080`), series such as `container_memory_working_set_bytes{name="finskool-backend"}` and `container_oom_events_total{name=...}`. If container names are missing, this task's Step 4 decides the fallback and records it in `NOTES.md`.

- [ ] **Step 1: Add `cadvisor`** with `--docker_only=true`, `--housekeeping_interval=30s`, read-only mounts of `/`, `/var/run`, `/sys`, `/var/lib/docker` and `/dev/disk`, and a memory limit. Add job `cadvisor`.
- [ ] **Step 2: Validate** (`config -q`, `promtool`).
- [ ] **Step 3: Deploy.**
- [ ] **Step 4: Verify names resolve (Review Focus 3)**

```bash
curl -s 'http://127.0.0.1:9091/api/v1/query?query=container_memory_working_set_bytes%7Bname%3D~%22finskool-.%2B%22%7D' | grep -o '"name":"[^"]*"' | sort -u
```

Expected: all running Finskool containers by name (`finskool-backend`, `finskool-worker`, ...). If only IDs or empty labels appear, do not continue: record this in `NOTES.md`, remove the `cadvisor` job, and replace cAdvisor with a Docker-API stats exporter behind the socket proxy from Task 4. Re-run this step's query against the replacement until names appear.
- [ ] **Step 5: Add the container dashboard** (CPU, memory, restarts per container) and check its numbers against `docker stats --no-stream`.
- [ ] **Step 6: Commit** `git commit -am "feat: add cadvisor and container dashboard"`

---

### Task 4: Container lifecycle and kill reason

**Files:**
- Modify: `docker-compose.yml`, `prometheus/prometheus.yml`

**Interfaces:**
- Consumes: Task 1.
- Produces: `docker-socket-proxy` (read-only, endpoints `CONTAINERS=1` and `EVENTS=1` only, everything else denied) and a Docker-state exporter reading through it. After this task, record in `NOTES.md` the exact metric names for container state, exit code, OOM-killed flag, restart count and start time (verify them against the exporter's README before writing any alert on them). Later tasks use those names.

- [ ] **Step 1: Add the socket proxy and the state exporter.** The exporter has no direct socket mount; it talks to `docker-socket-proxy:2375`. Add its job.
- [ ] **Step 2: Validate** (`config -q`, `promtool`).
- [ ] **Step 3: Deploy.**
- [ ] **Step 4: Kill drill (Review Focus 4)**

```bash
docker run -d --name monitor-test alpine sleep 600
docker kill monitor-test
# after ~1 minute, query the exit-code metric for name="monitor-test": expect 137
docker rm monitor-test
```

Then repeat with `docker stop monitor-test` (expect 143) and with a memory-limited container that exceeds its limit (`docker run --memory 20m ... stress-style allocation`), expecting the OOM flag set.
- [ ] **Step 5: Security check:** from inside the exporter's network, confirm a write call through the proxy is refused (for example `curl -X POST http://docker-socket-proxy:2375/containers/create` must return 403).
- [ ] **Step 6: Commit** `git commit -am "feat: container lifecycle exporter via read-only docker proxy"`

---

### Task 5: Disk usage by consumer

**Files:**
- Create: `scripts/disk-usage.sh`
- Modify: server crontab or a systemd timer (documented in `README.md`)

**Interfaces:**
- Consumes: Task 2's textfile directory.
- Produces: metrics `docker_volume_bytes{volume}`, `docker_images_bytes`, `docker_build_cache_bytes`, `docker_container_log_bytes{container}` written to `/var/lib/node-exporter/textfile/docker_disk.prom`.

- [ ] **Step 1: Write `scripts/disk-usage.sh`:** runs `docker system df -v` and the sizes of `/var/lib/docker/containers/*/*-json.log`, writes the four metrics atomically (write to a temp file, then `mv`), with `timeout 120`. Runs every 10 minutes.
- [ ] **Step 2: Check the script by hand first**

```bash
bash -n scripts/disk-usage.sh && bash scripts/disk-usage.sh && cat /var/lib/node-exporter/textfile/docker_disk.prom
```

Expected: one line per volume, plus the three totals. The build-cache figure should match `docker system df` (reported 99 GB as of 2026-11-12, real size unconfirmed).
- [ ] **Step 3: Install the 10-minute schedule on the server and wait one interval.**
- [ ] **Step 4: Verify in Prometheus:** `docker_volume_bytes{volume="finskool-postgres-data"}` returns a value near the size from `docker system df -v`.
- [ ] **Step 5: Commit** `git add scripts && git commit -m "feat: docker disk usage metrics"`

---

### Task 6: Finskool Postgres and Redis exporters

**Files:**
- Modify: `docker-compose.yml`, `prometheus/prometheus.yml`, `.env.example`
- Create: `scripts/create-monitoring-role.sql`

**Interfaces:**
- Consumes: Task 0's network name `FINSKOOL_NET` and container names.
- Produces: jobs `postgres-finskool` and `redis-finskool`; Postgres metrics for connections used (`pg_stat_activity_count`) and the limit (`pg_settings_max_connections`); Redis metrics for memory, clients, operations and evictions. Confirm exact names against the live `/metrics` output before Task 9 uses them.

- [ ] **Step 1: Create a read-only Postgres role** (`scripts/create-monitoring-role.sql`): `CREATE ROLE monitoring LOGIN PASSWORD '<from .env>'; GRANT pg_monitor TO monitoring;`. Run it once inside `finskool-postgres` with `psql`.
- [ ] **Step 2: Add the exporters,** attach them to both `monitoring` and `FINSKOOL_NET`, read credentials from `.env`, and add the jobs.
- [ ] **Step 3: Validate** (`config -q`, `promtool`).
- [ ] **Step 4: Deploy.**
- [ ] **Step 5: Verify real data (Review Focus 6)**

```bash
curl -s 'http://127.0.0.1:9091/api/v1/query?query=pg_settings_max_connections'    # a number, not empty
curl -s 'http://127.0.0.1:9091/api/v1/query?query=redis_connected_clients'        # at least 1
```

Then break the password on purpose in `.env`, recreate the exporter, and confirm the data disappears or an error metric rises. Restore the password.
- [ ] **Step 6: Commit** `git commit -am "feat: finskool postgres and redis exporters"`

---

### Task 7: Edge and uptime (Caddy metrics, blackbox, MinIO)

**Files:**
- Modify: `/opt/edge/Caddyfile` on the server (and `docker-compose.yml` here for the blackbox exporter), `prometheus/prometheus.yml`
- Create: `blackbox/blackbox.yml`, `grafana/provisioning/dashboards/edge.json`

**Interfaces:**
- Consumes: Task 1; the edge's `eqlion-network`.
- Produces: job `caddy` (target `edge-caddy:9180`, not published on the host); job `blackbox` with `probe_success`, `probe_duration_seconds`, `probe_ssl_earliest_cert_expiry` for `https://community.finskool21.in/` and `https://community.finskool21.in/api/docs.json`; optionally job `minio`.

- [ ] **Step 1: Enable Caddy metrics** by adding to the global block `servers { metrics }` and a site `:9180 { metrics }` (an internal-only port, not in the compose `ports:`). Confirm both directives against the Caddy 2.8 docs first. Edit the file in place (`cat new > Caddyfile`), run `caddy validate`, then `caddy reload`, as in the server reference.
- [ ] **Step 2: Add `blackbox-exporter`** with an HTTP module that follows redirects and checks TLS, and add the probe targets.
- [ ] **Step 3: MinIO (optional in this task):** generate a bearer token with `mc admin prometheus generate` and add the job. Do not set the public-metrics environment variable, because that restarts MinIO.
- [ ] **Step 4: Validate** (`caddy validate`, `config -q`, `promtool`).
- [ ] **Step 5: Verify**

```bash
curl -s 'http://127.0.0.1:9091/api/v1/query?query=probe_success'                      # 1 for each target
curl -s 'http://127.0.0.1:9091/api/v1/query?query=probe_ssl_earliest_cert_expiry'      # a timestamp in Feb 2027
```

Fail-safe check: confirm both public sites still answer (`curl -sI https://community.finskool21.in/`) right after the Caddy reload.
- [ ] **Step 6: Commit** `git commit -am "feat: caddy metrics and blackbox uptime probes"`

---

### Task 8: Telegram contact point and routing

**Files:**
- Modify: `.env.example` (no secret values), `README.md`

**Interfaces:**
- Consumes: Task 1's Grafana.
- Produces: Grafana contact points `telegram-critical` and `telegram-warning` (two chats, or one chat if you prefer), and a notification policy that routes `severity=critical` to the first and `severity=warning` to the second.

- [ ] **Step 1 (you):** create a bot with BotFather, note the token, create the chat or chats, add the bot, note the chat IDs. Put the token and IDs in `/opt/monitoring/.env` only.
- [ ] **Step 2:** In Grafana, create the contact points and the notification policy in the UI, using the token and chat IDs. Export the structure (without secrets) to `alerts/export/contact-points.json` for the repo.
- [ ] **Step 3: Verify a real message arrives (Review Focus 2).** Use the contact point's Test button for each chat. Expected: a message in Telegram within a few seconds. If nothing arrives, check the token and chat ID, and that the server can reach `api.telegram.org`.
- [ ] **Step 4: Verify failure is visible:** temporarily save a wrong token, press Test, and confirm Grafana shows a delivery error. Restore the correct token and re-test.
- [ ] **Step 5: Commit** the export `git add alerts/export && git commit -m "feat: telegram contact points and routing"`

---

### Task 9: Alert rules, editable in the UI

**Files:**
- Create: `alerts/server.json`, `alerts/containers.json`, `alerts/data.json`, `alerts/edge.json`, `scripts/load-alert-rules.sh`

**Interfaces:**
- Consumes: metric names recorded in `NOTES.md` from Tasks 3, 4, 6 and 7; the contact points from Task 8.
- Produces: alert rule groups in Grafana, each with `severity` label `critical` or `warning` and the wait time below (all editable in the UI).

| Rule | Condition | Wait | Severity |
| --- | --- | --- | --- |
| Site unreachable | `probe_success == 0` | 2m | critical |
| Container exited unexpectedly | a Finskool container not in the running state (state metric from Task 4) | 1m | critical |
| Container OOM-killed | `increase(container_oom_events_total{name=~"finskool-.+"}[5m]) > 0` | 0m | critical |
| Container crash-looping | more than 3 restarts in 10 minutes | 3m | critical |
| Host RAM high | `1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes > 0.85` | 5m | critical |
| Caddy 5xx rate | share of 5xx responses above 2% (names from Task 7) | 5m | critical |
| Memory leak | a Finskool container's working set grew by more than 100 MiB over 1 h and is still rising | 30m | warning |
| Disk high | free space on `/` below 20% | 15m | warning |
| Disk filling | `predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[6h], 24*3600) < 0` | 15m | warning |
| DB connections high | `pg_stat_activity_count / pg_settings_max_connections > 0.8` | 5m | warning |
| Redis memory high | used memory above 80% of `maxmemory`, or of the share chosen in Task 0 if `maxmemory` is unset | 5m | warning |
| Certificate near expiry | `probe_ssl_earliest_cert_expiry - time() < 14*86400` | 1h | warning |

- [ ] **Step 1: Write the rule JSON files** with the conditions above, using the real metric names from `NOTES.md`.
- [ ] **Step 2: Write `scripts/load-alert-rules.sh`:** posts each rule to Grafana's alert-rule provisioning API with the `X-Disable-Provenance: true` header so the rules stay editable in the UI. Confirm the header name against the Grafana docs for the pinned version.
- [ ] **Step 3: Check the script:** `bash -n scripts/load-alert-rules.sh`, then run it against the server's Grafana through the tunnel.
- [ ] **Step 4: Verify editable (Review Focus 5):** open one rule in the UI, change its wait time, save, and confirm the save succeeds. If the rule shows as provisioned and read-only, fix the header or load method before continuing.
- [ ] **Step 5: Verify firing, one rule at a time:** point a rule at a test condition (for example lower the host RAM threshold below current use), confirm the alert reaches Telegram, then restore the threshold and confirm the "resolved" message.
- [ ] **Step 6: Commit** `git add alerts scripts && git commit -m "feat: alert rules for server, containers, data and edge"`

---

### Task 10: Finskool overview dashboard and deploy markers

**Files:**
- Create: `grafana/provisioning/dashboards/finskool-overview.json`
- Modify: `d:\finskool-monorepo\docker\deploy.sh` (Finskool repo; one block near the start and one in `on_exit`)

**Interfaces:**
- Consumes: Tasks 2 to 7 metrics; a Grafana API token with `annotations:write`, stored on the server in `/opt/monitoring/.env` as `GRAFANA_DEPLOY_TOKEN`.
- Produces: a dashboard with host, containers, Postgres, Redis, edge and uptime rows, and Grafana annotations "deploy started" and "deploy finished: ok or failed" with the commit SHA.

- [ ] **Step 1: Build the overview dashboard** and provision it.
- [ ] **Step 2: Add the annotation calls to `docker/deploy.sh`:** a `curl` to `http://127.0.0.1:3003/api/annotations` at the start and in the `on_exit` trap, both guarded so a Grafana outage can never fail or delay a deploy (short timeout, errors ignored).
- [ ] **Step 3: Check the script:** `bash -n docker/deploy.sh`.
- [ ] **Step 4: Verify:** run a no-change deploy (`bash docker/deploy.sh` reports "already deployed" and exits) and then a real push; confirm both annotations appear on the dashboard with the right SHA, and that stopping Grafana during a deploy does not change the deploy result.
- [ ] **Step 5: Commit** in both repos (`monitoring` and `finskool-monorepo`).

---

### Task 11: Harden the monitoring stack and back it up

**Files:**
- Modify: `docker-compose.yml`
- Create: `scripts/backup-grafana.sh`, `scripts/export-alert-rules.sh`

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: memory limits, a weekly Grafana volume archive and a weekly alert-rule export.

- [ ] **Step 1: Set memory limits** (starting values, tune after a week): Prometheus 1 GiB, Grafana 512 MiB, cAdvisor 256 MiB, node-exporter 64 MiB, blackbox 64 MiB, each exporter 64 MiB, socket proxy 32 MiB.
- [ ] **Step 2: Write the two scripts.** `export-alert-rules.sh` saves the live rules to `alerts/export/`. `backup-grafana.sh` archives `grafana_data` to `/root/backups/` and keeps the last 4.
- [ ] **Step 3: Check the scripts** (`bash -n`) and run each once; confirm the archive exists and the export is valid JSON.
- [ ] **Step 4: Restore test:** restore the archive into a temporary volume and confirm Grafana starts with its dashboards and rules.
- [ ] **Step 5: Verify limits hold:** `docker stats --no-stream` shows each monitoring container with a limit well under 31 GB; after 24 hours none was OOM-killed.
- [ ] **Step 6: Commit** `git commit -am "feat: limits and backups for the monitoring stack"`

---

### Task 12: Finskool log rotation and memory limits (scheduled, after 7 days of data)

**Files:**
- Modify: `d:\finskool-monorepo\docker\docker-compose.production.yml`

**Interfaces:**
- Consumes: at least 7 days of `container_memory_working_set_bytes` data.
- Produces: per-service `logging` options (`json-file`, `max-size: 20m`, `max-file: "5"`) and `mem_limit` per Finskool service equal to twice that container's 7-day peak working set, rounded up to the next 64 MiB.

- [ ] **Step 1: Read each container's 7-day peak from Prometheus** (`max_over_time(container_memory_working_set_bytes{name="..."}[7d])`) and compute the limits by the rule above. Record the numbers in `NOTES.md`.
- [ ] **Step 2: Edit the compose file** with logging options and limits. Do not set a limit below the observed peak.
- [ ] **Step 3: Validate:** `docker compose -f docker/docker-compose.production.yml --env-file apps/backend/.env config -q`.
- [ ] **Step 4: Announce a quiet window and deploy** through the normal CI path (the stack-level deploy recreates containers, with the maintenance page showing during it).
- [ ] **Step 5: Verify:** all Finskool containers healthy, `docker inspect <name> --format '{{.HostConfig.Memory}}'` shows the limit, and no alert fired except the expected deploy-time container restarts.
- [ ] **Step 6: Commit** in `finskool-monorepo`.

---

### Task 13: Enable `pg_stat_statements` (scheduled, short database restart)

**Files:**
- Modify: `d:\finskool-monorepo\docker\docker-compose.production.yml` (the `postgres` service command)

**Interfaces:**
- Consumes: Task 6's exporter.
- Produces: the extension active in Finskool's database, and query-statistics metrics (calls, total and mean time per query) visible through the exporter or a Grafana table.

- [ ] **Step 1: Add** `command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements"]` to the Finskool `postgres` service.
- [ ] **Step 2: Announce a quiet window.** The restart takes the API down for the length of a Postgres restart; the maintenance page covers it only if deployed through `deploy.sh`.
- [ ] **Step 3: Deploy, then create the extension:** `docker exec finskool-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;'`
- [ ] **Step 4: Verify:** `SELECT calls, mean_exec_time, left(query, 60) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 5;` returns rows after some traffic.
- [ ] **Step 5: Commit** in `finskool-monorepo`.

---

### Task 14: Failure drills and documentation

**Files:**
- Modify: `d:\finskool-monorepo\docs\production-server-reference.md`, `d:\monitoring\README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a verified, documented phase A.

- [ ] **Step 1: Run the drills on the server and confirm each alert reaches Telegram within the rule's wait time plus a minute:**
  - stop `finskool-worker` for 2 minutes (container exited),
  - block the site by stopping `finskool-nginx` briefly in a quiet moment (site unreachable),
  - run a temporary memory-limited container to the limit (OOM-killed),
  - fill 1 GB of disk in a temp file and confirm the disk alerts' direction, then delete it.
  Restore everything after each drill and confirm "resolved" messages.
- [ ] **Step 2: Confirm the stack does not hurt the apps:** compare Finskool API latency (a simple curl timing loop) before and after phase A.
- [ ] **Step 3: Update the docs:** add the monitoring project to the server reference (containers, ports, access by SSH tunnel, backups) and write the runbook in `README.md` (tunnel command, deploy, rollback, adding an alert).
- [ ] **Step 4: Commit** in both repos and tell the team where the dashboards and the runbook are.

---

## Later phases (each gets its own plan after phase A is live)

| Phase | Delivers |
| --- | --- |
| B | Loki and Alloy: central logs with request IDs, access logs, secret redaction in the backend |
| C | Backend and frontend request metrics (in-flight, p50/p95/p99), BullMQ queue and cron tracking, DB pool metrics |
| D | OpenTelemetry tracing and Tempo (check Express 5, Prisma 7 and Next.js 16 support first) |
| E | Browser monitoring with Grafana Faro and its public endpoint |
| F | Audit trail (parked) |
| Last | External pinger and heartbeat |
