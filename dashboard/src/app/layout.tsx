import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import AutoRefresh from '@/components/AutoRefresh';
import NavLinks from '@/components/NavLinks';
import SystemStrip from '@/components/SystemStrip';
import ThemeSwitch, { type Theme } from '@/components/ThemeSwitch';
import './globals.css';

export const metadata: Metadata = {
  title: 'n8n Ops Console',
  description: 'Incidents, retries, LLM costs and recovery metrics from every n8n workflow.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const saved = (await cookies()).get('theme')?.value;
  const theme: Theme = saved === 'light' || saved === 'dark' ? saved : 'system';
  return (
    <html lang="en" data-theme={theme === 'system' ? undefined : theme}>
      <body>
        <div className="mx-auto max-w-[1120px] px-4 pt-6 pb-16">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-baseline gap-2.5">
              <h1 className="m-0 text-lg font-semibold tracking-tight whitespace-nowrap">
                <Link href="/" className="text-fg hover:no-underline">
                  n8n Ops Console
                </Link>
              </h1>
              <NavLinks />
            </div>
            <div className="flex items-center gap-3">
              <AutoRefresh seconds={10} />
              <ThemeSwitch initial={theme} />
            </div>
          </header>
          <SystemStrip />
          {children}
        </div>
      </body>
    </html>
  );
}
