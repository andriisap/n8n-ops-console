export const dynamic = 'force-dynamic';

// Liveness: the Node process is up and serving. Deliberately does NOT touch the database.
// Docker's healthcheck uses this, and traefik drops unhealthy containers silently, so a
// database problem must not take the whole dashboard off the network. With the app still
// reachable, the user sees "database unreachable" on the page instead of a bare 404.
// Database status lives at /api/ready.
export async function GET() {
  return Response.json({ ok: true });
}
