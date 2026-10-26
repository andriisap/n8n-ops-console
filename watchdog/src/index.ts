// ops-watchdog: a Cloudflare Worker that watches the n8n server from outside.
//
//   POST /ping/<check>   header X-Ping-Key   something inside n8n reports in
//   GET  /status         X-Status-Key (read-only, the dashboard) or X-Ping-Key: every check as JSON
//   cron every minute                         probe URLs, judge silence, tell Telegram on change
//
// Alerts go straight to the Telegram Bot API, never through n8n: this is the path that
// has to work when n8n doesn't.

import {
  CHECKS, canReadStatus, classifyStatus, emptyRow, evaluatePing, evaluateProbe, messageFor, sameKey,
  type Check, type ProbeCheck, type ProbeResult, type Row,
} from './logic.ts';

export interface Env {
  DB: D1Database;
  N8N_URL: string;
  DASHBOARD_URL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  PING_KEY: string;
  STATUS_KEY?: string;   // read-only key for /status (the dashboard)
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json' } });

async function loadRows(env: Env): Promise<Map<string, Row>> {
  const { results } = await env.DB.prepare('SELECT * FROM checks').all<Row>();
  const rows = new Map<string, Row>();
  for (const c of CHECKS) rows.set(c.name, emptyRow(c.name));
  for (const r of results ?? []) if (rows.has(r.name)) rows.set(r.name, r);
  return rows;
}

// last_ping_at is written by /ping alone: a ping that lands during a tick must not be undone.
function saveRow(env: Env, r: Row, now: number) {
  return env.DB.prepare(
    `INSERT INTO checks (name, state, notified, since, last_ping_at, failures, detail, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (name) DO UPDATE SET state = ?2, notified = ?3, since = ?4,
       failures = ?6, detail = ?7, updated_at = ?8`,
  ).bind(r.name, r.state, r.notified, r.since, r.last_ping_at, r.failures, r.detail, now);
}

async function probe(check: ProbeCheck, env: Env): Promise<ProbeResult> {
  const base = (check.base === 'n8n' ? env.N8N_URL : env.DASHBOARD_URL).replace(/\/+$/, '');
  try {
    const res = await fetch(base + check.path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'ops-watchdog' },
    });
    return classifyStatus(check, res.status);
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function telegram(env: Env, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function tick(env: Env, now = Date.now()): Promise<Row[]> {
  const rows = await loadRows(env);
  const probes = await Promise.all(
    CHECKS.map((c) => (c.kind === 'probe' ? probe(c, env) : Promise.resolve(null))),
  );

  const out: Row[] = [];
  for (const [i, check] of CHECKS.entries()) {
    const before = rows.get(check.name)!;
    let row = check.kind === 'ping'
      ? evaluatePing(check, before, now)
      : evaluateProbe(check, before, now, probes[i]!);

    const msg = messageFor(check, row, now);
    if (msg) {
      // Silent first contact needs no send; a real message counts only once Telegram confirms.
      const delivered = msg.text === '' || (await telegram(env, msg.text));
      if (delivered) row = { ...row, notified: msg.to };
    }
    out.push(row);
  }
  await env.DB.batch(out.map((r) => saveRow(env, r, now)));
  return out;
}

function authorized(req: Request, env: Env): boolean {
  return sameKey(req.headers.get('x-ping-key') ?? '', env.PING_KEY ?? '');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    const ping = /^\/ping\/([\w-]+)$/.exec(url.pathname);
    if (ping && req.method === 'POST') {
      if (!authorized(req, env)) return json({ error: 'unauthorized' }, 401);
      const check: Check | undefined = CHECKS.find((c) => c.name === ping[1] && c.kind === 'ping');
      if (!check) return json({ error: 'unknown check' }, 404);
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO checks (name, last_ping_at, updated_at) VALUES (?1, ?2, ?2)
         ON CONFLICT (name) DO UPDATE SET last_ping_at = ?2, updated_at = ?2`,
      ).bind(check.name, now).run();
      return json({ ok: true, check: check.name, at: new Date(now).toISOString() });
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      const headers = { statusKey: req.headers.get('x-status-key') ?? '', pingKey: req.headers.get('x-ping-key') ?? '' };
      if (!canReadStatus(headers, env)) return json({ error: 'unauthorized' }, 401);
      const rows = await loadRows(env);
      return json(CHECKS.map((c) => {
        const r = rows.get(c.name)!;
        return {
          name: c.name, label: c.label, state: r.state, detail: r.detail,
          since: r.since ? new Date(r.since).toISOString() : null,
          last_ping_at: r.last_ping_at ? new Date(r.last_ping_at).toISOString() : null,
        };
      }));
    }

    if (url.pathname === '/') return new Response('ops-watchdog\n');
    return json({ error: 'not found' }, 404);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env));
  },
} satisfies ExportedHandler<Env>;

export { tick };
