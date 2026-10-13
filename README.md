# n8n Ops Console

Reliability layer for self-hosted n8n: one error workflow for every workflow, incidents grouped by fingerprint, retries with backoff, LLM cost per run, and a Next.js dashboard on top.

Status: stage 2 of 8 (central error workflow). Tested on n8n 2.42.5.

## How a failure flows

```
any workflow fails
  → ops-error-handler (Error Trigger)
  → normalize + classify (rate_limit / transient / auth / validation / unknown)
  → upsert incident by fingerprint, insert event by execution id
  → new or reopened? → Telegram alert → mark alerted
  → database down?   → fallback Telegram alert, no dedup
```

What happens when each piece breaks, and how it was verified on the live instance: [docs/failure-modes.md](docs/failure-modes.md).

## Tests

```bash
node workflows/ops/src/normalize-error.test.js          # classification and normalization
node workflows/ops/src/build-fallback-alert.test.js     # fallback message never prints [object Object]
python3 infra/tests/test_upsert_incident.py             # dedup, idempotency, reopen (needs a scratch Postgres)
```

After editing anything in `workflows/ops/src/`, rebuild the importable JSON:

```bash
python3 scripts/build-error-handler.py
```

## Repo layout

| Folder | What lives there |
| --- | --- |
| `infra/` | docker-compose, SQL migrations (stage 1+) |
| `workflows/` | exported n8n workflow JSON. `chaos/` fails on purpose, `ops/` is the console itself |
| `dashboard/` | Next.js app (stage 3+) |
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
| chaos-flaky | `/webhook/chaos-flaky` | random 200 or 503 (for retry tests) |

Run all of them:

```bash
N8N_URL=https://your-n8n-host ./scripts/fire-chaos.sh
```

Note: n8n only calls an error workflow for production runs. Manual runs from the editor don't count, which is why every chaos workflow has a Webhook trigger.
