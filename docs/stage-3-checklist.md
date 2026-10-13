# Stage 3 checklist: dashboard at ops.srv1878746.hstgr.cloud

## 1. Build the image (GitHub)

- [ ] Push the repo. GitHub → Actions → "dashboard image" runs automatically, ~3 min
- [ ] Open the finished run. The summary shows the tag, e.g. `ghcr.io/andriisap/n8n-ops-console-dashboard:sha-1a2b3c4`. Copy the `sha-…` part
- [ ] Make the image public, so the server can pull it without a login: github.com → your profile → Packages → `n8n-ops-console-dashboard` → Package settings → Change visibility → Public

## 2. Database role (ops-db terminal)

- [ ] On the Mac: `openssl rand -hex 24`, save as "ops_dashboard DB password"
- [ ] On the Mac: `pbcopy < infra/migrations/002_dashboard_role.sql`
- [ ] ops-db terminal → `psql -U ops -d ops` → paste → ends with `COMMIT`
- [ ] Still in psql: `ALTER ROLE ops_dashboard PASSWORD 'the-password';` → `ALTER ROLE`
- [ ] Optional: paste `infra/tests/002_dashboard_role_checks.sql` → `all dashboard role checks passed`

## 3. Dashboard login

- [ ] Pick a username and a password for the dashboard, save them in the password manager
- [ ] On the Mac:
  ```bash
  htpasswd -nbB andrii 'your-dashboard-password' | sed 's/\$/\$\$/g'
  ```
  Output looks like `andrii:$$2y$$05$$...`. The doubled `$$` is required: docker compose reads a single `$` as a variable.

## 4. Add the service (Hostinger)

Docker Manager → n8n-bet6 → Manage → .yaml editor. Keep everything as it is and add the `dashboard` block between `ops-db` and `volumes`, replacing the three placeholders:

```yaml
  dashboard:
    image: ghcr.io/andriisap/n8n-ops-console-dashboard:sha-REPLACE
    restart: unless-stopped
    depends_on:
      ops-db:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgres://ops_dashboard:DASHBOARD_DB_PASSWORD@ops-db:5432/ops
    labels:
      - traefik.enable=true
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}-dashboard.rule=Host(`ops.${TRAEFIK_HOST}`)
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}-dashboard.entrypoints=websecure
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}-dashboard.tls.certresolver=letsencrypt
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}-dashboard.middlewares=${COMPOSE_PROJECT_NAME}-dashboard-auth
      - traefik.http.middlewares.${COMPOSE_PROJECT_NAME}-dashboard-auth.basicauth.users=HTPASSWD_LINE
      - traefik.http.services.${COMPOSE_PROJECT_NAME}-dashboard.loadbalancer.server.port=3000
```

| Placeholder | Value |
| --- | --- |
| `sha-REPLACE` | tag from step 1 |
| `DASHBOARD_DB_PASSWORD` | password from step 2 |
| `HTPASSWD_LINE` | output from step 3, with `$$` |

- [ ] Deploy. n8n-bet6 now shows 3 containers

## 5. Check

- [ ] Open https://ops.srv1878746.hstgr.cloud → browser asks for login → incidents list
- [ ] Fire `chaos-auth` once → its count grows within 10 s, without reloading the page
- [ ] Resolve an incident in the dashboard, fire it again → 🟠 Reopened in Telegram

## If something is off

| Symptom | Likely cause |
| --- | --- |
| Deploy fails with "denied" or "unauthorized" pulling the image | Package still private (step 1) |
| 404 page not found from traefik | Router label typo, or the deploy didn't pick up the labels |
| Bad Gateway / Gateway Timeout | Traefik can't reach the container. Send me the output of `docker inspect traefik-traefik-1 --format '{{.HostConfig.NetworkMode}}'` from the server terminal |
| Dashboard page says the database is unreachable | Wrong password in DATABASE_URL, or step 2 not done |
| Login prompt keeps coming back | `$` not doubled in the htpasswd line |
