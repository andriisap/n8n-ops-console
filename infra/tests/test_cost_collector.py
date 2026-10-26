"""ops-cost-collector's SQL: where the listing window starts and which executions get downloaded.

Needs a scratch Postgres with migrations 001-004 applied. Truncates the cost tables.
"""
import json

from _db import ROOT, check, psql, run_query_file, scalar


def window():
    sql = (ROOT / "workflows/ops/src/cost-scan-window.sql").read_text()
    return psql(sql)[0]


def pick(ids, no_llm=()):
    rows = run_query_file("workflows/ops/src/pick-unscanned.sql", {"ids": ids, "no_llm": list(no_llm)},
                          ["id", "marked"])
    return [r["id"] for r in rows]


def scanned(execution_id, started_at, workflow_name="wf-with-llm"):
    psql(f"INSERT INTO cost_scans (execution_id, workflow_id, workflow_name, execution_status, started_at) "
         f"VALUES ('{execution_id}', 'wf', '{workflow_name}', 'success', '{started_at}');")


def no_llm(execution_id, started_at):
    return {"execution_id": execution_id, "workflow_id": "wf-plain", "execution_status": "success",
            "started_at": started_at}


psql("TRUNCATE llm_usage, cost_scans RESTART IDENTITY;")

w = window()
lag = scalar(f"SELECT round(extract(epoch FROM now() - '{w}'::timestamptz) / 3600)")
check(f"first run: window starts ~26 h back ({w})", lag == "26")
check("window is ISO-8601 UTC, as the API's startedAfter wants", w.endswith("Z") and "T" in w)

recent = scalar("SELECT to_char((now() - interval '30 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
expected = scalar(f"SELECT to_char(('{recent}'::timestamptz - interval '2 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
scanned("100", recent)
scanned("90", "2026-10-20T12:00:00Z")
check("window = 2 h before the newest downloaded execution", window() == expected)

pick([], [no_llm("500", "2099-01-01T00:00:00Z")])
check("executions marked from the listing (no model node) don't move the window", window() == expected)

psql("DELETE FROM cost_scans WHERE execution_id IN ('100', '500');")
lag = scalar(f"SELECT round(extract(epoch FROM now() - '{window()}'::timestamptz) / 3600)")
check("frontier older than a day: window capped at ~26 h back", lag == "26")
scanned("100", "2026-10-26T14:00:00Z")

check("already scanned ids are not downloaded again", pick(["90", "100", "101", "102"]) == ["101", "102"])
check("oldest first, numeric order (99 before 1000)", pick(["1000", "99"]) == ["99", "1000"])
check("at most 25 per run", len(pick([str(i) for i in range(200, 260)])) == 25)
check("junk ids ignored (never reach the URL)", pick(["101", "1;drop", "../x"]) == ["101"])
check("no ids: no rows, so the run stops there", pick([]) == [])

r = run_query_file("workflows/ops/src/pick-unscanned.sql",
                   {"ids": ["700"], "no_llm": [no_llm("600", "2026-10-26T10:00:00Z"), no_llm("601", "2026-10-26T10:01:00Z")]},
                   ["id", "marked"])
check("workflows without a model node: marked scanned, not downloaded", [x["id"] for x in r] == ["700"]
      and scalar("SELECT count(*) FROM cost_scans WHERE execution_id IN ('600', '601') AND llm_calls = 0") == "2")
check("they are marked even when nothing is left to download",
      pick([], [no_llm("602", "2026-10-26T10:02:00Z")]) == []
      and scalar("SELECT count(*) FROM cost_scans WHERE execution_id = '602'") == "1")
check("marking twice is a no-op", pick([], [no_llm("602", "2026-10-26T10:02:00Z")]) == [])

print("all cost collector tests passed")
