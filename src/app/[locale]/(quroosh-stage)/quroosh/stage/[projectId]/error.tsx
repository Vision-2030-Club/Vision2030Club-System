'use client';

import { useEffect } from 'react';

/**
 * What the stage screen shows if the page itself fails: the stage's navy and
 * nothing else, never an error message in front of the hall. It tries again
 * by itself every few seconds (`retry` reads the page again), since nobody is
 * at the stage's computer to press a button.
 */
export default function StageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    const timer = window.setInterval(retry, 5000);
    return () => window.clearInterval(timer);
  }, [retry]);

  return <div className="fixed inset-0 z-50 cursor-none bg-brand-950" />;
}
