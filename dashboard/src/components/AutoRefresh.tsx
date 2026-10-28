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

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span className="size-[7px] rounded-full bg-resolved shadow-[0_0_0_3px_var(--resolved-bg)]" aria-hidden />
      live · refreshes every {seconds}s
    </span>
  );
}
