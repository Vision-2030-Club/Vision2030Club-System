'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { isIOS, isPushSupported, isStandalone, registerServiceWorker } from '@/lib/push-client';

const DISMISSED_KEY = 'push-nudge-dismissed';

/**
 * One line on the dashboard for anyone who has not turned notifications on,
 * pointing at the card on their profile. Renders nothing until it knows —
 * a banner that flashes and disappears for subscribed people would be worse
 * than none — and stays dismissed per device.
 */
export function PushNudge({ profileHref }: { profileHref: string }) {
  const t = useTranslations('push');
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function decide() {
      try {
        if (window.localStorage.getItem(DISMISSED_KEY)) return;
      } catch {
        // Storage can be unavailable (private mode); the nudge just shows.
      }

      // A Safari tab on iOS cannot subscribe, but installing is step one, so
      // the nudge applies there too. Anywhere else: only if push exists.
      if (isIOS() && !isStandalone()) return setShow(true);
      if (!isPushSupported()) return;
      if (Notification.permission === 'denied') return;

      try {
        const registration = await registerServiceWorker();
        const existing = await registration.pushManager.getSubscription();
        if (!cancelled && !existing) setShow(true);
      } catch {
        // No worker, no push — nothing to nudge about.
      }
    }

    void decide();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Fine — it will show again next time.
    }
    setShow(false);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
      <span className="text-ink">{t('nudge')}</span>
      <span className="ms-auto flex items-center gap-3">
        <Link href={profileHref} className="font-medium text-brand-700 hover:underline">
          {t('nudgeLink')}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="text-ink-muted hover:text-ink"
        >
          {t('nudgeDismiss')}
        </button>
      </span>
    </div>
  );
}
