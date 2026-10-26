#!/usr/bin/env python3
"""Fills a scratch ops database with realistic incidents for local dashboard work.

Goes through workflows/ops/src/upsert-incident.sql, the same query n8n runs,
so the data has the same shape as production. Never point it at production.

    PGHOST=... PGUSER=ops PGDATABASE=ops python3 infra/dev/seed_demo_data.py
"""
import json
import pathlib
import random
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
SQL = (ROOT / "workflows/ops/src/upsert-incident.sql").read_text().strip().rstrip(";")

PROBLEMS = [
    ("wf-crm", "crm-lead-sync", "HubSpot: upsert contact", "rate_limit",
     "The service is receiving too many requests from you", "The service is receiving too many requests from you", 14),
    ("wf-inv", "invoice-intake", "Parse LLM reply", "validation",
     "Unexpected token 'S', \"Sure! Here\"... is not valid JSON [line 5]",
     "Unexpected token 'S', \"Sure! Here\"... is not valid JSON [line <n>]", 6),
    ("wf-slack", "daily-digest", "Post to Slack", "auth",
     "Authorization failed - please check your credentials", "Authorization failed - please check your credentials", 3),
    ("wf-ship", "order-shipping", "Nova Poshta: create waybill", "transient",
     "The connection was aborted, perhaps the server is offline",
     "The connection was aborted, perhaps the server is offline", 9),
    ("wf-rep", "weekly-report", "Code", "unknown",
     "Cannot read properties of undefined (reading 'total')",
     "Cannot read properties of undefined (reading 'total')", 1),
]


def psql(script, **variables):
    args = ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"]
    for k, v in variables.items():
        args += ["-v", f"{k}={v}"]
    subprocess.run(args, input=script, text=True, check=True, capture_output=True)


exec_id = 9000
for wf_id, wf_name, node, cls, msg, norm, count in PROBLEMS:
    for _ in range(count):
        exec_id += random.randint(1, 4)
        payload = {
            "execution_id": str(exec_id), "workflow_id": wf_id, "workflow_name": wf_name,
            "node_name": node, "error_class": cls, "error_message": msg,
            "normalized_message": norm, "execution_mode": "webhook",
            "execution_url": f"https://n8n.example/workflow/{wf_id}/executions/{exec_id}",
            "error_raw": {"message": msg, "name": "NodeApiError"},
        }
        psql(f"PREPARE u(jsonb) AS\n{SQL};\nEXECUTE u(:'p');\n", p=json.dumps(payload))

# Spread timestamps over the last two days so "last seen" varies.
psql("""
UPDATE error_events SET occurred_at = now() - (random() * interval '48 hours');
UPDATE incidents i SET
    first_seen_at = s.first, last_seen_at = s.last
FROM (SELECT incident_id, min(occurred_at) AS first, max(occurred_at) AS last
        FROM error_events GROUP BY incident_id) s
WHERE s.incident_id = i.id;
UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE workflow_name = 'daily-digest';
UPDATE incidents SET status = 'ignored' WHERE workflow_name = 'weekly-report';

-- Give the automatic retries a mix of endings, as after a day of real traffic.
WITH ranked AS (
    SELECT r.id, row_number() OVER (PARTITION BY r.incident_id ORDER BY r.id) AS n
    FROM retry_queue r
)
UPDATE retry_queue r SET
    status = CASE WHEN k.n % 3 = 1 THEN 'succeeded' WHEN k.n % 3 = 2 THEN 'dead' ELSE 'pending' END,
    attempt = CASE WHEN k.n % 3 = 1 THEN 2 WHEN k.n % 3 = 2 THEN 5 ELSE 1 END,
    retry_execution_id = CASE WHEN k.n % 3 <> 0 THEN (20000 + r.id)::text END,
    last_error = CASE WHEN k.n % 3 = 2 THEN 'retry execution ended with status error' END,
    next_attempt_at = now() + interval '50 seconds'
FROM ranked k WHERE k.id = r.id;
""")
print("seeded", len(PROBLEMS), "incidents")

# LLM usage for the /costs page: 14 days of a ticket-triage workflow (Groq + Claude per
# run), a summarizer that only uses Claude, a spike on one day, and one unpriced model.
# Prices come from infra/prices/model_prices.sql, like on the server.
psql((ROOT / "infra/prices/model_prices.sql").read_text())
rows = []
ex = 50000
for day in range(13, -1, -1):
    runs = random.randint(8, 30) if day != 4 else 90           # a busy day four days ago
    for _ in range(runs):
        ex += 1
        at = f"(date_trunc('day', now()) - interval '{day} days' + random() * interval '23 hours')"
        rows.append(f"('{ex}', 'wf-triage', 'demo-ticket-triage', 'Groq Chat Model', 0, 'groq', "
                    f"'openai/gpt-oss-20b', {random.randint(130, 170)}, {random.randint(60, 150)}, 'success', {at})")
        rows.append(f"('{ex}', 'wf-triage', 'demo-ticket-triage', 'Anthropic Chat Model', 0, 'anthropic', "
                    f"'claude-haiku-5-5', {random.randint(115, 140)}, {random.randint(110, 160)}, 'success', {at})")
    for _ in range(random.randint(1, 4)):
        ex += 1
        at = f"(date_trunc('day', now()) - interval '{day} days' + random() * interval '23 hours')"
        rows.append(f"('{ex}', 'wf-sum', 'weekly-summary', 'Anthropic Chat Model', 0, 'anthropic', "
                    f"'claude-haiku-5-5', {random.randint(8000, 40000)}, {random.randint(600, 1500)}, 'success', {at})")
ex += 1
rows.append(f"('{ex}', 'wf-sum', 'weekly-summary', 'OpenRouter Chat Model', 0, 'openrouter', "
            f"'some/new-model', 4000, 500, 'error', now() - interval '3 hours')")
psql("TRUNCATE llm_usage, cost_scans, cost_alerts;\n"
     "INSERT INTO llm_usage (execution_id, workflow_id, workflow_name, node_name, run_index, provider, model, "
     "input_tokens, output_tokens, execution_status, started_at) VALUES\n" + ",\n".join(rows) + ";\n"
     "INSERT INTO cost_scans (execution_id, workflow_id, workflow_name, execution_status, started_at, llm_calls) "
     "SELECT execution_id, max(workflow_id), max(workflow_name), max(execution_status), min(started_at), count(*) "
     "FROM llm_usage GROUP BY execution_id;")
print("seeded", len(rows), "LLM calls")
