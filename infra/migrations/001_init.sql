-- 001_init.sql
-- Ops Console schema. Safe to run twice: every object uses IF NOT EXISTS,
-- and the migration records itself in schema_migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- Keeps updated_at honest without relying on every writer to set it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- One row per distinct problem. Ten identical failures = one incident with
-- occurrences = 10. A resolved incident that fails again is reopened, not duplicated.
CREATE TABLE IF NOT EXISTS incidents (
    id              bigserial PRIMARY KEY,
    fingerprint     text        NOT NULL UNIQUE,
    workflow_id     text        NOT NULL,
    workflow_name   text        NOT NULL,
    node_name       text,
    error_class     text        NOT NULL
        CHECK (error_class IN ('rate_limit', 'transient', 'auth', 'validation', 'unknown')),
    error_message   text        NOT NULL,   -- normalized sample, ids and timestamps stripped
    status          text        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved', 'ignored')),
    occurrences     integer     NOT NULL DEFAULT 1 CHECK (occurrences > 0),
    reopened_count  integer     NOT NULL DEFAULT 0,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
    last_alerted_at timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incidents_status_last_seen_idx
    ON incidents (status, last_seen_at DESC);

DROP TRIGGER IF EXISTS incidents_updated_at ON incidents;
CREATE TRIGGER incidents_updated_at
    BEFORE UPDATE ON incidents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per failed execution. UNIQUE(execution_id) makes the error workflow
-- idempotent: if it runs twice for the same execution, the second insert is a no-op.
CREATE TABLE IF NOT EXISTS error_events (
    id             bigserial PRIMARY KEY,
    incident_id    bigint      NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    execution_id   text        NOT NULL UNIQUE,
    workflow_id    text        NOT NULL,
    workflow_name  text        NOT NULL,
    node_name      text,
    error_class    text        NOT NULL,
    error_message  text        NOT NULL,   -- original, not normalized
    error_raw      jsonb,                  -- full Error Trigger payload for debugging
    execution_url  text,
    execution_mode text,                   -- webhook, trigger, retry...
    occurred_at    timestamptz NOT NULL DEFAULT now(),
    received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS error_events_incident_idx
    ON error_events (incident_id, occurred_at DESC);

-- Work queue for automatic retries (stage 4). Workers claim rows with
-- SELECT ... FOR UPDATE SKIP LOCKED, so two scheduler runs never take the same job.
CREATE TABLE IF NOT EXISTS retry_queue (
    id              bigserial PRIMARY KEY,
    error_event_id  bigint      NOT NULL REFERENCES error_events (id) ON DELETE CASCADE,
    incident_id     bigint      NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    execution_id    text        NOT NULL,
    workflow_id     text        NOT NULL,
    idempotency_key text        NOT NULL UNIQUE,
    status          text        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'succeeded', 'failed', 'dead')),
    attempt         integer     NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    max_attempts    integer     NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_at       timestamptz,
    last_error      text,
    retry_execution_id text,               -- execution created by the successful retry
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The scheduler only ever looks for due pending jobs; a partial index keeps that fast.
CREATE INDEX IF NOT EXISTS retry_queue_due_idx
    ON retry_queue (next_attempt_at)
    WHERE status = 'pending';

DROP TRIGGER IF EXISTS retry_queue_updated_at ON retry_queue;
CREATE TRIGGER retry_queue_updated_at
    BEFORE UPDATE ON retry_queue
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Price per million tokens, versioned by date. A price change never rewrites
-- the cost of past runs: each usage row is priced with the row valid at the time.
CREATE TABLE IF NOT EXISTS model_prices (
    provider             text          NOT NULL,
    model                text          NOT NULL,
    valid_from           date          NOT NULL,
    input_per_mtok       numeric(10,4) NOT NULL CHECK (input_per_mtok >= 0),
    output_per_mtok      numeric(10,4) NOT NULL CHECK (output_per_mtok >= 0),
    cache_read_per_mtok  numeric(10,4) NOT NULL DEFAULT 0,
    cache_write_per_mtok numeric(10,4) NOT NULL DEFAULT 0,
    source_url           text,
    PRIMARY KEY (provider, model, valid_from)
);

-- One row per LLM call (stage 5).
CREATE TABLE IF NOT EXISTS llm_usage (
    id                 bigserial PRIMARY KEY,
    execution_id       text          NOT NULL,
    workflow_id        text          NOT NULL,
    workflow_name      text          NOT NULL,
    node_name          text,
    provider           text          NOT NULL,
    model              text          NOT NULL,
    input_tokens       integer       NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens      integer       NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    cache_read_tokens  integer       NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
    cache_write_tokens integer       NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
    cost_usd           numeric(12,6),  -- NULL when no price is known for the model
    created_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_usage_execution_idx ON llm_usage (execution_id);
CREATE INDEX IF NOT EXISTS llm_usage_workflow_time_idx ON llm_usage (workflow_id, created_at DESC);

-- Last sign of life per source (stage 6): n8n itself, the scheduler, the external worker.
CREATE TABLE IF NOT EXISTS heartbeats (
    source       text        PRIMARY KEY,
    last_beat_at timestamptz NOT NULL DEFAULT now(),
    details      jsonb
);

INSERT INTO schema_migrations (version) VALUES ('001_init')
ON CONFLICT (version) DO NOTHING;

COMMIT;
