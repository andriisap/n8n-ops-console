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
| n8n itself is down | The watchdog on Cloudflare: 🚨 "n8n web" after 3 failed probes, 🚨 "n8n schedules" after 15 min without a heartbeat, ✅ for each when back | Live 2026-10-26, see stage 6 runs |
| n8n up but its schedules stopped | `ops-heartbeat` stops pinging: 🚨 "n8n schedules" after 15 min | Unit: watchdog tests; the same path as the live stop |
| ops-error-handler itself broken | Its own failures never reach an error workflow; the hourly `chaos-canary` stops pinging, 🚨 "Alert pipeline" after 70 min | Live 2026-10-27: 🚨 at exactly 70 min, ✅ a minute after the fix |
| Same execution read twice by the cost collector | No-op: unique per (execution, node, run) | Unit: `test_llm_usage.py` |
| Model without a known price | Cost NULL ("no price"), never $0; a price added later applies to past runs; budget alert names the unpriced calls | Unit: `test_llm_usage.py`, `test_budget.py` |
| Cost collector down | `/costs` turns amber after 5 min (heartbeat); on return it picks up from the newest downloaded execution minus 2 h, oldest first, capped at 1 day back | Unit: `test_cost_collector.py`; live 2026-10-26: 7-minute outage, amber at 6 min, 3 missed runs recorded within a minute of return |
| API key lacks a scope the collector needs | Run fails with 403, ops-error-handler alerts | Live 2026-10-26: `workflow:list` missing → incident #69 |
| LLM request over the provider's limit (Groq free tier: 8,000 tokens/minute) | Classified `validation`, not retried automatically; nothing billed, no cost recorded | Live 2026-10-26: incident #76 |
| Daily budget exceeded | One 💸 message a day; retried until Telegram confirms | Unit: `test_budget.py`; live 2026-10-26: one message at $0.00113 of $0.0005, none on the next runs |
| Dashboard can't reach the database | Page stays up and says so; cause in `docker logs`; `/api/ready` returns 503 with the Postgres error code | Local, 2026-10-13: wrong password → "database unreachable" page, log `28P01 password authentication failed` |

## Live runs of stage 6 (2026-10-26)

| Run | What happened |
| --- | --- |
| `docker stop n8n-bet6-n8n-1` at 21:35:20 UTC | 21:38 🚨 n8n web down (HTTP 404: traefik with no container behind it), the dashboard strip showed ▲ n8n web down. 21:46 🚨 n8n schedules down (last heartbeat ~21:31 + 15 min). Nothing else sent |
| `docker start` at ~21:48 | 21:49 ✅ n8n web back (down for 11 min, counted from the alert), 21:51 ✅ n8n schedules back with the first `ops-heartbeat`. One message per change, none repeated |
| `chaos-canary` through MCP | Handler recorded it quietly (incident 77 ignored), pinged `error-handler`; no Telegram. chaos-429 still took the normal path |
| Canary ping broken on purpose (wrong `watchdog_url`) at 12:14 UTC, 27 Oct | From 13:00 UTC every canary run failed the handler itself (404 at the ping), silently: n8n reports nobody's error-workflow failures. 13:11 UTC 🚨 "Alert pipeline … no signal for over 70 min (last at 12:00 UTC)". Real failures of other workflows kept alerting the whole time |
| Restored 08:45 UTC, 28 Oct | Canary run → handler 43849 succeeded and pinged; 08:46 ✅ "Alert pipeline is back (down for 19 h 35 min)". The fix came late: the check-in that was to restore it waited for an approval in the chat overnight (decision 036) |

## Live runs of stage 5 (2026-10-26)

| Run | What happened |
| --- | --- |
| demo-ticket-triage, 14 runs | Every call recorded with real `tokenUsage`, none estimated; costs checked by hand against the price rows (e.g. 36038 Groq: 147 × $0.075 + 116 × $0.30 per million = $0.0000458). `/costs` Today = the same query in psql: 11 runs, 22 calls, $0.001370 |
| Budget alert, budget set to $0.0005 | One 💸 at $0.00113 (execution 36725), `sent_at` set after Telegram confirmed; the next run with new usage (36736) sent nothing |
| Ticket of 8,694 tokens (`--too-long`) | Groq refused it: over the free tier's 8,000 tokens a minute. Incident #76 as `validation`, no automatic retry (a request that size never fits), nothing billed, recorded with 0 calls |
| Ticket of ~7,400 tokens (`--long`), execution 36842 | Recorded at $0.00138: 12.8K tokens in, 507 out, about 10× an ordinary run, top of "Most expensive runs". Claude's reply stopped at the workflow's `maxTokensToSample: 400` |
| Collector unpublished for 7 minutes | After 5 minutes `/costs` turned amber ("Collector last ran 6 min. ago"); 3 runs in that gap were missing. Republished: within a minute all 3 were recorded, 14 runs and 28 calls, no duplicates |

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
| 2026-10-26 | Collector a day behind on its first run: ~3,000 saved executions a day, none with LLM calls | Executions of workflows without a model node are marked from the listing (decision 032) |
| 2026-10-26 | ops-retry-scheduler and ops-cost-collector saved every successful run, though their JSON says not to: the setting didn't survive Import from file | Set `saveDataSuccessExecution: none` on the live workflows through the n8n MCP connector; checked after each import from now on |
| 2026-10-26 | `/costs` said "check ops-cost-collector" while it ran fine: staleness was read from the newest scan, and quiet periods scan nothing | Heartbeat written at the start of every run; the page reads that (decision 034) |
