// Runs lib/metrics.ts against a scratch Postgres with migrations 001-005 (PGHOST, PGPORT, PGUSER,
// PGDATABASE, as the database tests). Truncates the incident tables. Skipped when PGDATABASE is unset.
//   PGHOST=/tmp PGPORT=5433 PGUSER=ops PGDATABASE=ops npm test
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { byClass, daily, filterQuery, parseFilter, summary, topNodes, workflowOptions, type MetricsFilter } from '../src/lib/metrics.ts';

const live = !!process.env.PGDATABASE;
const pool = live ? new pg.Pool({ max: 2 }) : null;
const q = (sql: string) => pool!.query(sql);
const F = (patch: Partial<MetricsFilter> = {}): MetricsFilter => ({ days: 7, workflow: null, hideTest: false, ...patch });

let n = 0;
// One failure, written the way upsert-incident.sql leaves it: an incident per (workflow, node, class).
async function fail(workflow: string, node: string, cls: string, hoursAgo: number, opts: { retryOf?: string } = {}) {
  const id = String(++n);
  const fp = `${workflow}|${node}|${cls}`;
  const { rows } = await pool!.query(
    `INSERT INTO incidents (fingerprint, workflow_id, workflow_name, node_name, error_class, error_message, first_seen_at, last_seen_at)
     VALUES ($1, 'wf-' || $2, $2, $3, $4, 'x', now() - make_interval(hours => $5), now() - make_interval(hours => $5))
     ON CONFLICT (fingerprint) DO UPDATE SET occurrences = incidents.occurrences + 1,
       first_seen_at = least(incidents.first_seen_at, excluded.first_seen_at)
     RETURNING id`, [fp, workflow, node, cls, hoursAgo]);
  await pool!.query(
    `INSERT INTO error_events (incident_id, execution_id, workflow_id, workflow_name, node_name, error_class, error_message, occurred_at, retry_of)
     VALUES ($1, $2, 'wf-' || $3, $3, $4, $5, 'x', now() - make_interval(hours => $6), $7)`,
    [rows[0].id, id, workflow, node, cls, hoursAgo, opts.retryOf ?? null]);
  return { incident: Number(rows[0].id), execution: id };
}

before(async () => {
  if (!live) return;
  await q('TRUNCATE incidents, error_events, retry_queue, incident_status_log RESTART IDENTITY CASCADE');
  await fail('billing-sync', 'Call Stripe', 'rate_limit', 1);
  await fail('billing-sync', 'Call Stripe', 'rate_limit', 30);
  await fail('billing-sync', 'Call Stripe', 'rate_limit', 50);
  await fail('billing-sync', 'Write CRM', 'auth', 2);
  await fail('chaos-auth', 'Call API', 'auth', 3);
  await fail('chaos-auth', 'Call API', 'auth', 4, { retryOf: '5' });           // a failed retry: not a failure
  await fail('billing-sync', 'Call Stripe', 'rate_limit', 24 * 10);            // 10 days ago: previous 7-day period
  const canary = await fail('chaos-canary', 'Fail on purpose', 'unknown', 1);  // ignored: never counted
  await q(`UPDATE incidents SET status = 'ignored' WHERE id = ${canary.incident}`);

  // recovery: chaos-recover failed 100 s ago, the automatic retry succeeded just now
  const rec = await fail('chaos-recover', 'Call API', 'transient', 0);
  await q(`UPDATE error_events SET occurred_at = now() - interval '100 seconds' WHERE execution_id = '${rec.execution}'`);
  await q(`INSERT INTO retry_queue (error_event_id, incident_id, execution_id, workflow_id, idempotency_key, status, attempt)
           SELECT id, incident_id, execution_id, workflow_id, 'k1', 'succeeded', 2 FROM error_events WHERE execution_id = '${rec.execution}'`);
  // a retry that gave up: counted as retried, not recovered
  const dead = await fail('chaos-timeout', 'Call slow API', 'transient', 5);
  await q(`INSERT INTO retry_queue (error_event_id, incident_id, execution_id, workflow_id, idempotency_key, status, attempt)
           SELECT id, incident_id, execution_id, workflow_id, 'k2', 'dead', 5 FROM error_events WHERE execution_id = '${dead.execution}'`);

  // a resolution: Write CRM incident open 2 h, resolved after 30 min
  await q(`UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE node_name = 'Write CRM'`);
  await q(`UPDATE incident_status_log SET changed_at = now() - interval '90 minutes' WHERE to_status = 'resolved'`);
});

