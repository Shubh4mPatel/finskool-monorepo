# Production Server Reference

As of: 2026-11-12. Facts marked "not verified" come from the compose files and have not been checked on the live server.

One server with 8 cores and 32 GB of RAM runs all three projects, and it is lightly loaded: about 3 GB of RAM in use and 28% of the disk. It has no swap space.

## Hardware and host

| Item | Value |
| --- | --- |
| Hostname | srv1977180 |
| CPU | 8 cores |
| RAM | 32,094 MB total, 2,955 MB used, 29,139 MB available (most of the rest is file cache) |
| Swap | None |
| Disk | /dev/sda1, 387 GB total, 105 GB used (28%), 282 GB free |
| Public IP | 82.112.235.160 (IPv4 only, no IPv6 record for the domains) |
| Host firewall | ufw is inactive. Any provider-level firewall is unknown. |
| Docker image store | overlayfs with the containerd snapshotter, so image layers and build cache live under /var/lib/containerd, not /var/lib/docker |
| Not yet recorded | OS and kernel version, hosting provider and plan, Docker and Compose versions, snapshot and backup setup |

### Docker disk use

| Type | Count | Size | Note |
| --- | --- | --- | --- |
| Images | 22 | 7.38 GB | 21 in use |
| Containers | 23 | 14.4 MB | 20 running |
| Volumes | 16 | 2.97 GB | Postgres, Redis and MinIO data lives here |
| Build cache | 1,943 entries | 99.24 GB reported, 91.86 GB reclaimable | The real size on disk is unconfirmed: Docker may count shared layers more than once. Cleanup is deferred. |

## Projects on this server

Three codebases share the server and are served from two domains: EqLion (backend plus frontend) at staging.eqlion.com, and Finskool at community.finskool21.in. The 20 running containers use about 1.5 GB of RAM in total.

| Project | Domain | Code on the server | How it deploys |
| --- | --- | --- | --- |
| EqLion-Backend | staging.eqlion.com (/api and /ws) | /root/EqLion-Backend | GitHub Actions runs `docker compose up --build -d --remove-orphans` |
| EqLion-Frontend | staging.eqlion.com (everything else) | /root/EqLion-Frontend | Its own repo and stack, joined to the same network |
| Finskool | community.finskool21.in | /root/finskool-monorepo | GitHub Actions on every push to main: SSH, `git reset --hard`, then docker/deploy.sh, which rebuilds only what changed and shows a maintenance page while it runs |

### Containers and memory snapshot

Memory is from `docker stats` on 2026-11-12. Ports come from the compose files (not verified live).

| Container | Project | Role | Memory (MiB) | Published ports |
| --- | --- | --- | --- | --- |
| edge-caddy | Edge | Public entry point, TLS | 16 | 80, 443, 443/udp |
| eqlion-backend | EqLion | API and WebSockets, internal port 3000 | 116 | none |
| eqlion-worker | EqLion | Background jobs | 55 | none |
| eqlion-tracker | EqLion | Background service (role not verified) | 85 | none |
| eqlion-frontend | EqLion | Next.js site, internal port 3000 | 55 | none |
| eqlion-postgres | EqLion | Database | 31 | 127.0.0.1:5432 |
| eqlion-redis | EqLion | Cache and queue | 10 | 127.0.0.1:6379 |
| eqlion-prometheus | EqLion | Metrics | 116 | 127.0.0.1:9090 |
| eqlion-loki | EqLion | Log storage | 103 | 127.0.0.1:3100 |
| eqlion-promtail | EqLion | Log shipper | 124 | none |
| eqlion-grafana | EqLion | Dashboards | 190 | 127.0.0.1:3002 |
| finskool-nginx | Finskool | Internal router for /api, /ws, /assets and the maintenance page | 8 | 127.0.0.1:8080 |
| finskool-backend | Finskool | Express 5 API and WebSockets, port 3001, health check at /health | 165 | none |
| finskool-worker | Finskool | BullMQ worker for notifications, email and push | 109 | none |
| finskool-cron | Finskool | Scheduled jobs: expiry reminders, admin digests, stock price refresh | 126 | none |
| finskool-frontend | Finskool | Next.js 16 site, internal port 3000 | 58 | none |
| finskool-postgres | Finskool | Database (Postgres 16) | 30 | none |
| finskool-redis | Finskool | Queue and live-notification channel, password protected | 19 | none |
| finskool-minio | Finskool | File storage (S3 compatible) | 114 | 9003 (admin console, all interfaces) |
| finskool-mailhog | Finskool | Catches outgoing mail, does not deliver it | 11 | 8025 (web UI, all interfaces) |

A one-shot container, finskool-minio-init, creates the storage buckets at start and then exits.

### Networks and data

- **eqlion-network** is an external Docker network shared by the EqLion stack, finskool-nginx and edge-caddy. Caddy reaches every site through it.
- Finskool also has its own default network for its database, Redis and MinIO.
- **Finskool volumes:** finskool-postgres-data, finskool-redis-data, finskool-minio-data, finskool-seed-flag.
- **EqLion volumes:** its Postgres data sits in an external volume carried over from an older Coolify setup, plus eqlion-redis-data, eqlion-prometheus-data, eqlion-loki-data, eqlion-grafana-data, eqlion-promtail-positions and the legacy certbot volumes.

