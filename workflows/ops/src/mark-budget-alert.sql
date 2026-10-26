-- Postgres node "Mark budget alert sent", after Telegram confirmed delivery.
-- $1 = {day, kind} from "Check budget".
UPDATE cost_alerts
SET sent_at = now()
WHERE day = ($1::jsonb->>'day')::date
  AND kind = $1::jsonb->>'kind'
  AND sent_at IS NULL
RETURNING day::text AS day, kind, sent_at;
