'use client';

// Shown when a server component throws, e.g. the database is down.
// The full error is logged on the server; the browser only gets Next's digest id.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="card empty">
      Can&apos;t load incidents right now. The ops database may be unreachable.{' '}
      <button className="btn" onClick={reset}>Try again</button>
      {error.digest && <div className="node" style={{ marginTop: 8 }}>Error id: {error.digest} (see docker logs)</div>}
    </main>
  );
}
