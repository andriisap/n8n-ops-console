-- Postgres node "Scan window" in ops-cost-collector.
-- Where to start listing executions.
--
-- Frontier = the newest execution whose data was downloaded (workflow_name is set only on
-- that path; executions of workflows without a model node are marked from the listing and
-- don't move it). Downloads go oldest first, so every LLM execution still waiting is newer
-- than the frontier. Minus 2 h: a run that started earlier but finished after the last scan
-- is still caught.
-- Never more than 1 day back, so the listing stays a few pages: after more than a day of
-- collector downtime, older LLM runs are not counted (decision 032).
SELECT to_char(
         (greatest(
             coalesce((SELECT max(started_at) FROM cost_scans WHERE workflow_name IS NOT NULL), '-infinity'),
             now() - interval '1 day')
          - interval '2 hours') AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_after;
