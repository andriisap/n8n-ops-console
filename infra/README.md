# infra

| File | Purpose |
| --- | --- |
| `compose.ops-db.yml` | Postgres service for Ops Console data. Merge into the n8n compose file |
| `.env.example` | variables the compose file expects |
| `compose.dashboard.yml` | dashboard service behind traefik with basic auth |
| `migrations/001_init.sql` | schema: incidents, error_events, retry_queue, model_prices, llm_usage, heartbeats |
| `migrations/002_dashboard_role.sql` | `ops_dashboard` role: read all, update incident status only |
| `tests/001_schema_checks.sql` | checks dedup, idempotency, constraints and triggers inside a rolled-back transaction |
| `tests/002_dashboard_role_checks.sql` | tries every action the dashboard role must not be able to do |
| `tests/test_upsert_incident.py` | behaviour of the error handler's upsert query |
| `dev/seed_demo_data.py` | realistic incidents for local dashboard work |

## Tables

| Table | One row per | Written by |
| --- | --- | --- |
| `incidents` | distinct problem (fingerprint) | error workflow, stage 2 |
| `error_events` | failed execution | error workflow, stage 2 |
| `retry_queue` | scheduled retry | error workflow + scheduler, stage 4 |
| `model_prices` | model price, by date | manual, stage 5 |
| `llm_usage` | LLM call | cost-meter sub-workflow, stage 5 |
| `heartbeats` | source that reports it's alive | heartbeat workflow, stage 6 |

Migrations are plain SQL, safe to run twice, and record themselves in `schema_migrations`. Tested on Postgres 16 and written for the 17 image used in production.
