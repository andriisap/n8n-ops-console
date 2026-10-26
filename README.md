# n8n Ops Console

Reliability layer for self-hosted n8n: one error workflow for every workflow, incidents grouped by fingerprint, retries with backoff, LLM cost per run, and a Next.js dashboard on top.

Status: stages 0–4 of 8 done (up to retries and Replay); next is stage 5, LLM cost per run. Tested on n8n 2.42.5.

## How a failure flows

```
any workflow fails
  → ops-error-handler (Error Trigger)
  → normalize + classify (rate_limit / transient / auth / validation / unknown)
  → upsert incident by fingerprint, insert event by execution id
  → new or reopened? → Telegram alert → mark alerted
  → rate_limit / transient? → queue an automatic retry (never for a failed retry)
  → database down?   → fallback Telegram alert, no dedup

ops-retry-scheduler (every 30 s)
  → lease due jobs (FOR UPDATE SKIP LOCKED)
  → POST /api/v1/executions/{id}/retry, wait for the result
  → recovered → ✅ · failed → backoff 30 s × 2^n ±20 % · 5th failure → 💀

ops-cost-collector (every minute)
  → list finished executions (public API), download the ones not seen yet
  → every model sub-node run = one LLM call: provider, model, tokens
  → llm_usage_costed prices each call by its day and prompt-length tier
  → over the daily budget? → one 💸 Telegram message a day

dashboard (Next.js, ops.<host>)
  → reads incidents, events and retry state as a read-mostly role
  → Resolve / Ignore / Reopen, Replay (queues a job, holds no n8n key), refreshes every 10 s
  → /costs: spend today / 7 / 30 days, per day, per workflow, per model with its price source, top runs
```

## Dashboard

| Part | Choice |
| --- | --- |
| App | Next.js 16 App Router, server components query Postgres, one server action writes |
| Database access | `ops_dashboard` role: SELECT everywhere, UPDATE on `incidents.status` and `resolved_at` only |
| Delivery | GitHub Actions → GHCR image tagged `sha-<commit>` → pulled by the server |
| Access | Traefik basic auth, HTTPS from Let's Encrypt, no published port |

Local development against a scratch database:

```bash
python3 infra/dev/seed_demo_data.py          # fills a scratch DB with realistic incidents
cd dashboard && cp .env.example .env.local   # set DATABASE_URL
npm install && npm run dev
```

What happens when each piece breaks, and how it was verified on the live instance: [docs/failure-modes.md](docs/failure-modes.md).

## Tests

```bash
node workflows/ops/src/normalize-error.test.js          # classification and normalization
node workflows/ops/src/build-fallback-alert.test.js     # fallback message never prints [object Object]
node workflows/ops/src/retry-scheduler.test.js          # every n8n retry API answer → outcome; alert texts
python3 infra/tests/test_upsert_incident.py             # dedup, idempotency, reopen, retry queueing, no loop
python3 infra/tests/test_retry_queue.py                 # lease, backoff, give-up, parallel runs, Replay permissions
node workflows/ops/src/extract-llm-calls.test.js        # LLM calls from a real execution: no double count, estimates, failures
python3 infra/tests/test_llm_usage.py                   # pricing by date and tier, idempotent recording, NULL for unknown prices
node workflows/ops/src/cost-collector.test.js           # listing pages → finished ids
python3 infra/tests/test_cost_collector.py              # scan window, oldest-first batches of 25, no re-downloads
python3 infra/tests/test_budget.py                      # one 💸 alert a day, retried until delivered
node workflows/ops/src/budget-alert.test.js             # alert text: amounts, top workflows, unpriced warning
```

The Python tests need a scratch Postgres with all migrations applied (they truncate the tables).

After editing anything in `workflows/ops/src/`, rebuild the importable JSON:

```bash
python3 scripts/build-error-handler.py
python3 scripts/build-retry-scheduler.py
python3 scripts/build-cost-collector.py
```

## Repo layout

| Folder | What lives there |
| --- | --- |
| `infra/` | docker-compose, SQL migrations (stage 1+) |
| `workflows/` | exported n8n workflow JSON. `chaos/` fails on purpose, `ops/` is the console itself |
| `dashboard/` | Next.js app, built into a Docker image by `.github/workflows/dashboard-image.yml` |
| `scripts/` | helper scripts, e.g. firing the chaos workflows |
| `docs/` | decisions, stage checklists, failure modes |

## Chaos workflows

Five workflows that each fail in one predictable way. Everything else in this repo is tested against them.

| Workflow | Webhook path | Fails with |
| --- | --- | --- |
| chaos-429 | `/webhook/chaos-429` | HTTP 429 Too Many Requests |
| chaos-timeout | `/webhook/chaos-timeout` | request timeout after 3 s |
| chaos-invalid-json | `/webhook/chaos-invalid-json` | SyntaxError parsing a fake LLM reply |
| chaos-auth | `/webhook/chaos-auth` | HTTP 401 Unauthorized |
| chaos-flaky | `/webhook/chaos-flaky` | random 200 or 503 |
| chaos-recover | `/webhook/chaos-recover?fail_until=<unix ms>` | 503 until that moment, then success: a retry that recovers every time. Fire with `scripts/fire-recover.sh` |

Run all of them:

```bash
N8N_URL=https://your-n8n-host ./scripts/fire-chaos.sh
```

Note: n8n only calls an error workflow for production runs. Manual runs from the editor don't count, which is why every chaos workflow has a Webhook trigger.
