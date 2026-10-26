import { db } from './db';

// System status for the strip under the header. Two sources:
//   - the watchdog on Cloudflare (outside the server): the authority on whether n8n,
//     its schedules and the alert pipeline are alive. Read with a read-only key.
//   - ops-db heartbeats: what the collector and ops-heartbeat last wrote.
// The page renders even when either source is unreachable; it says so instead.

export type CheckState = 'up' | 'down' | 'unknown';
export type WatchdogCheck = {
  name: string;
  label: string;
  state: CheckState;
  detail: string | null;
  since: string | null;
  last_ping_at: string | null;
};
export type SystemStatus = {
  watchdog: { reachable: true; checks: WatchdogCheck[] } | { reachable: false; reason: string } | null; // null: not configured
  beats: { source: string; last_beat_at: Date }[];
};

async function watchdog(): Promise<SystemStatus['watchdog']> {
  const url = process.env.WATCHDOG_URL?.replace(/\/+$/, '');
  const key = process.env.WATCHDOG_STATUS_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/status`, {
      headers: { 'x-status-key': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { reachable: false, reason: `HTTP ${res.status}` };
    return { reachable: true, checks: (await res.json()) as WatchdogCheck[] };
  } catch (e) {
    return { reachable: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function beats(): Promise<SystemStatus['beats']> {
  try {
    const { rows } = await db().query<{ source: string; last_beat_at: Date }>(
      `SELECT source, last_beat_at FROM heartbeats ORDER BY source`,
    );
    return rows;
  } catch {
    return [];
  }
}

export async function systemStatus(): Promise<SystemStatus> {
  const [w, b] = await Promise.all([watchdog(), beats()]);
  return { watchdog: w, beats: b };
}
