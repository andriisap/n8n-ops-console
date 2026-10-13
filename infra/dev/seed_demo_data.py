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
