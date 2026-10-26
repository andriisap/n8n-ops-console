-- Model prices, USD per million tokens, copied by hand from each provider's own pricing page.
-- Safe to run again: existing rows are updated in place.
--
-- A price change is a NEW row with a new valid_from, never an edit of an old one:
-- past runs keep the price they had (decision 008).
-- min_prompt_tokens > 0 = a tier that applies when the prompt is at least that long.
--
-- Load on the server:
--   docker exec -i n8n-bet6-ops-db-1 psql -U ops -d ops < infra/prices/model_prices.sql

BEGIN;

INSERT INTO model_prices
    (provider, model, valid_from, min_prompt_tokens,
     input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, source_url)
VALUES
    -- Claude Haiku 5.5, released 2026-10-07. Two tiers by prompt length.
    -- Cache write = the 5-minute rate ($0.20 / $1 for 1-hour writes; n8n doesn't report which).
    -- Checked 2026-10-26 on the pricing page.
    ('anthropic', 'claude-haiku-5-5', '2026-10-07', 0,
     0.10, 0.50, 0.125, 0.01, 'https://platform.claude.com/docs/en/about-claude/pricing'),
    ('anthropic', 'claude-haiku-5-5', '2026-10-07', 100001,
     0.50, 2.50, 0.625, 0.05, 'https://platform.claude.com/docs/en/about-claude/pricing'),

    -- Groq openai/gpt-oss-20b. Cached input $0.037; Groq has no cache-write charge.
    -- Checked 2026-10-26 on the model page in the Groq console. The date the price started
    -- isn't published: valid_from is set before the first demo run.
    ('groq', 'openai/gpt-oss-20b', '2026-10-01', 0,
     0.075, 0.30, 0, 0.037, 'https://console.groq.com/docs/model/openai/gpt-oss-20b')
ON CONFLICT (provider, model, valid_from, min_prompt_tokens) DO UPDATE SET
    input_per_mtok       = EXCLUDED.input_per_mtok,
    output_per_mtok      = EXCLUDED.output_per_mtok,
    cache_write_per_mtok = EXCLUDED.cache_write_per_mtok,
    cache_read_per_mtok  = EXCLUDED.cache_read_per_mtok,
    source_url           = EXCLUDED.source_url;

COMMIT;
