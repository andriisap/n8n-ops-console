'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Incidents', match: (p: string) => p === '/' || p.startsWith('/incidents') },
  { href: '/metrics', label: 'Metrics', match: (p: string) => p.startsWith('/metrics') },
  { href: '/costs', label: 'Costs', match: (p: string) => p.startsWith('/costs') },
];

export default function NavLinks() {
  const path = usePathname() ?? '/';
  return (
    <nav className="mainnav" aria-label="Sections">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(path) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
