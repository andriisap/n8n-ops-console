-- Postgres node "Upsert incident" in ops-error-handler.
-- $1 = the whole normalized record as JSON (one parameter, so commas or quotes
-- inside error messages can never break parameter parsing).
-- Always returns exactly one row.

WITH input AS (
    SELECT
        p->>'execution_id'       AS execution_id,
        p->>'workflow_id'        AS workflow_id,
        p->>'workflow_name'      AS workflow_name,
        p->>'node_name'          AS node_name,
        p->>'error_class'        AS error_class,
        p->>'error_message'      AS error_message,
        p->>'normalized_message' AS normalized_message,
        p->>'execution_url'      AS execution_url,
        p->>'execution_mode'     AS execution_mode,
        p->'error_raw'           AS error_raw,
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
        occurrences    = incidents.occurrences + 1,
        last_seen_at   = now(),
        workflow_name  = EXCLUDED.workflow_name,
        status         = CASE WHEN incidents.status = 'resolved' THEN 'open' ELSE incidents.status END,
        reopened_count = incidents.reopened_count + (incidents.status = 'resolved')::int,
        resolved_at    = CASE WHEN incidents.status = 'resolved' THEN NULL ELSE incidents.resolved_at END
    RETURNING id, status, occurrences, reopened_count, (xmax = 0) AS is_new
),
ev AS (
    INSERT INTO error_events (incident_id, execution_id, workflow_id, workflow_name, node_name,
                              error_class, error_message, error_raw, execution_url, execution_mode)
    SELECT u.id, i.execution_id, i.workflow_id, i.workflow_name, i.node_name,
           i.error_class, i.error_message, i.error_raw, i.execution_url, i.execution_mode
    FROM upsert u CROSS JOIN input i
    ON CONFLICT (execution_id) DO NOTHING
    RETURNING id
)
SELECT
    u.id                                              AS incident_id,
    u.status                                          AS status,
    u.occurrences                                     AS occurrences,
    u.reopened_count                                  AS reopened_count,
    u.is_new                                          AS is_new,
    coalesce((SELECT status FROM prev) = 'resolved', false) AS is_reopened,
    (SELECT id FROM ev)                               AS error_event_id,
    false                                             AS duplicate,
    u.status = 'open'
        AND (u.is_new OR coalesce((SELECT status FROM prev) = 'resolved', false)) AS should_alert
FROM upsert u
UNION ALL
SELECT NULL, NULL, NULL, NULL, false, false, NULL, true, false
WHERE EXISTS (SELECT 1 FROM already);
