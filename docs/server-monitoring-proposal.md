# Server Monitoring Proposal

Status: draft for review. Nothing in this proposal is installed yet.
Date: 2026-11-12
Companion: [production-server-reference.md](production-server-reference.md) describes the server this applies to.

This proposal covers monitoring the production server and everything on it (EqLion, Finskool and the Caddy edge), self-hosted on the same server, with alerts sent to Telegram. Several choices are made. The items in "Open decisions" are not.

## Goals

| # | Goal | What done looks like |
| --- | --- | --- |
| 1 | Know when something is down | A crashed or crash-looping container, a dead site or a failing health check reaches you on Telegram within minutes. The `eqlion-backend` crash loop of 2026-11-12 would have been caught. |
| 2 | Catch the server struggling early | Memory leaks (steady growth, not only a high number), a process hogging CPU or RAM, a filling disk and other unusual behavior raise an alert. |
| 3 | See both levels | Server level: CPU, memory, swap, disk, network. Docker level: each container's CPU, memory, restarts and logs. |
| 4 | Find why errors happen | Central searchable logs, a request ID you can follow, and error tracking for the API, worker, cron and frontend. |
| 5 | Trust the background jobs | The queue, cron runs, email and push delivery, and payment webhooks are visible, and you are told when one stops. |
| 6 | Keep an audit trail | A reliable record of who did what and when for payments and admin actions. It is a record to query, not an alert. |

**Constraints:** self-hosted on one shared server, light enough not to compete with the apps, independent of any single project, alerts to Telegram.

**Non-goals:** business analytics, replacing the audit trail with logs, a heavy self-hosted Sentry, and making the monitoring itself highly available.

## Decisions so far

| Topic | Decision |
| --- | --- |
| Hosting | Self-hosted on the production server, in its own project in `/opt/monitoring`, owned by no single app (the same arrangement as `/opt/edge`) |
| Alert channel | Telegram |
| Alert speed | Set per failure type, not one number, and editable from a UI. Defaults are in the alerting section. |
| Access to dashboards | SSH tunnel for now. A VPN (WireGuard or Tailscale) can replace it later with no stack change, because the services stay on `127.0.0.1`. |
| Metrics and dashboards | Prometheus and Grafana |
| Alerting | Grafana's own alerting, so thresholds and wait times can be edited in the UI. A separate Alertmanager container is not used. (Proposed, awaiting confirmation.) |
| External uptime pinger | Parked until last |

## Proposed stack

```
node-exporter   cAdvisor   blackbox-exporter   DB exporters   Caddy   MinIO
      \             |              |                |           |       /
       '------------+--------------+----------------+-----------+------'
                                   |
                              Prometheus   (stores 15 days, scrapes every 30 s)
                                   |
                                Grafana    (dashboards + alert rules edited in the UI)
                                   |
                               Telegram
```

| Job | Tool | What it does | Phase | Memory (estimate) |
| --- | --- | --- | --- | --- |
| Collect: server | node-exporter | Host CPU, memory, swap, disk, network | A | about 20 MB |
| Collect: containers | cAdvisor | Per-container CPU, memory, restarts, OOM kills | A | about 100-200 MB |
| Collect: websites | blackbox-exporter | Checks that public URLs answer and certificates are valid | A | about 20 MB |
| Collect: databases | postgres-exporter, redis-exporter (one per instance) | Connections, size, memory, evictions | A | about 20 MB each |
| Store | Prometheus | Keeps 15 days of metrics, capped by size so it cannot fill the disk | A | about 200-400 MB |
| Show and alert | Grafana | Dashboards and alert rules, with Telegram as the contact point | A | about 150-200 MB |
| Logs | Loki and a log shipper | Collects all container logs for search | B | about 200-250 MB |
| App metrics | `prom-client` in the backend | Request and queue metrics | C | in the backend |

