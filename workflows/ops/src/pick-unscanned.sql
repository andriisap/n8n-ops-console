-- Postgres node "Pick unscanned" in ops-cost-collector.
-- $1 = {ids: [...]} finished execution ids from the listing.
-- Returns at most 25 that were never scanned, oldest first: each needs its full data
-- downloaded, so a backlog is worked off over several runs instead of in one huge run.
SELECT t.id
FROM jsonb_array_elements_text(coalesce($1::jsonb->'ids', '[]'::jsonb)) AS t(id)
WHERE t.id ~ '^[0-9]+$'
  AND NOT EXISTS (SELECT 1 FROM cost_scans s WHERE s.execution_id = t.id)
ORDER BY t.id::bigint
LIMIT 25;
