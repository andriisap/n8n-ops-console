// Runs finished-ids.js outside n8n against pages shaped like the public API's listings.
// Usage: node workflows/ops/src/cost-collector.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, 'finished-ids.js'), 'utf8');
function run(workflowPages, ...pages) {
  const $ = (name) => {
    assert.strictEqual(name, 'List workflows');
    if (workflowPages === 'throw') throw new Error('node did not run');
    return { all: () => workflowPages.map((json) => ({ json })) };
  };
  return new Function('$input', '$', code)({ all: () => pages.map((json) => ({ json })) }, $)[0].json;
}

const e = (id, status, workflowId = 'wfLLM') => ({ id, status, workflowId, startedAt: '2026-10-26T14:00:00Z' });
const workflows = [{ data: [
  { id: 'wfLLM', nodes: [{ type: 'n8n-nodes-base.webhook' }, { type: '@n8n/n8n-nodes-langchain.lmChatGroq' }] },
  { id: 'wfOpenAi', nodes: [{ type: '@n8n/n8n-nodes-langchain.lmOpenAi' }] },
  { id: 'wfPlain', nodes: [{ type: 'n8n-nodes-base.errorTrigger' }, { type: 'n8n-nodes-base.postgres' }] },
], nextCursor: null }];

let r = run(workflows,
  { data: [e('5', 'success'), e('6', 'error'), e('7', 'waiting')], nextCursor: 'abc' },
  { data: [e('8', 'crashed'), e('9', 'canceled'), e('5', 'success')], nextCursor: null },
);
assert.deepStrictEqual(r.ids, ['5', '6', '8', '9']);
assert.strictEqual(r.listed, 6);
console.log('ok  finished ids across pages, waiting left for later, duplicates once');

r = run(workflows, { data: [e('10', 'success', 'wfPlain'), e('11', 'success', 'wfOpenAi'), e('12', 'success', 'wfPlain')] });
assert.deepStrictEqual(r.ids, ['11']);
assert.deepStrictEqual(r.no_llm.map((x) => x.execution_id), ['10', '12']);
assert.deepStrictEqual(r.no_llm[0], { execution_id: '10', workflow_id: 'wfPlain', execution_status: 'success', started_at: '2026-10-26T14:00:00Z' });
console.log('ok  executions of workflows without a model node are marked, not downloaded');

r = run(workflows, { data: [e('13', 'success', 'wfDeleted')] });
assert.deepStrictEqual(r.ids, []);
assert.deepStrictEqual(r.no_llm.map((x) => x.execution_id), ['13']);
console.log('ok  a workflow that no longer exists counts as no model node');

r = run('throw', { data: [e('14', 'success', 'wfPlain')] });
assert.deepStrictEqual(r.ids, ['14']);
assert.deepStrictEqual(r.no_llm, []);
console.log('ok  no workflow list: download everything rather than miss costs');

r = run(workflows, { data: [], nextCursor: null });
assert.deepStrictEqual(r, { ids: [], no_llm: [], listed: 0 });
console.log('ok  empty listing');

r = run(workflows, { message: 'unauthorized' });
assert.deepStrictEqual(r.ids, []);
console.log('ok  a page without data does not crash');

console.log('all cost collector tests passed');
