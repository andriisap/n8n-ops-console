-- Postgres node "Keep canary quiet" in ops-error-handler, on the chaos-canary branch.
-- $1 = incident id from "Upsert incident" ('' when the event was a duplicate).
-- The canary's incident is ignored on purpose: it counts every run, never alerts and never
-- shows as open. Returns no rows after the first time; the node always outputs so the
-- watchdog ping after it still runs.
UPDATE incidents SET status = 'ignored'
WHERE id = NULLIF($1, '')::bigint AND status <> 'ignored'
RETURNING id;
