// Code node "Build alert" in ops-error-handler. Telegram HTML mode, so every value is escaped.

const row = $input.first().json;                       // from "Upsert incident"
const e = $('Normalize error').first().json;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

const title = row.is_reopened
  ? `🟠 <b>Reopened incident #${row.incident_id}</b> (reopened ${row.reopened_count}×)`
  : `🔴 <b>New incident #${row.incident_id}</b>`;

const lines = [
  title,
  `<b>${esc(e.workflow_name)}</b>${e.node_name ? ` → ${esc(e.node_name)}` : ''}`,
  `Class: <code>${esc(e.error_class)}</code>${e.http_status ? ` · HTTP ${e.http_status}` : ''}`,
  '',
  `<pre>${esc(cut(e.error_message, 600))}</pre>`,
];

if (e.execution_url) lines.push(`<a href="${esc(e.execution_url)}">Open execution ${esc(e.execution_id)}</a>`);

return [{ json: { text: lines.join('\n') } }];
