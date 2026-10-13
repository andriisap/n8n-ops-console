-- Postgres node "Claim due retries" in ops-retry-scheduler.
-- Takes up to 5 due jobs and leases them: status in_progress + locked_at.
--
-- SKIP LOCKED: two scheduler runs at the same moment never take the same row.
-- The lease is the status itself, committed right away, so a run that crashes mid-way
-- doesn't hold row locks; its jobs are picked up again once the lease is 10 minutes old.
-- The attempt counter goes up here, before the call, so a crash still counts as an attempt.

WITH due AS (
    SELECT id
    FROM retry_queue
    WHERE (status = 'pending' AND next_attempt_at <= now())
       OR (status = 'in_progress' AND locked_at < now() - interval '10 minutes')
    ORDER BY next_attempt_at
    LIMIT 5
    FOR UPDATE SKIP LOCKED
)
UPDATE retry_queue r
SET status    = 'in_progress',
    locked_at = now(),
    attempt   = r.attempt + 1
FROM due
WHERE r.id = due.id
RETURNING r.id, r.execution_id, r.workflow_id, r.incident_id, r.kind,
          r.load_workflow, r.attempt, r.max_attempts;
