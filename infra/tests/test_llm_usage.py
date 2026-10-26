"""Cost meter: recording LLM calls and pricing them by date and tier.

The payload is produced by running the real extract-llm-calls.js (node) on a real
execution captured from the server, so this tests the same path the collector takes.
Needs a scratch Postgres with migrations 001-004 applied. Truncates the cost tables.
"""
import copy
import json
import subprocess

from _db import ROOT, check, psql, run_query_file, scalar

COLS = ["calls_recorded", "executions_recorded"]


def extract(*executions):
    """Runs extract-llm-calls.js exactly as the Code node would, returns its single output item."""
    js = (
        "const fs=require('fs');"
        "const code=fs.readFileSync(process.argv[1],'utf8');"
        "const items=JSON.parse(fs.readFileSync(0,'utf8'));"
        "const $input={all:()=>items.map(json=>({json}))};"
        "process.stdout.write(JSON.stringify(new Function('$input',code)($input)[0].json));"
    )
    out = subprocess.run(["node", "-e", js, str(ROOT / "workflows/ops/src/extract-llm-calls.js")],
                         input=json.dumps(list(executions)), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def record(payload):
    return run_query_file("workflows/ops/src/record-llm-usage.sql", payload, COLS)[0]


def cost(node, execution="35791"):
    v = scalar(f"SELECT coalesce(cost_usd::text, 'NULL') FROM llm_usage_costed "
               f"WHERE execution_id = '{execution}' AND node_name = '{node}'")
    return v


def reset():
    psql("TRUNCATE llm_usage, cost_scans, cost_alerts, model_prices RESTART IDENTITY;")
    psql((ROOT / "infra/prices/model_prices.sql").read_text())


real = json.loads((ROOT / "workflows/ops/src/fixtures/execution-demo-triage.json").read_text())

reset()

r = record(extract(real))
check("real execution: 2 calls and 1 scanned execution recorded", r == {"calls_recorded": "2", "executions_recorded": "1"})

r = record(extract(real))
check("same execution again: nothing new (collector windows may overlap)", r == {"calls_recorded": "0", "executions_recorded": "0"})
check("still exactly 2 rows", scalar("SELECT count(*) FROM llm_usage") == "2")

# Haiku 5.5, base tier: 123 in x $0.10 + 139 out x $0.50 per million = $0.0000818
check("Claude call priced from the Haiku 5.5 base tier", cost("Anthropic Chat Model") == "0.00008180")
check("Groq call has no price yet: NULL, not $0", cost("Groq Chat Model") == "NULL")

# A price added later applies to past runs (it is valid from before the run).
psql("INSERT INTO model_prices (provider, model, valid_from, input_per_mtok, output_per_mtok, source_url) "
     "VALUES ('groq', 'openai/gpt-oss-20b', '2026-01-01', 0.075, 0.30, 'test');")
# 147 x 0.075 + 136 x 0.30 = 11.025 + 40.8 = 51.825 per million
check("price added later applies to a past run", cost("Groq Chat Model") == "0.00005183")

# A price change: the new row does not touch runs before its valid_from.
psql("INSERT INTO model_prices (provider, model, valid_from, input_per_mtok, output_per_mtok, source_url) "
     "VALUES ('groq', 'openai/gpt-oss-20b', '2027-01-01', 1, 1, 'test');")
check("price change from 2027 leaves an October 2026 run alone", cost("Groq Chat Model") == "0.00005183")

later = copy.deepcopy(real)
later["id"] = "40000"
later["startedAt"] = "2027-01-02T10:00:00.000Z"
record(extract(later))
check("a run after the change uses the new price: (147 + 136) x $1 per million",
      cost("Groq Chat Model", "40000") == "0.00028300")

# A price that starts after the run doesn't apply backwards.
early = copy.deepcopy(real)
early["id"] = "100"
early["startedAt"] = "2026-10-01T10:00:00.000Z"   # before Haiku 5.5's valid_from (2026-10-07)
record(extract(early))
check("run before a model's first price: NULL", cost("Anthropic Chat Model", "100") == "NULL")

# Long prompt: Haiku 5.5's second tier prices the whole request at the higher rate.
big = copy.deepcopy(real)
big["id"] = "200"
out = big["data"]["resultData"]["runData"]["Anthropic Chat Model"][0]["data"]["ai_languageModel"][0][0]["json"]
out["tokenUsage"] = {"promptTokens": 150000, "completionTokens": 1000, "totalTokens": 151000}
record(extract(big))
# 150,000 x $0.50 + 1,000 x $2.50 per million = $0.0775
check("prompt over 100,000 tokens: whole call at the long-context rate", cost("Anthropic Chat Model", "200") == "0.07750000")
check("tier recorded on the row", scalar("SELECT price_tier FROM llm_usage_costed WHERE execution_id = '200' "
                                         "AND node_name = 'Anthropic Chat Model'") == "100001")
edge = copy.deepcopy(real)
edge["id"] = "201"
out = edge["data"]["resultData"]["runData"]["Anthropic Chat Model"][0]["data"]["ai_languageModel"][0][0]["json"]
out["tokenUsage"] = {"promptTokens": 100000, "completionTokens": 0, "totalTokens": 100000}
record(extract(edge))
check("exactly 100,000 prompt tokens stays in the base tier", cost("Anthropic Chat Model", "201") == "0.01000000")

# Scans and calls go in together: an empty payload is harmless.
check("empty payload records nothing", record({"executions": [], "calls": []}) == {"calls_recorded": "0", "executions_recorded": "0"})

# The dashboard role reads costs but can't write them.
psql("""
BEGIN;
SET LOCAL ROLE ops_dashboard;
SELECT count(*) FROM llm_usage_costed;
SELECT count(*) FROM cost_scans;
SELECT count(*) FROM model_prices;
ROLLBACK;
""")
check("ops_dashboard can read llm_usage_costed, cost_scans, model_prices", True)
denied = subprocess.run(
    ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
     "SET ROLE ops_dashboard; INSERT INTO model_prices (provider, model, valid_from, input_per_mtok, output_per_mtok) "
     "VALUES ('x','y','2026-01-01',0,0);"],
    capture_output=True, text=True)
check("ops_dashboard can't change prices", denied.returncode != 0 and "permission denied" in denied.stderr)

print("all llm usage tests passed")
