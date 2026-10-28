-- Deterministic demo data for the end-to-end tests and the before/after screenshots.
-- Times are relative to now(), so the pages always show "x min. ago" and fill the last
-- 7 and 30 days. Run against a scratch database with all migrations applied:
--   psql -v ON_ERROR_STOP=1 -f dashboard/e2e/seed.sql
-- It truncates every ops table first.

BEGIN;

TRUNCATE incidents, error_events, retry_queue, incident_status_log, llm_usage, cost_scans, cost_alerts
  RESTART IDENTITY CASCADE;
DELETE FROM heartbeats;

-- One incident per problem. Statuses cover every tab; first_seen_at drives the openings log.
INSERT INTO incidents (fingerprint, workflow_id, workflow_name, node_name, error_class, error_message,
                       status, occurrences, reopened_count, first_seen_at, last_seen_at, resolved_at, last_alerted_at)
VALUES
  ('fp-429',    'wf-crm',   'crm-lead-sync',      'HubSpot: upsert contact', 'rate_limit',
   'The service is receiving too many requests from you', 'open', 6, 0,
   now() - interval '6 days', now() - interval '12 minutes', NULL, now() - interval '6 days'),
  ('fp-ship',   'wf-ship',  'order-shipping',     'Carrier API: create waybill', 'transient',
   'The connection was aborted, perhaps the server is offline', 'open', 4, 1,
   now() - interval '5 days', now() - interval '3 hours', NULL, now() - interval '3 hours'),
  ('fp-groq',   'wf-triage','demo-ticket-triage', 'Classify ticket', 'auth',
   'Authorization failed - please check your credentials', 'open', 1, 0,
   now() - interval '40 minutes', now() - interval '40 minutes', NULL, now() - interval '40 minutes'),
  ('fp-json',   'wf-inv',   'invoice-intake',     'Parse LLM reply', 'validation',
   'Unexpected token ''S'', "Sure! Here"... is not valid JSON [line <n>]', 'open', 3, 0,
   now() - interval '4 days', now() - interval '2 days', NULL, now() - interval '4 days'),
  ('fp-total',  'wf-rep',   'weekly-report',      'Code', 'unknown',
   'Cannot read properties of undefined (reading ''total'')', 'open', 1, 0,
   now() - interval '3 days', now() - interval '3 days', NULL, now() - interval '3 days'),
  ('fp-canary', 'wf-canary','chaos-canary',       'Fail on purpose', 'unknown',
   'chaos-canary: deliberate failure', 'open', 9, 0,
   now() - interval '9 hours', now() - interval '20 minutes', NULL, NULL);

-- Failed runs. Ids are stable so the tests can look for them.
INSERT INTO error_events (incident_id, execution_id, workflow_id, workflow_name, node_name, error_class,
                          error_message, execution_url, execution_mode, occurred_at, error_raw)
SELECT i.id, e.execution_id, i.workflow_id, i.workflow_name, i.node_name, i.error_class, e.message,
       'https://n8n.example.com/workflow/' || i.workflow_id || '/executions/' || e.execution_id,
       'webhook', now() - e.ago, jsonb_build_object('message', e.message)
  FROM (VALUES
    ('fp-429',   '1001', interval '6 days',     'The service is receiving too many requests from you'),
    ('fp-429',   '1002', interval '5 days',     'The service is receiving too many requests from you'),
    ('fp-429',   '1003', interval '3 days',     'The service is receiving too many requests from you'),
    ('fp-429',   '1004', interval '2 days',     'The service is receiving too many requests from you'),
    ('fp-429',   '1005', interval '1 day',      'The service is receiving too many requests from you'),
    ('fp-429',   '1006', interval '12 minutes', 'The service is receiving too many requests from you'),
    ('fp-ship',  '2001', interval '5 days',     'The connection was aborted, perhaps the server is offline'),
    ('fp-ship',  '2002', interval '4 days',     'The connection was aborted, perhaps the server is offline'),
    ('fp-ship',  '2003', interval '1 day',      'The connection was aborted, perhaps the server is offline'),
    ('fp-ship',  '2004', interval '3 hours',    'The connection was aborted, perhaps the server is offline'),
    ('fp-groq',  '3001', interval '40 minutes', 'Invalid API Key'),
    ('fp-json',  '4001', interval '4 days',     'Unexpected token ''S'', "Sure! Here"... is not valid JSON [line 5]'),
    ('fp-json',  '4002', interval '3 days',     'Unexpected token ''S'', "Sure! Here"... is not valid JSON [line 5]'),
    ('fp-json',  '4003', interval '2 days',     'Unexpected token ''S'', "Sure! Here"... is not valid JSON [line 5]'),
    ('fp-total', '5001', interval '3 days',     'Cannot read properties of undefined (reading ''total'')'),
    ('fp-canary','6001', interval '20 minutes', 'chaos-canary: deliberate failure')
  ) AS e(fp, execution_id, ago, message)
  JOIN incidents i ON i.fingerprint = e.fp;

