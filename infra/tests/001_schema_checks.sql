-- Behaviour checks for 001_init. Runs inside a transaction and rolls back,
-- so it leaves no data behind. Any failed check raises and stops the script.
-- Run: psql -v ON_ERROR_STOP=1 -f infra/tests/001_schema_checks.sql

BEGIN;

DO $$
DECLARE
    inc_id   bigint;
    inc      incidents%ROWTYPE;
    ev_count integer;
    created  timestamptz;
BEGIN
    -- 1. Same fingerprint twice -> one incident, occurrences = 2.
    INSERT INTO incidents (fingerprint, workflow_id, workflow_name, node_name, error_class, error_message)
    VALUES ('fp-test', 'wf1', 'chaos-429', 'Call rate-limited API', 'rate_limit', 'HTTP 429')
    ON CONFLICT (fingerprint) DO UPDATE
        SET occurrences = incidents.occurrences + 1, last_seen_at = now()
    RETURNING id INTO inc_id;

    INSERT INTO incidents (fingerprint, workflow_id, workflow_name, node_name, error_class, error_message)
    VALUES ('fp-test', 'wf1', 'chaos-429', 'Call rate-limited API', 'rate_limit', 'HTTP 429')
    ON CONFLICT (fingerprint) DO UPDATE
        SET occurrences = incidents.occurrences + 1, last_seen_at = now();

    SELECT * INTO inc FROM incidents WHERE id = inc_id;
    IF inc.occurrences <> 2 THEN
        RAISE EXCEPTION 'dedup: expected 2 occurrences, got %', inc.occurrences;
    END IF;

    -- 2. Same execution reported twice -> one error_event.
    INSERT INTO error_events (incident_id, execution_id, workflow_id, workflow_name, error_class, error_message)
    VALUES (inc_id, 'exec-1', 'wf1', 'chaos-429', 'rate_limit', 'HTTP 429')
    ON CONFLICT (execution_id) DO NOTHING;
    INSERT INTO error_events (incident_id, execution_id, workflow_id, workflow_name, error_class, error_message)
    VALUES (inc_id, 'exec-1', 'wf1', 'chaos-429', 'rate_limit', 'HTTP 429')
    ON CONFLICT (execution_id) DO NOTHING;

    SELECT count(*) INTO ev_count FROM error_events WHERE execution_id = 'exec-1';
    IF ev_count <> 1 THEN
        RAISE EXCEPTION 'idempotency: expected 1 event, got %', ev_count;
    END IF;

    -- 3. Unknown error class is rejected.
    BEGIN
        INSERT INTO incidents (fingerprint, workflow_id, workflow_name, error_class, error_message)
        VALUES ('fp-bad', 'wf1', 'x', 'oops', 'x');
        RAISE EXCEPTION 'check: bad error_class was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- 4. updated_at is set by the trigger on UPDATE.
    UPDATE incidents SET updated_at = '2000-01-01' WHERE id = inc_id;
    SELECT updated_at INTO created FROM incidents WHERE id = inc_id;
    IF created < now() - interval '1 minute' THEN
        RAISE EXCEPTION 'trigger: updated_at was not refreshed';
    END IF;

    RAISE NOTICE 'all schema checks passed';
END;
$$;

ROLLBACK;
