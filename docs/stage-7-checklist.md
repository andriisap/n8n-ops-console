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

- [ ] Merge PR #17 → new image tag in the Hostinger YAML → Deploy
- [ ] /metrics shows the live numbers; the two automatic recoveries of chaos-recover give the median recover time (~108 s, as in step 1)
## 5. Empty and error states, loading skeletons
## 6. Dark theme switch, contrast check
## 7. Deploy
## 8. Live check against psql
## 9. Docs

## Done when

`/metrics` shows recovery times, the failing nodes and the error classes for 7 or 30 days, every list can be filtered by link, and every page reads well empty, on a phone and in both themes.