Estimates are rough. For comparison, EqLion's existing stack measured on 2026-11-12: Prometheus 116 MiB, Grafana 190 MiB, Loki 103 MiB, Promtail 124 MiB. Phase A as a whole should stay near 700 MB to 1 GB, against about 29 GB of available RAM.

Caddy and MinIO publish their own metrics. Caddy needs its metrics option enabled, and MinIO needs a token or its public-metrics setting.

## What we monitor and when we alert

### Coverage

Sub-project in brackets: A = host, containers, edge, uptime. B = logs and error tracking. C = app and job metrics. D = audit trail.

| Layer | What we watch | How |
| --- | --- | --- |
| Server (A) | CPU, load, RAM, swap, disk space and fill rate, disk I/O, network, OOM kills, reboots | node-exporter |
| Containers (A) | CPU, memory and its trend, restarts, OOM kills, missing containers | cAdvisor, plus memory limits per container |
| Docker housekeeping (A) | Build cache, image growth, container log size | Disk alerts, a scheduled prune, log rotation (`max-size`) |
| Edge, Caddy (A) | Requests per domain, 5xx rate, latency, certificate days left | Caddy metrics |
| Uptime (A) | Public URLs reachable, TLS valid | blackbox-exporter, later an external pinger |
| Databases and stores (A) | Postgres connections, size, slow queries; Redis memory and evictions; MinIO disk and errors | Exporters and MinIO metrics |
| Backend app (C) | Request rate, latency and errors per route, event-loop lag, database pool use | `prom-client` |
| Background jobs (C) | Queue depth and age, failed jobs, last successful run of each cron job, email and push results, payment webhook outcomes | BullMQ metrics and a "last success" timestamp per cron job |
| Logs (B) | All container logs, searchable by request ID and user | Loki, `pino-http` request IDs, secret redaction |
| Error tracking (B/C) | Stack traces and frequency, frontend errors | See the next section |
| Audit trail (D) | Who did what and when for payments and admin actions | An append-only table in the application database |
| Unusual activity | Traffic surges, login-failure spikes, newly exposed ports | Rules over metrics and logs, plus a port check |

### Default alert timings

Timing depends on the failure, so each rule has its own wait time and severity. These are suggested defaults, all editable in the Grafana UI.

| Failure point | Alerts after | Severity |
| --- | --- | --- |
| Public site unreachable | 2 min | Critical |
| Container crash-looping (3 restarts) | 3 min | Critical |
| Host RAM above 85% | 5 min | Critical |
| Memory leak (steady growth over the window) | 30 min | Warning |
| Disk will fill within 24 h | 15 min | Warning |
| Disk above 80% | 15 min | Warning |
| Queue backing up | 10 min | Warning |
| Certificate under 14 days | 1 h | Warning |
| Cron job missed its run | 25 h | Warning |

Critical alerts go to Telegram as soon as the wait time passes. Warnings can go to a separate chat or a digest. Silences and mute windows are set in the UI.

### Trade-offs of UI-edited alert rules

- Rules live in Grafana's database. The `grafana_data` volume needs a backup, and rules should be exported to files now and then.
- Rules run inside Grafana. If Grafana stops, alerts stop. The external heartbeat, still to be decided, covers that.

## Error tracking options

Example used for comparison: a payment webhook crashes on a null field.

