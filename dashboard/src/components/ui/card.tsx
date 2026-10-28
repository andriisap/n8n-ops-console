import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)} {...props} />;
}

// The one message a card shows when it has nothing to list.
export function EmptyState({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-4 py-12 text-center text-muted', className)} {...props} />;
}

export function Stat({
  label,
  value,
  children,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface px-3.5 py-3', className)}>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono text-lg font-semibold">{value}</div>
      {children && <div className="mt-0.5 text-xs text-muted">{children}</div>}
    </div>
  );
}

export function Section({
  title,
  children,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-6', className)}>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
