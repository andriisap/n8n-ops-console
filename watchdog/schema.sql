-- D1 schema for the watchdog. One row per check.
--   npm run db:init   (wrangler d1 execute ops-watchdog --remote --file=schema.sql)
CREATE TABLE IF NOT EXISTS checks (
    name          TEXT PRIMARY KEY,
    state         TEXT NOT NULL DEFAULT 'unknown',  -- unknown | up | down
    notified      TEXT NOT NULL DEFAULT 'unknown',  -- the state Telegram last confirmed hearing about
    since         INTEGER,                          -- ms: when the current state began
    last_ping_at  INTEGER,                          -- ms: last signal (ping checks)
    failures      INTEGER NOT NULL DEFAULT 0,       -- consecutive failed probes (probe checks)
    detail        TEXT,                             -- last probe result or why it is down
    updated_at    INTEGER
);
