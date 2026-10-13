// Runs normalize-error.js outside n8n against payloads shaped like the Error Trigger output.
// Usage: node workflows/ops/src/normalize-error.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, 'normalize-error.js'), 'utf8');

function run(payload) {
  const $input = { first: () => ({ json: payload }) };
  return new Function('$input', code)($input)[0].json;
}

const wf = { id: 'wf429', name: 'chaos-429' };
const exec = (id, error, node = 'Call API') => ({
  execution: { id, url: `https://n8n.example/workflow/wf/executions/${id}`, mode: 'webhook', lastNodeExecuted: node, error },
  workflow: wf,
});

const cases = [
  ['429 via httpCode', exec('1', { message: 'The service is receiving too many requests from you', httpCode: '429' }), 'rate_limit'],
  ['401', exec('2', { message: 'Authorization failed - please check your credentials', httpCode: '401' }), 'auth'],
  ['503', exec('3', { message: 'The service is not available', httpCode: '503' }), 'transient'],
  ['timeout', exec('4', { message: 'timeout of 3000ms exceeded', code: 'ECONNABORTED' }), 'transient'],
  // Exact message n8n 2.42.5 produced for chaos-timeout on the real server (2026-10-13).
  ['timeout (n8n 2.42)', exec('4b', { message: 'The connection was aborted, perhaps the server is offline' }), 'transient'],
  ['invalid JSON', exec('5', { name: 'SyntaxError', message: "Expected ',' or '}' after property value in JSON at position 87" }), 'validation'],
  // Exact message from the real server for chaos-invalid-json.
  ['invalid JSON (n8n)', exec('5b', { message: 'Unexpected token \'S\', "Sure! Here"... is not valid JSON [line 5]' }), 'validation'],
  ['unknown', exec('6', { message: 'Something odd happened' }), 'unknown'],
  ['trigger failure', { trigger: { error: { message: 'Cron misfire' }, mode: 'trigger' }, workflow: wf }, 'unknown'],
];

for (const [label, payload, expected] of cases) {
  const out = run(payload);
  assert.strictEqual(out.error_class, expected, `${label}: got ${out.error_class}`);
  console.log(`ok  ${label.padEnd(18)} → ${out.error_class}`);
}

// Two runs of the same problem must normalize to the same text, so they share a fingerprint.
const a = run(exec('10', { message: 'Request 7f3c9e1a-1111-4222-8333-444455556666 failed at 2026-10-13T09:57:39.029Z after 3000ms' }));
const b = run(exec('11', { message: 'Request 0a1b2c3d-9999-4888-8777-666655554444 failed at 2026-10-14T10:00:00.000Z after 2999ms' }));
assert.strictEqual(a.normalized_message, b.normalized_message);
console.log(`ok  same problem, same text: "${a.normalized_message}"`);

const t = run({ trigger: { error: { message: 'x' } }, workflow: wf });
assert.ok(t.execution_id.startsWith('trigger:wf429:'));
console.log('ok  trigger failure gets a synthetic execution id');

console.log('\nall normalize tests passed');
