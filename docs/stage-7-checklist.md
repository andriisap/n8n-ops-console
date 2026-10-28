# Stage 7 checklist: metrics and UI polish

Plan: [decision 037](decisions.md). Each step is one pull request.

## 1. Database: status history and metric views (PR #16)

- [ ] `git pull` on the Mac
- [ ] `pbcopy < infra/migrations/005_metrics.sql` → `docker exec -it n8n-bet6-ops-db-1 psql -U ops -d ops` → paste → ends with `COMMIT`
- [ ] Check: `SELECT to_status, count(*) FROM incident_status_log GROUP BY 1;` → one `open` per incident, plus one row per resolved or ignored incident
- [ ] Check: `SELECT count(*), round(avg(extract(epoch FROM time_to_recover))) AS avg_s FROM auto_recoveries;` → the chaos-recover runs of stage 4 (~1 min each)

## 2–3. Metrics queries and the /metrics page (PR #17)

- [x] `dashboard/src/lib/metrics.ts`: summary, failing nodes, classes, failures per day, workflow list; 9 tests against a scratch Postgres (`npm test` in `dashboard/`)
- [x] Chart fills per class validated for both themes (decision 038)

## 4. Filters (PR #17)

- [x] Incidents: workflow, class, last seen (24 h / 7 / 30 days), text search; status tabs count within the filter; all in the URL
- [x] Links from /metrics (a class, a failing node) open the incident list with the same filter
- [x] Phone: incident rows fold class, count and last seen under the name, no sideways scroll

## Deploy 2–4

- [x] Merge PR #17 → new image tag in the Hostinger YAML → Deploy
- [x] /metrics live: 30 days shows the two chaos-recover recoveries of stage 4 (median 2 min), 2 of 5 retried recovered
## 5–6. States and theme (PR #18)

- [x] One empty state per page instead of a row of empty cards: /metrics ("look at 30 days", "clear filters"), /costs, incidents (says which filter is empty)
- [x] Loading skeleton while a page's queries run; error page for any page (database down) with the error id to find in `docker logs`; not-found with links to the three sections
- [x] Theme switch in the header: system → light → dark. Kept in a cookie and rendered by the server, so no flash on load; checked: a dark system with "light" chosen stays light
- [x] Text contrast checked for every text colour on every surface in both themes (WCAG 4.5:1): only `ignored` in light was short (4.2), darkened
- [x] Merge PR #18 → new image tag → Deploy; theme switch checked live in both themes

## 8. Live check against psql (PR #19)

- [x] chaos-recover through MCP with a 75 s outage: failed 09:36:22 UTC (44016), retry 1 failed (44020), retry 2 succeeded 09:37:30 (44024). `auto_recoveries` 68 s = tile "Time to recover 68 s", "1 of 2 retried recovered"
- [x] chaos-auth (43988): `auth`, no automatic retry, shows under failing nodes
- [x] Failures in 7 days: psql 12 = tile 12; incident #122 set to Ignore → 11, `unknown` gone from the chart and the shares
- [x] Results in [failure-modes.md](failure-modes.md#live-runs-of-stage-7-2026-10-28)

Closed 2026-10-28.

## Done when

`/metrics` shows recovery times, the failing nodes and the error classes for 7 or 30 days, every list can be filtered by link, and every page reads well empty, on a phone and in both themes.
