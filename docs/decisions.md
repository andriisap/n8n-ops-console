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

## 028. Costs are collected from n8n's execution data, not logged by each workflow (2026-10-26)

The first plan was a `cost-meter` sub-workflow called after every LLM step. Reading n8n 2.42.5's source showed every model sub-node already records `tokenUsage` (or `tokenUsageEstimate`) and the model id in the execution data. `ops-cost-collector` reads finished executions through the public API and extracts the calls. No workflow has to change, a workflow someone forgets to instrument is still counted, and failed runs, which cost money too, are included. Only the model sub-node's runs are counted: the chain node above it repeats the same totals in `metadata.tracing`, and counting both would double every call. Captured on the real server and kept as a test fixture (`fixtures/demo-triage-35791.json`).

## 029. Cost is computed in a view, never stored (2026-10-26)

`llm_usage` keeps tokens; `llm_usage_costed` multiplies them by the price valid on the run's day (UTC) through `llm_price_for()`. A price added or corrected later applies to the past correctly, and there is one place where cost is computed. A model with no known price shows NULL ("no price"), never $0: a missing price must look missing.

## 030. Anthropic cache tokens can't be priced separately (2026-10-26)

n8n's Anthropic node adds `cache_read_input_tokens` and `cache_creation_input_tokens` into `promptTokens`. Cache reads cost a tenth of input on Haiku 5.5 and writes 1.25x, so with prompt caching on, the meter prices cached tokens as plain input. The demo workflow doesn't cache. Fixing it means reading usage from the raw API response, which n8n doesn't keep; the columns `cache_read_tokens` / `cache_write_tokens` are there for a provider that reports them.

## 031. Prices have tiers by prompt length (2026-10-26)

Claude Haiku 5.5 charges a higher rate for the whole request once the prompt is over 100,000 tokens. `model_prices.min_prompt_tokens` makes that a second row; the lookup takes the newest `valid_from`, then the highest tier the prompt reaches. Prices live in `infra/prices/model_prices.sql`, copied from each provider's own page with the source URL, re-runnable.

## 032. Only executions of workflows with a model node are downloaded (2026-10-26)

The first live run showed the cost: about 3,000 saved executions a day on this instance, almost all from workflows with no LLM (error handler, chaos, schedulers). Downloading each one's full data at 25 a minute meant two hours of backlog and pointless load. The collector now lists workflows once per run, and executions of workflows without a model node are marked scanned straight from the listing, with no download. The test is the workflow's current version, so an LLM node removed later means its old runs aren't counted. The listing window starts 2 hours before the newest downloaded execution and never more than a day back, so after a collector outage of more than a day the oldest LLM runs are missed. Both are accepted for a demo-sized instance; a real one would keep the workflow history.

## 033. One budget alert per day, marked sent only after delivery (2026-10-26)

After recording new usage, the collector compares today's spend (UTC day, all workflows, priced through `llm_usage_costed`) with `daily_budget_usd`. Over budget claims a `cost_alerts` row for the day; Telegram is sent; only then is `sent_at` set. A failed send leaves the row unsent, so the next run tries again; a delivered one silences the rest of the day, however much more is spent. Calls without a price are counted and named in the message, since they make real spend higher than shown. The check runs only when new usage arrived: spend can't grow without it.

## 034. The collector writes a heartbeat every run (2026-10-26)

The first `/costs` page judged the collector by its newest scan and showed "check ops-cost-collector" after 18 quiet minutes while the collector was fine: once successful scheduler and collector runs stopped being saved, there were simply no new executions to scan. Liveness is now its own signal: `Scan window`, the first query of every run, upserts `heartbeats('ops-cost-collector')`, and the page warns only when that is older than 5 minutes. The same table is what stage 6 builds on for n8n itself.

## 035. A watchdog outside the server, on Cloudflare Workers (2026-10-26)

Every alert so far is sent by n8n, so n8n down, n8n up with its scheduler stuck, or a broken `ops-error-handler` (n8n never runs an error workflow for the error workflow's own failures) would all be silent. A Cloudflare Worker watches from outside: two dead man's switches (n8n pings every 5 minutes; the error handler pings after an hourly deliberate failure, so the whole alert path is exercised) and two HTTP probes. It sends to the Telegram Bot API itself. State lives in D1: the free plan allows 100,000 row writes a day and the watchdog needs about 6,000; KV's 1,000 writes a day would not be enough for a check every minute. Telegram hears only state changes, and a change counts as told only once Telegram confirms, the same rule as the budget alert. Probes need 3 failures in a row, so a restart or a blip doesn't page. Known limit: nothing watches Cloudflare.
