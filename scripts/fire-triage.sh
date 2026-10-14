#!/usr/bin/env bash
# Send support tickets to demo-ticket-triage. Each run = 2 LLM calls (Groq + Claude).
#   N8N_URL=https://your-n8n-host ./scripts/fire-triage.sh        # one ticket
#   N8N_URL=… ./scripts/fire-triage.sh 5                          # five different tickets
#   N8N_URL=… ./scripts/fire-triage.sh --long                     # one ~30k-character ticket: a cost spike
set -euo pipefail
: "${N8N_URL:?set N8N_URL, e.g. N8N_URL=https://n8n.example.com}"
URL="${N8N_URL%/}/webhook/demo-ticket-triage"

TICKETS=(
  "We were charged twice for the October invoice, order 4471. Please refund one of them."
  "Since this morning nobody on our team can log in, we get 'session expired' right after the password. Client demo at 15:00."
  "Could you add an export to CSV on the reports page? Not urgent, but the whole team would use it."
  "The PDF export cuts off the last column of every table. Tried Chrome and Safari."
  "How do I change the email address on my account? I can't find it in settings."
)

send() {
  local text="$1"
  local body; body=$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$text")
  local code
  code=$(curl -sS -o /tmp/triage-reply.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data "$body" "$URL")
  echo "HTTP $code  $(head -c 160 /tmp/triage-reply.json)"
}

if [[ "${1:-}" == "--long" ]]; then
  base="${TICKETS[1]} Here is the full log we exported from the browser console: "
  log=$(python3 -c 'print(" ".join(f"[{i:05d}] GET /api/session 401 session expired, retrying with refresh token" for i in range(400)))')
  send "$base$log"
  exit 0
fi

n="${1:-1}"
for ((i = 0; i < n; i++)); do
  send "${TICKETS[$((i % ${#TICKETS[@]}))]}"
done
