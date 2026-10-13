import type { Metadata } from 'next';
import Link from 'next/link';
import AutoRefresh from '@/components/AutoRefresh';
import './globals.css';

export const metadata: Metadata = {
  title: 'n8n Ops Console',
  description: 'Incidents from every n8n workflow, grouped and deduplicated.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <h1><Link href="/">n8n Ops Console</Link></h1>
              <span>incidents</span>
            </div>
            <AutoRefresh seconds={10} />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
