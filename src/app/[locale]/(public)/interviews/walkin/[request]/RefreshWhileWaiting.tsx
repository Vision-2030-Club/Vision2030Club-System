'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-reads the status page every ten seconds while it is on screen, until reception has answered. */
export function RefreshWhileWaiting() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 10_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
