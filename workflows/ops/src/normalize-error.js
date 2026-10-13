// Code node "Normalize error" in ops-error-handler.
// Turns the Error Trigger payload into one flat record and decides the error class.
// The fingerprint is computed in SQL (md5), so this node needs no crypto module.

const input = $input.first().json;
const exec = input.execution ?? {};
const trig = input.trigger ?? {};      // present when a trigger node failed, not a regular node
const wf = input.workflow ?? {};
const err = exec.error ?? trig.error ?? {};

const message = String(err.message ?? 'Unknown error');
const description = err.description ? String(err.description) : '';

function httpStatus() {
  const candidates = [err.httpCode, err.status, err.statusCode, err.cause?.status];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n >= 100 && n <= 599) return n;
  }
  const m = /\b(?:status code|HTTP)\s*(\d{3})\b/i.exec(`${message} ${description}`);
  return m ? Number(m[1]) : null;
}

const http = httpStatus();
const text = `${err.name ?? ''} ${err.code ?? ''} ${message} ${description}`;

// Order matters: the first matching rule wins.
function classify() {
  if (http === 429 || /too many requests|rate.?limit|quota exceeded/i.test(text)) return 'rate_limit';
  if (http === 401 || http === 403 ||
      /unauthori[sz]ed|forbidden|authorization failed|invalid api key|invalid token|credentials/i.test(text)) return 'auth';
  if ((http !== null && (http >= 500 || http === 408)) ||
      /timeout|timed out|ETIMEDOUT|ECONNABORTED|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|service unavailable|bad gateway|not available|connection was aborted|connection (?:refused|reset|closed)|server is offline/i.test(text)) return 'transient';
  if (/SyntaxError|JSON|unexpected token|validation|invalid|schema|required/i.test(text)) return 'validation';
  return 'unknown';
}

// Strips the parts of a message that change between runs, so one problem gets one fingerprint.
function normalize(msg) {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<ts>')
    .replace(/https?:\/\/[^\s?#]+[^\s]*/g, (url) => url.split(/[?#]/)[0])
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')   // no \b: "3000ms" has no word boundary between 0 and m
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

const executionId = exec.id
  ? String(exec.id)
  : `trigger:${wf.id ?? 'unknown'}:${Date.now()}`;   // trigger failures have no execution

return [{
  json: {
    execution_id: executionId,
    execution_url: exec.url ?? null,
    execution_mode: exec.mode ?? trig.mode ?? null,
    retry_of: exec.retryOf ?? null,
    workflow_id: String(wf.id ?? 'unknown'),
    workflow_name: String(wf.name ?? 'unknown'),
    node_name: exec.lastNodeExecuted ?? err.node?.name ?? null,
    http_status: http,
    error_class: classify(),
    error_message: message.slice(0, 2000),
    normalized_message: normalize(message),
    error_raw: {
      name: err.name ?? null,
      message: message.slice(0, 2000),
      description: description.slice(0, 2000) || null,
      http_code: err.httpCode ?? null,
      code: err.code ?? null,
      stack: err.stack ? String(err.stack).slice(0, 4000) : null,
    },
  },
}];
