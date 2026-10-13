'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Re-runs the server components every few seconds. Pauses while the tab is hidden.
export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, seconds]);

  return <span className="live">live · refreshes every {seconds}s</span>;
}
