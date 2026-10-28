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
  description: 'Incidents and LLM costs from every n8n workflow.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const saved = (await cookies()).get('theme')?.value;
  const theme: Theme = saved === 'light' || saved === 'dark' ? saved : 'system';
  return (
    <html lang="en" data-theme={theme === 'system' ? undefined : theme}>
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <h1>
                <Link href="/">n8n Ops Console</Link>
              </h1>
              <NavLinks />
            </div>
            <div className="top-right">
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
