import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva('inline-block rounded-full px-2 py-px text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      open: 'bg-open-bg text-open',
      resolved: 'bg-resolved-bg text-resolved',
      ignored: 'bg-ignored-bg text-ignored',
      neutral: 'border border-border text-muted',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
