import Link from 'next/link';
import { Card } from '@/components/ui/card';

export default function NotFound() {
  return (
    <Card className="px-4 py-10 text-center text-muted">
      <h2 className="mb-1.5 text-base font-semibold text-fg">Not found</h2>
      <p className="mb-3.5">This page or incident doesn&apos;t exist, or it was removed.</p>
      <Link href="/">Incidents</Link> · <Link href="/metrics">Metrics</Link> · <Link href="/costs">Costs</Link>
    </Card>
  );
}
