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

- [ ] `git pull`, then `cd watchdog && npm ci`
- [ ] `npx wrangler login` (opens the browser, approve)
- [ ] `npx wrangler d1 create ops-watchdog` → copy `database_id` into `wrangler.toml`
- [ ] `npm run db:init` → creates the `checks` table in the remote D1
- [ ] A ping key: `openssl rand -hex 24` → password manager (n8n needs it in step 3)
- [ ] Secrets, each asks for the value (input hidden):
  - `npx wrangler secret put TELEGRAM_BOT_TOKEN` (the token of the alerts bot)
  - `npx wrangler secret put TELEGRAM_CHAT_ID`
  - `npx wrangler secret put PING_KEY`
- [ ] `npm run deploy` → note the `https://ops-watchdog.<you>.workers.dev` URL
- [ ] `curl -s -H "x-ping-key: <key>" https://ops-watchdog.<you>.workers.dev/status` → 4 checks; after 1–3 minutes `n8n-http` and `dashboard-http` are `up`, the two pings `unknown`

## 3. Wire n8n to it (through MCP)

## 4. Dashboard status strip

## 5. Live tests

## Done when

`docker stop` on n8n brings a 🚨 from the watchdog within ~15 minutes and a ✅ after start; a broken alert pipeline is noticed within ~70 minutes.
