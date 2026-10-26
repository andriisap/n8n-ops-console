// Runs build-budget-alert.js outside n8n. Usage: node workflows/ops/src/budget-alert.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, 'build-budget-alert.js'), 'utf8');
const build = (row) => new Function('$json', code)(row).json;

const row = {
  day: '2026-10-26', kind: 'daily_budget', threshold: '0.0005', spent: '0.00063363',
  calls: '10', runs: '5', unpriced: '0',
  workflows: [{ workflow_name: 'demo-ticket-triage', cost: 0.00063363, runs: 5 }],
};

let r = build(row);
assert.ok(r.text.startsWith('💸 <b>LLM budget exceeded</b> · 2026-10-26 (UTC)'));
assert.ok(r.text.includes('Spent $0.00063 of $0.00050 today: 10 calls in 5 runs.'));
assert.ok(r.text.includes('• demo-ticket-triage: $0.00063 in 5 runs'));
assert.ok(!r.text.includes('no price yet'));
assert.deepStrictEqual([r.day, r.kind], ['2026-10-26', 'daily_budget']);
console.log('ok  small amounts keep 5 decimals, top workflow listed');

r = build({ ...row, threshold: '5', spent: '12.3456', unpriced: '3' });
assert.ok(r.text.includes('Spent $12.35 of $5.00 today'));
assert.ok(r.text.includes('⚠️ 3 calls have no price yet'));
console.log('ok  dollars rounded to cents, unpriced calls warned about');

r = build({ ...row, workflows: [{ workflow_name: '<script>', cost: null, runs: 1 }] });
assert.ok(r.text.includes('• &lt;script&gt;: no price in 1 runs'));
console.log('ok  names escaped for Telegram HTML, missing cost shown as "no price"');

console.log('all budget alert tests passed');
