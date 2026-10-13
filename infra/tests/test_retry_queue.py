#!/usr/bin/env python3
"""Behaviour tests for the retry queue: claim-retries.sql, finish-retry.sql, 003_retries.sql.

Runs the exact SQL of the n8n nodes. Needs a scratch database with all migrations applied.

    PGHOST=... PGUSER=ops PGDATABASE=ops python3 infra/tests/test_retry_queue.py
"""
import pathlib
import subprocess
import sys
import threading

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _db import ROOT, check, psql, reset, run_query_file, scalar  # noqa: E402

UPSERT_COLS = ["incident_id", "status", "occurrences", "reopened_count", "is_new", "is_reopened",
               "error_event_id", "duplicate", "is_retry", "retry_enqueued", "should_alert"]
CLAIM_COLS = ["id", "execution_id", "workflow_id", "incident_id", "kind", "load_workflow", "attempt", "max_attempts"]
FINISH_COLS = ["id", "status", "attempt", "max_attempts", "kind", "execution_id", "workflow_id",
               "retry_execution_id", "last_error", "next_attempt_at", "incident_id",
               "workflow_name", "node_name", "error_class", "notify"]
CLAIM_SQL = (ROOT / "workflows/ops/src/claim-retries.sql").read_text()


def fail(execution_id, error_class="transient"):
    payload = {"execution_id": execution_id, "workflow_id": "wf-flaky", "workflow_name": "chaos-flaky",
               "node_name": "Call flaky API", "error_class": error_class, "error_message": "Service unavailable",
               "normalized_message": "Service unavailable", "execution_mode": "webhook", "error_raw": {}}
    return run_query_file("workflows/ops/src/upsert-incident.sql", payload, UPSERT_COLS)[0]


def claim():
    return [dict(zip(CLAIM_COLS, r.split("|"))) for r in psql(CLAIM_SQL)]


def finish(job_id, outcome, retry_execution_id=None, error=None):
    rows = run_query_file("workflows/ops/src/finish-retry.sql",
                          {"id": int(job_id), "outcome": outcome,
                           "retry_execution_id": retry_execution_id, "error": error}, FINISH_COLS)
    return rows[0] if rows else None


def make_due(execution_id):
    psql(f"UPDATE retry_queue SET next_attempt_at = now() - interval '1 second' WHERE execution_id = '{execution_id}';")


def delay_seconds(execution_id):
    return float(scalar(f"SELECT extract(epoch FROM next_attempt_at - now()) FROM retry_queue WHERE execution_id = '{execution_id}';"))


reset()

# --- lease ------------------------------------------------------------------------------
fail("692")
check("a job is not taken before it is due", claim() == [])

make_due("692")
jobs = claim()
check("a due job is leased: in_progress, attempt 1",
      len(jobs) == 1 and jobs[0]["attempt"] == "1"
      and scalar("SELECT status FROM retry_queue WHERE execution_id = '692';") == "in_progress")
job = jobs[0]["id"]
check("a leased job is not handed out twice", claim() == [])

# --- backoff ----------------------------------------------------------------------------
r = finish(job, "failed", "801", "retry execution 801 ended with status error")
d = delay_seconds("692")
check(f"after attempt 1 fails: pending again, next try in 30 s ±20 % (got {d:.0f} s)",
      r["status"] == "pending" and r["notify"] == "f" and 23 <= d <= 37)

expected = {2: 60, 3: 120, 4: 240}
for attempt, base in expected.items():
    make_due("692")
    claim()
    finish(job, "failed", None, "still failing")
    d = delay_seconds("692")
    check(f"after attempt {attempt} fails: next try in {base} s ±20 % (got {d:.0f} s)",
          base * 0.79 <= d <= base * 1.21)

make_due("692")
claim()
r = finish(job, "failed", "805", "still failing")
check("after the 5th failed attempt the job is dead and Telegram is told",
      r["status"] == "dead" and r["attempt"] == "5" and r["notify"] == "t")
check("a dead job is never claimed again", (make_due("692"), claim())[1] == [])

# --- success, requeue, late answers ------------------------------------------------------
fail("700")
make_due("700")
j = claim()[0]
r = finish(j["id"], "succeeded", "900")
check("a successful retry closes the job, clears the error and notifies",
      r["status"] == "succeeded" and r["notify"] == "t" and r["retry_execution_id"] == "900" and r["last_error"] == "")

