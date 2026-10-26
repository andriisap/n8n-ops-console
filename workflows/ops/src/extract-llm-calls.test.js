// Runs extract-llm-calls.js outside n8n against a real execution captured on the server.
// Usage: node workflows/ops/src/extract-llm-calls.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, 'extract-llm-calls.js'), 'utf8');
// Execution 35791 of demo-ticket-triage on n8n 2.42.5 (2026-10-26), IP and credential ids redacted.
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/execution-demo-triage.json'), 'utf8'));

function run(...executions) {
  const $input = { all: () => executions.map((json) => ({ json })) };
  return new Function('$input', code)($input)[0].json;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok  ${name}`); }

test('real execution: two calls, one per model node, chain nodes not counted', () => {
  const r = run(real);
  assert.strictEqual(r.calls.length, 2);
  const byNode = Object.fromEntries(r.calls.map((c) => [c.node_name, c]));
  assert.deepStrictEqual(Object.keys(byNode).sort(), ['Anthropic Chat Model', 'Groq Chat Model']);
});

test('real execution: provider, model and tokens as n8n recorded them', () => {
  const r = run(real);
  const g = r.calls.find((c) => c.node_name === 'Groq Chat Model');
  const a = r.calls.find((c) => c.node_name === 'Anthropic Chat Model');
  assert.deepStrictEqual(
    [g.provider, g.model, g.input_tokens, g.output_tokens, g.estimated],
    ['groq', 'openai/gpt-oss-20b', 147, 136, false]);
  assert.deepStrictEqual(
    [a.provider, a.model, a.input_tokens, a.output_tokens, a.estimated],
    ['anthropic', 'claude-haiku-5-5', 123, 139, false]);
  assert.strictEqual(a.execution_id, '35791');
  assert.strictEqual(a.workflow_id, 'hbuLLmZWicq9fXSt');
  assert.strictEqual(a.workflow_name, 'demo-ticket-triage');
  assert.strictEqual(a.started_at, '2026-10-26T14:22:46.095Z');
  assert.strictEqual(a.run_index, 0);
});

test('real execution: marked scanned with its call count', () => {
  const r = run(real);
  assert.deepStrictEqual(r.executions, [{
    execution_id: '35791', workflow_id: 'hbuLLmZWicq9fXSt', workflow_name: 'demo-ticket-triage',
    execution_status: 'success', started_at: '2026-10-26T14:22:46.095Z', llm_calls: 2,
  }]);
});

test('a model node that ran 3 times (agent loop) = 3 calls with run_index 0..2', () => {
  const e = clone(real);
  const runs = e.data.resultData.runData['Groq Chat Model'];
  runs.push(clone(runs[0]), clone(runs[0]));
  const r = run(e);
  const groq = r.calls.filter((c) => c.node_name === 'Groq Chat Model').map((c) => c.run_index);
  assert.deepStrictEqual(groq, [0, 1, 2]);
});

test('streaming: tokenUsageEstimate is taken and flagged estimated', () => {
  const e = clone(real);
  const out = e.data.resultData.runData['Anthropic Chat Model'][0].data.ai_languageModel[0][0].json;
  out.tokenUsageEstimate = out.tokenUsage;
  delete out.tokenUsage;
  const a = run(e).calls.find((c) => c.node_name === 'Anthropic Chat Model');
  assert.strictEqual(a.estimated, true);
  assert.strictEqual(a.input_tokens, 123);
});

test('a failed LLM call (no usage) records nothing for that run', () => {
  const e = clone(real);
  e.status = 'error';
  e.data.resultData.runData['Anthropic Chat Model'][0].data = {
    ai_languageModel: [[{ json: { error: { message: 'overloaded' } } }]],
  };
  const r = run(e);
  assert.deepStrictEqual(r.calls.map((c) => c.node_name), ['Groq Chat Model']);
  assert.strictEqual(r.executions[0].execution_status, 'error');
  assert.strictEqual(r.executions[0].llm_calls, 1);
});

test('unfinished or data-less executions are skipped, not marked scanned', () => {
  const waiting = { ...clone(real), id: '1', status: 'waiting' };
  const noData = { ...clone(real), id: '2' };
  delete noData.data;
  const r = run(waiting, noData);
  assert.deepStrictEqual(r.executions, []);
  assert.deepStrictEqual(r.calls, []);
  assert.deepStrictEqual(r.skipped.map((s) => s.id), ['1', '2']);
});

test('an execution without LLM nodes is scanned with 0 calls', () => {
  const e = clone(real);
  e.id = '3';
  for (const n of ['Groq Chat Model', 'Anthropic Chat Model']) delete e.data.resultData.runData[n];
  const r = run(e);
  assert.strictEqual(r.calls.length, 0);
  assert.strictEqual(r.executions[0].llm_calls, 0);
});

test('model falls back to the node parameter, "models/" prefix dropped, expressions ignored', () => {
  const e = clone(real);
  const run0 = e.data.resultData.runData['Groq Chat Model'][0];
  delete run0.inputOverride;
  e.workflowData.nodes.find((n) => n.name === 'Groq Chat Model').parameters.model = 'models/some-model';
  assert.strictEqual(run(e).calls.find((c) => c.node_name === 'Groq Chat Model').model, 'some-model');
  e.workflowData.nodes.find((n) => n.name === 'Groq Chat Model').parameters.model = '={{ $json.m }}';
  assert.strictEqual(run(e).calls.find((c) => c.node_name === 'Groq Chat Model').model, 'unknown');
});

test('unknown model node type still gets a readable provider', () => {
  const e = clone(real);
  e.workflowData.nodes.find((n) => n.name === 'Groq Chat Model').type = '@n8n/n8n-nodes-langchain.lmChatFooBar';
  assert.strictEqual(run(e).calls.find((c) => c.node_name === 'Groq Chat Model').provider, 'foobar');
});

console.log(`all ${passed} extract tests passed`);
