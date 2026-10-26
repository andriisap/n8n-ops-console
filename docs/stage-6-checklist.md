# Stage 6 checklist: watching the watcher

Everything that alerts today runs inside n8n. Stage 6 adds a watchdog outside the server:
a Cloudflare Worker that alerts Telegram directly when n8n, its schedules or its alert
pipeline go quiet (decision 035).

| Check | Kind | Down when |
| --- | --- | --- |
| `n8n-heartbeat` | ping from `ops-heartbeat`, every 5 min | silent > 15 min |
| `error-handler` | ping from `ops-error-handler` after the hourly `chaos-canary` | silent > 70 min |
| `n8n-http` | probe `GET /healthz` every minute | 3 failures in a row |
| `dashboard-http` | probe `GET /api/health` (401 from basic auth = up) | 3 failures in a row |

One Telegram message when a check goes down, one when it's back. Nothing in between.

## 1. Watchdog code (PR #10)

- [x] `watchdog/`: Worker, D1 schema, 12 logic tests (`npm test`), typecheck, local run with a local D1

## 2. Deploy the watchdog (on the Mac)

- [x] `git pull`, then `cd watchdog && npm ci`
- [x] `npx wrangler login` (opens the browser, approve)
- [x] `npx wrangler d1 create ops-watchdog` → `database_id` in `wrangler.toml` (PR #11)
- [x] `npm run db:init` → creates the `checks` table in the remote D1
- [x] A ping key: `openssl rand -hex 24` → password manager. Rotated once: the first one showed up in a screenshot
- [x] Secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `PING_KEY` with `npx wrangler secret put …`
- [x] `npm run deploy` → `https://ops-watchdog.andriisap.workers.dev` (first deploy also registers the account's workers.dev subdomain)
- [x] `/status` → `n8n-http`, `dashboard-http` up; the two pings `unknown`
- [ ] After PR #12: `npm run deploy` once more (`workers_dev = true`, `preview_urls = false` now explicit)

Read `/status` without the key landing in shell history or a screenshot:
`read -s KEY` then `curl -s -H "x-ping-key: $KEY" https://ops-watchdog.andriisap.workers.dev/status`

## 3. Wire n8n to it (through MCP, PR #12)

- [x] Credential `ops-watchdog` (Header Auth `X-Ping-Key`), created by hand: it holds the secret
- [x] `ops-heartbeat` created: every 5 min → `POST /ping/n8n-heartbeat` and `heartbeats('n8n')` in ops-db; error workflow ops-error-handler, successful runs not saved. Test run: watchdog answered `ok`
- [x] `chaos-canary` created: fails every hour on purpose
- [x] `ops-error-handler`: `Canary?` after `Upsert incident` → `Keep canary quiet` (incident 77 set to ignored) → `Ping watchdog (canary)`; everything else goes to `Should alert?` as before. Config gained `canary_workflow_id` and `watchdog_url`
- [x] Checked: canary run 36981 → handler 36982 pinged `error-handler`, no Telegram; second run 36990 the same with the incident already ignored; chaos-429 (36985 → 36986) still takes the normal path (open incident, deduplicated, retry queued)
- [x] Repo: `workflows/ops/ops-heartbeat.json`, `workflows/chaos/chaos-canary.json`, `build-error-handler.py` with the canary branch

## 4. Dashboard status strip

## 5. Live tests

## Done when

`docker stop` on n8n brings a 🚨 from the watchdog within ~15 minutes and a ✅ after start; a broken alert pipeline is noticed within ~70 minutes.
