# Decisions

Short records of choices made before or during the build. Newest at the bottom.

## 001. Separate Postgres for ops data, n8n stays on SQLite (2026-10-08)

The live n8n instance runs on SQLite. Ops Console data (incidents, retries, costs) goes into its own Postgres container in the same compose, database `ops`. Migrating n8n itself to Postgres and queue mode is a later, separate stage, so the working instance isn't touched at the start.

## 002. Alerts go to Telegram (2026-10-08)

Free, no Slack API limits, and n8n has native human-in-the-loop for Telegram.

## 003. Dashboard runs on the same VPS behind traefik (2026-10-08)

Vercel Hobby doesn't allow commercial use, and hosting there would mean exposing Postgres to the internet. A container next to n8n reads Postgres over the internal docker network.

## 004. One public monorepo (2026-10-08)

`infra/`, `workflows/`, `dashboard/`, `docs/` in one GitHub repo, so a reviewer can clone it and run `docker compose up`.

## 005. Chaos workflows use webhook triggers and httpbin (2026-10-08)

Error workflows only fire on production executions, so manual runs can't test them. httpbin.org returns any status code or delay on request with no account. If httpbin turns out unreliable, a self-hosted httpbin container replaces it.

## 006. Postgres 17, no public port (2026-10-08)

The postgres:18 image moved its data directory, which breaks the common `/var/lib/postgresql/data` volume mount. 17 is pinned until there is a reason to move. The service has no `ports:`, so only containers in the same compose project can reach it.

## 007. Deduplication and idempotency live in the schema (2026-10-08)

`incidents.fingerprint` is UNIQUE, so repeated failures become `occurrences + 1` through `ON CONFLICT`. `error_events.execution_id` is UNIQUE, so a second report of the same execution is a no-op. Workflows can't forget a rule the database enforces.

## 008. Model prices are versioned by date (2026-10-08)

`model_prices` has `valid_from` in its key. When a provider changes prices, past runs keep the cost they had. The table starts empty: prices are filled in stage 5 from the providers' own pages, not from memory.

## 009. Code and SQL live as files, the workflow JSON is built from them (2026-10-13)

`workflows/ops/src/` holds the JavaScript and SQL of the error handler; `scripts/build-error-handler.py` assembles the importable JSON. Code in a JSON string can't be read, diffed or tested. As files it has unit tests (`normalize-error.test.js`) and database tests (`infra/tests/test_upsert_incident.py`).

## 010. Fingerprint = md5(workflow, node, class, normalized message), computed in SQL (2026-10-13)

The n8n Code node can't load `crypto` unless the instance allows built-ins, so hashing happens in Postgres. Normalization replaces ids, timestamps, emails, long hex and all numbers, so "timeout of 3000ms" and "timeout of 2999ms" are one problem. The workflow id is part of the key: the same error in two workflows is two incidents with two owners.

## 011. One JSON parameter for the upsert query (2026-10-13)

The whole record goes in as `$1::jsonb`. Error messages contain commas and quotes; one parameter means there is no list of values to split wrong.

## 012. Alert on new and reopened incidents only; ignored stays quiet (2026-10-13)

Repeats raise `occurrences`, not messages. A resolved incident that fails again reopens and alerts once. `last_alerted_at` is written only after Telegram confirms delivery, so a failed send is not recorded as sent.

## 013. If the ops database is down, alert anyway (2026-10-13)

The upsert node retries 3 times, then routes to an error output that sends a fallback message without dedup. A monitoring system that goes silent when its own storage fails is the failure it exists to prevent.

## 014. Classification rules are tested against messages captured from the real server (2026-10-13)

The first live run classified chaos-timeout as `unknown`: n8n 2.42.5 reports an HTTP timeout as "The connection was aborted, perhaps the server is offline", not "timeout of 3000ms exceeded". Every message seen on the real instance now goes into `normalize-error.test.js` as a fixture, so a new n8n version that rewords errors breaks a test, not an alert.
