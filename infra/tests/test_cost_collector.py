"""ops-cost-collector's SQL: where the listing window starts and which executions get downloaded.

Needs a scratch Postgres with migrations 001-004 applied. Truncates the cost tables.
"""
import json

from _db import ROOT, check, psql, run_query_file, scalar


def window():
    sql = (ROOT / "workflows/ops/src/cost-scan-window.sql").read_text()
    return psql(sql)[0]


def pick(ids):
    rows = run_query_file("workflows/ops/src/pick-unscanned.sql", {"ids": ids}, ["id"])
    return [r["id"] for r in rows]


def scanned(execution_id, started_at):
    psql(f"INSERT INTO cost_scans (execution_id, workflow_id, execution_status, started_at) "
         f"VALUES ('{execution_id}', 'wf', 'success', '{started_at}');")


psql("TRUNCATE llm_usage, cost_scans RESTART IDENTITY;")

w = window()
lag = scalar(f"SELECT round(extract(epoch FROM now() - '{w}'::timestamptz) / 3600)")
check(f"first run: window starts ~26 h back ({w})", lag == "26")
check("window is ISO-8601 UTC, as the API's startedAfter wants", w.endswith("Z") and "T" in w)

scanned("100", "2026-10-26T14:00:00Z")
scanned("90", "2026-10-26T12:00:00Z")
check("window = 2 h before the newest scanned execution", window() == "2026-10-26T12:00:00Z")

check("already scanned ids are not downloaded again", pick(["90", "100", "101", "102"]) == ["101", "102"])
check("oldest first, numeric order (99 before 1000)", pick(["1000", "99"]) == ["99", "1000"])
check("at most 25 per run", len(pick([str(i) for i in range(200, 260)])) == 25)
check("junk ids ignored (never reach the URL)", pick(["101", "1;drop", "../x"]) == ["101"])
check("no ids: no rows, so the run stops there", pick([]) == [])

print("all cost collector tests passed")
