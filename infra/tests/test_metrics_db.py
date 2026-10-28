#!/usr/bin/env python3
"""Migration 005: incident status history and the two metric views.

Drives incidents through the real upsert-incident.sql and finish-retry.sql, resolves as the
dashboard role, then checks incident_status_log, incident_resolutions and auto_recoveries.
Needs a scratch Postgres with migrations 001-005 and ops_dashboard password in PGDASHPASS
(default devpass). Truncates the incident tables.
"""
import os
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _db import ROOT, check, psql, reset, run_query_file, scalar  # noqa: E402

UPSERT_COLS = ["incident_id", "status", "occurrences", "reopened_count", "is_new", "is_reopened",
               "error_event_id", "duplicate", "is_retry", "retry_enqueued", "should_alert"]


def upsert(execution_id, error_class="auth", retry_of=None, workflow="chaos-auth"):
    payload = {"execution_id": execution_id, "workflow_id": f"wf-{workflow}", "workflow_name": workflow,
               "node_name": "Call API", "error_class": error_class, "error_message": "boom",
               "normalized_message": f"boom {error_class}", "execution_mode": "retry" if retry_of else "webhook",
               "retry_of": retry_of, "error_raw": {}}
    return run_query_file("workflows/ops/src/upsert-incident.sql", payload, UPSERT_COLS)[0]


def as_dashboard(sql):
    env = dict(os.environ, PGUSER="ops_dashboard", PGPASSWORD=os.environ.get("PGDASHPASS", "devpass"))
    out = subprocess.run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(out.stderr)
    return out.stdout.strip()


def log(incident_id):
    return psql(f"SELECT coalesce(from_status, '-') || '>' || to_status || ' ' || changed_by "
                f"FROM incident_status_log WHERE incident_id = {incident_id} ORDER BY changed_at, id;")


def shift_log(incident_id, to_status, minutes_ago):
    """Moves the newest entry with that status back in time, to give the story real durations."""
    psql(f"UPDATE incident_status_log SET changed_at = now() - interval '{minutes_ago} minutes' "
         f"WHERE id = (SELECT max(id) FROM incident_status_log WHERE incident_id = {incident_id} "
         f"AND to_status = '{to_status}');")


reset()

# --- the log follows every change, whoever makes it ---------------------------------------

r = upsert("100")
inc = r["incident_id"]
check("new incident logs its opening", log(inc) == ["->open ops"])

upsert("101")
check("another occurrence changes no status, logs nothing", len(log(inc)) == 1)

as_dashboard(f"UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE id = {inc};")
check("resolve from the dashboard is logged as ops_dashboard", log(inc)[-1] == "open>resolved ops_dashboard")
check("the dashboard still can't write the log directly",
      "permission denied" in subprocess.run(
          ["psql", "-X", "-q", "-c", f"INSERT INTO incident_status_log (incident_id, to_status) VALUES ({inc}, 'open')"],
          capture_output=True, text=True,
          env=dict(os.environ, PGUSER="ops_dashboard", PGPASSWORD=os.environ.get("PGDASHPASS", "devpass"))).stderr)
check("but can read it", as_dashboard(f"SELECT count(*) FROM incident_status_log WHERE incident_id = {inc}") == "2")

r = upsert("102")
check("failure after resolve reopens, and the log says so",
      r["is_reopened"] == "t" and log(inc)[-1] == "resolved>open ops")

as_dashboard(f"UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE id = {inc};")
check("two cycles, four entries", len(log(inc)) == 4)

# --- incident_resolutions: one row per cycle ----------------------------------------------

# cycle 1: open 120 min ago, resolved 100 min ago (20 min); cycle 2: reopened 30, resolved 5 (25 min)
psql(f"UPDATE incident_status_log SET changed_at = now() - interval '120 minutes' "
     f"WHERE incident_id = {inc} AND from_status IS NULL;")
psql(f"UPDATE incident_status_log SET changed_at = now() - interval '100 minutes' "
     f"WHERE id = (SELECT min(id) FROM incident_status_log WHERE incident_id = {inc} AND to_status = 'resolved');")
