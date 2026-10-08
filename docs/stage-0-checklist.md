# Stage 0 checklist

## On Hostinger

- [ ] Snapshot: Backups & Monitoring → Snapshots → Create snapshot
- [ ] Docker Manager → n8n-bet6 → Manage → .yaml editor: change `image: docker.n8n.io/n8nio/n8n` to `image: docker.n8n.io/n8nio/n8n:2.42.5` → Deploy
- [ ] n8n → Help → About n8n shows 2.42.5

## In n8n

- [ ] Settings → n8n API → Create an API key. Store it in a password manager. It goes into the dashboard's `.env` in stage 3
- [ ] Import the five files from `workflows/chaos/`: Workflows → Create → ⋯ menu → Import from file
- [ ] Publish each chaos workflow (webhooks only answer on published workflows)
- [ ] Run `N8N_URL=https://<your host> ./scripts/fire-chaos.sh`
- [ ] Executions list shows four failed runs and one random result for chaos-flaky

## On GitHub

- [ ] Create a public repo `n8n-ops-console`, push this folder

## Done when

Each chaos workflow fails the same way every time it is fired.
