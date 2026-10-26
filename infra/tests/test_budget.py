"""Daily LLM budget alert: over budget once a day, retried until Telegram confirms.

Needs a scratch Postgres with migrations 001-004 applied. Truncates the cost tables.
"""
from _db import ROOT, check, psql, run_query_file, scalar

COLS = ["day", "kind", "threshold", "spent", "calls", "runs", "unpriced", "workflows"]


def check_budget(budget):
    return run_query_file("workflows/ops/src/check-budget.sql", {"daily_budget_usd": budget}, COLS)


def mark(day):
    return run_query_file("workflows/ops/src/mark-budget-alert.sql", {"day": day, "kind": "daily_budget"},
                          ["day", "kind", "sent_at"])


def call(execution, workflow, model, tokens_in, tokens_out, when="now()"):
    psql(f"INSERT INTO llm_usage (execution_id, workflow_id, workflow_name, node_name, provider, model, "
         f"input_tokens, output_tokens, started_at) VALUES ('{execution}', 'wf-{workflow}', '{workflow}', "
         f"'Model', 'anthropic', '{model}', {tokens_in}, {tokens_out}, {when});")


psql("TRUNCATE llm_usage, cost_scans, cost_alerts, model_prices RESTART IDENTITY;")
psql((ROOT / "infra/prices/model_prices.sql").read_text())

# Haiku 5.5, base tier (prompt exactly 100,000): 100,000 x $0.10 + 1,000,000 x $0.50 per million = $0.51
call("1", "triage", "claude-haiku-5-5", 100000, 1000000)
check("under budget: nothing", check_budget(1.00) == [])
check("no budget configured: nothing", check_budget(None) == [])

call("2", "summarize", "claude-haiku-5-5", 100000, 1000000)   # today $1.02
call("3", "triage", "unpriced-model", 500, 500)
r = check_budget(1.00)
check("over budget: one row", len(r) == 1)
a = r[0]
check("spent is today's total", a["spent"] == "1.020000" and a["threshold"] == "1.000000")
check("calls, runs and unpriced counted", (a["calls"], a["runs"], a["unpriced"]) == ("3", "3", "1"))
check("top workflows by cost", '"workflow_name": "summarize"' in a["workflows"] or '"workflow_name": "triage"' in a["workflows"])

check("not sent yet (Telegram failed or still sending): offered again next run", len(check_budget(1.00)) == 1)
check("only one alert row per day", scalar("SELECT count(*) FROM cost_alerts") == "1")

m = mark(a["day"])
check("marked sent", len(m) == 1 and m[0]["day"] == a["day"])
check("sent: no more alerts today, however much is spent", check_budget(1.00) == [] and check_budget(0.01) == [])
check("marking twice changes nothing", mark(a["day"]) == [])

psql("TRUNCATE llm_usage, cost_alerts;")
call("4", "triage", "claude-haiku-5-5", 100000, 1000000, "now() - interval '2 days'")
check("spend from earlier days doesn't count today", check_budget(0.10) == [])
psql("INSERT INTO cost_alerts (day, kind, threshold, spent, sent_at) "
     "VALUES ((now() AT TIME ZONE 'UTC')::date - 1, 'daily_budget', 0.1, 0.51, now() - interval '1 day');")
call("5", "triage", "claude-haiku-5-5", 100000, 1000000)
check("yesterday's alert doesn't silence today's", len(check_budget(0.10)) == 1)

print("all budget tests passed")
