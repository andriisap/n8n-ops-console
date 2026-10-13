#!/usr/bin/env python3
"""Behaviour tests for workflows/ops/src/upsert-incident.sql against a real Postgres.

Runs the exact SQL the n8n node runs, with the JSON parameter bound the same way.
Needs psql on PATH and a scratch database with all migrations applied.

    PGHOST=... PGUSER=ops PGDATABASE=ops python3 infra/tests/test_upsert_incident.py

The tables are cleaned at the start, so never point this at production data.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _db import check, reset, run_query_file, scalar, psql  # noqa: E402

COLS = ["incident_id", "status", "occurrences", "reopened_count", "is_new", "is_reopened",
        "error_event_id", "duplicate", "is_retry", "retry_enqueued", "should_alert"]


def upsert(execution_id, error_class="transient", normalized="timeout of <n>ms exceeded", retry_of=None):
    payload = {
        "execution_id": execution_id, "workflow_id": "wf1", "workflow_name": "chaos-timeout",
        "node_name": "Call slow API", "error_class": error_class,
        "error_message": "timeout of 3000ms exceeded, it's a \"quoted\" message",
        "normalized_message": normalized, "execution_url": f"https://n8n.example/e/{execution_id}",
        "execution_mode": "retry" if retry_of else "webhook", "retry_of": retry_of,
        "error_raw": {"message": "x"},
    }
    rows = run_query_file("workflows/ops/src/upsert-incident.sql", payload, COLS)
    assert len(rows) == 1, f"expected exactly one row, got {rows}"
    return rows[0]


reset()

# --- dedup, idempotency, reopen (stage 2) ---------------------------------------------

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

# --- retries (stage 4) ------------------------------------------------------------------

reset()

r = upsert("500")
check("transient failure is queued for an automatic retry",
      r["retry_enqueued"] == "t"
      and scalar("SELECT kind || ' ' || status || ' ' || idempotency_key FROM retry_queue;")
      == "auto pending auto:500")
check("first transient retry waits about 30 s",
      scalar("SELECT next_attempt_at - now() BETWEEN interval '25 seconds' AND interval '35 seconds' "
             "FROM retry_queue WHERE execution_id = '500';") == "t")

r = upsert("501", error_class="rate_limit", normalized="too many requests")
check("rate-limit failure waits longer before its first retry (about 60 s)",
      r["retry_enqueued"] == "t"
      and scalar("SELECT next_attempt_at - now() > interval '55 seconds' "
                 "FROM retry_queue WHERE execution_id = '501';") == "t")

for cls, eid in [("auth", "502"), ("validation", "503"), ("unknown", "504")]:
    r = upsert(eid, error_class=cls, normalized=f"{cls} problem")
    check(f"{cls} failure is NOT retried automatically", r["retry_enqueued"] == "f")

before = scalar("SELECT occurrences FROM incidents WHERE id = (SELECT incident_id FROM error_events WHERE execution_id = '500');")
r = upsert("600", retry_of="500")
check("a failed retry is recorded as history...",
      r["is_retry"] == "t"
      and scalar("SELECT retry_of FROM error_events WHERE execution_id = '600';") == "500")
check("...but queues no new retry (no loop), adds no occurrence, sends no alert",
      r["retry_enqueued"] == "f" and r["should_alert"] == "f"
      and r["occurrences"] == before
      and scalar("SELECT count(*) FROM retry_queue WHERE execution_id IN ('500', '600');") == "1")

inc500 = scalar("SELECT incident_id FROM error_events WHERE execution_id = '500';")
psql(f"UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE id = {inc500};")
r = upsert("601", retry_of="500")
check("a failed retry does not reopen a resolved incident", r["status"] == "resolved" and r["should_alert"] == "f")

psql(f"UPDATE incidents SET status = 'ignored' WHERE id = {inc500};")
r = upsert("700")
check("ignored incident gets no automatic retry", r["retry_enqueued"] == "f")

r = upsert("trigger:wf1:1760000000000")
check("trigger failure (no execution to retry) is not queued", r["retry_enqueued"] == "f")

reset()
print("\nall upsert tests passed")
