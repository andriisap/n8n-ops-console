-- Postgres node "Scan window" in ops-cost-collector.
-- Where to start listing executions: two hours before the newest execution already scanned,
-- so a run that started earlier but finished after the last scan is still caught.
-- Unscanned executions are taken oldest first (pick-unscanned.sql), so after downtime the
-- frontier walks forward through the backlog instead of skipping it. First run: last 24 h.
SELECT to_char(
         (coalesce((SELECT max(started_at) FROM cost_scans), now() - interval '1 day')
          - interval '2 hours') AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_after;
