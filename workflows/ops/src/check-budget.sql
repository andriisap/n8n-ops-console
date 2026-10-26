-- Postgres node "Check budget" in ops-cost-collector, after new usage is recorded.
-- $1 = {daily_budget_usd} from Config.
--
-- Today = the current UTC day. Returns one row only when today's spend is over budget AND
-- no alert for today has been delivered yet; otherwise no rows, and the run ends.
-- The alert row is claimed here and marked sent only after Telegram confirms
-- (mark-budget-alert.sql), so a failed send is retried by the next run, and a sent one is
-- never repeated: one message per day.
WITH input AS (
    SELECT ($1::jsonb->>'daily_budget_usd')::numeric AS budget
),
bounds AS (
    SELECT (now() AT TIME ZONE 'UTC')::date AS day,
           date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS since
),
today AS (
    SELECT coalesce(sum(u.cost_usd), 0)               AS spent,
           count(*)                                   AS calls,
           count(*) FILTER (WHERE u.cost_usd IS NULL) AS unpriced,
           count(DISTINCT u.execution_id)             AS runs
    FROM llm_usage_costed u, bounds b
    WHERE u.started_at >= b.since
),
top AS (
    SELECT coalesce(jsonb_agg(t ORDER BY t.cost DESC), '[]'::jsonb) AS workflows
    FROM (
        SELECT u.workflow_name, sum(u.cost_usd) AS cost, count(DISTINCT u.execution_id) AS runs
        FROM llm_usage_costed u, bounds b
        WHERE u.started_at >= b.since
        GROUP BY u.workflow_name
        ORDER BY sum(u.cost_usd) DESC NULLS LAST
        LIMIT 3
    ) t
),
claim AS (
    INSERT INTO cost_alerts (day, kind, threshold, spent)
    SELECT b.day, 'daily_budget', i.budget, t.spent
    FROM bounds b, input i, today t
    WHERE i.budget IS NOT NULL AND t.spent > i.budget
    ON CONFLICT (day, kind) DO UPDATE
        SET spent = EXCLUDED.spent, threshold = EXCLUDED.threshold
        WHERE cost_alerts.sent_at IS NULL
    RETURNING day, kind, threshold, spent
)
SELECT c.day::text AS day, c.kind, c.threshold, c.spent, t.calls, t.runs, t.unpriced, top.workflows
FROM claim c, today t, top;