## Central Caddy edge

A standalone Caddy container, edge-caddy, owns ports 80 and 443 and routes by domain name. Since the cutover on 2026-11-12, an EqLion deploy, restart or crash can no longer take Finskool's proxy or certificates down. Before that, EqLion's nginx held the public ports and the certificates for both projects.

```
Browsers and apps
        |
   edge-caddy  (ports 80 and 443, routes by domain)
     |                                   |
     | staging.eqlion.com                | community.finskool21.in
     v                                   v
  /api, /ws -> eqlion-backend:3000    finskool-nginx:80 (internal router)
  everything else -> eqlion-frontend:3000   |-- /api, /ws -> finskool-backend:3001
                                            |-- /assets   -> finskool-minio:9000
                                            '-- everything else -> finskool-frontend:3000
```

### How it runs

| Item | Value |
| --- | --- |
| Container | edge-caddy, image caddy:2.8-alpine, restart policy unless-stopped |
| Files | /opt/edge/docker-compose.yml and /opt/edge/Caddyfile, a compose project of its own that no project's CI deploys. Not yet in git. |
| Ports | 80, 443 and 443/udp (HTTP/3) |
| Network | eqlion-network (external), so it reaches every site by container name |
| Volumes | caddy_data (certificates and the Let's Encrypt account, needs a backup), caddy_config, and a read-only mount of eqlion-certbot-certs that is no longer used |
| Admin API | Port 2019, inside the container only |

### What it routes

| Domain | Path | Goes to | Notes |
| --- | --- | --- | --- |
| staging.eqlion.com | /api/* | eqlion-backend:3000 | The /api prefix is stripped, as EqLion's old nginx did |
| staging.eqlion.com | /ws/* | eqlion-backend:3000 | WebSockets, prefix kept |
| staging.eqlion.com | everything else | eqlion-frontend:3000 | Request body capped at 12 MiB |
| community.finskool21.in | all paths | finskool-nginx:80 | Finskool's own nginx then splits /api, /ws, /assets (MinIO) and the site. Body capped at 50 MiB. |

The edge only maps a domain to an entry point. Each project keeps its own routing rules, so Finskool's MinIO signed-path handling and maintenance page stay in the Finskool repo.

### Certificates and behavior

- **TLS:** Caddy gets and renews its own certificates from Let's Encrypt using the HTTP challenge on port 80. Both current certificates expire on 2027-02-10, and renewal starts about 30 days before. The ACME account has no contact email, so there are no expiry warning mails.
- **Redirects:** plain HTTP is redirected to HTTPS with a 308.
- **Headers and WebSockets:** Caddy sends X-Forwarded-For, X-Forwarded-Proto and Host, passes WebSocket upgrades through, and sets no read timeout.
- **Failure isolation:** a stopped upstream returns 502 for its own domain only. Tested on 2026-11-12 with a fake dead upstream while both real sites kept answering 200.
- **Upload limits:** Caddy's limit is applied while the body streams, so it acts as a backstop. The real limits are Finskool's nginx (50 MB) and EqLion's backend.

### Operating it

1. Edit the Caddyfile in place, for example `cat new-file > Caddyfile`. Do not use `sed -i`: it replaces the file, and the running container keeps reading the old one.
2. Validate: `docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile`
3. Reload without dropping connections: `docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile`

**Rollback to the old nginx** (kept as a profile in EqLion's compose file): `docker stop edge-caddy`, then in /root/EqLion-Backend run `docker compose --profile legacy-edge up -d nginx certbot`.

## Known risks and open items

| Item | What we know |
| --- | --- |
| No swap and no container memory limits | Verified. Every container shows the whole 31 GB as its limit. One leaking process can use all the RAM, and the kernel would then kill something, possibly a database. |
| MinIO console and MailHog UI may be public | Not verified. The compose files publish ports 9003 and 8025 on all interfaces, ufw is inactive, and Docker's published ports bypass ufw anyway. |
| MailHog runs in production | Not verified. MailHog catches mail without delivering it. If SMTP_HOST in the server's .env points at it, users receive no emails. |
| Single host | Verified. A crash, out-of-memory event or full disk takes EqLion and Finskool down together. |
| Build cache growth | Reported 99 GB, real size unconfirmed. Grows with every deploy and nothing prunes it. |
| Edge state not backed up | Verified. caddy_data holds the certificates and ACME account, and /opt/edge is not in git. |
| ACME account has no email | Verified. No warning mail if a renewal ever fails. |
| Wrong client IP in rate limits | Not verified live. Finskool's backend trusts one proxy hop, but two sit in front of it (Caddy, then finskool-nginx), so per-IP limits likely see the proxy's address. The setting is in apps/backend/src/app.ts. |
| Legacy edge files | EqLion still contains the unused nginx and certbot services (behind the legacy-edge profile) and templates, kept for rollback. |
| eqlion-backend crash loop | Seen on 2026-11-12, caused by a missing environment variable, fixed by adding it. It was found by chance. |
