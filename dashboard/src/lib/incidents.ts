import { db } from './db';

export const STATUSES = ['open', 'resolved', 'ignored'] as const;
export type Status = (typeof STATUSES)[number];

export const ERROR_CLASSES = ['rate_limit', 'transient', 'auth', 'validation', 'unknown'] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

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

export type ErrorEvent = {
  id: number;
  execution_id: string;
  execution_url: string | null;
  execution_mode: string | null;
  error_message: string;
  error_raw: Record<string, unknown> | null;
  occurred_at: Date;
};

export function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

const INCIDENT_COLUMNS = `
  id::int, workflow_id, workflow_name, node_name, error_class, error_message, status,
  occurrences, reopened_count, first_seen_at, last_seen_at, resolved_at, last_alerted_at`;

export async function listIncidents(status: Status | 'all'): Promise<Incident[]> {
  const { rows } = await db().query<Incident>(
    `SELECT ${INCIDENT_COLUMNS}
       FROM incidents
      WHERE $1 = 'all' OR status = $1
      ORDER BY (status = 'open') DESC, last_seen_at DESC
      LIMIT 200`,
    [status],
  );
  return rows;
}

export async function countByStatus(): Promise<Record<Status, number>> {
  const { rows } = await db().query<{ status: Status; n: number }>(
    `SELECT status, count(*)::int AS n FROM incidents GROUP BY status`,
  );
  const counts: Record<Status, number> = { open: 0, resolved: 0, ignored: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
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
    `SELECT id::int, execution_id, execution_url, execution_mode, error_message, error_raw, occurred_at
       FROM error_events
      WHERE incident_id = $1
      ORDER BY occurred_at DESC
      LIMIT $2`,
    [incidentId, limit],
  );
  return rows;
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
