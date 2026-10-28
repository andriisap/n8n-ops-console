import { db } from './db';
import type { ErrorClass, IncidentFilter, Status } from './incident-filter';

export * from './incident-filter';

export type Incident = {
  id: number;
  workflow_id: string;
  workflow_name: string;
  node_name: string | null;
  error_class: ErrorClass;
  error_message: string;
  status: Status;
  occurrences: number;
  reopened_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
  last_alerted_at: Date | null;
};

export type RetryStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'dead';

export type ErrorEvent = {
  id: number;
  execution_id: string;
  execution_url: string | null;
  execution_mode: string | null;
  error_message: string;
  error_raw: Record<string, unknown> | null;
  occurred_at: Date;
  retry_of: string | null;              // set when this failure was itself a retry
  // latest retry job for this execution, if any
  retry_status: RetryStatus | null;
  retry_kind: 'auto' | 'manual' | null;
  retry_attempt: number | null;
  retry_max: number | null;
  retry_next_at: Date | null;
  retry_execution_id: string | null;
  retry_last_error: string | null;
  recovered: boolean;                   // some retry of this execution succeeded
};

const INCIDENT_COLUMNS = `
  id::int, workflow_id, workflow_name, node_name, error_class, error_message, status,
  occurrences, reopened_count, first_seen_at, last_seen_at, resolved_at, last_alerted_at`;

// Everything but the status: the tabs count within the rest of the filter.
// $1 workflow, $2 class, $3 days, $4 text (ILIKE, wildcards escaped).
const SCOPE = `
  ($1::text IS NULL OR workflow_id = $1)
  AND ($2::text IS NULL OR error_class = $2)
  AND ($3::int IS NULL OR last_seen_at >= now() - make_interval(days => $3::int))
  AND ($4::text IS NULL OR workflow_name ILIKE $4 OR node_name ILIKE $4 OR error_message ILIKE $4)`;

const like = (q: string | null) => (q ? `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%` : null);
const scopeParams = (f: IncidentFilter) => [f.workflow, f.errorClass, f.days, like(f.q)];

export async function listIncidents(f: IncidentFilter): Promise<Incident[]> {
  const { rows } = await db().query<Incident>(
    `SELECT ${INCIDENT_COLUMNS}
       FROM incidents
      WHERE ($5 = 'all' OR status = $5) AND ${SCOPE}
      ORDER BY (status = 'open') DESC, last_seen_at DESC
      LIMIT 200`,
    [...scopeParams(f), f.status],
  );
  return rows;
}

export async function countByStatus(f: IncidentFilter): Promise<Record<Status, number>> {
  const { rows } = await db().query<{ status: Status; n: number }>(
    `SELECT status, count(*)::int AS n FROM incidents WHERE ${SCOPE} GROUP BY status`,
    scopeParams(f),
  );
  const counts: Record<Status, number> = { open: 0, resolved: 0, ignored: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

export type WorkflowChoice = { workflow_id: string; workflow_name: string };

export async function workflowChoices(): Promise<WorkflowChoice[]> {
  const { rows } = await db().query<WorkflowChoice>(
    `SELECT workflow_id, max(workflow_name) AS workflow_name FROM incidents GROUP BY workflow_id ORDER BY 2`,
  );
  return rows;
}

export async function getIncident(id: number): Promise<Incident | null> {
  const { rows } = await db().query<Incident>(
    `SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listEvents(incidentId: number, limit = 50): Promise<ErrorEvent[]> {
  const { rows } = await db().query<ErrorEvent>(
    `SELECT e.id::int, e.execution_id, e.execution_url, e.execution_mode, e.error_message,
            e.error_raw, e.occurred_at, e.retry_of,
            rq.status AS retry_status, rq.kind AS retry_kind, rq.attempt AS retry_attempt,
            rq.max_attempts AS retry_max, rq.next_attempt_at AS retry_next_at,
            rq.retry_execution_id, rq.last_error AS retry_last_error,
            EXISTS (SELECT 1 FROM retry_queue s
                     WHERE s.execution_id = e.execution_id AND s.status = 'succeeded') AS recovered
       FROM error_events e
       LEFT JOIN LATERAL (
            SELECT status, kind, attempt, max_attempts, next_attempt_at, retry_execution_id, last_error
              FROM retry_queue r
             WHERE r.execution_id = e.execution_id
             ORDER BY r.id DESC
             LIMIT 1) rq ON true
      WHERE e.incident_id = $1
      ORDER BY e.occurred_at DESC
      LIMIT $2`,
    [incidentId, limit],
  );
  return rows;
}

export type ReplayResult = 'queued' | 'already_queued_or_not_replayable';

// Asks the retry scheduler to run this execution again. The dashboard never calls n8n itself:
// it holds no n8n API key, and every retry goes through one executor with one audit trail.
// The database pins dashboard-made jobs to one manual attempt with the latest saved workflow.
export async function requestReplay(eventId: number): Promise<ReplayResult> {
  const { rowCount } = await db().query(
    `INSERT INTO retry_queue (error_event_id, incident_id, execution_id, workflow_id, idempotency_key)
     SELECT e.id, e.incident_id, e.execution_id, e.workflow_id,
            'manual:' || e.execution_id || ':' || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
       FROM error_events e
      WHERE e.id = $1
        AND e.retry_of IS NULL
        AND e.execution_id NOT LIKE 'trigger:%'
        AND NOT EXISTS (SELECT 1 FROM retry_queue s
                         WHERE s.execution_id = e.execution_id AND s.status = 'succeeded')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [eventId],
  );
  return rowCount === 1 ? 'queued' : 'already_queued_or_not_replayable';
}

// The only write the dashboard can make; the database role allows nothing else.
export async function setIncidentStatus(id: number, status: Status): Promise<boolean> {
  const { rowCount } = await db().query(
    `UPDATE incidents
        SET status = $2,
            resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END
      WHERE id = $1`,
    [id, status],
  );
  return rowCount === 1;
}
