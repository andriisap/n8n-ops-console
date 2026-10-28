// Metrics for /metrics (stage 7, decision 037). Every function takes the database as its
// first argument, so the tests run the same SQL against a scratch Postgres without Next.
//
// What counts as a failure here: an original failed run (error_events.retry_of IS NULL).
// Failed retries are history of the same failure, not new ones, as everywhere else.
// Ignored incidents are left out: the hourly canary is one, on purpose.

import type { QueryResultRow } from 'pg';

export type Db = { query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: R[] }> };

export const PERIODS = [7, 30] as const;
export type Period = (typeof PERIODS)[number];

export type MetricsFilter = {
  days: Period;
  workflow: string | null; // workflow_id
  hideTest: boolean; // leave out chaos-* workflows
};

export const TEST_WORKFLOW_PATTERN = 'chaos-%';

// $1 days, $2 workflow_id or null, $3 hide test workflows. Every query below takes these three.
const params = (f: MetricsFilter) => [f.days, f.workflow, f.hideTest];

// Filter on any row with workflow_id and workflow_name columns, under alias `a`.
const scope = (a: string) => `
  ($2::text IS NULL OR ${a}.workflow_id = $2)
  AND (NOT $3::boolean OR ${a}.workflow_name NOT LIKE '${TEST_WORKFLOW_PATTERN}')`;

// Failures in a window that ends `ago` periods back: 0 = this period, 1 = the one before.
const failuresIn = (ago: 0 | 1) => `
  SELECT e.* FROM error_events e JOIN incidents i ON i.id = e.incident_id
   WHERE e.retry_of IS NULL AND i.status <> 'ignored' AND ${scope('e')}
     AND e.occurred_at >= now() - make_interval(days => $1::int * ${ago + 1})
     AND e.occurred_at <  now() - make_interval(days => $1::int * ${ago})`;

export type Duration = { n: number; median_s: number | null; p90_s: number | null };

export type MetricsSummary = {
  failures: number;
  failures_before: number; // the period before, for the trend
  incidents_hit: number; // distinct incidents with a failure in the period
  incidents_new: number; // first seen in the period
  recover: Duration; // automatic retry that succeeded
  retried: number; // automatic retry jobs that finished in the period
  resolve: Duration & { backfilled: number };
};

const DURATION = (col: string) => `
  count(*)::int AS n,
  (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ${col})))::float8 AS median_s,
  (percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM ${col})))::float8 AS p90_s`;

export async function summary(db: Db, f: MetricsFilter): Promise<MetricsSummary> {
  const { rows } = await db.query<{
    failures: number;
    failures_before: number;
    incidents_hit: number;
    incidents_new: number;
    rec: Duration;
    retried: number;
    res: Duration & { backfilled: number };
  }>(
    `WITH cur AS (${failuresIn(0)}),
          rec AS (
            SELECT ${DURATION('time_to_recover')} FROM auto_recoveries a
             WHERE a.recovered_at >= now() - make_interval(days => $1::int) AND ${scope('a')}),
          res AS (
            SELECT ${DURATION('time_to_resolve')}, (count(*) FILTER (WHERE backfilled))::int AS backfilled
              FROM incident_resolutions r JOIN incidents i ON i.id = r.incident_id
             WHERE r.resolved_at >= now() - make_interval(days => $1::int)
               AND i.status <> 'ignored' AND ${scope('r')})
     SELECT (SELECT count(*) FROM cur)::int                                AS failures,
            (SELECT count(*) FROM (${failuresIn(1)}) b)::int               AS failures_before,
            (SELECT count(DISTINCT incident_id) FROM cur)::int             AS incidents_hit,
            (SELECT count(*) FROM incidents i
              WHERE i.first_seen_at >= now() - make_interval(days => $1::int)
                AND i.status <> 'ignored' AND ${scope('i')})::int          AS incidents_new,
            (SELECT row_to_json(rec) FROM rec)                             AS rec,
            (SELECT count(*) FROM retry_queue q JOIN error_events e ON e.id = q.error_event_id
              WHERE q.kind = 'auto' AND q.status IN ('succeeded', 'dead')
                AND q.updated_at >= now() - make_interval(days => $1::int) AND ${scope('e')})::int AS retried,
            (SELECT row_to_json(res) FROM res)                             AS res`,
    params(f),
  );
  const r = rows[0];
  return {
    failures: r.failures,
    failures_before: r.failures_before,
    incidents_hit: r.incidents_hit,
    incidents_new: r.incidents_new,
    recover: r.rec,
    retried: r.retried,
    resolve: r.res,
  };
}

