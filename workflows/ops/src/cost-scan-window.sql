-- Postgres node "Scan window" in ops-cost-collector, the first thing every run does.
--
-- 1. Heartbeat: records that the collector ran, even when there is nothing new to scan.
--    Successful runs aren't saved in n8n, and quiet periods record no scans, so without
--    this the dashboard can't tell "nothing happened" from "the collector is dead".
-- 2. Where to start listing executions.
--    Frontier = the newest execution whose data was downloaded (workflow_name is set only on
--    that path; executions of workflows without a model node are marked from the listing and
--    don't move it). Downloads go oldest first, so every LLM execution still waiting is newer
--    than the frontier. Minus 2 h: a run that started earlier but finished after the last scan
--    is still caught.
--    Never more than 1 day back, so the listing stays a few pages: after more than a day of
--    collector downtime, older LLM runs are not counted (decision 032).
WITH beat AS (
    INSERT INTO heartbeats (source, last_beat_at)
    VALUES ('ops-cost-collector', now())
    ON CONFLICT (source) DO UPDATE SET last_beat_at = EXCLUDED.last_beat_at
    RETURNING last_beat_at
)
SELECT to_char(
         (greatest(
             coalesce((SELECT max(started_at) FROM cost_scans WHERE workflow_name IS NOT NULL), '-infinity'),
             now() - interval '1 day')
          - interval '2 hours') AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_after,
       (SELECT last_beat_at FROM beat) AS heartbeat_at;
