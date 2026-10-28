import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Shown while a page's queries run on navigation. Same shapes as the pages, no numbers.
export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Loading">
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface px-3.5 py-3">
            <Skeleton className="h-2.5 w-[55%]" />
            <Skeleton className="mt-2.5 h-5 w-[35%]" />
          </div>
        ))}
      </div>
      <Card>
        {[90, 70, 80, 60, 75].map((w, i) => (
          <Skeleton key={i} className="m-3.5 h-3" style={{ width: `${w}%` }} />
        ))}
      </Card>
    </main>
  );
}
