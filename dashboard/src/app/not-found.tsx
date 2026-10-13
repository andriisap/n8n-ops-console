import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="card empty">
      Incident not found. <Link href="/">Back to all incidents</Link>
    </main>
  );
}
