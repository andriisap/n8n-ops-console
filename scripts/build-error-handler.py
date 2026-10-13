#!/usr/bin/env python3
"""Builds workflows/ops/ops-error-handler.json from the files in workflows/ops/src.

Code and SQL live in src/ so they can be read, diffed and tested on their own.
Run from the repo root: python3 scripts/build-error-handler.py
"""
import json
import pathlib
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "workflows" / "ops" / "src"
OUT = ROOT / "workflows" / "ops" / "ops-error-handler.json"

# Stable ids, so rebuilding doesn't produce a noisy diff.
NS = uuid.UUID("6f1c2d3e-0000-4000-8000-00000000c0de")


def nid(name):
    return str(uuid.uuid5(NS, name))


def src(name):
    return (SRC / name).read_text()


def node(name, type_, version, pos, params, **extra):
    n = {"parameters": params, "name": name, "type": type_, "typeVersion": version,
         "position": pos, "id": nid(name)}
    n.update(extra)
    return n


NOTE = """## ops-error-handler
Every workflow points here (Settings → Error workflow).

1. Normalize: flatten the payload, classify the error
2. Upsert: one incident per fingerprint, one event per execution
3. Alert only on a new or reopened incident
4. If the DB write fails, alert anyway (bottom branch)

Source of the code and SQL: `workflows/ops/src/` in the repo."""

nodes = [
    node("Note", "n8n-nodes-base.stickyNote", 1, [-60, -420],
         {"content": NOTE, "height": 300, "width": 460}),
    node("Error Trigger", "n8n-nodes-base.errorTrigger", 1, [0, 0], {}),
    node("Config", "n8n-nodes-base.set", 3.4, [220, 0], {
        "assignments": {"assignments": [
            {"id": nid("cfg-chat"), "name": "telegram_chat_id",
             "value": "PASTE_CHAT_ID", "type": "string"},
        ]},
        "includeOtherFields": True,
        "options": {},
    }),
    node("Normalize error", "n8n-nodes-base.code", 2, [440, 0],
         {"jsCode": src("normalize-error.js")}),
    node("Upsert incident", "n8n-nodes-base.postgres", 2.5, [660, 0], {
        "operation": "executeQuery",
        "query": src("upsert-incident.sql"),
        "options": {"queryReplacement": "={{ JSON.stringify($json) }}"},
    }, onError="continueErrorOutput", retryOnFail=True, maxTries=3, waitBetweenTries=1000),
    node("Should alert?", "n8n-nodes-base.if", 2.2, [900, -100], {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{
                "id": nid("cond-alert"),
                "leftValue": "={{ $json.should_alert }}",
                "rightValue": "",
                "operator": {"type": "boolean", "operation": "true", "singleValue": True},
            }],
            "combinator": "and",
        },
        "looseTypeValidation": True,
        "options": {},
    }),
    node("Build alert", "n8n-nodes-base.code", 2, [1120, -200],
         {"jsCode": src("build-alert.js")}),
    node("Send alert", "n8n-nodes-base.telegram", 1.2, [1340, -200], {
        "chatId": "={{ $('Config').first().json.telegram_chat_id }}",
        "text": "={{ $json.text }}",
        "additionalFields": {"appendAttribution": False, "parse_mode": "HTML",
                             "disable_web_page_preview": True},
    }, retryOnFail=True, maxTries=3, waitBetweenTries=2000),
    node("Mark alerted", "n8n-nodes-base.postgres", 2.5, [1560, -200], {
        "operation": "executeQuery",
        "query": "UPDATE incidents SET last_alerted_at = now() WHERE id = $1::bigint;",
        "options": {"queryReplacement": "={{ $('Upsert incident').first().json.incident_id }}"},
    }),
    node("No alert needed", "n8n-nodes-base.noOp", 1, [1120, 0], {}),
    node("Build fallback alert", "n8n-nodes-base.code", 2, [900, 220],
         {"jsCode": src("build-fallback-alert.js")}),
    node("Send fallback alert", "n8n-nodes-base.telegram", 1.2, [1120, 220], {
        "chatId": "={{ $('Config').first().json.telegram_chat_id }}",
        "text": "={{ $json.text }}",
        "additionalFields": {"appendAttribution": False, "parse_mode": "HTML",
                             "disable_web_page_preview": True},
    }, retryOnFail=True, maxTries=3, waitBetweenTries=2000),
]


def to(*targets):
    return [[{"node": t, "type": "main", "index": 0} for t in targets]]


connections = {
    "Error Trigger": {"main": to("Config")},
    "Config": {"main": to("Normalize error")},
    "Normalize error": {"main": to("Upsert incident")},
    # output 0 = success, output 1 = error output (onError: continueErrorOutput)
    "Upsert incident": {"main": [
        [{"node": "Should alert?", "type": "main", "index": 0}],
        [{"node": "Build fallback alert", "type": "main", "index": 0}],
    ]},
    "Should alert?": {"main": [
        [{"node": "Build alert", "type": "main", "index": 0}],
        [{"node": "No alert needed", "type": "main", "index": 0}],
    ]},
    "Build alert": {"main": to("Send alert")},
    "Send alert": {"main": to("Mark alerted")},
    "Build fallback alert": {"main": to("Send fallback alert")},
}

workflow = {
    "name": "ops-error-handler",
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "saveDataErrorExecution": "all",
                 "saveDataSuccessExecution": "all"},
    "pinData": {},
}

OUT.write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT.relative_to(ROOT)}")
