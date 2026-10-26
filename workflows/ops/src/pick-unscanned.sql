-- Postgres node "Pick unscanned" in ops-cost-collector.
-- $1 = {ids: [...], no_llm: [...]} from "Finished ids".
--
-- 1. Executions of workflows without a model node are marked scanned (0 calls) right here.
-- 2. Of the rest, at most 25 never-scanned ids are returned, oldest first: each needs its
--    full data downloaded, so a backlog is worked off over several runs.
WITH input AS (
    SELECT $1::jsonb AS j
),
mark AS (
    INSERT INTO cost_scans (execution_id, workflow_id, execution_status, started_at, llm_calls)
    SELECT s.execution_id, s.workflow_id, s.execution_status, s.started_at, 0
    FROM input,
         jsonb_to_recordset(coalesce(input.j->'no_llm', '[]'::jsonb)) AS s(
             execution_id text, workflow_id text, execution_status text, started_at timestamptz)
    WHERE s.execution_id ~ '^[0-9]+$' AND s.started_at IS NOT NULL
    ON CONFLICT (execution_id) DO NOTHING
    RETURNING 1
)
SELECT t.id, (SELECT count(*) FROM mark) AS marked_without_llm
FROM input, jsonb_array_elements_text(coalesce(input.j->'ids', '[]'::jsonb)) AS t(id)
WHERE t.id ~ '^[0-9]+$'
  AND NOT EXISTS (SELECT 1 FROM cost_scans s WHERE s.execution_id = t.id)
ORDER BY t.id::bigint
LIMIT 25;
