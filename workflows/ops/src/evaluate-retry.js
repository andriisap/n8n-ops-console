// Code node "Evaluate result" in ops-retry-scheduler. Mode: Run Once for Each Item.
// Turns the response of POST /api/v1/executions/{id}/retry into one outcome for the job.
// Behaviour of the endpoint, from the n8n 2.42.5 source:
//   200 -> the retry ran to the end (the call waits for it); body.status = success | error | ...
//   409 -> "The execution succeeded, so it cannot be retried."            (already recovered)
//          "Execution is queued to run (not yet started) ..."            (try again later)
//          "The execution was aborted before starting ..."               (can never be retried)
//   404 -> execution not found, e.g. pruned by execution data retention

const job = $('Claim due retries').item.json;
const res = $json;

const out = {
  id: job.id,
  outcome: 'failed',           // succeeded | failed | requeue | dead
  retry_execution_id: null,
  error: null,
  api_key_rejected: false,
};

const messageOf = (body) =>
  typeof body === 'string' ? body : String(body?.message ?? body?.error ?? '');

if (res.error) {
  // HTTP node set to continue on error: network failure, timeout, DNS...
  out.error = `request failed: ${messageOf(res.error) || JSON.stringify(res.error)}`;
} else {
  const code = Number(res.statusCode);
  const body = res.body ?? {};
  const msg = messageOf(body);

  if (code === 200) {
    out.retry_execution_id = body.id != null ? String(body.id) : null;
    if (body.status === 'success') {
      out.outcome = 'succeeded';
    } else {
      out.error = `retry execution ${body.id ?? '?'} ended with status ${body.status ?? 'unknown'}`;
    }
  } else if (code === 409 && /succeeded/i.test(msg)) {
    out.outcome = 'succeeded';   // someone else already recovered it; nothing left to do
  } else if (code === 409 && /queued/i.test(msg)) {
    out.outcome = 'requeue';     // not our failure, don't spend an attempt
    out.error = msg;
  } else if (code === 409 && /aborted/i.test(msg)) {
    out.outcome = 'dead';        // n8n has no data to retry from
    out.error = msg;
  } else if (code === 404) {
    out.outcome = 'dead';
    out.error = 'execution not found: it may have been pruned';
  } else if (code === 401 || code === 403) {
    out.outcome = 'requeue';     // our configuration problem: keep the job, fail the run loudly
    out.api_key_rejected = true;
    out.error = `n8n API rejected the API key (HTTP ${code}): unauthorized`;
  } else {
    out.error = `HTTP ${code}: ${msg}`;
  }
}

if (out.error) out.error = out.error.slice(0, 1000);
return { json: out };
