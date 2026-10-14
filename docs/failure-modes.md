# Failure modes

What happens when things break, and how each case was verified. "Live" means tested on the real n8n 2.42.5 instance; "unit" means an automated test in this repo.

| Failure | What the system does | Verified |
| --- | --- | --- |
| Same problem fails repeatedly | One incident, `occurrences` grows, one alert | Live, 2026-10-13: 10 runs × 4 workflows → 4 incidents with occurrences = 10, 4 messages |
| Same execution reported twice | Second report is a no-op (UNIQUE on execution_id) | Unit: `test_upsert_incident.py` |
| Resolved incident fails again | Reopens, `reopened_count + 1`, one 🟠 alert | Live, 2026-10-13: chaos-auth → "Reopened incident #3 (reopened 1×)" |
| Operator resolves in the dashboard, the problem comes back | Status written by the restricted role; next failure reopens it, alerts, and the dashboard shows it as open again within 10 s | Live, 2026-10-13: chaos-429 resolved twice from ops.srv1878746.hstgr.cloud → "reopened 1×" at 15:32, "reopened 2×" at 15:44 |
| Incident marked ignored | Keeps counting, never alerts | Unit: `test_upsert_incident.py` |
| Ops database down | 3 retries, then fallback ⚠️ alert without dedup, with the cause | Live, 2026-10-13: `docker stop` on ops-db → "DB error: getaddrinfo EAI_AGAIN ops-db" within ~10 s |
| Error message wording varies (ids, timestamps, durations) | Normalized before fingerprinting, stays one incident | Unit: `normalize-error.test.js` |
| Telegram API fails | 3 retries; `last_alerted_at` stays empty, so the miss is visible in the database | By design, not yet tested live |
| Trigger node fails (no execution id) | Synthetic id `trigger:<workflow>:<time>`, still recorded | Unit |
| Transient failure (rate limit, 5xx, timeout) | Queued automatically; retried 30 s after, then 30 s, 1, 2, 4 min apart (double for rate limits); ✅ on recovery, 💀 after 5 attempts, ~8 min in | Unit: `test_retry_queue.py` (backoff ranges, give-up, notify) |
| A retry fails too | Recorded as history; no new retry, no occurrence, no reopen, no alert (no loop) | Unit: `test_upsert_incident.py` |
| auth / validation failure | Never retried automatically; Replay button for after the fix | Unit: `test_upsert_incident.py`; browser test of Replay |
| Replay clicked twice | One active job per execution (partial unique index) | Unit + browser test |
| Dashboard tries to queue a forged execution | Trigger replaces it with the event's own execution; role can't set status, update or delete jobs | Unit: `test_retry_queue.py` |
| Two scheduler runs overlap | `SKIP LOCKED`: work is split, never duplicated | Unit: parallel claim, 5 + 5 of 10 |
| Scheduler dies mid-run | Leased jobs are picked up again after 10 min; the attempt still counts | Unit: stale lease reclaimed |
| n8n API key wrong or revoked | Jobs keep their attempts and wait; the run fails, so ops-error-handler alerts | Unit: `retry-scheduler.test.js` |
| Execution pruned before its retry | Job marked dead with the reason | Unit |
| Server says `Retry-After: 120` | Not honoured: the Error Trigger payload carries no response headers | Known limitation (decision 024) |
| n8n itself is down | Nothing inside n8n can notice | Not covered yet: external heartbeat in stage 6 |
| Dashboard can't reach the database | Page stays up and says so; cause in `docker logs`; `/api/ready` returns 503 with the Postgres error code | Local, 2026-10-13: wrong password → "database unreachable" page, log `28P01 password authentication failed` |

## Live runs of stage 4 (2026-10-14)

| Run | What happened |
| --- | --- |
| chaos-timeout, execution 789 | 5 retries (792, 795, 800, 807, 819), gaps growing as designed, job dead ~8 min in, one 💀 message. 5 retry failures recorded with `retry_of = 789`, still one job in the queue: no loop. Occurrences 11 for 16 events: retries don't inflate the count |
| chaos-flaky, execution 908 | Original and all 5 retries hit 503. Correct give-up, but bad luck for a demo (~3 % at 50/50, more when httpbin.org itself is overloaded). Led to chaos-recover, a deterministic outage, for demos |
| chaos-recover, executions 975 and 989 | Two runs of a 75 s outage. Each time: retry 1 failed with 29 s / 24 s of outage left (979, 993), retry 2 succeeded (983, 997), "succeeded on attempt 2/5", one ✅ message per run. One 🔴 alert for the incident (#64): the second run hit the still-open incident and stayed quiet. Occurrences 2 for 4 events: the failed retries are history, not new occurrences |
| chaos-auth, Replay on execution 775 | Clicked from the dashboard: `replay queued`, then within ~30 s retry 1007 failed (the key is wrong on purpose), cell shows `replay failed`, one 💀 "still fails after manual replay". The failed replay added no occurrence, did not re-alert the open incident and queued no automatic retry (auth is never retried on its own) |

## Bugs found by live tests

| Date | Bug | Fix |
| --- | --- | --- |
| 2026-10-13 | chaos-timeout classified `unknown`: n8n reports timeouts as "The connection was aborted, perhaps the server is offline" | Added the phrasing to the transient rules and the real message to the tests (decision 014) |
| 2026-10-13 | Fallback alert printed `DB error: [object Object]`: n8n's error output carries the error as an object | Read fields from the object instead of casting it to a string |
| 2026-10-13 | Dashboard deployed but answered `404 page not found`, no error in any log. Its healthcheck queried the database; the DB login failed, the container went unhealthy, and traefik drops unhealthy containers without logging at WARN | Healthcheck no longer depends on the database; DB status moved to `/api/ready`, which logs the cause (decision 020) |
| 2026-10-13 | After that fix the alert showed the SQL text: on a connection failure the Postgres node sets `message` to "Failed query: <whole query>" | Search the whole error for known causes (ENOTFOUND, ECONNREFUSED, auth failed…), skip the query dump; tests cover each shape |
