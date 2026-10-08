#!/usr/bin/env bash
# Fires every chaos workflow once through its production webhook.
# Usage: N8N_URL=https://your-n8n-host ./scripts/fire-chaos.sh [times]

set -euo pipefail

: "${N8N_URL:?Set N8N_URL, e.g. N8N_URL=https://n8n.example.com}"
TIMES="${1:-1}"
PATHS=(chaos-429 chaos-timeout chaos-invalid-json chaos-auth chaos-flaky)

for ((i = 1; i <= TIMES; i++)); do
  for p in "${PATHS[@]}"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "${N8N_URL%/}/webhook/${p}")
    printf '%-20s webhook answered %s\n' "$p" "$code"
  done
done

echo
echo "A 200 here only means the webhook accepted the call."
echo "The failures themselves show up in n8n under Executions."
