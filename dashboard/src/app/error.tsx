'use client';

import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// Shown when a server component throws, e.g. the database is down.
// The full error is logged on the server; the browser only gets Next's digest id.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card role="alert" className="px-4 py-10 text-center text-muted">
      <h2 className="mb-1.5 text-base font-semibold text-fg">This page can&apos;t load right now</h2>
      <p className="mb-3.5">
        The ops database may be unreachable. n8n and its alerts keep working without the dashboard.
      </p>
      <Button onClick={reset}>
        <RotateCw aria-hidden /> Try again
      </Button>
      {error.digest && (
        <div className="mt-2.5 text-xs">
          Error id {error.digest}: search for it in <code>docker logs</code> of the dashboard.
        </div>
      )}
    </Card>
  );
}
