# Server Monitoring Proposal

Status: draft for review. Nothing in this proposal is installed yet.
Date: 2026-11-12 (scope updated the same day)
Companion: [production-server-reference.md](production-server-reference.md) describes the server this applies to.

This proposal covers two things. First, visibility into the whole production server: memory, disk, CPU and who is using what. Second, deep visibility into the Finskool application: frontend, backend, databases, workers and cron jobs. Everything is self-hosted on the same server, with alerts to Telegram. EqLion gets the server-level coverage automatically (the container and host metrics see every container) and its application-level depth is added later.

Several choices are made. The items in "Open decisions" are not.

## What we want to know

### Whole server

- Overall memory, CPU, disk space and network, and how they trend.
- Who is using what: CPU and memory per container, and disk use by volumes, images, build cache and logs.

### Containers (Finskool for now)

- A container that was pushed but never started, or crashed on start, and what blocked it.
- Whether a container was killed by an action (a stop, a deploy) or by load (out of memory).
- CPU and memory used by each container, and restarts.

### Frontend

- **Next.js server container:** its logs, CPU and memory, request load, concurrent requests and the slowest requests.
- **Users' browsers:** JavaScript errors, slow page loads and failed or slow API calls as real visitors see them.

### Backend

- Concurrent requests and current load, and the times of day with peak load and how high the peak goes.
- Response time as p50, p95 and p99, per route.
- For a failed request: the request flow and the stack where it failed.
- A time breakdown inside each request (database, Redis, external calls).
- Whether a failure was the container dying or the request failing.

### Databases and Redis

- Database connections used against the maximum, query times, slow queries and overall load.
- The same kind of picture for Redis: operations, memory, clients, evictions and latency.

### Workers and cron jobs

- Queue depth, failed jobs, job duration and wait time.
- For each cron job: when it last ran, how long it took, and whether it succeeded.

### Alerts

- Alert speed depends on the failure, so each alert rule has its own wait time and severity, editable from a UI.

**Constraints:** self-hosted on one shared server, light enough not to compete with the apps, independent of any single project, alerts to Telegram.

**Non-goals:** business analytics, a heavy self-hosted Sentry, and making the monitoring itself highly available.

## Decisions so far

| Topic | Decision |
| --- | --- |
| Hosting | Self-hosted on the production server, in its own project in `/opt/monitoring`, owned by no single app (the same arrangement as `/opt/edge`) |
| Scope | Server-wide metrics for all containers, application depth for Finskool only. Other projects are added later. |
| Alert channel | Telegram |
| Alert speed | Set per failure type and editable from a UI. Defaults are in the alerting section. |
| Access to dashboards | SSH tunnel for now. A VPN (WireGuard or Tailscale) can replace it later with no stack change, because the services stay on `127.0.0.1`. |
| Metrics, dashboards and alerting | Prometheus and Grafana, with Grafana's own alerting so thresholds can be edited in the UI. A separate Alertmanager container is not used. (Alerting choice awaiting confirmation.) |
| Browser monitoring | Yes, both the Next.js server and real visitors' browsers are in scope |
| External uptime pinger | Parked until last |
| Audit trail | Parked. It was not in the latest requirement list. |

## Proposed stack

Three kinds of data are collected: metrics (numbers over time), logs, and traces (the time breakdown inside one request). Grafana shows all three.

```
node-exporter  cAdvisor  Docker events  blackbox  DB and Redis exporters  Caddy  MinIO
       \          |           |            |               |               |      /
        '---------+-----------+------------+---------------+---------------+-----'
                                    |
                               Prometheus     (metrics, scraped every 30 s)

 container logs, backend and frontend logs --> Alloy --> Loki      (logs)
 OpenTelemetry in the backend and Next.js  --> Alloy --> Tempo     (traces)
 browser SDK (Grafana Faro)                --> Alloy --> Loki, Tempo

                                    |
                                 Grafana    (dashboards and alert rules, edited in the UI)
                                    |
                                Telegram
```

