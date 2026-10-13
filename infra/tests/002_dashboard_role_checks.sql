-- Checks that ops_dashboard can do exactly what the dashboard needs and nothing more.
-- Run as the owner (ops); switches role inside a rolled-back transaction.
--   psql -v ON_ERROR_STOP=1 -f infra/tests/002_dashboard_role_checks.sql

BEGIN;

INSERT INTO incidents (fingerprint, workflow_id, workflow_name, error_class, error_message)
VALUES ('fp-role-test', 'wf', 'role-test', 'auth', 'x');
INSERT INTO error_events (incident_id, execution_id, workflow_id, workflow_name, error_class, error_message)
SELECT id, 'exec-role-test', 'wf', 'role-test', 'auth', 'x' FROM incidents WHERE fingerprint = 'fp-role-test';

SET LOCAL ROLE ops_dashboard;

DO $$
DECLARE
    n integer;
BEGIN
    -- allowed
    SELECT count(*) INTO n FROM incidents;
    SELECT count(*) INTO n FROM error_events;
    UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE fingerprint = 'fp-role-test';

    -- forbidden: other columns
    BEGIN
        UPDATE incidents SET occurrences = 999 WHERE fingerprint = 'fp-role-test';
        RAISE EXCEPTION 'could update occurrences';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- forbidden: delete
    BEGIN
        DELETE FROM incidents WHERE fingerprint = 'fp-role-test';
        RAISE EXCEPTION 'could delete incidents';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- forbidden: insert
    BEGIN
        INSERT INTO incidents (fingerprint, workflow_id, workflow_name, error_class, error_message)
        VALUES ('x', 'x', 'x', 'auth', 'x');
        RAISE EXCEPTION 'could insert incidents';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- forbidden: edit events
    BEGIN
        UPDATE error_events SET error_message = 'tampered' WHERE execution_id = 'exec-role-test';
        RAISE EXCEPTION 'could edit events';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- forbidden: schema changes
    BEGIN
        CREATE TABLE evil (id int);
        RAISE EXCEPTION 'could create tables';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    RAISE NOTICE 'all dashboard role checks passed';
END
$$;

ROLLBACK;
