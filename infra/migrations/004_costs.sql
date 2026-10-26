-- 004_costs.sql
-- LLM cost per run (stage 5).
--
-- Token counts are copied from n8n's own execution data by ops-cost-collector.
-- Cost is never stored: llm_usage_costed prices every row with the price that was
-- valid on the day of the run, so a price added or corrected later applies to the
-- past correctly, and there is only one place where cost is computed.

BEGIN;

-- Tiered prices. Claude Haiku 5.5 charges a higher rate for the whole request once the
-- prompt is over 100,000 tokens: that is a second row with min_prompt_tokens = 100001.
ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS min_prompt_tokens integer NOT NULL DEFAULT 0;
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'model_prices_min_prompt_tokens_check') THEN
        ALTER TABLE model_prices ADD CONSTRAINT model_prices_min_prompt_tokens_check
            CHECK (min_prompt_tokens >= 0);
    END IF;
    IF NOT EXISTS (
        SELECT FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'model_prices_pkey' AND i.indnatts = 4
    ) THEN
        ALTER TABLE model_prices DROP CONSTRAINT model_prices_pkey;
        ALTER TABLE model_prices ADD PRIMARY KEY (provider, model, valid_from, min_prompt_tokens);
    END IF;
END
$$;

-- One row per LLM call = one run of a model sub-node. Re-reading the same execution
-- is a no-op thanks to the unique key, so the collector can overlap its windows freely.
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS run_index integer NOT NULL DEFAULT 0;
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS estimated boolean NOT NULL DEFAULT false;
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS execution_status text;
ALTER TABLE llm_usage DROP COLUMN IF EXISTS cost_usd;
UPDATE llm_usage SET started_at = created_at WHERE started_at IS NULL;
ALTER TABLE llm_usage ALTER COLUMN started_at SET NOT NULL;
ALTER TABLE llm_usage ALTER COLUMN node_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_one_row_per_call
    ON llm_usage (execution_id, node_name, run_index);
CREATE INDEX IF NOT EXISTS llm_usage_started_idx ON llm_usage (started_at DESC);

-- Every finished execution the collector has looked at, with or without LLM calls,
-- so it never downloads the same execution data twice.
CREATE TABLE IF NOT EXISTS cost_scans (
    execution_id     text        PRIMARY KEY,
    workflow_id      text        NOT NULL,
    workflow_name    text,
    execution_status text        NOT NULL,
    started_at       timestamptz NOT NULL,
    llm_calls        integer     NOT NULL DEFAULT 0,
    scanned_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cost_scans_scanned_idx ON cost_scans (scanned_at DESC);

-- One budget alert per day and kind, however many collector runs see the overspend.
CREATE TABLE IF NOT EXISTS cost_alerts (
    day        date          NOT NULL,
    kind       text          NOT NULL,
    threshold  numeric(12,6) NOT NULL,
    spent      numeric(12,6) NOT NULL,
    sent_at    timestamptz,
    created_at timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (day, kind)
);

-- The price row for one call: newest valid_from on or before the run's day (UTC),
-- then the highest tier the prompt reaches.
CREATE OR REPLACE FUNCTION llm_price_for(p_provider text, p_model text, p_at timestamptz, p_prompt_tokens integer)
RETURNS SETOF model_prices
LANGUAGE sql STABLE AS $$
    SELECT *
    FROM model_prices
    WHERE provider = p_provider
      AND model = p_model
      AND valid_from <= (p_at AT TIME ZONE 'UTC')::date
      AND min_prompt_tokens <= p_prompt_tokens
    ORDER BY valid_from DESC, min_prompt_tokens DESC
    LIMIT 1
$$;

-- cost_usd is NULL when no price is known for the model: shown as "no price", never as $0.
CREATE OR REPLACE VIEW llm_usage_costed AS
SELECT u.id, u.execution_id, u.workflow_id, u.workflow_name, u.node_name, u.run_index,
       u.provider, u.model, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens,
       u.estimated, u.execution_status, u.started_at, u.created_at,
       p.valid_from        AS price_valid_from,
       p.min_prompt_tokens AS price_tier,
       round((u.input_tokens       * p.input_per_mtok
            + u.output_tokens      * p.output_per_mtok
            + u.cache_read_tokens  * p.cache_read_per_mtok
            + u.cache_write_tokens * p.cache_write_per_mtok) / 1000000.0, 8) AS cost_usd
FROM llm_usage u
LEFT JOIN LATERAL llm_price_for(
    u.provider, u.model, u.started_at,
    u.input_tokens + u.cache_read_tokens + u.cache_write_tokens) p ON true;

GRANT SELECT ON llm_usage_costed, cost_scans, cost_alerts TO ops_dashboard;

INSERT INTO schema_migrations (version) VALUES ('004_costs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
