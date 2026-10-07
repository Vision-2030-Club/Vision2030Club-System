'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-reads the page every `seconds` while it is on screen (a soft refresh:
 * scroll and open panels stay), so the room view of the floor keeps up
 * with arrivals without anyone pressing anything — the same idea as the
 * company board's polling (CompanyBoard), for a page with no client state.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
