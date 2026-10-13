-- 003_retries.sql
-- Automatic retries (stage 4) and manual Replay from the dashboard.

BEGIN;

-- A failed retry runs the error workflow again, with retryOf = the original execution.
-- Storing it lets the handler tell a new failure from a failed retry, which is what
-- breaks the "retry fails -> enqueue another retry -> ..." loop.
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS retry_of text;
CREATE INDEX IF NOT EXISTS error_events_retry_of_idx
    ON error_events (retry_of) WHERE retry_of IS NOT NULL;

ALTER TABLE retry_queue ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'auto';
ALTER TABLE retry_queue ADD COLUMN IF NOT EXISTS load_workflow boolean NOT NULL DEFAULT false;
ALTER TABLE retry_queue ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'retry_queue_kind_check') THEN
        ALTER TABLE retry_queue ADD CONSTRAINT retry_queue_kind_check CHECK (kind IN ('auto', 'manual'));
    END IF;
END
$$;

-- At most one pending or running job per execution, however many times Replay is clicked.
CREATE UNIQUE INDEX IF NOT EXISTS retry_queue_one_active_per_execution
    ON retry_queue (execution_id) WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS retry_queue_execution_idx ON retry_queue (execution_id, id DESC);

-- Whoever inserts a job, its execution, workflow and incident are taken from the event it
-- points at, so a caller can't queue a retry of an execution that never failed.
-- The dashboard role is also pinned to one-shot manual jobs.
CREATE OR REPLACE FUNCTION retry_queue_before_insert() RETURNS trigger AS $$
DECLARE
    ev error_events%ROWTYPE;
BEGIN
    SELECT * INTO ev FROM error_events WHERE id = NEW.error_event_id;
    IF FOUND THEN
        NEW.execution_id := ev.execution_id;
        NEW.workflow_id  := ev.workflow_id;
        NEW.incident_id  := ev.incident_id;
    END IF;
    IF current_user = 'ops_dashboard' THEN
        NEW.kind          := 'manual';
        NEW.max_attempts  := 1;
        NEW.load_workflow := true;
        NEW.attempt       := 0;
        NEW.status        := 'pending';
        NEW.next_attempt_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS retry_queue_before_insert ON retry_queue;
CREATE TRIGGER retry_queue_before_insert
    BEFORE INSERT ON retry_queue
    FOR EACH ROW EXECUTE FUNCTION retry_queue_before_insert();

-- Dashboard: may request a retry, nothing else on this table.
GRANT INSERT (error_event_id, incident_id, execution_id, workflow_id, idempotency_key)
    ON retry_queue TO ops_dashboard;
GRANT USAGE ON SEQUENCE retry_queue_id_seq TO ops_dashboard;

INSERT INTO schema_migrations (version) VALUES ('003_retries')
ON CONFLICT (version) DO NOTHING;

COMMIT;