fail("710")
make_due("710")
j = claim()[0]
r = finish(j["id"], "requeue", None, "Execution is queued to run")
check("requeue gives the attempt back and waits a minute",
      r["status"] == "pending" and r["attempt"] == "0" and 55 <= delay_seconds("710") <= 61)

check("a late answer for a job that is no longer in progress changes nothing",
      finish(j["id"], "succeeded", "999") is None
      and scalar("SELECT status FROM retry_queue WHERE execution_id = '710';") == "pending")

# --- crashed scheduler -------------------------------------------------------------------
psql("UPDATE retry_queue SET status = 'in_progress', locked_at = now() - interval '11 minutes' WHERE execution_id = '710';")
jobs = claim()
check("a job leased by a run that died 10+ min ago is picked up again",
      [x["execution_id"] for x in jobs] == ["710"])

# --- two schedulers at once --------------------------------------------------------------
reset()
for i in range(10):
    fail(f"c{i}")
psql("UPDATE retry_queue SET next_attempt_at = now() - interval '1 second';")
results = {}


def worker(name):
    # holds its claim open for 1 s, as a slow run would
    out = subprocess.run(["psql", "-X", "-q", "-At"], input=f"BEGIN;\n{CLAIM_SQL}\nSELECT pg_sleep(1);\nCOMMIT;\n",
                         capture_output=True, text=True, check=True).stdout
    results[name] = {line.split("|")[0] for line in out.splitlines() if "|" in line}


threads = [threading.Thread(target=worker, args=(n,)) for n in ("a", "b")]
for t in threads:
    t.start()
for t in threads:
    t.join()
check(f"two parallel runs split the work with no overlap ({len(results['a'])} + {len(results['b'])})",
      not (results["a"] & results["b"]) and len(results["a"] | results["b"]) == 10)

# --- dashboard Replay through the restricted role ------------------------------------------
reset()
fail("auth-1", error_class="auth")   # not auto-retried, so the dashboard has something to replay
ev = scalar("SELECT id FROM error_events WHERE execution_id = 'auth-1';")
replay = (f"SET ROLE ops_dashboard;\n"
          f"INSERT INTO retry_queue (error_event_id, incident_id, execution_id, workflow_id, idempotency_key)\n"
          f"SELECT e.id, e.incident_id, e.execution_id, e.workflow_id, 'manual:' || e.execution_id || ':' || {{n}}\n"
          f"FROM error_events e WHERE e.id = {ev}\n"
          f"ON CONFLICT DO NOTHING RETURNING id;")
first = psql(replay.format(n=1))
check("the dashboard role can request a replay",
      len(first) == 1
      and scalar("SELECT kind || ' ' || max_attempts || ' ' || load_workflow || ' ' || status FROM retry_queue;")
      == "manual 1 true pending")
check("clicking Replay twice queues one job, without an error",
      psql(replay.format(n=2)) == [] and scalar("SELECT count(*) FROM retry_queue;") == "1")

forged = (f"SET ROLE ops_dashboard;\n"
          f"INSERT INTO retry_queue (error_event_id, incident_id, execution_id, workflow_id, idempotency_key)\n"
          f"VALUES ({ev}, 1, 'some-other-execution', 'other-wf', 'forged');")
psql("DELETE FROM retry_queue;")
psql(forged)
check("a forged execution id is replaced by the event's own (trigger)",
      scalar("SELECT execution_id || ' ' || workflow_id FROM retry_queue;") == "auth-1 wf-flaky")

for label, stmt in [
    ("set its own status", f"INSERT INTO retry_queue (error_event_id, incident_id, execution_id, workflow_id, idempotency_key, status) VALUES ({ev}, 1, 'x', 'x', 'k2', 'succeeded');"),
    ("update a job", "UPDATE retry_queue SET status = 'succeeded';"),
    ("delete a job", "DELETE FROM retry_queue;"),
]:
    try:
        psql(f"SET ROLE ops_dashboard;\n{stmt}")
        ok = False
    except RuntimeError as e:
        ok = "permission denied" in str(e)
    check(f"the dashboard role cannot {label}", ok)

reset()
print("\nall retry queue tests passed")
