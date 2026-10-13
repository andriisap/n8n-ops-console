import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Readiness: can the dashboard reach the ops database? For monitoring and debugging.
// The reason is logged in full (docker logs) but only a short code goes to the client.
export async function GET() {
  try {
    await db().query('SELECT 1');
    return Response.json({ ok: true, database: 'reachable' });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error(`[ready] database check failed: ${e.code ?? ''} ${e.message ?? String(err)}`);
    return Response.json({ ok: false, database: 'unreachable', code: e.code ?? null }, { status: 503 });
  }
}
