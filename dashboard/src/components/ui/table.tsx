import { cn } from '@/lib/utils';

// Plain table parts with the console's look. A wide table scrolls inside its card on phones,
// and that scroll area can be reached and scrolled with the keyboard; `fit` tables fold
// columns instead and never scroll.
export function Table({
  className,
  fit,
  label,
  ...props
}: React.ComponentProps<'table'> & { fit?: boolean; label?: string }) {
  return (
    <div
      className="overflow-x-auto"
      {...(!fit && { tabIndex: 0, role: 'region', 'aria-label': label ?? 'Table, scrolls sideways' })}
    >
      <table className={cn('w-full border-collapse', !fit && 'min-w-[560px]', className)} {...props} />
    </div>
  );
}

export function TableHead({ className, numeric, ...props }: React.ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        'border-b border-border px-3.5 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr className={cn('border-b border-border last:border-b-0 [tbody_&]:hover:bg-surface-2', className)} {...props} />
  );
}

export function TableCell({ className, numeric, ...props }: React.ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      className={cn('px-3.5 py-3 align-top', numeric && 'text-right font-mono whitespace-nowrap', className)}
      {...props}
    />
  );
}
