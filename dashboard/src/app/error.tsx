'use client';

// Shown when a server component throws, e.g. the database is down.
// The full error is logged on the server; the browser only gets Next's digest id.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="card state" role="alert">
      <h2>This page can&apos;t load right now</h2>
      <p>The ops database may be unreachable. n8n and its alerts keep working without the dashboard.</p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
      {error.digest && (
        <div className="small" style={{ marginTop: 10 }}>
          Error id {error.digest}: search for it in <code>docker logs</code> of the dashboard.
        </div>
      )}
    </main>
  );
}
