# Stage 8 checklist: packaging

Plan: a README for someone who sees the project for the first time, and the engineering
hygiene a reviewer looks for. Decisions 039–040.

## 1. One-command install (dropped)

- [ ] ~~`docker compose up` brings everything up from scratch with seeded data~~ — dropped on 2026-10-28. Checked what it needs on n8n 2.42.5: the owner can come from `N8N_INSTANCE_OWNER_*` (since 2.17), workflows and credentials from the CLI, but a public API key can't be created without the UI or its internal REST API. Listed under Limitations in the README; the stage checklists remain the install guide

## 2. README (PR #21)

- [x] Problem → Architecture (Mermaid) → Failure modes and mitigations (10 rows, each with how it was verified) → Cost per run → Limitations → "Tested on n8n 2.42.5"
- [x] Live /metrics screenshot (`docs/img/metrics-dark.png`)
- [x] Incident page shows the LLM cost of the run that recovered (PR #20)

## 3. Engineering hygiene (PR #22, #23, #24)

- [x] CI on every pull request: lint, format, types, tests against Postgres 17 with all migrations, production build, database and workflow-code tests, watchdog tests; badge in the README
- [x] Dashboard on Tailwind CSS v4 with shadcn-style components (Radix Select, cva variants), lucide icons; screenshots of 7 pages × 2 themes × 2 widths compared before and after (decision 039)
- [x] 23 Playwright end-to-end tests with axe accessibility checks, in CI; they found and fixed four real problems, including a 404 page that answered 200 (decision 040)
- [x] Deployed: Radix selects, theme switch with icons, dark theme checked on the live server

Closed 2026-10-28 as `v1.0`.

## Done when

Someone who opens the repo for the first time understands in a minute what it does, sees that it was tested by breaking it, and sees what it doesn't do.