after(async () => { await pool?.end(); });

test('summary counts original failures only, without ignored incidents', { skip: !live }, async () => {
  const s = await summary(pool!, F());
  assert.equal(s.failures, 7);            // 3 Stripe + CRM + chaos-auth + recover + timeout
  assert.equal(s.failures_before, 1);     // the 10-day-old one
  assert.equal(s.incidents_hit, 5);
  assert.equal(s.incidents_new, 4);       // Stripe incident first seen 10 days ago is not new
});

test('recovery and resolution times', { skip: !live }, async () => {
  const s = await summary(pool!, F());
  assert.equal(s.recover.n, 1);
  assert.equal(Math.round(s.recover.median_s!), 100);
  assert.equal(s.retried, 2);             // one succeeded, one dead
  assert.equal(s.resolve.n, 1);
  assert.equal(Math.round(s.resolve.median_s! / 60), 30);   // opened 2 h ago, resolved 90 min ago
  assert.equal(s.resolve.backfilled, 0);
});

test('no data: zeros and nulls, not errors', { skip: !live }, async () => {
  const s = await summary(pool!, F({ workflow: 'wf-nothing' }));
  assert.equal(s.failures, 0);
  assert.equal(s.recover.n, 0);
  assert.equal(s.recover.median_s, null);
  assert.deepEqual(await topNodes(pool!, F({ workflow: 'wf-nothing' })), []);
  const days = await daily(pool!, F({ workflow: 'wf-nothing' }));
  assert.equal(days.length, 7);
  assert.ok(days.every((d) => d.total === 0));
});

test('top nodes, most failures first, with the dominant class', { skip: !live }, async () => {
  const t = await topNodes(pool!, F());
  assert.equal(t[0].node_name, 'Call Stripe');
  assert.equal(t[0].failures, 3);
  assert.equal(t[0].top_class, 'rate_limit');
  assert.ok(!t.some((x) => x.workflow_name === 'chaos-canary'));
});

test('classes add up to 100 %', { skip: !live }, async () => {
  const c = await byClass(pool!, F());
  assert.deepEqual(c.map((x) => [x.error_class, x.failures]), [['rate_limit', 3], ['auth', 2], ['transient', 2]]);
  assert.equal(Math.round(c.reduce((a, x) => a + x.share, 0) * 1000), 1000);
});

test('daily: every day of the period, split by class', { skip: !live }, async () => {
  const d = await daily(pool!, F({ days: 30 }));
  assert.equal(d.length, 30);
  assert.equal(d.reduce((a, x) => a + x.total, 0), 8);
  for (const day of d) assert.equal(Object.values(day.by_class).reduce((a, x) => a + x, 0), day.total);
});

test('hiding test workflows and filtering by workflow', { skip: !live }, async () => {
  assert.equal((await summary(pool!, F({ hideTest: true }))).failures, 4);
  assert.equal((await summary(pool!, F({ hideTest: true }))).recover.n, 0);
  assert.equal((await summary(pool!, F({ workflow: 'wf-chaos-recover' }))).recover.n, 1);
  assert.equal((await summary(pool!, F({ workflow: 'wf-billing-sync' }))).failures, 4);
  assert.equal((await summary(pool!, F({ days: 30 }))).failures, 8);
});

test('workflow options for the filter', { skip: !live }, async () => {
  const w = await workflowOptions(pool!);
  assert.deepEqual(w.find((x) => x.workflow_name === 'chaos-auth'), { workflow_id: 'wf-chaos-auth', workflow_name: 'chaos-auth', test: true });
  assert.equal(w.find((x) => x.workflow_name === 'billing-sync')!.test, false);
});

test('filter parsing never throws and links stay short', () => {
  assert.deepEqual(parseFilter({}), { days: 7, workflow: null, hideTest: false });
  assert.deepEqual(parseFilter({ days: '30', wf: 'abc', test: 'hide' }), { days: 30, workflow: 'abc', hideTest: true });
  assert.equal(parseFilter({ days: '9999' }).days, 7);
  assert.equal(parseFilter({ wf: 'x'.repeat(65) }).workflow, null);
  assert.equal(filterQuery(F()), '');
  assert.equal(filterQuery(F(), { days: 30, hideTest: true }), '?days=30&test=hide');
  assert.equal(filterQuery(F({ workflow: 'a b' })), '?wf=a+b');
});
