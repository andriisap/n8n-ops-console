#!/usr/bin/env bash
# Download one execution with its full data from the n8n public API, to look at
# what the LLM nodes recorded (tokenUsage, model). The key is asked for, never stored.
#   N8N_URL=https://your-n8n-host ./scripts/fetch-execution.sh 1234
set -euo pipefail
: "${N8N_URL:?set N8N_URL}"
ID="${1:?usage: fetch-execution.sh <execution id>}"
read -r -s -p "n8n API key (input hidden): " KEY; echo
OUT="execution-$ID.json"
code=$(curl -sS -o "$OUT" -w '%{http_code}' -H "X-N8N-API-KEY: $KEY" \
  "${N8N_URL%/}/api/v1/executions/$ID?includeData=true")
unset KEY
if [[ "$code" != "200" ]]; then echo "HTTP $code"; cat "$OUT"; rm -f "$OUT"; exit 1; fi
echo "saved $OUT ($(wc -c < "$OUT") bytes)"
python3 - "$OUT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
run = (d.get("data") or {}).get("resultData", {}).get("runData", {})
for node, runs in run.items():
    for i, r in enumerate(runs):
        for conn, outs in (r.get("data") or {}).items():
            if conn != "ai_languageModel":
                continue
            for item in (outs or [[]])[0] or []:
                j = item.get("json", {})
                u = j.get("tokenUsage") or j.get("tokenUsageEstimate")
                kind = "real" if "tokenUsage" in j else "ESTIMATE"
                print(f"{node} run {i}: {kind} {u}")
PY
