// npm test (Node 22.18+ runs TypeScript by stripping types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKS, classifyStatus, emptyRow, evaluatePing, evaluateProbe, messageFor, sameKey,
  type PingCheck, type ProbeCheck, type Row,
} from '../src/logic.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 26, 21, 0);
const heartbeat = CHECKS.find((c) => c.name === 'n8n-heartbeat') as PingCheck;
const canary = CHECKS.find((c) => c.name === 'error-handler') as PingCheck;
const n8nHttp = CHECKS.find((c) => c.name === 'n8n-http') as ProbeCheck;
const dashboard = CHECKS.find((c) => c.name === 'dashboard-http') as ProbeCheck;

// Runs one cron tick the way index.ts does, with Telegram delivery as given.
function tick(check: PingCheck | ProbeCheck, row: Row, now: number, probeStatus?: number | null, delivered = true) {
  let next = check.kind === 'ping'
    ? evaluatePing(check, row, now)
    : evaluateProbe(check, row, now, probeStatus === null
      ? { ok: false, status: null, error: 'connect ECONNREFUSED' }
      : classifyStatus(check, probeStatus!));
  const msg = messageFor(check, next, now);
  if (msg && (msg.text === '' || delivered)) next = { ...next, notified: msg.to };
  return { row: next, msg };
}

test('a ping check that never reported stays unknown and quiet', () => {
  const { row, msg } = tick(heartbeat, emptyRow('n8n-heartbeat'), T0);
  assert.equal(row.state, 'unknown');
  assert.equal(msg, null);
});

test('first signal: up, acknowledged silently', () => {
  const { row, msg } = tick(heartbeat, { ...emptyRow('n8n-heartbeat'), last_ping_at: T0 }, T0 + MIN);
  assert.equal(row.state, 'up');
  assert.equal(msg?.text, '');
  assert.equal(row.notified, 'up');
});

test('heartbeat silent past 15 min: one alert, then quiet while still down', () => {
  let r: Row = { ...emptyRow('n8n-heartbeat'), last_ping_at: T0, state: 'up', notified: 'up', since: T0 };
  let t = tick(heartbeat, r, T0 + 15 * MIN);
  assert.equal(t.row.state, 'up', 'exactly 15 min is still fine');
  t = tick(heartbeat, t.row, T0 + 16 * MIN);
  assert.equal(t.row.state, 'down');
  assert.match(t.msg!.text, /^🚨 <b>n8n schedules \(ops-heartbeat\)<\/b> is down\nno signal for 16 min \(limit 15\)/);
  t = tick(heartbeat, t.row, T0 + 17 * MIN);
  assert.equal(t.msg, null, 'no repeat');
  assert.equal(t.row.detail, 'no signal for 17 min (limit 15)');
});

test('signal returns: one recovery with how long it was down', () => {
  let r: Row = { ...emptyRow('n8n-heartbeat'), last_ping_at: T0, state: 'down', notified: 'down', since: T0 + 16 * MIN };
  r = { ...r, last_ping_at: T0 + 58 * MIN };
  const t = tick(heartbeat, r, T0 + 59 * MIN);
  assert.equal(t.row.state, 'up');
  assert.equal(t.msg!.text, '✅ <b>n8n schedules (ops-heartbeat)</b> is back (down for 43 min)');
  assert.equal(tick(heartbeat, t.row, T0 + 60 * MIN).msg, null);
});

test('canary allows 70 min: an hourly canary with a late run is not an outage', () => {
  const r: Row = { ...emptyRow('error-handler'), last_ping_at: T0, state: 'up', notified: 'up', since: T0 };
  assert.equal(tick(canary, r, T0 + 69 * MIN).row.state, 'up');
  assert.equal(tick(canary, r, T0 + 71 * MIN).row.state, 'down');
});

test('Telegram fails: the alert is retried next tick, then delivered once', () => {
  let r: Row = { ...emptyRow('n8n-heartbeat'), last_ping_at: T0, state: 'up', notified: 'up', since: T0 };
  let t = tick(heartbeat, r, T0 + 20 * MIN, undefined, false);
  assert.equal(t.row.state, 'down');
  assert.equal(t.row.notified, 'up', 'not confirmed');
  t = tick(heartbeat, t.row, T0 + 21 * MIN, undefined, true);
  assert.ok(t.msg, 'sent again');
  assert.equal(t.row.notified, 'down');
  assert.equal(tick(heartbeat, t.row, T0 + 22 * MIN).msg, null);
});

test('probe: one or two failures are a blip, the third is an outage', () => {
  let r: Row = { ...emptyRow('n8n-http'), state: 'up', notified: 'up', since: T0 };
  let t = tick(n8nHttp, r, T0 + MIN, 502);
  assert.equal(t.row.state, 'up'); assert.equal(t.row.failures, 1); assert.equal(t.msg, null);
  t = tick(n8nHttp, t.row, T0 + 2 * MIN, null);
  assert.equal(t.row.state, 'up'); assert.equal(t.row.failures, 2);
  t = tick(n8nHttp, t.row, T0 + 3 * MIN, null);
  assert.equal(t.row.state, 'down');
  assert.match(t.msg!.text, /n8n web \(\/healthz\)<\/b> is down\nconnect ECONNREFUSED/);
});

test('probe: a success in between resets the streak', () => {
  let r: Row = { ...emptyRow('n8n-http'), state: 'up', notified: 'up', since: T0 };
  r = tick(n8nHttp, r, T0 + MIN, 502).row;
  r = tick(n8nHttp, r, T0 + 2 * MIN, 502).row;
  r = tick(n8nHttp, r, T0 + 3 * MIN, 200).row;
  assert.equal(r.failures, 0);
  r = tick(n8nHttp, r, T0 + 4 * MIN, 502).row;
  assert.equal(r.state, 'up');
});

test('dashboard: 401 from basic auth counts as up, 404 (container dropped by traefik) as down', () => {
  assert.equal(classifyStatus(dashboard, 401).ok, true);
  assert.equal(classifyStatus(dashboard, 200).ok, true);
  assert.equal(classifyStatus(dashboard, 404).ok, false);
  assert.equal(classifyStatus(n8nHttp, 401).ok, false);
});

test('first ever probe failing three times alerts even without an earlier up', () => {
  let r = emptyRow('n8n-http');
  for (let i = 1; i <= 3; i++) r = tick(n8nHttp, r, T0 + i * MIN, 502).row;
  assert.equal(r.state, 'down');
  assert.equal(r.notified, 'down');
});

test('labels are escaped for Telegram HTML', () => {
  const evil: PingCheck = { name: 'x', kind: 'ping', label: '<b>&', maxSilenceMin: 1 };
  const r: Row = { ...emptyRow('x'), last_ping_at: T0, state: 'up', notified: 'up', since: T0 };
  assert.match(tick(evil, r, T0 + 5 * MIN).msg!.text, /&lt;b&gt;&amp;/);
});

test('ping key comparison', () => {
  assert.equal(sameKey('abc123', 'abc123'), true);
  assert.equal(sameKey('abc123', 'abc124'), false);
  assert.equal(sameKey('', ''), false, 'an unset key never matches');
  assert.equal(sameKey('abc', 'abc123'), false);
});
