-- Postgres node "Upsert incident" in ops-error-handler.
-- $1 = the whole normalized record as JSON (one parameter, so commas or quotes
-- inside error messages can never break parameter parsing).
-- Always returns exactly one row.

WITH input AS (
    SELECT
        p->>'execution_id'              AS execution_id,
        p->>'workflow_id'               AS workflow_id,
        p->>'workflow_name'             AS workflow_name,
        p->>'node_name'                 AS node_name,
        p->>'error_class'               AS error_class,
        p->>'error_message'             AS error_message,
        p->>'normalized_message'        AS normalized_message,
        p->>'execution_url'             AS execution_url,
        p->>'execution_mode'            AS execution_mode,
        nullif(p->>'retry_of', '')      AS retry_of,
        -- A failed retry: recorded as history, but it is not a new failure.
        nullif(p->>'retry_of', '') IS NOT NULL AS is_retry,
        p->'error_raw'                  AS error_raw,
        md5(concat_ws('|',
            p->>'workflow_id',
            coalesce(p->>'node_name', ''),
            p->>'error_class',
            p->>'normalized_message')) AS fingerprint
    FROM (SELECT $1::jsonb AS p) AS src
),
-- The same execution reported twice (n8n retry of the handler, manual re-run): do nothing.
already AS (
    SELECT 1 FROM error_events e JOIN input i USING (execution_id)
),
-- CTEs read the table as it was before this statement, so this is the status before the upsert.
prev AS (
    SELECT inc.status FROM incidents inc JOIN input i USING (fingerprint)
),
upsert AS (
    INSERT INTO incidents (fingerprint, workflow_id, workflow_name, node_name, error_class, error_message)
    SELECT fingerprint, workflow_id, workflow_name, node_name, error_class, normalized_message
    FROM input
    WHERE NOT EXISTS (SELECT 1 FROM already)
    ON CONFLICT (fingerprint) DO UPDATE SET
        -- Failed retries don't inflate the count and don't reopen a resolved incident.
        occurrences    = incidents.occurrences + (NOT (SELECT is_retry FROM input))::int,
        last_seen_at   = now(),
        workflow_name  = EXCLUDED.workflow_name,
        status         = CASE WHEN incidents.status = 'resolved' AND NOT (SELECT is_retry FROM input)
                              THEN 'open' ELSE incidents.status END,
        reopened_count = incidents.reopened_count
                         + (incidents.status = 'resolved' AND NOT (SELECT is_retry FROM input))::int,
        resolved_at    = CASE WHEN incidents.status = 'resolved' AND NOT (SELECT is_retry FROM input)
                              THEN NULL ELSE incidents.resolved_at END
    RETURNING id, status, occurrences, reopened_count, (xmax = 0) AS is_new
),
ev AS (
    INSERT INTO error_events (incident_id, execution_id, workflow_id, workflow_name, node_name,
                              error_class, error_message, error_raw, execution_url, execution_mode, retry_of)
    SELECT u.id, i.execution_id, i.workflow_id, i.workflow_name, i.node_name,
           i.error_class, i.error_message, i.error_raw, i.execution_url, i.execution_mode, i.retry_of
    FROM upsert u CROSS JOIN input i
    ON CONFLICT (execution_id) DO NOTHING
    RETURNING id
),
-- Only failures that can fix themselves are retried automatically. Never a retry of a retry:
-- the scheduler owns the attempt count. Never for ignored incidents or trigger failures,
-- which have no execution to retry.
rq AS (
    INSERT INTO retry_queue (error_event_id, incident_id, execution_id, workflow_id,
                             idempotency_key, kind, next_attempt_at)
    SELECT e.id, u.id, i.execution_id, i.workflow_id,
           'auto:' || i.execution_id, 'auto',
           now() + CASE WHEN i.error_class = 'rate_limit' THEN interval '60 seconds'
                        ELSE interval '30 seconds' END
    FROM ev e CROSS JOIN upsert u CROSS JOIN input i
    WHERE i.error_class IN ('rate_limit', 'transient')
      AND NOT i.is_retry
      AND u.status = 'open'
      AND i.execution_id NOT LIKE 'trigger:%'
    ON CONFLICT DO NOTHING
    RETURNING id
)
SELECT
    u.id                                              AS incident_id,
    u.status                                          AS status,
    u.occurrences                                     AS occurrences,
    u.reopened_count                                  AS reopened_count,
    u.is_new                                          AS is_new,
    coalesce((SELECT status FROM prev) = 'resolved', false)
        AND NOT (SELECT is_retry FROM input)          AS is_reopened,
    (SELECT id FROM ev)                               AS error_event_id,
    false                                             AS duplicate,
    (SELECT is_retry FROM input)                      AS is_retry,
    EXISTS (SELECT 1 FROM rq)                         AS retry_enqueued,
    u.status = 'open'
        AND NOT (SELECT is_retry FROM input)
        AND (u.is_new OR coalesce((SELECT status FROM prev) = 'resolved', false)) AS should_alert
FROM upsert u
UNION ALL
SELECT NULL, NULL, NULL, NULL, false, false, NULL, true, false, false, false
WHERE EXISTS (SELECT 1 FROM already);
