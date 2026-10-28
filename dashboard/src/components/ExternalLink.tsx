import { ArrowUpRight } from 'lucide-react';

// A link to n8n or a provider's page: opens in a new tab and says so with an icon.
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
      <ArrowUpRight className="ml-0.5 inline size-3.5 align-[-2px]" aria-label="(opens in a new tab)" />
    </a>
  );
}
