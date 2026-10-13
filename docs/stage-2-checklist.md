# Stage 2 checklist: central error workflow

## 1. Telegram bot

- [ ] In Telegram, open @BotFather → `/newbot` → name `n8n Ops Alerts`, username ending in `bot`
- [ ] Save the token in the password manager
- [ ] Open your new bot, press Start, send it any message
- [ ] In the browser open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `"chat":{"id": ...}`. That number is your chat id

## 2. n8n credential

- [ ] Credentials → Create → Telegram API → paste the token → name it `ops-telegram` → Save

## 3. Import the handler

- [ ] Import `workflows/ops/ops-error-handler.json`
- [ ] Node **Config**: replace `PASTE_CHAT_ID` with your chat id
- [ ] Nodes **Upsert incident** and **Mark alerted**: credential `ops-db`
- [ ] Nodes **Send alert** and **Send fallback alert**: credential `ops-telegram`
- [ ] Save. An error workflow doesn't need to be published: n8n calls it directly

## 4. Point the chaos workflows at it

For each of the five chaos workflows: ⋯ menu → Settings → Error workflow → `ops-error-handler` → Save.

## 5. Test

- [ ] Fire every chaos workflow once: `N8N_URL=https://... ./scripts/fire-chaos.sh`
- [ ] Telegram: 4 or 5 messages, one per problem (chaos-flaky only fails about half the time)
- [ ] Fire nine more times: `./scripts/fire-chaos.sh 9`
- [ ] Telegram: no new messages
- [ ] In the ops-db terminal (`psql -U ops -d ops`):
  ```sql
  SELECT id, workflow_name, error_class, occurrences, status FROM incidents ORDER BY id;
  ```
  4 incidents with `occurrences = 10`, plus chaos-flaky with a smaller count.

## 6. Test the failure modes

- [ ] Reopen: `UPDATE incidents SET status = 'resolved' WHERE workflow_name = 'chaos-auth';`, fire once, expect one 🟠 Reopened message
- [ ] Database down: Hostinger → stop the `ops-db` container, fire chaos-auth once, expect a ⚠️ fallback message within about 5 s (the handler retries the DB 3 times first). Start `ops-db` again

## Done when

Ten identical failures make one incident and one Telegram message.
