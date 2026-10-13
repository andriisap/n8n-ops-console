'use client';

// Shown when a server component throws, e.g. the database is down.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="card empty">
      Can&apos;t load incidents right now. The ops database may be unreachable.{' '}
      <button className="btn" onClick={reset}>Try again</button>
    </main>
  );
}
