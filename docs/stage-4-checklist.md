# Stage 4 checklist: automatic retries and Replay

Order matters: the database first, then the error handler, then the scheduler, then the dashboard.

## 1. Code to GitHub

- [ ] Commit and push. GitHub Actions builds a new dashboard image; note its `sha-…` tag

## 2. Database (ops-db terminal)

- [ ] On the Mac: `pbcopy < infra/migrations/003_retries.sql`
- [ ] `docker exec -it n8n-bet6-ops-db-1 psql -U ops -d ops` → paste → ends with `COMMIT`

## 3. n8n API key

- [ ] n8n → Settings → n8n API → Create an API key, label `ops-retry-scheduler`. If scopes are offered, allow `execution:read` and `execution:retry`
- [ ] Copy the key straight into the next step; also keep it in the password manager
- [ ] Credentials → Create → **Header Auth** → Name `X-N8N-API-KEY`, Value = the key → name the credential `ops-n8n-api` → Save

## 4. Error handler: the new upsert query

- [ ] On the Mac: `pbcopy < workflows/ops/src/upsert-incident.sql`
- [ ] ops-error-handler → node **Upsert incident** → replace the whole Query → Save → Publish

## 5. Retry scheduler

- [ ] Import `workflows/ops/ops-retry-scheduler.json`
- [ ] Node **Config**: `n8n_public_url` = `https://n8n-bet6.srv1878746.hstgr.cloud`, `telegram_chat_id` = your chat id
- [ ] Credentials: **Claim due retries** and **Finish retry** → `ops-db`; **Call retry API** → Header Auth `ops-n8n-api`; **Send retry alert** → `ops-telegram`
- [ ] ⋯ → Settings → Error workflow → `ops-error-handler`
- [ ] Save → **Publish** (a schedule only runs when published)

## 6. Dashboard

- [ ] Hostinger yaml editor: `image:` of `dashboard` → the new `sha-…` → Deploy

## 7. Test

- [ ] Fire `chaos-flaky` 3–4 times until one fails. Within ~30 s its event shows `retry 1/5 …`, then usually `✓ recovered`, and Telegram says ✅ Recovered
- [ ] Fire `chaos-timeout` once. It can never succeed: about 8 min later (30 s + 30 s + 1 + 2 + 4 min, ±20 %, plus up to 30 s per scheduler tick) the event shows `gave up after 5` and Telegram says 💀 Gave up retrying
- [ ] Open the `chaos-auth` incident → Replay on any event → `replay queued` → ~30 s later `replay failed` and a 💀 message (it fails on purpose)
- [ ] Executions of ops-retry-scheduler: successful runs are not saved (by design); the list stays empty unless a run fails

## Done when

A flaky failure recovers on its own and says so; a permanent one gives up after 5 attempts and says so; Replay works from the dashboard.
