# Stage 1 checklist: ops Postgres

## 1. Prepare

- [ ] Snapshot: Backups & Monitoring → Snapshots → Create snapshot
- [ ] Generate a password on your Mac and save it in the password manager:
  ```bash
  openssl rand -hex 24
  ```
  Hex only, because a `$` in the password would be read by docker compose as a variable.

## 2. Add the database (Hostinger)

Docker Manager → n8n-bet6 → Manage → .yaml editor. Replace the whole file with the version below, then put your password in place of `PASTE_PASSWORD_HERE`. This copy lives only on the server and never goes into git.

```yaml
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:2.42.5
    restart: unless-stopped
    ports:
      - "5678"
    labels:
      - traefik.enable=true
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}.rule=Host(`${COMPOSE_PROJECT_NAME}.${TRAEFIK_HOST}`)
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}.entrypoints=websecure
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}.tls.certresolver=letsencrypt
      - traefik.http.services.${COMPOSE_PROJECT_NAME}.loadbalancer.server.port=5678
    environment:
      - N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
      - N8N_RUNNERS_ENABLED=true
      - N8N_SECURE_COOKIE=false
      - WEBHOOK_URL=https://${COMPOSE_PROJECT_NAME}.${TRAEFIK_HOST}/
      - NODE_ENV=production
      - GENERIC_TIMEZONE=${TZ}
      - TZ=${TZ}
    volumes:
      - n8n_data:/home/node/.n8n

  ops-db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_DB=ops
      - POSTGRES_USER=ops
      - POSTGRES_PASSWORD=PASTE_PASSWORD_HERE
    volumes:
      - ops_db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ops -d ops"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  n8n_data:
  ops_db_data:
```

- [ ] Deploy
- [ ] The app now shows 2 containers, both Running

## 3. Create the tables

- [ ] Open the Terminal of the `ops-db` container and run `psql -U ops -d ops`
- [ ] Paste the whole of `infra/migrations/001_init.sql`. The last line of output must be `COMMIT`
- [ ] `\dt` lists 7 tables, then `\q`

Optional: paste `infra/tests/001_schema_checks.sql` the same way. It must print `all schema checks passed` and leaves no data behind.

## 4. Connect n8n

- [ ] n8n → Credentials → Create → Postgres
  - Host: `ops-db`
  - Database: `ops`
  - User: `ops`
  - Password: the generated one
  - Port: `5432`
  - SSL: Disable (traffic never leaves the docker network)
- [ ] Save. The connection test must pass
- [ ] Import `workflows/ops/ops-db-smoke-test.json`, pick the credential in both Postgres nodes, click Execute workflow

## Done when

The node "Read it back" shows `migrations = 001_init` and `seconds_ago` under 1.

## Then

```bash
git add .
git commit -m "Stage 1: ops Postgres and schema"
git push
```
