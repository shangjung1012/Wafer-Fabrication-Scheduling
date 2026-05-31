# Monitoring

Grafana + Prometheus monitoring for the wafer scheduling system.

## What It Monitors

- Application pages: configured by `MONITOR_HTTP_TARGETS` and probed through Blackbox Exporter.
- PostgreSQL health and runtime metrics: scraped through Postgres Exporter.
- Redis health, memory, clients, and command metrics: scraped through Redis Exporter.
- Wafer business metrics from PostgreSQL custom queries:
  - orders by status/type
  - active orders by due-date bucket
  - assignments by status/type
  - daily capacity utilization for the next 14 days
  - conflict issues by status
  - auto-scheduler configuration

## Start

From the repository root:

```bash
docker compose up -d
pnpm dev
cd monitor
cp .env.example .env
docker compose up -d
```

Open Grafana at `http://localhost:3001`.

Default local credentials are controlled by `monitor/.env`:

```text
admin / admin
```

Prometheus is available at `http://localhost:9090`.

## Configuration

All monitoring URLs and ports live in `monitor/.env`.

For local development on macOS, keep the defaults:

```env
MONITOR_HTTP_TARGETS="http://host.docker.internal:3000,http://host.docker.internal:3000/login,http://host.docker.internal:3000/docs"
POSTGRES_EXPORTER_DATA_SOURCE_URI="host.docker.internal:5432/wafer_db?sslmode=disable"
REDIS_EXPORTER_REDIS_ADDR="redis://host.docker.internal:6379"
GRAFANA_POSTGRES_HOST="host.docker.internal"
```

If the app, database, or Redis run inside another Docker network, change those
values to the reachable service names or URLs.
