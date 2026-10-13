// Tests for the JavaScript of ops-retry-scheduler, run outside n8n.
// Usage: node workflows/ops/src/retry-scheduler.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const load = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const evaluateCode = load('evaluate-retry.js');
const alertCode = load('build-retry-alert.js');

const job = { id: 7, execution_id: '692', workflow_id: 'wfX', attempt: 2, max_attempts: 5 };

function evaluate(response) {
  const $ = (name) => {
    assert.strictEqual(name, 'Claim due retries');
    return { item: { json: job } };
  };
  return new Function('$json', '$', evaluateCode)(response, $).json;
}

function alert(row) {
  const $ = () => ({ first: () => ({ json: { n8n_public_url: 'https://n8n.example/' } }) });
  return new Function('$json', '$', alertCode)(row, $).json.text;
}

const cases = [
  ['200 + success → succeeded', { statusCode: 200, body: { id: '801', status: 'success' } },
    { outcome: 'succeeded', retry_execution_id: '801', error: null }],
  ['200 + error → failed attempt', { statusCode: 200, body: { id: '802', status: 'error' } },
    { outcome: 'failed', retry_execution_id: '802' }],
  ['409 already succeeded → succeeded', { statusCode: 409, body: { message: 'The execution succeeded, so it cannot be retried.' } },
    { outcome: 'succeeded' }],
  ['409 queued → requeue, attempt not spent', { statusCode: 409, body: { message: 'Execution is queued to run (not yet started) so it cannot be retried' } },
    { outcome: 'requeue' }],
  ['409 aborted → dead', { statusCode: 409, body: { message: 'The execution was aborted before starting, so it cannot be retried' } },
    { outcome: 'dead' }],
  ['404 → dead (pruned)', { statusCode: 404, body: { message: 'Not Found' } }, { outcome: 'dead' }],
  ['401 → requeue + fail the run loudly', { statusCode: 401, body: { message: 'unauthorized' } },
    { outcome: 'requeue', api_key_rejected: true }],
  ['500 → failed attempt', { statusCode: 500, body: 'Internal Server Error' }, { outcome: 'failed' }],
  ['network error → failed attempt', { error: { message: 'connect ECONNREFUSED 127.0.0.1:5678' } },
    { outcome: 'failed' }],
];

for (const [label, response, expected] of cases) {
  const out = evaluate(response);
  assert.strictEqual(out.id, job.id, `${label}: job id`);
  for (const [k, v] of Object.entries(expected)) assert.deepStrictEqual(out[k], v, `${label}: ${k} = ${out[k]}`);
  console.log(`ok  ${label}`);
}

assert.ok(evaluate({ statusCode: 500, body: 'x'.repeat(5000) }).error.length <= 1000);
console.log('ok  error text is capped at 1000 chars');

const recovered = alert({ status: 'succeeded', incident_id: 4, workflow_name: 'chaos-flaky', node_name: 'Call flaky API',
  kind: 'auto', attempt: 2, max_attempts: 5, execution_id: '692', retry_execution_id: '801', workflow_id: 'wfX' });
assert.ok(recovered.includes('Recovered') && recovered.includes('attempt 2/5'));
assert.ok(recovered.includes('https://n8n.example/workflow/wfX/executions/801'));
console.log('ok  recovered alert names the attempt and links the retry execution');

const dead = alert({ status: 'dead', incident_id: 1, workflow_name: 'chaos-429', node_name: null, kind: 'auto',
  attempt: 5, max_attempts: 5, execution_id: '661', retry_execution_id: '900', last_error: 'retry <b> ended', workflow_id: 'w' });
assert.ok(dead.includes('Gave up') && dead.includes('5/5') && dead.includes('&lt;b&gt;'));
console.log('ok  give-up alert shows the attempts and escapes the error text');

const manual = alert({ status: 'succeeded', incident_id: 1, workflow_name: 'x', kind: 'manual', attempt: 1, max_attempts: 1,
  execution_id: '1', retry_execution_id: null, workflow_id: 'w' });
assert.ok(manual.includes('manual replay') && !manual.includes('Open retry'));
console.log('ok  manual replay alert reads as a replay');

console.log('\nall retry scheduler tests passed');
