-- 002_dashboard_role.sql
-- A separate login for the dashboard with the least it needs:
-- read everything, change only an incident's status. It can't delete rows,
-- can't edit events or retry jobs, can't touch the schema.
--
-- The password is NOT set here, so it never lands in git. After running this:
--   ALTER ROLE ops_dashboard PASSWORD '<generated password>';

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ops_dashboard') THEN
        CREATE ROLE ops_dashboard LOGIN;
    END IF;
END
$$;

-- Lock down defaults: in Postgres 15+ PUBLIC has no CREATE on public schema,
-- this makes the intent explicit for older versions too.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE ops TO ops_dashboard;
GRANT USAGE ON SCHEMA public TO ops_dashboard;

GRANT SELECT ON incidents, error_events, retry_queue, llm_usage, model_prices, heartbeats
    TO ops_dashboard;

-- Column-level grant: the dashboard can set status and resolved_at, nothing else.
-- updated_at still changes, because the BEFORE UPDATE trigger sets it.
GRANT UPDATE (status, resolved_at) ON incidents TO ops_dashboard;

INSERT INTO schema_migrations (version) VALUES ('002_dashboard_role')
ON CONFLICT (version) DO NOTHING;

COMMIT;
