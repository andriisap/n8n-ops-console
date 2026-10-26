#!/usr/bin/env python3
"""Builds workflows/ops/ops-cost-collector.json from the files in workflows/ops/src.

Run from the repo root: python3 scripts/build-cost-collector.py
"""
import json
import pathlib
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "workflows" / "ops" / "src"
OUT = ROOT / "workflows" / "ops" / "ops-cost-collector.json"
NS = uuid.UUID("6f1c2d3e-0000-4000-8000-00000000c057")


def nid(name):
    return str(uuid.uuid5(NS, name))


def src(name):
    return (SRC / name).read_text()


def node(name, type_, version, pos, params, **extra):
    n = {"parameters": params, "name": name, "type": type_, "typeVersion": version,
         "position": pos, "id": nid(name)}
    n.update(extra)
    return n


BASE = "={{ $('Config').first().json.n8n_public_url.replace(/\\/+$/, '') }}/api/v1"
API = BASE + "/executions"
PAGINATION = {"pagination": {
    "paginationMode": "updateAParameterInEachRequest",
    "parameters": {"parameters": [
        {"type": "qs", "name": "cursor", "value": "={{ $response.body.nextCursor }}"},
    ]},
    "paginationCompleteWhen": "other",
    "completeExpression": "={{ !$response.body.nextCursor }}",
    "limitPagesFetched": True,
    "maxRequests": 20,
}}
HEADER_AUTH = {"authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth"}

NOTE = """## ops-cost-collector
Every minute: list finished executions through n8n's own API. Executions of workflows with a model node are downloaded (25 per run, oldest first) and every LLM call recorded with its tokens; the rest are marked scanned straight from the listing.

- No workflow needs changing: model nodes already record `tokenUsage`
- Only model sub-nodes are counted; the chain node above repeats the same totals
- Cost isn't stored: the `llm_usage_costed` view prices each call by its day and tier
- Over `daily_budget_usd` today (UTC): one 💸 Telegram message a day, marked sent only after delivery

Successful runs are not saved. Failed runs are, and alert through ops-error-handler."""

