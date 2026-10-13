// Usage: node workflows/ops/src/build-fallback-alert.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, 'build-fallback-alert.js'), 'utf8');
const normalized = { workflow_name: 'chaos-auth', node_name: 'Call API', error_class: 'auth',
  error_message: 'Authorization failed', execution_id: '773', execution_url: 'https://n8n.example/e/773' };

function run(item) {
  const $input = { first: () => ({ json: item }) };
  const $ = () => ({ first: () => ({ json: normalized }) });
  return new Function('$input', '$', code)($input, $)[0].json.text;
}

const queryDump = 'Failed query: -- Postgres node "Upsert incident" in ops-error-handler.\nWITH input AS (SELECT ...';

const cases = [
  // Shape seen on n8n 2.42.5 with ops-db stopped: message is the SQL, cause sits elsewhere.
  ['query dump + cause in description', { error: { message: queryDump, description: 'getaddrinfo ENOTFOUND ops-db' } }, 'getaddrinfo ENOTFOUND ops-db'],
  // Exact cause the live server reported with ops-db stopped (2026-10-13, execution 779).
  ['live: container stopped', { error: { message: queryDump, description: 'getaddrinfo EAI_AGAIN ops-db' } }, 'getaddrinfo EAI_AGAIN ops-db'],
  ['query dump + cause nested deeper', { error: { message: queryDump, context: { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 172.18.0.3:5432' } } } }, 'connect ECONNREFUSED 172.18.0.3:5432'],
  ['query dump, unknown cause', { error: { message: queryDump, description: 'something new went wrong' } }, 'something new went wrong'],
  ['wrong password', { error: { message: 'password authentication failed for user "ops"' } }, 'password authentication failed for user "ops"'],
  ['error as string', { error: 'connection refused' }, 'connection refused'],
  ['error with no message', { error: { code: 'X1' } }, '{"code":"X1"}'],
];

for (const [label, item, expected] of cases) {
  const text = run(item);
  assert.ok(!text.includes('[object Object]'), `${label}: printed [object Object]`);
  assert.ok(!text.includes('Failed query'), `${label}: printed the SQL dump`);
  assert.ok(text.includes(expected), `${label}: expected "${expected}" in\n${text}`);
  console.log(`ok  ${label}`);
}
console.log('\nall fallback alert tests passed');
