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

## 3. ops-cost-collector workflow (PR #3)

- [ ] `git pull`; load prices again: `pbcopy < infra/prices/model_prices.sql` → paste into psql → `INSERT 0 3` (2 updated, Groq added)
- [ ] Import `workflows/ops/ops-cost-collector.json`
- [ ] Node **Config**: `n8n_public_url` = `https://n8n-bet6.srv1878746.hstgr.cloud`
- [ ] Credentials: **Scan window**, **Pick unscanned**, **Record usage** → `ops-db`; **List executions**, **Get execution** → Header Auth `ops-n8n-api`
- [ ] ⋯ → Settings → Error workflow → `ops-error-handler`; Save → **Publish**
- [ ] Within 1–2 min: `SELECT count(*), sum(llm_calls) FROM cost_scans;` grows; `SELECT node_name, model, input_tokens, output_tokens, cost_usd FROM llm_usage_costed;` shows execution 35791 (2 rows, both priced)
- [ ] `./scripts/fire-triage.sh 3` → 6 new rows within a minute or two

First live run: 225 executions scanned in ~9 min, all without LLM calls, still a day behind. Fixed in PR #4 (decision 032): executions of workflows without a model node are marked from the listing, not downloaded.

- [ ] PR #4: delete the old ops-cost-collector in n8n, import the new one, same Config and credentials plus **List workflows** → `ops-n8n-api`

## 4. Daily budget alert

## 5. Dashboard: /costs

## 6. Live tests

## Done when

The dashboard shows what each run and each workflow cost, by day, with the price source; an overspend alerts once a day.
