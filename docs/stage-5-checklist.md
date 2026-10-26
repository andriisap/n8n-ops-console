# Stage 5 checklist: LLM cost per run

Plan: [decisions 028–031](decisions.md). Each step is one pull request.

## 1. Demo workflow with real LLM calls (PR #1)

- [x] Anthropic and Groq API keys; credentials `ops-anthropic`, `ops-groq` in n8n
- [x] Import `workflows/demo/demo-ticket-triage.json`, error workflow `ops-error-handler`, Publish
- [x] `./scripts/fire-triage.sh` → HTTP 200 with category and reply
- [x] `./scripts/fetch-execution.sh <id>` → both model nodes report real `tokenUsage` (Groq 147 / 136, Claude 123 / 139 in execution 35791)

## 2. Database: usage, prices, scans (PR #2)

- [x] `git pull` on the Mac
- [x] `pbcopy < infra/migrations/004_costs.sql` → `docker exec -it n8n-bet6-ops-db-1 psql -U ops -d ops` → paste → ends with `COMMIT`
- [x] Same for `infra/prices/model_prices.sql` → `INSERT 0 2`, `COMMIT`
- [x] Check: 2 rows for claude-haiku-5-5
- [x] Groq price for `openai/gpt-oss-20b` from its page in the Groq console → added to `model_prices.sql` (PR #3)

## 3. ops-cost-collector workflow (PR #3, #4)

- [x] Prices reloaded: 3 rows (Claude ×2, Groq)
- [x] Import `workflows/ops/ops-cost-collector.json`, Config, credentials, error workflow, Publish
- [x] First run: 225 executions in ~9 min, none with LLM calls, still a day behind. Fixed in PR #4 (decision 032)
- [x] API key needed the `workflow:list` scope: 403 Forbidden until added (key scopes are enforced)
- [x] Caught up within minutes: executions 32573–36032 scanned, 35791 with 2 calls
- [x] `./scripts/fire-triage.sh 3` → 2 rows per run, every cost checked by hand (e.g. 36038 Groq: 147 × $0.075 + 116 × $0.30 = $0.0000458 per million)

## 4. Daily budget alert (PR #5)

- [ ] `git pull`. In n8n delete ops-cost-collector, import the new `workflows/ops/ops-cost-collector.json`
- [ ] Config: `n8n_public_url`, `telegram_chat_id` (same as in ops-error-handler), `daily_budget_usd` = **0.0005** for the test
- [ ] Credentials: Postgres nodes → `ops-db` (now 5: Scan window, Pick unscanned, Record usage, Check budget, Mark budget alert sent); HTTP nodes → `ops-n8n-api` (3); **Send budget alert** → `ops-telegram`
- [ ] Error workflow → `ops-error-handler`; Save → Publish
- [ ] `./scripts/fire-triage.sh 2` → within 1–2 min one 💸 message (today is already over $0.0005)
- [ ] `./scripts/fire-triage.sh 2` again → no second message; `SELECT * FROM cost_alerts;` → one row with `sent_at`
- [ ] Set `daily_budget_usd` back to **1**, Save → Publish

## 5. Dashboard: /costs

## 6. Live tests

## Done when

The dashboard shows what each run and each workflow cost, by day, with the price source; an overspend alerts once a day.