-- Retries: two automatic recoveries, one give-up, one waiting, and the manual Replay of the
-- bad key that succeeded after the fix. The insert trigger fills execution, workflow, incident.
ALTER TABLE retry_queue DISABLE TRIGGER retry_queue_updated_at;
INSERT INTO retry_queue (error_event_id, incident_id, execution_id, workflow_id, idempotency_key,
                         kind, status, attempt, max_attempts, next_attempt_at, retry_execution_id, last_error,
                         updated_at)
SELECT e.id, e.incident_id, e.execution_id, e.workflow_id, 'seed-' || e.execution_id,
       r.kind, r.status, r.attempt, r.max_attempts, e.occurred_at + r.next_in, r.retry_execution_id, r.last_error,
       e.occurred_at + r.done_in
  FROM (VALUES
    ('2001', 'auto',   'succeeded', 2, 5, interval '30 seconds', '2011', NULL,                interval '74 seconds'),
    ('2003', 'auto',   'succeeded', 1, 5, interval '30 seconds', '2013', NULL,                interval '41 seconds'),
    ('1005', 'auto',   'dead',      5, 5, interval '8 minutes',  NULL,   'HTTP 429 after 5 attempts', interval '8 minutes'),
    ('2004', 'auto',   'pending',   1, 5, interval '3 hours 5 minutes', NULL, 'HTTP 503',     interval '1 minute'),
    ('3001', 'manual', 'succeeded', 1, 1, interval '30 minutes', '3011', NULL,                interval '31 minutes')
  ) AS r(execution_id, kind, status, attempt, max_attempts, next_in, retry_execution_id, last_error, done_in)
  JOIN error_events e ON e.execution_id = r.execution_id;
ALTER TABLE retry_queue ENABLE TRIGGER retry_queue_updated_at;

-- Status changes after the fact, as a person would make them; the trigger logs each one,
-- then the log gets the times they "happened".
UPDATE incidents SET status = 'resolved', resolved_at = now() - interval '1 day'  WHERE fingerprint = 'fp-json';
UPDATE incidents SET status = 'resolved', resolved_at = now() - interval '2 days' WHERE fingerprint = 'fp-total';
UPDATE incidents SET status = 'ignored' WHERE fingerprint = 'fp-canary';
UPDATE incident_status_log l
   SET changed_at = coalesce(i.resolved_at, i.first_seen_at + interval '5 minutes'), changed_by = 'ops_dashboard'
  FROM incidents i
 WHERE i.id = l.incident_id AND l.to_status <> 'open';

-- LLM usage: twelve ordinary triage runs over the week, one long ticket, and the replayed run.
INSERT INTO llm_usage (execution_id, workflow_id, workflow_name, node_name, provider, model,
                       input_tokens, output_tokens, started_at, execution_status)
SELECT 't' || g, 'wf-triage', 'demo-ticket-triage', m.node, m.provider, m.model,
       m.base_in + (g * 7) % 11, m.base_out + (g * 13) % 40,
       now() - make_interval(hours => g * 11), 'success'
  FROM generate_series(1, 12) g,
       (VALUES ('Groq Chat Model', 'groq', 'openai/gpt-oss-20b', 147, 90),
               ('Anthropic Chat Model', 'anthropic', 'claude-haiku-5-5', 123, 125)) AS m(node, provider, model, base_in, base_out);

INSERT INTO llm_usage (execution_id, workflow_id, workflow_name, node_name, provider, model,
                       input_tokens, output_tokens, started_at, execution_status)
VALUES
  ('t-long', 'wf-triage', 'demo-ticket-triage', 'Groq Chat Model',      'groq',      'openai/gpt-oss-20b', 5389, 107, now() - interval '2 days', 'success'),
  ('t-long', 'wf-triage', 'demo-ticket-triage', 'Anthropic Chat Model', 'anthropic', 'claude-haiku-5-5',   7440, 400, now() - interval '2 days', 'success'),
  ('3011',   'wf-triage', 'demo-ticket-triage', 'Groq Chat Model',      'groq',      'openai/gpt-oss-20b',  147, 116, now() - interval '9 minutes', 'success'),
  ('3011',   'wf-triage', 'demo-ticket-triage', 'Anthropic Chat Model', 'anthropic', 'claude-haiku-5-5',    123, 145, now() - interval '9 minutes', 'success');

INSERT INTO heartbeats (source, last_beat_at) VALUES ('ops-cost-collector', now() - interval '20 seconds');

COMMIT;
