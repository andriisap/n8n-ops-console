import { db } from './db';

// Every cost comes from the llm_usage_costed view: tokens x the price valid on the run's
// day (decision 029). cost is null when no price is known, and stays null here, so the
// page can say "no price" instead of showing $0. Days are UTC days, like the budget alert.

export type Totals = {
  cost: number;          // sum of priced calls
  calls: number;
  runs: number;
  unpriced: number;      // calls without a price: real spend is higher than cost
  estimated: number;     // calls with tokenUsageEstimate instead of provider numbers
  tokens_in: number;
  tokens_out: number;
};

export type Summary = { today: Totals; last7: Totals; last30: Totals };

export type Day = { day: string; cost: number; calls: number; runs: number; unpriced: number };

export type WorkflowCost = Totals & { workflow_id: string; workflow_name: string; per_run: number | null };

export type ModelCost = {
  provider: string;
  model: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  cost: number | null;   // null: no price for any of its calls
  unpriced: number;
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  price_tiers: number;
  valid_from: string | null;
  source_url: string | null;
};

export type RunCost = {
  execution_id: string;
  workflow_id: string;
  workflow_name: string;
  started_at: Date;
  status: string | null;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  cost: number | null;
  unpriced: number;
  models: string;
};

const TOTALS = `
  coalesce(sum(cost_usd), 0)::float8                    AS cost,
  count(*)::int                                         AS calls,
  count(DISTINCT execution_id)::int                     AS runs,
  (count(*) FILTER (WHERE cost_usd IS NULL))::int       AS unpriced,
  (count(*) FILTER (WHERE estimated))::int              AS estimated,
  coalesce(sum(input_tokens), 0)::float8                AS tokens_in,
  coalesce(sum(output_tokens), 0)::float8               AS tokens_out`;

// Start of the UTC day `days - 1` days ago: days = 1 is "today".
const SINCE = `(date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => $1::int - 1)) AT TIME ZONE 'UTC'`;

async function totals(days: number): Promise<Totals> {
  const { rows } = await db().query<Totals>(
    `SELECT ${TOTALS} FROM llm_usage_costed WHERE started_at >= ${SINCE}`,
    [days],
  );
  return rows[0];
}

export async function summary(): Promise<Summary> {
  const [today, last7, last30] = await Promise.all([totals(1), totals(7), totals(30)]);
  return { today, last7, last30 };
}

export async function daily(days = 14): Promise<Day[]> {
  const { rows } = await db().query<Day>(
    `WITH d AS (
       SELECT generate_series(
                (now() AT TIME ZONE 'UTC')::date - ($1::int - 1),
                (now() AT TIME ZONE 'UTC')::date,
                interval '1 day')::date AS day
     )
     SELECT to_char(d.day, 'YYYY-MM-DD')                               AS day,
            coalesce(sum(u.cost_usd), 0)::float8                       AS cost,
            count(u.id)::int                                           AS calls,
            count(DISTINCT u.execution_id)::int                        AS runs,
            (count(u.id) FILTER (WHERE u.id IS NOT NULL AND u.cost_usd IS NULL))::int AS unpriced
       FROM d
       LEFT JOIN llm_usage_costed u ON (u.started_at AT TIME ZONE 'UTC')::date = d.day
      GROUP BY d.day
      ORDER BY d.day`,
    [days],
  );
  return rows;
}

export async function byWorkflow(days = 7): Promise<WorkflowCost[]> {
  const { rows } = await db().query<WorkflowCost>(
    `SELECT workflow_id, max(workflow_name) AS workflow_name, ${TOTALS},
            (coalesce(sum(cost_usd), 0) / nullif(count(DISTINCT execution_id), 0))::float8 AS per_run
       FROM llm_usage_costed
      WHERE started_at >= ${SINCE}
      GROUP BY workflow_id
      ORDER BY sum(cost_usd) DESC NULLS LAST, count(*) DESC`,
    [days],
  );
  return rows;
}

// Usage per model, next to the price that applies today (base tier) and its source.
export async function byModel(days = 7): Promise<ModelCost[]> {
  const { rows } = await db().query<ModelCost>(
    `WITH usage AS (
       SELECT provider, model,
              count(*)::int                                   AS calls,
              sum(input_tokens)::float8                       AS tokens_in,
              sum(output_tokens)::float8                      AS tokens_out,
              CASE WHEN count(cost_usd) = 0 THEN NULL ELSE sum(cost_usd)::float8 END AS cost,
              (count(*) FILTER (WHERE cost_usd IS NULL))::int AS unpriced
         FROM llm_usage_costed
        WHERE started_at >= ${SINCE}
        GROUP BY provider, model
     )
     SELECT u.*,
            p.input_per_mtok::float8                         AS input_per_mtok,
            p.output_per_mtok::float8                        AS output_per_mtok,
            to_char(p.valid_from, 'YYYY-MM-DD')              AS valid_from,
            p.source_url,
            (SELECT count(*)::int FROM model_prices t
              WHERE t.provider = u.provider AND t.model = u.model
                AND t.valid_from = p.valid_from)              AS price_tiers
       FROM usage u
       LEFT JOIN LATERAL llm_price_for(u.provider, u.model, now(), 0) p ON true
      ORDER BY u.cost DESC NULLS LAST, u.calls DESC`,
    [days],
  );
  return rows;
}

export async function topRuns(days = 7, limit = 10): Promise<RunCost[]> {
  const { rows } = await db().query<RunCost>(
    `SELECT execution_id, max(workflow_id) AS workflow_id, max(workflow_name) AS workflow_name,
            min(started_at) AS started_at, max(execution_status) AS status,
            count(*)::int AS calls,
            sum(input_tokens)::float8 AS tokens_in, sum(output_tokens)::float8 AS tokens_out,
            CASE WHEN count(cost_usd) = 0 THEN NULL ELSE sum(cost_usd)::float8 END AS cost,
            (count(*) FILTER (WHERE cost_usd IS NULL))::int AS unpriced,
            string_agg(DISTINCT model, ', ' ORDER BY model) AS models
       FROM llm_usage_costed
      WHERE started_at >= ${SINCE}
      GROUP BY execution_id
      ORDER BY sum(cost_usd) DESC NULLS LAST, min(started_at) DESC
      LIMIT $2`,
    [days, limit],
  );
  return rows;
}

// Collector health: when it last RAN (heartbeat written at the start of every run), not
// when it last recorded something: quiet hours record nothing and are fine. Falls back to
// the newest scan for a collector older than the heartbeat.
export async function lastCollectorRun(): Promise<Date | null> {
  const { rows } = await db().query<{ at: Date | null }>(
    `SELECT coalesce(
       (SELECT last_beat_at FROM heartbeats WHERE source = 'ops-cost-collector'),
       (SELECT max(scanned_at) FROM cost_scans)) AS at`,
  );
  return rows[0]?.at ?? null;
}

export function executionUrl(workflowId: string, executionId: string): string | null {
  const base = process.env.N8N_PUBLIC_URL?.replace(/\/+$/, '');
  return base ? `${base}/workflow/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}` : null;
}
