"""Small helpers shared by the database tests. Talks to Postgres through psql only."""
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]


def psql(script, **variables):
    """Runs SQL through psql; variables are passed with -v, raw, so no quoting rules to get wrong."""
    args = ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-F", "|"]
    for name, value in variables.items():
        args += ["-v", f"{name}={value}"]
    out = subprocess.run(args, input=script, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr)
    return [line for line in out.stdout.splitlines() if line]


def run_query_file(relative_path, payload, columns):
    """Runs a workflow SQL file exactly as the n8n Postgres node does: one JSON bind parameter.

    PREPARE keeps $1 a real bind parameter. Returns the rows as dicts.
    """
    sql = (ROOT / relative_path).read_text().strip().rstrip(";")
    rows = psql(f"PREPARE q(jsonb) AS\n{sql};\nEXECUTE q(:'payload');\n", payload=json.dumps(payload))
    return [dict(zip(columns, r.split("|"))) for r in rows]


def scalar(query):
    rows = psql(query)
    return rows[0] if rows else None


def check(label, cond):
    assert cond, label
    print(f"ok  {label}")


def reset():
    psql("TRUNCATE incidents, error_events, retry_queue RESTART IDENTITY CASCADE;")
