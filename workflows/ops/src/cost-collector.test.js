// Runs finished-ids.js outside n8n against pages shaped like GET /api/v1/executions.
// Usage: node workflows/ops/src/cost-collector.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, 'finished-ids.js'), 'utf8');
const run = (...pages) =>
  new Function('$input', code)({ all: () => pages.map((json) => ({ json })) })[0].json;

const e = (id, status) => ({ id, status, workflowId: 'wf', startedAt: '2026-10-26T14:00:00Z' });

let r = run(
  { data: [e('5', 'success'), e('6', 'error'), e('7', 'waiting')], nextCursor: 'abc' },
  { data: [e('8', 'crashed'), e('9', 'canceled'), e('5', 'success')], nextCursor: null },
);
assert.deepStrictEqual(r.ids, ['5', '6', '8', '9']);
assert.strictEqual(r.listed, 6);
console.log('ok  finished ids across pages, waiting left for later, duplicates once');

r = run({ data: [], nextCursor: null });
assert.deepStrictEqual(r, { ids: [], listed: 0 });
console.log('ok  empty listing');

r = run({ message: 'unauthorized' });
assert.deepStrictEqual(r.ids, []);
console.log('ok  a page without data does not crash');

console.log('all cost collector tests passed');
