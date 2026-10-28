import { Badge } from '@/components/ui/badge';
import { CLASS_TEXT } from '@/lib/error-classes';
import type { ErrorClass, Status } from '@/lib/incidents';
import { cn } from '@/lib/utils';

export function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={status}>{status}</Badge>;
}

// Colour plus the class name itself: identity is never carried by colour alone.
export function ClassLabel({ value, className }: { value: ErrorClass; className?: string }) {
  return (
    <span className={cn('font-mono text-xs whitespace-nowrap', CLASS_TEXT[value], className)}>
      <span aria-hidden>● </span>
      {value}
    </span>
  );
}
