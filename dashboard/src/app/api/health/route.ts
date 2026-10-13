import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Used by the container healthcheck. 200 only when the database answers.
export async function GET() {
  try {
    await db().query('SELECT 1');
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'database unreachable' }, { status: 503 });
  }
}
