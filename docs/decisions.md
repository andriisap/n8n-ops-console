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

## 015. The dashboard gets its own database role (2026-10-13)

`ops_dashboard` can read every table and update two columns: `incidents.status` and `incidents.resolved_at`. It can't insert, delete, edit events or change the schema. A bug or an injection in the web app is limited to what that role can do. `infra/tests/002_dashboard_role_checks.sql` tries each forbidden action.

## 016. Server components read Postgres directly, no API layer (2026-10-13)

The dashboard is a Next.js App Router app. Pages are server components that query the database; the only write is one server action. For a single internal tool an extra REST layer would add code without adding a consumer.

## 017. Images are built in CI and pinned by commit (2026-10-13)

GitHub Actions builds the dashboard on every push to `main` and publishes `ghcr.io/<owner>/n8n-ops-console-dashboard:sha-<commit>` plus `latest`. The server runs a `sha-` tag: a deploy is a known commit, and a rollback is changing one line.

## 018. Login at the proxy, no published port (2026-10-13)

Traefik basic auth guards `ops.<host>` before any request reaches the app. The service publishes no port, so the server IP can't be used to skip the login. Real user accounts and roles are out of scope until there is more than one operator.

## 020. Liveness and readiness are separate endpoints (2026-10-13)

`/api/health` answers 200 whenever the Node process runs; the container healthcheck uses it. `/api/ready` checks the database and logs the reason when it fails. First deploy had one endpoint doing both: a wrong DB password made the container unhealthy, traefik silently dropped it, and the user saw a bare 404 with nothing in any log. Now the same fault shows "database unreachable" on the page and `28P01 password authentication failed` in `docker logs`.

## 021. Retries go through n8n's public API, read from the source (2026-10-13)

`POST /api/v1/executions/{id}/retry`, scope `execution:retry`, body `{loadWorkflow}`. In n8n 2.42.5 the call waits for the retry to finish and returns its status, so the scheduler knows the outcome in the same request. 409 means already succeeded, still queued, or aborted before starting; 404 means pruned. All of this is from `executions.public.controller.ts` and `execution.service.ts` at tag `n8n@2.42.5`, not from memory, because the docs page didn't say.

## 022. A failed retry never queues another retry (2026-10-13)

n8n runs the error workflow for retry-mode failures too, with `retryOf` set. Without a guard that is a loop: retry fails, handler queues a retry, it fails, and so on. The handler stores `retry_of`; a failure with it set is kept as history but queues nothing, adds no occurrence, reopens nothing and sends no alert. The attempt count belongs to the scheduler alone.

## 023. Only rate_limit and transient are retried automatically (2026-10-13)

A bad key or invalid JSON fails the same way every time; retrying it costs API calls and hides the real problem. Those get a Replay button for when a person has fixed the cause.

## 024. Backoff lives in SQL: 30 s × 2^(n-1), ±20 % jitter, 5 attempts (2026-10-13)

Base 60 s for rate limits. One query decides the next attempt, so the rule is in one place and covered by `test_retry_queue.py`. n8n's Error Trigger doesn't pass response headers, so `Retry-After` can't be honoured; the longer base for rate limits stands in for it.

## 025. The dashboard queues a replay, it never calls n8n (2026-10-13)

The dashboard holds no n8n API key. Replay inserts a job; the scheduler runs it within 30 s. One executor means one audit trail and one place to get retries right. A database trigger fills the job's execution from its event and pins dashboard jobs to one manual attempt, so even a compromised dashboard can only ask for a retry of something that really failed. A partial unique index allows one active job per execution, so double clicks queue once.

## 026. Lease by status, not by holding locks (2026-10-13)

`FOR UPDATE SKIP LOCKED` picks due jobs, which are marked `in_progress` and committed at once. Two runs never take the same job; a run that dies leaves jobs that are picked up again after 10 minutes. The attempt counter rises at claim time, so a crash still counts.

## 027. The scheduler doesn't save successful runs (2026-10-13)

It runs every 30 s: 2,880 executions a day that would only fill n8n's database. Failed runs are saved, and its error workflow is ops-error-handler, so a broken scheduler alerts like any other workflow.

## 019. Next.js 16.3.8, TypeScript 5.9 (2026-10-13)

Latest patch of the 16.3 line rather than 16.4.0, which was a week old. TypeScript 7 (the Go rewrite) is skipped until Next lists it as supported.
