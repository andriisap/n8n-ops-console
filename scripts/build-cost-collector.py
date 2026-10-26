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


API = "={{ $('Config').first().json.n8n_public_url.replace(/\\/+$/, '') }}/api/v1/executions"
HEADER_AUTH = {"authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth"}

NOTE = """## ops-cost-collector
Every minute: list finished executions through n8n's own API, download the ones not seen yet (25 per run, oldest first), and record every LLM call with its tokens.

- No workflow needs changing: model nodes already record `tokenUsage`
- Only model sub-nodes are counted; the chain node above repeats the same totals
- Cost isn't stored: the `llm_usage_costed` view prices each call by its day and tier

Successful runs are not saved. Failed runs are, and alert through ops-error-handler."""

nodes = [
    node("Note", "n8n-nodes-base.stickyNote", 1, [-80, -420], {"content": NOTE, "height": 300, "width": 520}),
    node("Every minute", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0],
         {"rule": {"interval": [{"field": "minutes", "minutesInterval": 1}]}}),
    node("Config", "n8n-nodes-base.set", 3.4, [220, 0], {
        "assignments": {"assignments": [
            {"id": nid("cfg-url"), "name": "n8n_public_url", "value": "PASTE_N8N_URL", "type": "string"},
        ]},
        "options": {},
    }),
    node("Scan window", "n8n-nodes-base.postgres", 2.5, [440, 0], {
        "operation": "executeQuery", "query": src("cost-scan-window.sql"), "options": {},
    }),
    # Without data: a cheap listing of ids and statuses. Pagination follows nextCursor.
    node("List executions", "n8n-nodes-base.httpRequest", 4.2, [660, 0], {
        "url": API,
        **HEADER_AUTH,
        "sendQuery": True,
        "queryParameters": {"parameters": [
            {"name": "startedAfter", "value": "={{ $json.started_after }}"},
            {"name": "limit", "value": "250"},
        ]},
        "options": {
            "pagination": {"pagination": {
                "paginationMode": "updateAParameterInEachRequest",
                "parameters": {"parameters": [
                    {"type": "qs", "name": "cursor", "value": "={{ $response.body.nextCursor }}"},
                ]},
                "paginationCompleteWhen": "other",
                "completeExpression": "={{ !$response.body.nextCursor }}",
                "limitPagesFetched": True,
                "maxRequests": 20,
            }},
            "timeout": 60000,
        },
    }),
    node("Finished ids", "n8n-nodes-base.code", 2, [880, 0], {"jsCode": src("finished-ids.js")}),
    node("Pick unscanned", "n8n-nodes-base.postgres", 2.5, [1100, 0], {
        "operation": "executeQuery",
        "query": src("pick-unscanned.sql"),
        "options": {"queryReplacement": "={{ JSON.stringify($json) }}"},
    }),
    # A query with no rows can still hand on an empty item; only real ids go on.
    node("Has id?", "n8n-nodes-base.if", 2.2, [1320, 0], {
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
    node("Get execution", "n8n-nodes-base.httpRequest", 4.2, [1540, -100], {
        "url": "=" + API[1:] + "/{{ $json.id }}",
        **HEADER_AUTH,
        "sendQuery": True,
        "queryParameters": {"parameters": [
            {"name": "includeData", "value": "true"},
            {"name": "ignoreDataSizeLimit", "value": "true"},
        ]},
        "options": {"timeout": 60000},
    }, onError="continueRegularOutput"),
    node("Extract LLM calls", "n8n-nodes-base.code", 2, [1760, -100], {"jsCode": src("extract-llm-calls.js")}),
    node("Record usage", "n8n-nodes-base.postgres", 2.5, [1980, -100], {
        "operation": "executeQuery",
        "query": src("record-llm-usage.sql"),
        "options": {"queryReplacement": "={{ JSON.stringify($json) }}"},
    }, retryOnFail=True, maxTries=3, waitBetweenTries=1000),
]


def to(*targets):
    return [[{"node": t, "type": "main", "index": 0} for t in targets]]


connections = {
    "Every minute": {"main": to("Config")},
    "Config": {"main": to("Scan window")},
    "Scan window": {"main": to("List executions")},
    "List executions": {"main": to("Finished ids")},
    "Finished ids": {"main": to("Pick unscanned")},
    "Pick unscanned": {"main": to("Has id?")},
    "Has id?": {"main": [[{"node": "Get execution", "type": "main", "index": 0}], []]},
    "Get execution": {"main": to("Extract LLM calls")},
    "Extract LLM calls": {"main": to("Record usage")},
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
