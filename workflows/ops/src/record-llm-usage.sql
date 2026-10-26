-- Postgres node "Record usage" in ops-cost-collector.
-- $1 = {executions: [...], calls: [...]} from "Extract LLM calls".
--
-- One statement, so calls and the "scanned" marks land together or not at all:
-- an execution is never marked scanned while its calls are missing.
-- Both inserts ignore rows already there, so reading an execution twice changes nothing.

WITH input AS (
    SELECT $1::jsonb AS j
),
calls AS (
    INSERT INTO llm_usage (execution_id, workflow_id, workflow_name, node_name, run_index,
                           provider, model, input_tokens, output_tokens, estimated,
                           execution_status, started_at)
    SELECT c.execution_id, c.workflow_id, coalesce(c.workflow_name, ''), c.node_name, c.run_index,
           c.provider, c.model, c.input_tokens, c.output_tokens, c.estimated,
           c.execution_status, c.started_at
    FROM input,
         jsonb_to_recordset(coalesce(input.j->'calls', '[]'::jsonb)) AS c(
             execution_id text, workflow_id text, workflow_name text, node_name text, run_index integer,
             provider text, model text, input_tokens integer, output_tokens integer, estimated boolean,
             execution_status text, started_at timestamptz)
    ON CONFLICT (execution_id, node_name, run_index) DO NOTHING
    RETURNING 1
),
scans AS (
    INSERT INTO cost_scans (execution_id, workflow_id, workflow_name, execution_status, started_at, llm_calls)
    SELECT s.execution_id, s.workflow_id, s.workflow_name, s.execution_status, s.started_at, s.llm_calls
    FROM input,
         jsonb_to_recordset(coalesce(input.j->'executions', '[]'::jsonb)) AS s(
             execution_id text, workflow_id text, workflow_name text, execution_status text,
             started_at timestamptz, llm_calls integer)
    ON CONFLICT (execution_id) DO NOTHING
    RETURNING 1
)
SELECT (SELECT count(*) FROM calls) AS calls_recorded,
       (SELECT count(*) FROM scans) AS executions_recorded;
