-- 005_metrics.sql
-- Metrics (stage 7): a history of incident status changes, so time to resolve can be
-- measured per resolution, and two views the dashboard reads (decision 037).

BEGIN;

-- incidents keeps only the latest resolved_at; a reopen overwrites the story.
-- Every status change is appended here by a trigger, whoever makes it.
CREATE TABLE IF NOT EXISTS incident_status_log (
    id          bigserial   PRIMARY KEY,
    incident_id bigint      NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    from_status text,                       -- NULL: the incident was just created
    to_status   text        NOT NULL,
    changed_at  timestamptz NOT NULL DEFAULT now(),
    changed_by  text        NOT NULL DEFAULT current_user,  -- ops (n8n) or ops_dashboard (a person)
    backfilled  boolean     NOT NULL DEFAULT false           -- reconstructed by this migration
);
CREATE INDEX IF NOT EXISTS incident_status_log_incident_idx
    ON incident_status_log (incident_id, changed_at, id);
CREATE INDEX IF NOT EXISTS incident_status_log_changed_idx
    ON incident_status_log (to_status, changed_at);

-- SECURITY DEFINER: the dashboard role can change a status but has no INSERT on the log,
-- and shouldn't. session_user still names who made the change.
CREATE OR REPLACE FUNCTION log_incident_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO incident_status_log (incident_id, from_status, to_status, changed_at, changed_by)
        VALUES (NEW.id, NULL, NEW.status, NEW.first_seen_at, session_user);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO incident_status_log (incident_id, from_status, to_status, changed_by)
        VALUES (NEW.id, OLD.status, NEW.status, session_user);
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS incidents_status_log ON incidents;
CREATE TRIGGER incidents_status_log
    AFTER INSERT OR UPDATE OF status ON incidents
    FOR EACH ROW EXECUTE FUNCTION log_incident_status();

-- Backfill what can still be known: when each incident opened, and its current status.
-- Earlier reopen cycles are lost; only the latest resolution survives in incidents.
INSERT INTO incident_status_log (incident_id, from_status, to_status, changed_at, changed_by, backfilled)
SELECT i.id, NULL, 'open', i.first_seen_at, 'migration', true
  FROM incidents i
 WHERE NOT EXISTS (SELECT FROM incident_status_log l WHERE l.incident_id = i.id);

INSERT INTO incident_status_log (incident_id, from_status, to_status, changed_at, changed_by, backfilled)
SELECT i.id, 'open', i.status,
       -- a reopened incident's latest open period started at the reopening failure, unknown
       -- here; resolved_at is the best we have, and never earlier than the first failure
       greatest(coalesce(CASE WHEN i.status = 'resolved' THEN i.resolved_at END, i.updated_at), i.first_seen_at),
       'migration', true
  FROM incidents i
 WHERE i.status <> 'open'
   AND NOT EXISTS (SELECT FROM incident_status_log l WHERE l.incident_id = i.id AND l.to_status <> 'open');

-- One row per resolution: how long the incident had been open when it was resolved.
-- A reopened incident yields one row per cycle.
CREATE OR REPLACE VIEW incident_resolutions AS
SELECT r.id            AS log_id,
       r.incident_id,
       i.workflow_id,
       i.workflow_name,
       i.error_class,
       o.changed_at    AS opened_at,
       r.changed_at    AS resolved_at,
       r.changed_at - o.changed_at AS time_to_resolve,
       r.changed_by,
       r.backfilled OR o.backfilled AS backfilled
  FROM incident_status_log r
  JOIN incidents i ON i.id = r.incident_id
  JOIN LATERAL (
        SELECT changed_at, backfilled
          FROM incident_status_log o
         WHERE o.incident_id = r.incident_id AND o.to_status = 'open'
           AND (o.changed_at, o.id) < (r.changed_at, r.id)
         ORDER BY o.changed_at DESC, o.id DESC
         LIMIT 1) o ON true
 WHERE r.to_status = 'resolved';

-- One row per failure the system healed by itself: from the failed run to the moment the
-- retry that succeeded finished (the retry call waits for the run, then marks the job).
CREATE OR REPLACE VIEW auto_recoveries AS
SELECT q.id            AS job_id,
       q.incident_id,
       e.workflow_id,
       e.workflow_name,
       e.node_name,
       e.error_class,
       e.execution_id,
       q.retry_execution_id,
       q.attempt,
       e.occurred_at   AS failed_at,
       q.updated_at    AS recovered_at,
       q.updated_at - e.occurred_at AS time_to_recover
  FROM retry_queue q
  JOIN error_events e ON e.id = q.error_event_id
 WHERE q.kind = 'auto' AND q.status = 'succeeded';

-- Metrics count failures by when they happened.
CREATE INDEX IF NOT EXISTS error_events_occurred_idx ON error_events (occurred_at);

GRANT SELECT ON incident_status_log, incident_resolutions, auto_recoveries TO ops_dashboard;

INSERT INTO schema_migrations (version) VALUES ('005_metrics')
ON CONFLICT (version) DO NOTHING;

COMMIT;
