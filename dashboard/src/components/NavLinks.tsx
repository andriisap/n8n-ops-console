'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Incidents', match: (p: string) => p === '/' || p.startsWith('/incidents') },
  { href: '/metrics', label: 'Metrics', match: (p: string) => p.startsWith('/metrics') },
  { href: '/costs', label: 'Costs', match: (p: string) => p.startsWith('/costs') },
];

export default function NavLinks() {
  const path = usePathname() ?? '/';
  return (
    <nav className="flex gap-0.5" aria-label="Sections">
      {LINKS.map((l) => {
        const active = l.match(path);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-0.5 text-[13px] font-medium text-muted hover:bg-surface-2 hover:no-underline',
              active && 'bg-surface text-fg shadow-[inset_0_0_0_1px_var(--border)]',
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
