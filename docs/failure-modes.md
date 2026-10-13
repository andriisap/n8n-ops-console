# Failure modes

What happens when things break, and how each case was verified. "Live" means tested on the real n8n 2.42.5 instance; "unit" means an automated test in this repo.

| Failure | What the system does | Verified |
| --- | --- | --- |
| Same problem fails repeatedly | One incident, `occurrences` grows, one alert | Live, 2026-10-13: 10 runs × 4 workflows → 4 incidents with occurrences = 10, 4 messages |
| Same execution reported twice | Second report is a no-op (UNIQUE on execution_id) | Unit: `test_upsert_incident.py` |
| Resolved incident fails again | Reopens, `reopened_count + 1`, one 🟠 alert | Live, 2026-10-13: chaos-auth → "Reopened incident #3 (reopened 1×)" |
| Incident marked ignored | Keeps counting, never alerts | Unit: `test_upsert_incident.py` |
| Ops database down | 3 retries, then fallback ⚠️ alert without dedup, with the cause | Live, 2026-10-13: `docker stop` on ops-db → "DB error: getaddrinfo EAI_AGAIN ops-db" within ~10 s |
| Error message wording varies (ids, timestamps, durations) | Normalized before fingerprinting, stays one incident | Unit: `normalize-error.test.js` |
| Telegram API fails | 3 retries; `last_alerted_at` stays empty, so the miss is visible in the database | By design, not yet tested live |
| Trigger node fails (no execution id) | Synthetic id `trigger:<workflow>:<time>`, still recorded | Unit |
| n8n itself is down | Nothing inside n8n can notice | Not covered yet: external heartbeat in stage 6 |
| Dashboard can't reach the database | Page stays up and says so; cause in `docker logs`; `/api/ready` returns 503 with the Postgres error code | Local, 2026-10-13: wrong password → "database unreachable" page, log `28P01 password authentication failed` |

## Bugs found by live tests

| Date | Bug | Fix |
| --- | --- | --- |
| 2026-10-13 | chaos-timeout classified `unknown`: n8n reports timeouts as "The connection was aborted, perhaps the server is offline" | Added the phrasing to the transient rules and the real message to the tests (decision 014) |
| 2026-10-13 | Fallback alert printed `DB error: [object Object]`: n8n's error output carries the error as an object | Read fields from the object instead of casting it to a string |
| 2026-10-13 | Dashboard deployed but answered `404 page not found`, no error in any log. Its healthcheck queried the database; the DB login failed, the container went unhealthy, and traefik drops unhealthy containers without logging at WARN | Healthcheck no longer depends on the database; DB status moved to `/api/ready`, which logs the cause (decision 020) |
| 2026-10-13 | After that fix the alert showed the SQL text: on a connection failure the Postgres node sets `message` to "Failed query: <whole query>" | Search the whole error for known causes (ENOTFOUND, ECONNREFUSED, auth failed…), skip the query dump; tests cover each shape |
