#!/usr/bin/env python3
"""Build workflows/demo/demo-ticket-triage.json.

Two LLM steps from two providers in one run, so the cost meter (stage 5) has
something real to add up: Groq classifies the ticket, Claude drafts the reply.
Credentials are left empty on purpose: pick them in n8n after import.
"""
import json, uuid, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
NS = uuid.UUID("6f0e3c1a-7d1e-4b8e-9a51-2f4b1c0d9e77")
nid = lambda name: str(uuid.uuid5(NS, "demo-ticket-triage/" + name))

SAMPLE = ("Hi, since this morning our team can't log in to the dashboard. "
          "We get 'session expired' right after entering the password. "
          "We have a client demo at 15:00, please help.")

CLASSIFY_SYSTEM = (
    "You triage customer support tickets. Answer with JSON only, no prose, no code fences: "
    '{"category": "billing|bug|access|feature_request|other", '
    '"urgency": "low|normal|high", "summary": "<one sentence>"}'
)
DRAFT_SYSTEM = (
    "You are a support agent. Write a short, friendly first reply to the customer "
    "(at most 5 sentences). Acknowledge the problem, say what happens next, and do not promise "
    "anything you can't know. Plain text, no greeting line with a name."
)

PARSE_JS = r"""// The classifier is asked for JSON, but a model can still wrap it in prose or fences.
const raw = String($json.text ?? '');
const match = raw.match(/\{[\s\S]*\}/);
let c = {};
try { c = match ? JSON.parse(match[0]) : {}; } catch (e) { c = {}; }
return [{ json: {
  ticket: $('Ticket').first().json.ticket,
  category: c.category ?? 'other',
  urgency: c.urgency ?? 'normal',
  summary: c.summary ?? raw.slice(0, 200),
} }];
"""

nodes = [
    {"id": nid("Webhook"), "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
     "position": [0, 0], "webhookId": nid("webhook-id"),
     "parameters": {"httpMethod": "POST", "path": "demo-ticket-triage",
                    "responseMode": "lastNode", "options": {}}},
    {"id": nid("Ticket"), "name": "Ticket", "type": "n8n-nodes-base.set", "typeVersion": 3.4,
     "position": [220, 0],
     "parameters": {"assignments": {"assignments": [
         {"id": nid("ticket-field"), "name": "ticket", "type": "string",
          "value": "={{ $json.body?.text || " + json.dumps(SAMPLE) + " }}"}]},
         "options": {}}},
    {"id": nid("Classify ticket"), "name": "Classify ticket", "type": "@n8n/n8n-nodes-langchain.chainLlm",
     "typeVersion": 1.9, "position": [440, 0],
     "parameters": {"promptType": "define", "text": "={{ $json.ticket }}",
                    "messages": {"messageValues": [{"message": CLASSIFY_SYSTEM}]}}},
    {"id": nid("Groq Chat Model"), "name": "Groq Chat Model", "type": "@n8n/n8n-nodes-langchain.lmChatGroq",
     "typeVersion": 1, "position": [440, 220],
     "parameters": {"model": "openai/gpt-oss-20b", "options": {}}},
    {"id": nid("Parse classification"), "name": "Parse classification", "type": "n8n-nodes-base.code",
     "typeVersion": 2, "position": [760, 0], "parameters": {"jsCode": PARSE_JS}},
    {"id": nid("Draft reply"), "name": "Draft reply", "type": "@n8n/n8n-nodes-langchain.chainLlm",
     "typeVersion": 1.9, "position": [980, 0],
     "parameters": {"promptType": "define",
                    "text": "=Ticket ({{ $json.category }}, urgency {{ $json.urgency }}):\n\n{{ $json.ticket }}",
                    "messages": {"messageValues": [{"message": DRAFT_SYSTEM}]}}},
    {"id": nid("Anthropic Chat Model"), "name": "Anthropic Chat Model",
     "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic", "typeVersion": 1.6, "position": [980, 220],
     "parameters": {"model": {"__rl": True, "mode": "id", "value": "claude-haiku-5-5"},
                    "options": {"maxTokensToSample": 400}}},
    {"id": nid("Result"), "name": "Result", "type": "n8n-nodes-base.set", "typeVersion": 3.4,
     "position": [1300, 0],
     "parameters": {"assignments": {"assignments": [
         {"id": nid("r-category"), "name": "category", "type": "string",
          "value": "={{ $('Parse classification').first().json.category }}"},
         {"id": nid("r-urgency"), "name": "urgency", "type": "string",
          "value": "={{ $('Parse classification').first().json.urgency }}"},
         {"id": nid("r-summary"), "name": "summary", "type": "string",
          "value": "={{ $('Parse classification').first().json.summary }}"},
         {"id": nid("r-reply"), "name": "reply", "type": "string", "value": "={{ $json.text }}"}]},
         "options": {}}},
    {"id": nid("Note"), "name": "Note", "type": "n8n-nodes-base.stickyNote", "typeVersion": 1,
     "position": [-40, -260],
     "parameters": {"width": 520, "height": 220, "content":
         "## demo-ticket-triage\nTwo LLM calls per run, two providers: **Groq** classifies, "
         "**Claude** drafts the reply. Exists so the Ops Console cost meter has real spend to count.\n\n"
         "Fire it with `scripts/fire-triage.sh`. Error workflow: ops-error-handler."}},
]

connections = {
    "Webhook": {"main": [[{"node": "Ticket", "type": "main", "index": 0}]]},
    "Ticket": {"main": [[{"node": "Classify ticket", "type": "main", "index": 0}]]},
    "Classify ticket": {"main": [[{"node": "Parse classification", "type": "main", "index": 0}]]},
    "Parse classification": {"main": [[{"node": "Draft reply", "type": "main", "index": 0}]]},
    "Draft reply": {"main": [[{"node": "Result", "type": "main", "index": 0}]]},
    "Groq Chat Model": {"ai_languageModel": [[{"node": "Classify ticket", "type": "ai_languageModel", "index": 0}]]},
    "Anthropic Chat Model": {"ai_languageModel": [[{"node": "Draft reply", "type": "ai_languageModel", "index": 0}]]},
}

wf = {"name": "demo-ticket-triage", "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1"}, "pinData": {}}
out = ROOT / "workflows/demo/demo-ticket-triage.json"
out.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
print("wrote", out.relative_to(ROOT))