| Job | Tool | What it does | Phase | Memory (estimate) |
| --- | --- | --- | --- | --- |
| Collect: server | node-exporter | Host CPU, memory, swap, disk, network | A | about 20 MB |
| Collect: containers | cAdvisor | Per-container CPU, memory, restarts, OOM kills | A | about 100-200 MB |
| Collect: container lifecycle | A small Docker-events source | Records create, start, die and kill with exit code and signal | A | about 20 MB |
| Collect: disk by consumer | A small exporter over Docker's disk usage | Volumes, images, build cache and log sizes | A | negligible |
| Collect: websites | blackbox-exporter | Public URLs answer and certificates are valid | A | about 20 MB |
| Collect: databases | postgres-exporter and redis-exporter, one per instance | Connections, query statistics, memory, evictions | A | about 20 MB each |
| Store metrics | Prometheus | Keeps metrics, capped by size so it cannot fill the disk | A | about 200-400 MB |
| Show and alert | Grafana | Dashboards and alert rules, with Telegram as the contact point | A | about 150-200 MB |
| Logs | Loki and Grafana Alloy (replaces Promtail in the new stack) | Collect and search all container logs | B | about 250-450 MB together |
| App metrics | `prom-client` in the backend, instrumentation in Next.js | Request, queue and cron metrics | C | in the apps |
| Traces | OpenTelemetry in the apps and Grafana Tempo | Time breakdown of each request | D | about 200-400 MB |
| Browser | Grafana Faro SDK in the frontend | Errors, page speed and API calls from visitors | E | in the frontend |

Estimates are rough. For comparison, EqLion's existing stack measured on 2026-11-12: Prometheus 116 MiB, Grafana 190 MiB, Loki 103 MiB, Promtail 124 MiB. The full stack should stay near 1.5 to 2 GB, against about 29 GB of available RAM.

Caddy and MinIO publish their own metrics. Caddy needs its metrics option enabled, and MinIO needs a token or its public-metrics setting.

## What we monitor and how

"Code change" means the Finskool application or its deploy script must be edited. "No code" means it is collected from outside the app.

### 1. Whole server

| You want | How | Code change |
| --- | --- | --- |
| Memory, CPU, load, swap, disk, network and trends | node-exporter | No |
| Who uses CPU and memory | cAdvisor, per container | No |
| Who uses the disk (volumes, images, build cache, logs) | An exporter over Docker's disk usage | No |
| Processes that are not containers | process-exporter, only if needed | No |

### 2. Containers

| You want | How | Code change |
| --- | --- | --- |
| Pushed but never started, or crashed on start: what blocked it | Docker events (create, start, die, exit code) plus startup logs in Loki | Small change to `docker/deploy.sh` to mark each deploy and its result on the graphs |
| Killed by an action or by load | Docker events record the signal and exit code (137 means killed, 143 means stopped). Memory kills also appear as OOM events. | No |
| CPU, memory and restarts per container | cAdvisor | No |
| Container missing or stuck | A rule that fires when a container that should run is absent or not running | No |

### 3. Frontend: Next.js server

| You want | How | Code change |
| --- | --- | --- |
| Logs | Loki collects the container's output | No |
| CPU and memory | cAdvisor | No |
| Request load and concurrent requests | Caddy and nginx metrics from outside, and Next.js instrumentation for per-route detail | Small |
| Slow requests and why | Traces of server-rendered pages | Small |

### 4. Frontend: users' browsers

| You want | How | Code change |
| --- | --- | --- |
| JavaScript errors with stack traces | Grafana Faro, stored as logs in Loki with alerts on bursts | Yes, the SDK in the client code |
| Page speed and Core Web Vitals (LCP, CLS, INP) | Faro, shown on dashboards | Yes |
| Failed and slow API calls as the visitor saw them | Faro | Yes |
| One trace from the click through the backend to the database | Faro attaches a trace ID to the browser's API calls, joined with the backend traces | Yes, needs phase D first |

This needs a public endpoint on the domain (for example `/faro`) that forwards to Alloy. Rules for it are in the security section.

### 5. Backend

| You want | How | Code change |
| --- | --- | --- |
| Concurrent requests and current load | An in-flight request gauge and request rate | Yes, one middleware |
| p50, p95 and p99 per route | A latency histogram per route | Yes, same middleware |
| Peak load times and how high | Request rate over hours and days on a dashboard | No, from the same data |
| Why a request failed, and its flow | A request ID in every log line, structured error logs with stack traces | Yes |
| Time breakdown inside a request | Distributed tracing: OpenTelemetry in the backend and Tempo | Yes |
| Container failed or request failed | Docker events (container) versus error logs and traces (request) | No |

### 6. Databases and Redis

| You want | How | Code change |
| --- | --- | --- |
| Connections used against the maximum | postgres-exporter | No |
| The app's own connection pool use | Pool metrics from the app | Yes |
| Query times and slow queries | `pg_stat_statements` plus traces | Postgres setting change and a short database restart |
| Overall database load | postgres-exporter: transactions per second, locks, deadlocks, cache hit ratio, size | No |
| Redis load | redis-exporter: operations per second, memory, clients, evictions, latency | No |

