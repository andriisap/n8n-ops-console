# Decisions

Short records of choices made before or during the build. Newest at the bottom.

## 001. Separate Postgres for ops data, n8n stays on SQLite (2026-10-08)

The live n8n instance runs on SQLite. Ops Console data (incidents, retries, costs) goes into its own Postgres container in the same compose, database `ops`. Migrating n8n itself to Postgres and queue mode is a later, separate stage, so the working instance isn't touched at the start.

## 002. Alerts go to Telegram (2026-10-08)

Free, no Slack API limits, and n8n has native human-in-the-loop for Telegram.

## 003. Dashboard runs on the same VPS behind traefik (2026-10-08)

Vercel Hobby doesn't allow commercial use, and hosting there would mean exposing Postgres to the internet. A container next to n8n reads Postgres over the internal docker network.

## 004. One public monorepo (2026-10-08)

`infra/`, `workflows/`, `dashboard/`, `docs/` in one GitHub repo, so a reviewer can clone it and run `docker compose up`.

## 005. Chaos workflows use webhook triggers and httpbin (2026-10-08)

Error workflows only fire on production executions, so manual runs can't test them. httpbin.org returns any status code or delay on request with no account. If httpbin is unreliable, a self-hosted httpbin container replaces it in stage 1.
