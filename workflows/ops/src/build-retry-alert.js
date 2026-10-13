// Code node "Build retry alert" in ops-retry-scheduler. Mode: Run Once for Each Item.
// Telegram hears about the end of a retry story only: recovered, or given up.

const r = $json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const base = $('Config').first().json.n8n_public_url.replace(/\/+$/, '');
const link = (id) => `${base}/workflow/${encodeURIComponent(r.workflow_id)}/executions/${encodeURIComponent(id)}`;

const who = `<b>${esc(r.workflow_name)}</b>${r.node_name ? ` → ${esc(r.node_name)}` : ''}`;
const how = r.kind === 'manual' ? 'manual replay' : `attempt ${r.attempt}/${r.max_attempts}`;

const lines = r.status === 'succeeded'
  ? [
      `✅ <b>Recovered</b> · incident #${r.incident_id}`,
      who,
      `Execution ${esc(r.execution_id)} succeeded on ${how}.`,
    ]
  : [
      `💀 <b>Gave up retrying</b> · incident #${r.incident_id}`,
      who,
      `Execution ${esc(r.execution_id)} still fails after ${how}.`,
      r.last_error ? `<code>${esc(String(r.last_error).slice(0, 300))}</code>` : '',
    ];

if (r.retry_execution_id) lines.push(`<a href="${esc(link(r.retry_execution_id))}">Open retry execution ${esc(r.retry_execution_id)}</a>`);

return { json: { text: lines.filter(Boolean).join('\n') } };
