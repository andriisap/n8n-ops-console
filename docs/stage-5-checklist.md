# Stage 5 checklist: LLM cost per run

Plan: [decisions 028–031](decisions.md). Each step is one pull request.

## 1. Demo workflow with real LLM calls (PR #1)

- [x] Anthropic and Groq API keys; credentials `ops-anthropic`, `ops-groq` in n8n
- [x] Import `workflows/demo/demo-ticket-triage.json`, error workflow `ops-error-handler`, Publish
- [x] `./scripts/fire-triage.sh` → HTTP 200 with category and reply
- [x] `./scripts/fetch-execution.sh <id>` → both model nodes report real `tokenUsage` (Groq 147 / 136, Claude 123 / 139 in execution 35791)

## 2. Database: usage, prices, scans

- [ ] `git pull` on the Mac
- [ ] `pbcopy < infra/migrations/004_costs.sql` → `docker exec -it n8n-bet6-ops-db-1 psql -U ops -d ops` → paste → ends with `COMMIT`
- [ ] Same for `infra/prices/model_prices.sql` → `INSERT 0 2`, `COMMIT`
- [ ] Check: `SELECT provider, model, min_prompt_tokens, input_per_mtok, output_per_mtok FROM model_prices;` → 2 rows for claude-haiku-5-5
- [ ] Groq price for `openai/gpt-oss-20b` from its page on console.groq.com → added to `model_prices.sql`

## 3. ops-cost-collector workflow

## 4. Daily budget alert

## 5. Dashboard: /costs

## 6. Live tests

## Done when

The dashboard shows what each run and each workflow cost, by day, with the price source; an overspend alerts once a day.