### 7. Workers and cron jobs

| You want | How | Code change |
| --- | --- | --- |
| Queue depth, failed jobs, job duration, wait time | BullMQ metrics from the worker | Yes |
| Cron job tracking | Last run time, duration and result for each job, exported as metrics | Yes |
| A cron job that did not run | Alert when a job's last success is older than its schedule allows | No, from the same data |

### Other layers

| Layer | What we watch | How |
| --- | --- | --- |
| Docker housekeeping | Build cache, image growth, container log size | Disk alerts, a scheduled prune, log rotation (`max-size`) |
| Edge (Caddy) | Requests per domain, 5xx rate, latency, certificate days left | Caddy metrics |
| Uptime | Public URLs reachable, TLS valid | blackbox-exporter, later an external pinger |
| Unusual activity | Traffic surges, login-failure spikes, newly exposed ports | Rules over metrics and logs, plus a port check |

## Alerting

Timing depends on the failure, so each rule has its own wait time and severity. These are suggested defaults, all editable in the Grafana UI.

| Failure point | Alerts after | Severity |
| --- | --- | --- |
| Public site unreachable | 2 min | Critical |
| Container exited unexpectedly | 1 min | Critical |
| Container killed for memory (OOM) | Immediately | Critical |
| Container crash-looping (3 restarts) | 3 min | Critical |
| Host RAM above 85% | 5 min | Critical |
| Backend 5xx rate above 2% | 5 min | Critical |
| Backend p95 latency above 2 s | 5 min | Warning |
| Memory leak (steady growth over the window) | 30 min | Warning |
| Database connections above 80% of the maximum | 5 min | Warning |
| Redis memory above 80% of its limit | 5 min | Warning |
| Queue backing up | 10 min | Warning |
| Disk above 80%, or will fill within 24 h | 15 min | Warning |
| Browser JavaScript error burst | 10 min | Warning |
| Certificate under 14 days | 1 h | Warning |
| Cron job missed its run | 25 h | Warning |

Critical alerts go to Telegram as soon as the wait time passes. Warnings can go to a separate chat or a digest. Silences and mute windows are set in the UI.

**Trade-offs of UI-edited alert rules**

- Rules live in Grafana's database. The `grafana_data` volume needs a backup, and rules should be exported to files now and then.
- Rules run inside Grafana. If Grafana stops, alerts stop. The external heartbeat, still to be decided, covers that.

## Error tracking options

Example used for comparison: a payment webhook crashes on a null field.

| Option | What you would see | Weight | Gaps |
| --- | --- | --- | --- |
| A. Log-based alerts (Loki and Grafana), plus Faro for the browser | A Telegram alert such as "12 `unhandled error` lines in 5 min". You search Loki by request ID and read the stack trace in the log line. Browser errors arrive the same way. | No extra containers | No grouping of identical errors and no "new since this deploy" |
| B. GlitchTip (self-hosted, Sentry-compatible) | A grouped issue: "TypeError: cannot read 'id' of undefined, payments.service.ts:142. 37 events, 12 users, first seen after deploy abc123", with the stack trace | About 300-500 MB | Needs the Sentry SDK in the backend and frontend. Notifications go by email, Slack or webhook, so Telegram needs a small webhook bridge. |
| C. Bugsink (self-hosted, Sentry-compatible) | The same grouped issues, error tracking only | Lighter, about one container | Newer, smaller community, same SDK work |
| D. Self-hosted Sentry | Everything, including tracing and session replay | Very heavy: several GB of RAM and about a dozen containers | Not realistic on a shared server |
| E. Hosted Sentry free tier | Same as B, nothing to run | None | The data leaves the server, which conflicts with the self-hosting choice |

**Recommendation:** start with A. It needs no extra tool, and its rules are editable in the same Grafana UI. Add GlitchTip later if grouped issues or release tracking are needed. It can run alongside Faro.

## Access, security and resource impact

