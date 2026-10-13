// Code node "Build fallback alert": runs when the ops database can't be written.
// The alert must still go out, otherwise a dead database turns every failure silent.

const e = $('Normalize error').first().json;

// n8n's error output puts the error under `error`, usually as an object, sometimes a string.
// On a connection failure the Postgres node sets message to "Failed query: <the whole SQL>",
// so the real cause has to be searched for across the whole error, not taken from `message`.
const KNOWN_CAUSES = [
  /getaddrinfo \w+ [\w.-]+/i,                       // host can't be resolved (container stopped)
  /connect ECONNREFUSED [\w.:]+/i,                  // host up, nothing listening
  /connect ETIMEDOUT [\w.:]+/i,
  /password authentication failed for user "?[\w-]+"?/i,
  /database "?[\w-]+"? does not exist/i,
  /Connection terminated[\w ]*/i,
  /too many clients already/i,
  /timeout exceeded when trying to connect/i,
];

function describeDbError(item) {
  const err = item.error ?? item;
  if (typeof err === 'string') return err;

  let all = '';
  try { all = JSON.stringify(err); } catch { /* circular, fall through */ }
  for (const re of KNOWN_CAUSES) {
    const m = re.exec(all);
    if (m) return m[0];
  }

  const isQueryDump = (s) => typeof s === 'string' && /^\s*Failed query:/i.test(s);
  const readable = [err.description, err.cause?.message, err.message]
    .filter((s) => typeof s === 'string' && s.trim() && !isQueryDump(s));
  if (readable.length) return readable[0];
  return all ? all.slice(0, 300) : 'unknown database error';
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

const lines = [
  '⚠️ <b>Ops DB unavailable, alerting without dedup</b>',
  `DB error: <code>${esc(cut(describeDbError($input.first().json), 300))}</code>`,
  '',
  `<b>${esc(e.workflow_name)}</b>${e.node_name ? ` → ${esc(e.node_name)}` : ''}`,
  `Class: <code>${esc(e.error_class)}</code>`,
  `<pre>${esc(cut(e.error_message, 600))}</pre>`,
];

if (e.execution_url) lines.push(`<a href="${esc(e.execution_url)}">Open execution ${esc(e.execution_id)}</a>`);

return [{ json: { text: lines.join('\n') } }];
