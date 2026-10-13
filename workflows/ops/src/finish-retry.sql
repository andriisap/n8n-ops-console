-- Postgres node "Finish retry" in ops-retry-scheduler.
-- $1 = {id, outcome, retry_execution_id, error} from "Evaluate result".
--
-- Backoff is decided here, in one place: base * 2^(attempt-1), capped at 30 min,
-- with ±20 % jitter so jobs that failed together don't retry together.
-- Base: 60 s for rate limits, 30 s otherwise. A transient failure is retried
-- 30 s after it happens, then 30 s, 1, 2 and 4 min after each failed attempt:
-- 5 attempts, given up ~8 min in (~16 min for rate limits).
--
-- Only touches a job that is still in_progress, so a late answer can't overwrite
-- a job that another run has already re-leased and finished.

WITH input AS (
    SELECT (p->>'id')::bigint                  AS id,
           p->>'outcome'                       AS outcome,
           nullif(p->>'retry_execution_id', '') AS retry_execution_id,
           left(p->>'error', 1000)              AS error
    FROM (SELECT $1::jsonb AS p) AS src
),
job AS (
    SELECT r.id,
           CASE WHEN i.error_class = 'rate_limit' THEN 60 ELSE 30 END AS base_seconds,
           i.error_class, i.workflow_name, i.node_name
    FROM retry_queue r
    JOIN incidents i ON i.id = r.incident_id
    JOIN input inp ON inp.id = r.id
),
upd AS (
    UPDATE retry_queue r
    SET status = CASE
            WHEN inp.outcome = 'succeeded' THEN 'succeeded'
            WHEN inp.outcome = 'dead'      THEN 'dead'
            WHEN inp.outcome = 'requeue'   THEN 'pending'
            WHEN r.attempt >= r.max_attempts THEN 'dead'
            ELSE 'pending'
        END,
        -- a requeue was not a real attempt: give it back
        attempt = CASE WHEN inp.outcome = 'requeue' THEN greatest(r.attempt - 1, 0) ELSE r.attempt END,
        next_attempt_at = CASE
            WHEN inp.outcome = 'requeue' THEN now() + interval '1 minute'
            ELSE now() + make_interval(secs =>
                     least(1800, j.base_seconds * power(2, greatest(r.attempt - 1, 0)))
                     * (0.8 + random() * 0.4))
        END,
        locked_at          = NULL,
        last_attempt_at    = now(),
        last_error         = CASE WHEN inp.outcome = 'succeeded' THEN NULL ELSE inp.error END,
        retry_execution_id = coalesce(inp.retry_execution_id, r.retry_execution_id)
    FROM input inp, job j
    WHERE r.id = inp.id AND r.status = 'in_progress'
    RETURNING r.id, r.status, r.attempt, r.max_attempts, r.kind, r.execution_id, r.workflow_id,
              r.retry_execution_id, r.last_error, r.next_attempt_at, r.incident_id
)
SELECT u.id, u.status, u.attempt, u.max_attempts, u.kind, u.execution_id, u.workflow_id,
       u.retry_execution_id, u.last_error, u.next_attempt_at, u.incident_id,
       j.workflow_name, j.node_name, j.error_class,
       u.status IN ('succeeded', 'dead') AS notify
FROM upd u
JOIN job j USING (id);