nodes = [
    node("Note", "n8n-nodes-base.stickyNote", 1, [-80, -420], {"content": NOTE, "height": 300, "width": 520}),
    node("Every minute", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0],
         {"rule": {"interval": [{"field": "minutes", "minutesInterval": 1}]}}),
    node("Config", "n8n-nodes-base.set", 3.4, [220, 0], {
        "assignments": {"assignments": [
            {"id": nid("cfg-url"), "name": "n8n_public_url", "value": "PASTE_N8N_URL", "type": "string"},
            {"id": nid("cfg-chat"), "name": "telegram_chat_id", "value": "PASTE_CHAT_ID", "type": "string"},
            # Daily LLM spend (UTC day, all workflows) above which one 💸 message is sent.
            {"id": nid("cfg-budget"), "name": "daily_budget_usd", "value": 1, "type": "number"},
        ]},
        "options": {},
    }),
    node("Scan window", "n8n-nodes-base.postgres", 2.5, [440, 0], {
        "operation": "executeQuery", "query": src("cost-scan-window.sql"), "options": {},
    }),
    # Which workflows contain a model node: only their executions get downloaded.
    node("List workflows", "n8n-nodes-base.httpRequest", 4.2, [660, 0], {
        "url": BASE + "/workflows",
        **HEADER_AUTH,
        "sendQuery": True,
        "queryParameters": {"parameters": [
            {"name": "limit", "value": "250"},
            {"name": "excludePinnedData", "value": "true"},
        ]},
        "options": {"pagination": PAGINATION, "timeout": 60000},
    }),
    # Without data: a cheap listing of ids and statuses. Once, whatever the workflow pages.
    node("List executions", "n8n-nodes-base.httpRequest", 4.2, [880, 0], {
        "url": API,
        **HEADER_AUTH,
        "sendQuery": True,
        "queryParameters": {"parameters": [
            {"name": "startedAfter", "value": "={{ $('Scan window').first().json.started_after }}"},
            {"name": "limit", "value": "250"},
        ]},
        "options": {"pagination": PAGINATION, "timeout": 60000},
    }, executeOnce=True),
    node("Finished ids", "n8n-nodes-base.code", 2, [1100, 0], {"jsCode": src("finished-ids.js")}),
    node("Pick unscanned", "n8n-nodes-base.postgres", 2.5, [1320, 0], {
        "operation": "executeQuery",
        "query": src("pick-unscanned.sql"),
        "options": {"queryReplacement": "={{ JSON.stringify($json) }}"},
    }),
    # A query with no rows can still hand on an empty item; only real ids go on.
    node("Has id?", "n8n-nodes-base.if", 2.2, [1540, 0], {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{"id": nid("has-id"), "leftValue": "={{ $json.id }}", "rightValue": "",
                            "operator": {"type": "string", "operation": "exists", "singleValue": True}}],
            "combinator": "and",
        },
        "looseTypeValidation": True,
        "options": {},
    }),
    # Full data, ignoring EXECUTIONS_DATA_MAX_DISPLAY_SIZE so a long run isn't returned empty.
    # One failed download (e.g. pruned meanwhile) doesn't stop the others; it is retried next run.
    node("Get execution", "n8n-nodes-base.httpRequest", 4.2, [1760, -100], {
        "url": "=" + API[1:] + "/{{ $json.id }}",
        **HEADER_AUTH,
        "sendQuery": True,
        "queryParameters": {"parameters": [
            {"name": "includeData", "value": "true"},
            {"name": "ignoreDataSizeLimit", "value": "true"},
        ]},
        "options": {"timeout": 60000},
    }, onError="continueRegularOutput"),
    node("Extract LLM calls", "n8n-nodes-base.code", 2, [1980, -100], {"jsCode": src("extract-llm-calls.js")}),
    node("Record usage", "n8n-nodes-base.postgres", 2.5, [2200, -100], {
        "operation": "executeQuery",
        "query": src("record-llm-usage.sql"),
        "options": {"queryReplacement": "={{ JSON.stringify($json) }}"},
    }, retryOnFail=True, maxTries=3, waitBetweenTries=1000),
    # Budget: a row comes back only when today is over budget and no alert was delivered yet.
    node("Check budget", "n8n-nodes-base.postgres", 2.5, [2420, -100], {
        "operation": "executeQuery",
        "query": src("check-budget.sql"),
        "options": {"queryReplacement":
                    "={{ JSON.stringify({ daily_budget_usd: $('Config').first().json.daily_budget_usd }) }}"},
    }),
    node("Over budget?", "n8n-nodes-base.if", 2.2, [2640, -100], {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{"id": nid("over"), "leftValue": "={{ $json.day }}", "rightValue": "",
                            "operator": {"type": "string", "operation": "exists", "singleValue": True}}],
            "combinator": "and",
        },
        "looseTypeValidation": True,
        "options": {},
    }),
    node("Build budget alert", "n8n-nodes-base.code", 2, [2860, -200],
         {"mode": "runOnceForEachItem", "jsCode": src("build-budget-alert.js")}),
    node("Send budget alert", "n8n-nodes-base.telegram", 1.2, [3080, -200], {
        "chatId": "={{ $('Config').first().json.telegram_chat_id }}",
        "text": "={{ $json.text }}",
        "additionalFields": {"appendAttribution": False, "parse_mode": "HTML", "disable_web_page_preview": True},
    }, retryOnFail=True, maxTries=3, waitBetweenTries=2000),
    node("Mark budget alert sent", "n8n-nodes-base.postgres", 2.5, [3300, -200], {
        "operation": "executeQuery",
        "query": src("mark-budget-alert.sql"),
        "options": {"queryReplacement":
                    "={{ JSON.stringify({ day: $('Build budget alert').item.json.day, kind: $('Build budget alert').item.json.kind }) }}"},
    }, retryOnFail=True, maxTries=3, waitBetweenTries=1000),
]


def to(*targets):
    return [[{"node": t, "type": "main", "index": 0} for t in targets]]


connections = {
    "Every minute": {"main": to("Config")},
    "Config": {"main": to("Scan window")},
    "Scan window": {"main": to("List workflows")},
    "List workflows": {"main": to("List executions")},
    "List executions": {"main": to("Finished ids")},
    "Finished ids": {"main": to("Pick unscanned")},
    "Pick unscanned": {"main": to("Has id?")},
    "Has id?": {"main": [[{"node": "Get execution", "type": "main", "index": 0}], []]},
    "Get execution": {"main": to("Extract LLM calls")},
    "Extract LLM calls": {"main": to("Record usage")},
    "Record usage": {"main": to("Check budget")},
    "Check budget": {"main": to("Over budget?")},
    "Over budget?": {"main": [[{"node": "Build budget alert", "type": "main", "index": 0}], []]},
    "Build budget alert": {"main": to("Send budget alert")},
    "Send budget alert": {"main": to("Mark budget alert sent")},
}

workflow = {
    "name": "ops-cost-collector",
    "nodes": nodes,
    "connections": connections,
    "settings": {
        "executionOrder": "v1",
        "saveDataSuccessExecution": "none",
        "saveDataErrorExecution": "all",
        "saveManualExecutions": True,
    },
    "pinData": {},
}

OUT.write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT.relative_to(ROOT)}")
