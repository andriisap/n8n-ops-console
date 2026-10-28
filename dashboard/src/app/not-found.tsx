import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="card state">
      <h2>Not found</h2>
      <p>This page or incident doesn&apos;t exist, or it was removed.</p>
      <Link href="/">Incidents</Link> · <Link href="/metrics">Metrics</Link> · <Link href="/costs">Costs</Link>
    </main>
  );
}
