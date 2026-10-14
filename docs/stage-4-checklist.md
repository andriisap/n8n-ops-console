# Stage 4 checklist: automatic retries and Replay

Order matters: the database first, then the error handler, then the scheduler, then the dashboard.

## 1. Code to GitHub

- [x] Commit and push. GitHub Actions builds a new dashboard image; note its `sha-…` tag

## 2. Database (ops-db terminal)

- [x] On the Mac: `pbcopy < infra/migrations/003_retries.sql`
- [x] `docker exec -it n8n-bet6-ops-db-1 psql -U ops -d ops` → paste → ends with `COMMIT`

## 3. n8n API key

- [x] n8n → Settings → n8n API → Create an API key, label `ops-retry-scheduler`. If scopes are offered, allow `execution:read` and `execution:retry`
- [x] Copy the key straight into the next step; also keep it in the password manager
- [x] Credentials → Create → **Header Auth** → Name `X-N8N-API-KEY`, Value = the key → name the credential `ops-n8n-api` → Save

## 4. Error handler: the new upsert query

- [x] On the Mac: `pbcopy < workflows/ops/src/upsert-incident.sql`
- [x] ops-error-handler → node **Upsert incident** → replace the whole Query → Save → Publish

## 5. Retry scheduler

- [x] Import `workflows/ops/ops-retry-scheduler.json`
- [x] Node **Config**: `n8n_public_url` = `https://n8n-bet6.srv1878746.hstgr.cloud`, `telegram_chat_id` = your chat id
- [x] Credentials: **Claim due retries** and **Finish retry** → `ops-db`; **Call retry API** → Header Auth `ops-n8n-api`; **Send retry alert** → `ops-telegram`
- [x] ⋯ → Settings → Error workflow → `ops-error-handler`
- [x] Save → **Publish** (a schedule only runs when published)

## 6. Dashboard

- [x] Hostinger yaml editor: `image:` of `dashboard` → the new `sha-…` → Deploy

## 7. Test

- [x] Import `workflows/chaos/chaos-recover.json`, set its error workflow to ops-error-handler, publish. Run `N8N_URL=… ./scripts/fire-recover.sh`: the first run fails, early retries fail during the 75 s outage, a later one passes; `✓ recovered` in the dashboard and ✅ Recovered in Telegram within 2–3 min
- [x] Fire `chaos-timeout` once. It can never succeed: about 8 min later (30 s + 30 s + 1 + 2 + 4 min, ±20 %, plus up to 30 s per scheduler tick) the event shows `gave up after 5` and Telegram says 💀 Gave up retrying
- [x] Open the `chaos-auth` incident → Replay on any event → `replay queued` → ~30 s later `replay failed` and a 💀 message (it fails on purpose)
- [x] Executions of ops-retry-scheduler: successful runs are not saved (by design); the list stays empty unless a run fails

## Done when

A flaky failure recovers on its own and says so; a permanent one gives up after 5 attempts and says so; Replay works from the dashboard.

Closed 2026-10-14: all items verified on the live instance, results in [failure-modes.md](failure-modes.md#live-runs-of-stage-4-2026-10-14).
