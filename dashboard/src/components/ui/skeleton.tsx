import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none', className)} {...props} />
  );
}