- **Access:** Grafana and Prometheus bind to `127.0.0.1` and are opened through an SSH tunnel (`ssh -L`). Nothing in the monitoring stack is published publicly, except the browser endpoint below.
- **Browser endpoint:** Faro needs a public path on the domain, because browsers send data from the internet. It must be rate-limited, restricted to the site's own origin, size-capped, and its data treated as untrusted, since anyone can send to it.
- **Privacy:** URLs can carry tokens in the query string (the backend error middleware already strips them for that reason), so the browser SDK must strip them too. Sessions stay anonymous: no user ID, or only an opaque one, to be decided.
- **Sampling and retention (proposed):** metrics 15 days, logs 14 days, traces 3 to 7 days. Browser performance data is sampled (about 10-20% of sessions) and all errors are kept.
- **Ports:** EqLion's existing Prometheus (9090), Loki (3100) and Grafana (3002) already use those loopback ports, so the new stack uses different ones or none.
- **Secrets:** the Telegram bot token and exporter credentials live in a `.env` on the server, never in git. Database exporters use a read-only monitoring role.
- **Host access:** node-exporter and cAdvisor need read-only mounts of host paths. The Docker-events source needs read access to the Docker socket, which is sensitive, so it should be a minimal read-only proxy or a tool known to do nothing else.
- **Networks:** the stack joins `eqlion-network` (to reach Caddy and EqLion) and Finskool's own network (to reach its Postgres and Redis). The exact name of Finskool's network still needs confirming on the server.
- **Existing EqLion observability:** left running and untouched for now, at a cost of about 530 MB. Merging it into the new stack is a later step.
- **Memory limits:** no container has one today. Setting limits from the measured baseline is part of phase A, so a leak is contained to one container.

## Rollout

| Phase | Delivers | Touches app code | Depends on |
| --- | --- | --- | --- |
| A | Server, container and container-lifecycle metrics, disk by consumer, Postgres and Redis metrics, `pg_stat_statements`, uptime checks, Grafana alerts to Telegram, memory limits | Only `deploy.sh` | Confirming the stack |
| B | Central logs with request IDs, access logs and secret redaction | Yes (pino setup) | A |
| C | Backend and frontend request metrics, queue and cron tracking | Yes | A |
| D | Server-side tracing and the per-request time breakdown | Yes | A, B |
| E | Browser monitoring with Faro, joined to the traces | Yes (frontend) | B, D |
| F | Audit trail for payments and admin actions (parked) | Yes | Independent |

Each phase gets its own spec, plan and rollout. A is first because it covers the server and container questions and changes almost no application code.

## Open decisions and risks

### To decide

| Decision | Note |
| --- | --- |
| Confirm the stack: Prometheus, Grafana, Loki, Tempo, Alloy | Tempo and Alloy were added when tracing and browser monitoring came into scope |
| Confirm Grafana alerting in place of Alertmanager | This is what makes alert timings editable in the UI |
| Error tracker | Log-based plus Faro first is recommended, GlitchTip later if needed |
| Browser privacy and sampling | Whether sessions carry any user identity, and the sampling rate |
| Mobile app | Faro covers the web only. Errors inside the mobile app would need a separate tool. Backend metrics already show all mobile API traffic. |
| How Caddy's metrics are exposed | Its admin endpoint listens only inside the container, so reaching it from Prometheus means changing the admin address. This needs a safe design. |
| Telegram setup | Create a bot with BotFather and choose the chat or chats for critical alerts and warnings |
| Retention values | Confirm the proposed 15, 14 and 3 to 7 days |
| External pinger and heartbeat | Parked until last. Nothing on the server can report that the server itself died. |

### Risks to test first

| Risk | Why it matters |
| --- | --- |
| OpenTelemetry support for the Finskool stack | The backend uses Express 5 and Prisma 7, and the frontend uses Next.js 16. Check that the instrumentation libraries support them before committing to phase D. |
| cAdvisor on this server's containerd image store | cAdvisor can fail to name containers with it, which would make dashboards and alerts unreadable. Test at the start of phase A. If it fails, use an exporter that reads container stats from Docker directly. |
| Docker events are not replayed | The kill reason is only known if the events are captured as they happen. Past kills cannot be recovered. |
| `pg_stat_statements` | Needs a Postgres setting change and a short restart of `finskool-postgres`, so it must be scheduled. |
| Browser endpoint abuse | A public ingest path can be spammed. Rate limits, origin checks and size caps are required before it goes live. |
| MinIO and MailHog exposure | Ports 9003 and 8025 may be reachable from the internet. Verify from outside the server and fix independently of monitoring. |
| MailHog in production | If SMTP points at it, users receive no email. Check the server's `.env`. |
| Alert rules stored only in Grafana | Back up `grafana_data` and export rules, or a lost volume loses the alerting setup. |