shift_log(inc, "open", 30)
shift_log(inc, "resolved", 5)

rows = psql(f"SELECT round(extract(epoch FROM time_to_resolve) / 60) FROM incident_resolutions "
            f"WHERE incident_id = {inc} ORDER BY resolved_at;")
check("each resolution measured from the open that preceded it", rows == ["20", "25"])

ign = upsert("200", error_class="validation", workflow="chaos-validation")["incident_id"]
as_dashboard(f"UPDATE incidents SET status = 'ignored' WHERE id = {ign};")
check("ignoring is logged but is no resolution",
      log(ign)[-1] == "open>ignored ops_dashboard"
      and scalar(f"SELECT count(*) FROM incident_resolutions WHERE incident_id = {ign}") == "0")

check("an open incident has no resolution yet",
      scalar(f"SELECT count(*) FROM incident_resolutions WHERE incident_id = "
             f"{upsert('300', error_class='unknown', workflow='other')['incident_id']}") == "0")

# --- auto_recoveries ----------------------------------------------------------------------

FINISH_COLS = ["id", "status", "attempt", "max_attempts", "kind", "execution_id", "workflow_id",
               "retry_execution_id", "last_error", "next_attempt_at", "incident_id",
               "workflow_name", "node_name", "error_class", "notify"]


def finish(job_id, outcome, retry_execution_id=None):
    return run_query_file("workflows/ops/src/finish-retry.sql",
                          {"id": int(job_id), "outcome": outcome, "retry_execution_id": retry_execution_id,
                           "error": None if outcome == "succeeded" else "still down"}, FINISH_COLS)


r = upsert("400", error_class="transient", workflow="chaos-recover")
check("a transient failure is queued", r["retry_enqueued"] == "t")
job = scalar("SELECT id FROM retry_queue WHERE execution_id = '400';")
psql(f"UPDATE error_events SET occurred_at = now() - interval '90 seconds' WHERE execution_id = '400';")
psql(f"UPDATE retry_queue SET status = 'in_progress', attempt = 2, locked_at = now() WHERE id = {job};")
finish(job, "succeeded", "405")
rows = psql("SELECT attempt, retry_execution_id, round(extract(epoch FROM time_to_recover)) "
            "FROM auto_recoveries WHERE execution_id = '400';")
check("a successful automatic retry is one recovery, timed from the failure", rows == ["2|405|90"])

upsert("500", error_class="transient", workflow="chaos-timeout")
job = scalar("SELECT id FROM retry_queue WHERE execution_id = '500';")
psql(f"UPDATE retry_queue SET status = 'in_progress', attempt = 5, locked_at = now() WHERE id = {job};")
finish(job, "dead")
check("a retry that gave up is no recovery", scalar("SELECT count(*) FROM auto_recoveries WHERE execution_id = '500'") == "0")

check("the dashboard can read both views",
      as_dashboard("SELECT (SELECT count(*) FROM incident_resolutions) || '/' || (SELECT count(*) FROM auto_recoveries)") == "2/1")

# --- backfill: re-running the migration on existing incidents ------------------------------

psql("TRUNCATE incident_status_log;")
psql(f"UPDATE incidents SET resolved_at = now() - interval '10 minutes', "
     f"first_seen_at = now() - interval '70 minutes' WHERE id = {inc};")
psql((ROOT / "infra/migrations/005_metrics.sql").read_text())
check("backfill: open at first_seen_at, current status after it", log(inc) == ["->open migration", "open>resolved migration"])
check("backfilled resolution is marked as such",
      psql(f"SELECT round(extract(epoch FROM time_to_resolve) / 60), backfilled FROM incident_resolutions "
           f"WHERE incident_id = {inc};") == ["60|t"])
check("an open incident backfills its opening only", len(log(r["incident_id"])) == 1)
psql((ROOT / "infra/migrations/005_metrics.sql").read_text())
check("running the migration again adds nothing", scalar("SELECT count(*) FROM incident_status_log") == str(
    int(scalar("SELECT count(*) FROM incidents")) + int(scalar("SELECT count(*) FROM incidents WHERE status <> 'open'"))))

print("all metrics db tests passed")
