import Link from 'next/link';
import { cn } from '@/lib/utils';

// Tabs that are links: each state of the page has its own URL. The current one is marked
// with aria-current, which is also what the styles key on.
export function LinkTabs({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <nav aria-label={label} className={cn('flex flex-wrap gap-1', className)}>
      {children}
    </nav>
  );
}

export function LinkTab({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-lg border border-transparent px-3 py-1.5 font-medium text-muted hover:bg-surface-2 hover:no-underline',
        active && 'border-border bg-surface text-fg',
      )}
    >
      {children}
      {count !== undefined && <span className="ml-1.5 font-mono text-xs text-muted">{count}</span>}
    </Link>
  );
}