| Option | What you would see | Weight | Gaps |
| --- | --- | --- | --- |
| A. Log-based alerts (Loki and Grafana) | A Telegram alert such as "12 `unhandled error` lines in 5 min". You search Loki by request ID and read the stack trace in the log line. | No extra containers, since Loki arrives in phase B anyway | No grouping of identical errors, no "new since this deploy", and no browser errors from the Next.js frontend unless sent to the logs |
| B. GlitchTip (self-hosted, Sentry-compatible) | A grouped issue: "TypeError: cannot read 'id' of undefined, payments.service.ts:142. 37 events, 12 users, first seen after deploy abc123", with the stack trace. Also catches frontend errors. | About 300-500 MB | Needs the Sentry SDK in the backend and frontend. Notifications go by email, Slack or webhook, so Telegram needs a small webhook bridge. |
| C. Bugsink (self-hosted, Sentry-compatible) | The same grouped issues, error tracking only | Lighter, about one container | Newer, smaller community, same SDK work |
| D. Self-hosted Sentry | Everything, including tracing and session replay | Very heavy: several GB of RAM and about a dozen containers | Not realistic on a shared server |
| E. Hosted Sentry free tier | Same as B, nothing to run | None | The data leaves the server, which conflicts with the self-hosting choice |

**Recommendation:** start with A. It needs no extra tool and its rules are tunable in the same Grafana UI. Add GlitchTip later if grouped issues, release tracking or frontend crash reports are needed, since each costs SDK changes in the apps.

## Access, security and resource impact

- **Access:** Grafana and Prometheus bind to `127.0.0.1` and are opened through an SSH tunnel (`ssh -L`). Nothing is published publicly.
- **Ports:** EqLion's existing Prometheus (9090), Loki (3100) and Grafana (3002) already use those loopback ports, so the new stack uses different ones or none.
- **Secrets:** the Telegram bot token and exporter credentials live in a `.env` on the server, never in git. Database exporters use a read-only monitoring role.
- **Host access:** node-exporter and cAdvisor need read-only mounts of host paths. The Docker socket is not mounted unless a component truly needs it.
- **Networks:** the stack joins `eqlion-network` (to reach Caddy and EqLion) and Finskool's own network (to reach its Postgres and Redis). The exact name of Finskool's network still needs confirming on the server.
- **Existing EqLion observability:** left running and untouched for now, at a cost of about 530 MB. Merging it into the new stack is a later step.
- **Disk:** Prometheus retention is 15 days and capped by size.
- **Memory limits:** no container has one today. Setting limits from the measured baseline is part of phase A, so a leak is contained to one container.

## Rollout

| Phase | Delivers | Touches app code | Depends on |
| --- | --- | --- | --- |
| A | Host, container, edge and database metrics, uptime checks, Grafana alerts to Telegram, memory limits, disk and build-cache alerts | No | Confirming the stack |
| B | Central logs with request IDs, access logs and secret redaction in the backend | Yes (pino setup) | A |
| C | App and job metrics, failure alerts for queues, cron and payment webhooks, optional error tracker | Yes | A, B |
| D | Audit trail table for payments and admin actions | Yes | Independent |

Each phase gets its own spec, plan and rollout. A is first because it covers the leak and "server down" concerns and changes no application code.

## Open decisions and risks

### To decide

| Decision | Note |
| --- | --- |
| Confirm Grafana alerting in place of Alertmanager | This is what makes alert timings editable in the UI |
| Error tracker for phases B and C | Log-based first is recommended, GlitchTip later if needed |
| External pinger and heartbeat | Parked until last. Nothing on the server can report that the server itself died. |
| How Caddy's metrics are exposed | Its admin endpoint listens only inside the container, so reaching it from Prometheus means changing the admin address. This needs a safe design. |
| Telegram setup | Create a bot with BotFather and choose the chat or chats for critical alerts and warnings |

### Risks to test first

| Risk | Why it matters |
| --- | --- |
| cAdvisor on this server's containerd image store | cAdvisor can fail to name containers with it, which would make dashboards and alerts unreadable. Test at the start of phase A. If it fails, use an exporter that reads container stats from Docker directly. |
| MinIO and MailHog exposure | Ports 9003 and 8025 may be reachable from the internet. Verify from outside the server and fix independently of monitoring. |
| MailHog in production | If SMTP points at it, users receive no email. Check the server's `.env`. |
| Alert rules stored only in Grafana | Back up `grafana_data` and export rules, or a lost volume loses the alerting setup. |
