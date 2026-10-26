// Pure decision logic of the watchdog: no I/O, so it is tested with node --test.
//
// Two kinds of check:
//   ping  - something inside n8n reports in; silence longer than maxSilenceMin = down.
//           A check that never reported is 'unknown' and stays quiet, so the watchdog can
//           be deployed before n8n is wired up.
//   probe - the watchdog requests a URL; failuresToAlert failures in a row = down,
//           one success = up. A single blip doesn't page anyone.
//
// Telegram hears only about changes: `notified` is the state Telegram last confirmed.
// A message is due whenever state != notified, so a failed send is retried next minute
// and a confirmed one is never repeated.

export type State = 'unknown' | 'up' | 'down';

export type PingCheck = { name: string; kind: 'ping'; label: string; maxSilenceMin: number };
export type ProbeCheck = {
  name: string; kind: 'probe'; label: string;
  path: string; base: 'n8n' | 'dashboard'; okStatus: number[]; failuresToAlert: number;
};
export type Check = PingCheck | ProbeCheck;

export type Row = {
  name: string;
  state: State;
  notified: State;
  since: number | null;
  last_ping_at: number | null;
  failures: number;
  detail: string | null;
};

export const CHECKS: Check[] = [
  { name: 'n8n-heartbeat', kind: 'ping', label: 'n8n schedules (ops-heartbeat)', maxSilenceMin: 15 },
  { name: 'error-handler', kind: 'ping', label: 'Alert pipeline (ops-error-handler canary)', maxSilenceMin: 70 },
  { name: 'n8n-http', kind: 'probe', label: 'n8n web (/healthz)', base: 'n8n', path: '/healthz', okStatus: [200], failuresToAlert: 3 },
  // Behind traefik basic auth: 401 means traefik routed to a healthy container.
  // An unhealthy or stopped container gives 404 or 502, the failure seen on 2026-10-13.
  { name: 'dashboard-http', kind: 'probe', label: 'Ops dashboard', base: 'dashboard', path: '/api/health', okStatus: [200, 401], failuresToAlert: 3 },
];

export function emptyRow(name: string): Row {
  return { name, state: 'unknown', notified: 'unknown', since: null, last_ping_at: null, failures: 0, detail: null };
}

function withState(row: Row, state: State, now: number, detail: string | null): Row {
  if (row.state === state) return { ...row, since: row.since ?? now, detail: state === 'up' ? row.detail : detail };
  // Coming back up: remember how long it was down, for the recovery message.
  const back = row.state === 'down' && state === 'up' && row.since !== null
    ? `down for ${duration(now - row.since)}` : detail;
  return { ...row, state, since: now, detail: state === 'up' ? back : detail };
}

export function evaluatePing(check: PingCheck, row: Row, now: number): Row {
  if (row.last_ping_at === null) return withState(row, 'unknown', now, 'no signal yet');
  const silentMin = (now - row.last_ping_at) / 60_000;
  return silentMin > check.maxSilenceMin
    ? withState(row, 'down', now, `no signal for ${Math.floor(silentMin)} min (limit ${check.maxSilenceMin})`)
    : withState(row, 'up', now, null);
}

export type ProbeResult = { ok: true; status: number } | { ok: false; status: number | null; error: string };

export function evaluateProbe(check: ProbeCheck, row: Row, now: number, result: ProbeResult): Row {
  if (result.ok) return { ...withState(row, 'up', now, null), failures: 0 };
  const failures = row.failures + 1;
  const detail = result.status !== null ? `HTTP ${result.status}` : result.error;
  if (failures >= check.failuresToAlert) return { ...withState(row, 'down', now, detail), failures };
  // Not enough failures yet: keep the current state, remember the streak.
  return { ...row, failures, detail, since: row.since ?? now };
}

export function classifyStatus(check: ProbeCheck, status: number): ProbeResult {
  return check.okStatus.includes(status) ? { ok: true, status } : { ok: false, status, error: `HTTP ${status}` };
}

export type Message = { name: string; to: State; text: string };

// What Telegram should hear for this row, if anything.
// unknown → up is silent (first contact). Anything → down alerts. down → up recovers.
export function messageFor(check: Check, row: Row, now: number): Message | null {
  if (row.state === row.notified) return null;
  if (row.state === 'unknown') return null;
  if (row.state === 'up' && row.notified === 'unknown') return { name: row.name, to: 'up', text: '' }; // silent ack
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (row.state === 'down') {
    return {
      name: row.name, to: 'down',
      text: `🚨 <b>${esc(check.label)}</b> is down\n${esc(row.detail ?? '')}\n\nFrom the watchdog on Cloudflare, outside the server.`,
    };
  }
  return {
    name: row.name, to: 'up',
    text: `✅ <b>${esc(check.label)}</b> is back${row.detail ? ` (${esc(row.detail)})` : ''}`,
  };
}

export function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

// /status is read-only: the dashboard gets STATUS_KEY, which can't send pings, so a
// compromised dashboard can't fake "n8n is alive". PING_KEY may read it too (for curl).
export function canReadStatus(headers: { statusKey: string; pingKey: string }, keys: { STATUS_KEY?: string; PING_KEY?: string }): boolean {
  return sameKey(headers.statusKey, keys.STATUS_KEY ?? '') || sameKey(headers.pingKey, keys.PING_KEY ?? '');
}

// Constant-time comparison for the ping key.
export function sameKey(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