export type NodeFailures = {
  workflow_id: string;
  workflow_name: string;
  node_name: string | null;
  failures: number;
  incidents: number;
  top_class: string; // the most frequent class for this node
  last_at: Date;
};

export async function topNodes(db: Db, f: MetricsFilter, limit = 10): Promise<NodeFailures[]> {
  const { rows } = await db.query<NodeFailures>(
    `SELECT workflow_id, max(workflow_name) AS workflow_name, node_name,
            count(*)::int AS failures, count(DISTINCT incident_id)::int AS incidents,
            mode() WITHIN GROUP (ORDER BY error_class) AS top_class,
            max(occurred_at) AS last_at
       FROM (${failuresIn(0)}) e
      GROUP BY workflow_id, node_name
      ORDER BY count(*) DESC, max(occurred_at) DESC
      LIMIT $4`,
    [...params(f), limit],
  );
  return rows;
}

export type ClassShare = { error_class: string; failures: number; share: number };

export async function byClass(db: Db, f: MetricsFilter): Promise<ClassShare[]> {
  const { rows } = await db.query<ClassShare>(
    `SELECT error_class, count(*)::int AS failures,
            (count(*)::float8 / sum(count(*)) OVER ()) AS share
       FROM (${failuresIn(0)}) e
      GROUP BY error_class
      ORDER BY count(*) DESC, error_class`,
    params(f),
  );
  return rows;
}

// One row per UTC day of the period, every day present, failures split by class.
export type DayFailures = { day: string; total: number; by_class: Record<string, number> };

export async function daily(db: Db, f: MetricsFilter): Promise<DayFailures[]> {
  const { rows } = await db.query<DayFailures>(
    `WITH d AS (
       SELECT generate_series((now() AT TIME ZONE 'UTC')::date - ($1::int - 1),
                              (now() AT TIME ZONE 'UTC')::date, interval '1 day')::date AS day),
     c AS (
       SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day, error_class, count(*)::int AS n
         FROM (${failuresIn(0)}) e GROUP BY 1, 2)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            coalesce(sum(c.n), 0)::int AS total,
            coalesce(jsonb_object_agg(c.error_class, c.n) FILTER (WHERE c.error_class IS NOT NULL), '{}') AS by_class
       FROM d LEFT JOIN c ON c.day = d.day
      GROUP BY d.day ORDER BY d.day`,
    params(f),
  );
  return rows;
}

export type WorkflowOption = { workflow_id: string; workflow_name: string; test: boolean };

// For the filter: every workflow that has had an incident that isn't ignored.
export async function workflowOptions(db: Db): Promise<WorkflowOption[]> {
  const { rows } = await db.query<WorkflowOption>(
    `SELECT workflow_id, max(workflow_name) AS workflow_name,
            bool_or(workflow_name LIKE '${TEST_WORKFLOW_PATTERN}') AS test
       FROM incidents WHERE status <> 'ignored' GROUP BY workflow_id ORDER BY 2`,
  );
  return rows;
}

// URL search params -> a filter. Unknown values fall back to defaults, never throw.
export function parseFilter(sp: { days?: string; wf?: string; test?: string }): MetricsFilter {
  const days = Number(sp.days);
  return {
    days: (PERIODS as readonly number[]).includes(days) ? (days as Period) : 7,
    workflow: sp.wf && sp.wf.length <= 64 ? sp.wf : null,
    hideTest: sp.test === 'hide',
  };
}

// Filter -> query string, defaults left out so links stay short.
export function filterQuery(f: MetricsFilter, patch: Partial<MetricsFilter> = {}): string {
  const g = { ...f, ...patch };
  const q = new URLSearchParams();
  if (g.days !== 7) q.set('days', String(g.days));
  if (g.workflow) q.set('wf', g.workflow);
  if (g.hideTest) q.set('test', 'hide');
  const s = q.toString();
  return s ? `?${s}` : '';
}
