#!/usr/bin/env python3
"""Behaviour tests for workflows/ops/src/upsert-incident.sql against a real Postgres.

Runs the exact SQL the n8n node runs, with the JSON parameter bound the same way.
Needs psql on PATH and a scratch database with 001_init applied.

    PGHOST=... PGUSER=ops PGDATABASE=ops python3 infra/tests/test_upsert_incident.py

The tables are cleaned at the start, so never point this at production data.
"""
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
SQL = (ROOT / "workflows/ops/src/upsert-incident.sql").read_text().strip().rstrip(";")
COLS = ["incident_id", "status", "occurrences", "reopened_count", "is_new",
        "is_reopened", "error_event_id", "duplicate", "should_alert"]


def psql(script, **variables):
    args = ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-F", "|"]
    for name, value in variables.items():
        args += ["-v", f"{name}={value}"]   # passed raw, no quoting rules to get wrong
    out = subprocess.run(args, input=script, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr)
    return [line for line in out.stdout.splitlines() if line]


def upsert(execution_id, error_class="transient", normalized="timeout of <n>ms exceeded"):
    payload = {
        "execution_id": execution_id, "workflow_id": "wf1", "workflow_name": "chaos-timeout",
        "node_name": "Call slow API", "error_class": error_class,
        "error_message": "timeout of 3000ms exceeded, it's a \"quoted\" message",
        "normalized_message": normalized, "execution_url": f"https://n8n.example/e/{execution_id}",
        "execution_mode": "webhook", "error_raw": {"message": "x"},
    }
    # PREPARE keeps $1 a real bind parameter, exactly as the n8n Postgres node sends it.
    rows = psql(f"PREPARE upsert(jsonb) AS\n{SQL};\nEXECUTE upsert(:'payload');\n",
                payload=json.dumps(payload))
    assert len(rows) == 1, f"expected exactly one row, got {rows}"
    values = rows[0].split("|")
    return dict(zip(COLS, values))


def scalar(query):
    return psql(query)[0]


def check(label, cond):
    assert cond, label
    print(f"ok  {label}")


psql("TRUNCATE incidents, error_events, retry_queue RESTART IDENTITY CASCADE;")

r = upsert("100")
check("1st failure creates an incident and alerts", r["is_new"] == "t" and r["should_alert"] == "t")
inc = r["incident_id"]

r = upsert("101")
check("2nd failure of the same problem: occurrences 2, no alert",
      r["incident_id"] == inc and r["occurrences"] == "2" and r["should_alert"] == "f")

r = upsert("101")
check("same execution reported twice is a no-op",
      r["duplicate"] == "t" and r["should_alert"] == "f"
      and scalar(f"SELECT occurrences FROM incidents WHERE id = {inc};") == "2")

for i in range(102, 110):
    upsert(str(i))
check("10 failures in total → 1 incident, occurrences 10, 10 events",
      scalar("SELECT count(*) FROM incidents;") == "1"
      and scalar(f"SELECT occurrences FROM incidents WHERE id = {inc};") == "10"
      and scalar("SELECT count(*) FROM error_events;") == "10")

psql(f"UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE id = {inc};")
r = upsert("200")
check("failure after resolve reopens the incident and alerts",
      r["is_reopened"] == "t" and r["status"] == "open" and r["reopened_count"] == "1"
      and r["should_alert"] == "t"
      and scalar(f"SELECT resolved_at IS NULL FROM incidents WHERE id = {inc};") == "t")

psql(f"UPDATE incidents SET status = 'ignored' WHERE id = {inc};")
r = upsert("201")
check("ignored incident stays ignored and stays quiet",
      r["status"] == "ignored" and r["should_alert"] == "f")

r = upsert("300", error_class="rate_limit", normalized="too many requests")
check("a different problem gets its own incident",
      r["incident_id"] != inc and r["is_new"] == "t"
      and scalar("SELECT count(*) FROM incidents;") == "2")

check("quotes and commas in messages are stored intact",
      scalar("SELECT error_message FROM error_events WHERE execution_id = '300';")
      == "timeout of 3000ms exceeded, it's a \"quoted\" message")

psql("TRUNCATE incidents, error_events, retry_queue RESTART IDENTITY CASCADE;")
print("\nall upsert tests passed")
