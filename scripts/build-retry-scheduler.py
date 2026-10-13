#!/usr/bin/env python3
"""Builds workflows/ops/ops-retry-scheduler.json from the files in workflows/ops/src.

Run from the repo root: python3 scripts/build-retry-scheduler.py
"""
import json
import pathlib
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "workflows" / "ops" / "src"
OUT = ROOT / "workflows" / "ops" / "ops-retry-scheduler.json"
NS = uuid.UUID("6f1c2d3e-0000-4000-8000-0000000005ed")


def nid(name):
    return str(uuid.uuid5(NS, name))


def src(name):
    return (SRC / name).read_text()


def node(name, type_, version, pos, params, **extra):
    n = {"parameters": params, "name": name, "type": type_, "typeVersion": version,
         "position": pos, "id": nid(name)}
    n.update(extra)
    return n


def if_true(name, pos, expr):
    return node(name, "n8n-nodes-base.if", 2.2, pos, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{"id": nid(name + "-c"), "leftValue": expr, "rightValue": "",
                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and",
        },
        "looseTypeValidation": True,
        "options": {},
    })


NOTE = """## ops-retry-scheduler
Every 30 s: lease up to 5 due jobs from `retry_queue`, call n8n's own API to retry each execution, record the outcome.

- Backoff and give-up live in SQL (`finish-retry.sql`)
- Telegram hears only the end: ✅ recovered or 💀 gave up
- A rejected API key fails this run, so ops-error-handler alerts

Successful runs are not saved (2,880 a day would only fill the database). Failed runs are."""

nodes = [
    node("Note", "n8n-nodes-base.stickyNote", 1, [-80, -420], {"content": NOTE, "height": 300, "width": 480}),
    node("Every 30 seconds", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0],
         {"rule": {"interval": [{"field": "seconds", "secondsInterval": 30}]}}),
    node("Config", "n8n-nodes-base.set", 3.4, [220, 0], {
        "assignments": {"assignments": [
            {"id": nid("cfg-url"), "name": "n8n_public_url", "value": "PASTE_N8N_URL", "type": "string"},
            {"id": nid("cfg-chat"), "name": "telegram_chat_id", "value": "PASTE_CHAT_ID", "type": "string"},
        ]},
        "options": {},
    }),
    node("Claim due retries", "n8n-nodes-base.postgres", 2.5, [440, 0], {
        "operation": "executeQuery", "query": src("claim-retries.sql"), "options": {},
    }),
    # A query that returns no rows can still hand on an empty item; only real jobs go on.
    node("Has job?", "n8n-nodes-base.if", 2.2, [660, 0], {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{"id": nid("has-job"), "leftValue": "={{ $json.id }}", "rightValue": "",
                            "operator": {"type": "number", "operation": "exists", "singleValue": True}}],
            "combinator": "and",
        },
        "looseTypeValidation": True,
        "options": {},
    }),
    node("Call retry API", "n8n-nodes-base.httpRequest", 4.2, [880, 0], {
        "method": "POST",
        "url": "={{ $('Config').first().json.n8n_public_url.replace(/\\/+$/, '') }}/api/v1/executions/{{ $json.execution_id }}/retry",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ loadWorkflow: $json.load_workflow }) }}",
        "options": {
            "response": {"response": {"fullResponse": True, "neverError": True}},
            "timeout": 120000,
        },
    }, onError="continueRegularOutput"),
    node("Evaluate result", "n8n-nodes-base.code", 2, [1100, 0],
         {"mode": "runOnceForEachItem", "jsCode": src("evaluate-retry.js")}),
    node("Finish retry", "n8n-nodes-base.postgres", 2.5, [1320, 0], {
        "operation": "executeQuery",
        "query": src("finish-retry.sql"),
        "options": {"queryReplacement": "={{ JSON.stringify($json) }}"},
    }, retryOnFail=True, maxTries=3, waitBetweenTries=1000),
    if_true("Notify?", [1540, -120], "={{ $json.notify }}"),
    node("Build retry alert", "n8n-nodes-base.code", 2, [1760, -120],
         {"mode": "runOnceForEachItem", "jsCode": src("build-retry-alert.js")}),
    node("Send retry alert", "n8n-nodes-base.telegram", 1.2, [1980, -120], {
        "chatId": "={{ $('Config').first().json.telegram_chat_id }}",
        "text": "={{ $json.text }}",
        "additionalFields": {"appendAttribution": False, "parse_mode": "HTML", "disable_web_page_preview": True},
    }, retryOnFail=True, maxTries=3, waitBetweenTries=2000),
    if_true("API key rejected?", [1540, 120], "={{ $('Evaluate result').item.json.api_key_rejected }}"),
    node("Fail loudly", "n8n-nodes-base.stopAndError", 1, [1760, 120], {
        "errorMessage": "n8n API rejected the API key (HTTP 401/403): unauthorized. "
                        "Check the ops-n8n-api credential. Jobs stay queued and resume once it works.",
    }),
]


def to(*targets):
    return [[{"node": t, "type": "main", "index": 0} for t in targets]]


connections = {
    "Every 30 seconds": {"main": to("Config")},
    "Config": {"main": to("Claim due retries")},
    "Claim due retries": {"main": to("Has job?")},
    "Has job?": {"main": [[{"node": "Call retry API", "type": "main", "index": 0}], []]},
    "Call retry API": {"main": to("Evaluate result")},
    "Evaluate result": {"main": to("Finish retry")},
    "Finish retry": {"main": to("Notify?", "API key rejected?")},
    "Notify?": {"main": [[{"node": "Build retry alert", "type": "main", "index": 0}], []]},
    "Build retry alert": {"main": to("Send retry alert")},
    "API key rejected?": {"main": [[{"node": "Fail loudly", "type": "main", "index": 0}], []]},
}

workflow = {
    "name": "ops-retry-scheduler",
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
