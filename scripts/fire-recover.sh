#!/usr/bin/env bash
# Starts a 75-second simulated outage on chaos-recover. The first run fails, automatic
# retries keep failing while the outage lasts, and a later retry succeeds:
# expect "✅ Recovered" in Telegram within about 2-3 minutes.
# Usage: N8N_URL=https://your-n8n-host ./scripts/fire-recover.sh [outage_seconds]

set -euo pipefail
: "${N8N_URL:?Set N8N_URL, e.g. N8N_URL=https://n8n.example.com}"
OUTAGE="${1:-75}"
UNTIL=$(( $(date +%s) * 1000 + OUTAGE * 1000 ))

code=$(curl -s -o /dev/null -w '%{http_code}' "${N8N_URL%/}/webhook/chaos-recover?fail_until=${UNTIL}")
echo "chaos-recover webhook answered ${code}; simulated outage ends in ${OUTAGE} s"
